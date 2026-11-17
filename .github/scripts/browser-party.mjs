// Messenger98 exercised with actual app windows and independent simulated people.
// Own servers are closed on every exit path. No public relays or accounts are used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const ROOT = process.env.SITE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = process.env.PARTY_SHOTS || path.join(ROOT, '.ci-shots');
fs.mkdirSync(SHOTS, {recursive:true});
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.mp3':'audio/mpeg'};
const server = http.createServer((req,res) => {
    let filename;
    try { filename = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname)); } catch (_) {res.writeHead(400);return res.end();}
    if (filename !== ROOT && !filename.startsWith(ROOT + path.sep)) {res.writeHead(403);return res.end();}
    if (fs.existsSync(filename) && fs.statSync(filename).isDirectory()) filename=path.join(filename,'index.html');
    if (!fs.existsSync(filename)) {res.writeHead(404);return res.end();}
    res.setHeader('Content-Type',types[path.extname(filename)] || 'application/octet-stream');fs.createReadStream(filename).pipe(res);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const BASE = 'http://127.0.0.1:' + server.address().port;
const relayPort = 8700 + Math.floor(Math.random()*90);
const relay = spawn(process.execPath,[path.join(ROOT,'server/nostr-test-relay.mjs')],{env:{...process.env,PORT:String(relayPort)},stdio:'ignore'});
const browser = await chromium.launch(process.env.PW_CHROMIUM ? {executablePath:process.env.PW_CHROMIUM} : {});
const errors=[];let checks=0;
const check=(condition,label) => {assert.ok(condition,label);checks++;console.log('  ok  '+label);};
const FAKE_PEERJS = String.raw`
(function () {
    const wire = new BroadcastChannel('fake-peerjs');
    const emitter = o => {
        const on = {};
        o.on = (k, f) => { (on[k] = on[k] || []).push(f); return o; };
        o.emit = (k, v) => (on[k] || []).slice().forEach(f => f(v));
        return o;
    };
    const everyConn = window.__conns = [];
    function Peer(id) {
        const self = emitter(this), conns = new Map();
        self.id = id || 'guest-' + Math.random().toString(36).slice(2, 8);
        function conn(other) {
            const c = emitter({ peer: other });
            c.send = d => wire.postMessage({ k: 'data', from: self.id, to: other, d });
            c.close = () => {
                if (c.closed) return;
                c.closed = true;
                wire.postMessage({ k: 'close', from: self.id, to: other });
                c.emit('close');
            };
            conns.set(other, c);
            everyConn.push(c);
            return c;
        }
        wire.addEventListener('message', ev => {
            const m = ev.data;
            if (m.to !== self.id) return;
            if (m.k === 'offer') {
                wire.postMessage({ k: 'here', from: self.id, to: m.from });
                if (localStorage.getItem('test-direct') === 'noroute') return;
                const c = conn(m.from);
                self.emit('connection', c);
                setTimeout(() => { wire.postMessage({ k: 'answer', from: self.id, to: m.from }); c.emit('open'); }, 5);
            } else if (m.k === 'here') {
                const c = conns.get(m.from);
                if (c) c.found = true;
            } else if (m.k === 'answer') {
                const c = conns.get(m.from);
                if (c) c.emit('open');
            } else if (m.k === 'data') {
                const c = conns.get(m.from);
                if (c) c.emit('data', m.d);
            } else if (m.k === 'close') {
                const c = conns.get(m.from);
                if (c && !c.closed) { c.closed = true; c.emit('close'); }
            }
        });
        self.connect = target => {
            const c = conn(target);
            wire.postMessage({ k: 'offer', from: self.id, to: target });
            setTimeout(() => { if (!c.found) self.emit('error', { type: 'peer-unavailable' }); }, 250);
            return c;
        };
        self.reconnect = () => { };
        self.destroy = () => { conns.forEach(c => c.close()); };
        setTimeout(() => self.emit('open', self.id), 5);
    }
    window.Peer = Peer;
    window.__cutDirect = () => everyConn.forEach(c => c.close());
})();`;
async function context(options = {}) {
    const ctx = await browser.newContext({viewport:{width:1280,height:900}, ...options});
    ctx.on('page',p=>p.on('pageerror',error=>errors.push(error.stack || error.message)));
    await ctx.route('**/*',route=>{
        const url=route.request().url();
        if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        if (/peerjs/.test(url)) return route.fulfill({status:200,contentType:'text/javascript',body:FAKE_PEERJS});
        return route.abort();
    });
    return ctx;
}
async function person(ctx,name,{blocked=false,url=BASE}={}) {
    const p=await ctx.newPage();
    await p.addInitScript(({name,relayPort,blocked})=>{
        try {
            const store=window.localStorage,prefix='party-qa:'+name+':';
            const scoped={getItem:k=>store.getItem(prefix+k),setItem:(k,v)=>store.setItem(prefix+k,String(v)),removeItem:k=>store.removeItem(prefix+k),key:i=>Object.keys(store).filter(k=>k.startsWith(prefix))[i]?.slice(prefix.length),clear:()=>Object.keys(store).filter(k=>k.startsWith(prefix)).forEach(k=>store.removeItem(k))};
            Object.defineProperty(scoped,'length',{get:()=>Object.keys(store).filter(k=>k.startsWith(prefix)).length});
            Object.defineProperty(window,'localStorage',{configurable:true,get:()=>{if(blocked){const error=new Error('Storage denied');error.name='SecurityError';throw error;}return scoped;}});
            if(!blocked){localStorage.setItem('sound-enabled','false');localStorage.setItem('mrhakan98-netplay-relays','ws://127.0.0.1:'+relayPort);localStorage.setItem('mrhakan98-netplay-profile',JSON.stringify({id:'qa-'+name.toLowerCase(),name,avatar:null}));}
            sessionStorage.setItem('welcomed','1');sessionStorage.setItem('booted','1');
        }catch(_){}
        window.__partyWire=[];
        const send=BroadcastChannel.prototype.postMessage;
        BroadcastChannel.prototype.postMessage=function(value){if(window.__partyWire.length<2000)window.__partyWire.push(JSON.stringify(value));return send.call(this,value);};
    },{name,relayPort,blocked});
    await p.goto(url,{waitUntil:'load'});
    await p.waitForFunction(()=>typeof startMenuAction==='function');
    await p.evaluate(()=>document.getElementById('boot-screen')?.remove());
    if(url===BASE)await p.evaluate(()=>startMenuAction('messenger'));
    await p.waitForSelector('#ms98-host',{timeout:10000});
    await p.waitForFunction(()=>!!window.Netplay?.Party);
    await p.evaluate(name=>Netplay.saveProfile({...Netplay.profile(),id:'qa-'+name.toLowerCase(),name}),name);
    return p;
}
const count=(p,n)=>p.waitForFunction(n=>Netplay.Party.current?.members.length===n,n,{timeout:20000});
async function host(p,mode='local') {await p.selectOption('#ms98-mode',mode);await p.click('#ms98-host');await count(p,1);return p.evaluate(()=>Netplay.Party.current.code);}
async function join(p,code,mode='local') {await p.selectOption('#ms98-mode',mode);await p.fill('#ms98-code',code);await p.click('#ms98-join');await p.waitForFunction(()=>Netplay.Party.current?.members.length>=2,null,{timeout:20000});}
const controller=p=>p.evaluate(()=>({alive:Netplay.Party.current?.alive,code:Netplay.Party.current?.code,n:Netplay.Party.current?.members.length,game:Netplay.Party.current?.match?.gameId}));
async function send(p,text) {await p.evaluate(()=>openMessenger98());await p.fill('#ms98-chat-input',text);await p.click('#ms98-send');}
async function contains(p,text){await p.waitForFunction(text=>document.querySelector('#ms98-chatlog')?.textContent.includes(text),text,{timeout:10000});}
try {
    console.log('== persistent party, messenger and game lifecycle ==');
    const ctx=await context(),a=await person(ctx,'Host'),b=await person(ctx,'Guest'),c=await person(ctx,'Waiting');
    const code=await host(a);check(/^[A-Z0-9]{4,8}$/.test(code),'a real party invite is created');
    await join(b,code);await join(c,code);await Promise.all([count(a,3),count(b,3),count(c,3)]);
    await send(a,'Welcome to the party');await contains(b,'Welcome to the party');await contains(c,'Welcome to the party');check(true,'party chat reaches all members');
    const late=await person(ctx,'Late');await join(late,code);await count(a,4);await contains(late,'Welcome to the party');check(true,'late joiners receive bounded recent party history');
    await late.evaluate(()=>Netplay.Party.current.leave());await late.close();await Promise.all([count(a,3),count(b,3),count(c,3)]);
    await send(b,'<img src=x onerror=alert(1)>');await contains(a,'<img src=x onerror=alert(1)>');
    check(await a.locator('#ms98-chatlog img').count()===0,'messages are text, never executable markup');
    // Resolve the actual window rather than depending on its body nesting depth.
    await a.evaluate(()=>document.querySelector('.ms98-body').closest('.app-window').querySelector('.ie-titlebar-btn[title="close"]').click());
    check((await controller(a)).alive,'closing Messenger does not leave the party');
    await send(b,'Still connected');await a.evaluate(()=>openMessenger98());await a.waitForSelector('#ms98-chat-input');await contains(a,'Still connected');check(true,'messages survive Messenger close and reopen');
    await c.evaluate(()=>Netplay.Party.current.setAutoFollow(false));
    await a.waitForFunction(()=>Netplay.Party.current.members.some(p=>p.name==='Waiting' && p.autoFollow===false));
    await a.evaluate(async()=>{await Netplay.Party.current.selectGame('tankz');await Netplay.Party.current.startGame();});
    await Promise.all([a.waitForSelector('#tk-canvas',{timeout:45000}),b.waitForSelector('#tk-canvas',{timeout:45000})]);
    check((await controller(a)).alive && (await controller(b)).alive,'the game uses separate sessions, not the party connection');
    check(await c.locator('#tk-canvas').count()===0 && (await controller(c)).alive,'auto-follow off keeps a member in party chat');
    await send(c,'Watching from the lobby');await contains(b,'Watching from the lobby');check(true,'party chat works while a game is open');
    await a.evaluate(()=>document.querySelector('.tk-body').closest('.app-window').querySelector('.ie-titlebar-btn[title="close"]').click());
    await Promise.all([count(a,3),count(b,3),count(c,3)]);check((await controller(a)).alive,'closing a game does not disconnect its party');
    await a.evaluate(()=>Netplay.Party.current.returnToParty());await b.evaluate(()=>Netplay.Party.current.returnToParty());
    await c.evaluate(async()=>{await Netplay.Party.current.setAutoFollow(true);await Netplay.Party.current.setPresence('afk');});
    await a.waitForFunction(()=>Netplay.Party.current.members.some(p=>p.name==='Waiting' && p.presence==='afk'));
    await a.evaluate(async()=>{await Netplay.Party.current.selectGame('wizardz');await Netplay.Party.current.startGame();});
    await Promise.all([a.waitForSelector('#wz-canvas',{timeout:45000}),b.waitForSelector('#wz-canvas',{timeout:45000})]);
    check(await c.locator('#wz-canvas').count()===0,'AFK members are not pulled into a match');
    check((await controller(a)).code===code && (await controller(b)).code===code,'switching games keeps the party invite');
    await a.evaluate(()=>Netplay.Party.current.returnToParty());await b.evaluate(()=>Netplay.Party.current.returnToParty());
    await c.evaluate(()=>Netplay.Party.current.setPresence('online'));
    await a.waitForFunction(()=>Netplay.Party.current.members.some(p=>p.name==='Waiting' && p.presence==='online' && p.autoFollow===true));
    await a.evaluate(async()=>{await Netplay.Party.current.selectGame('ageoftroll');await Netplay.Party.current.startGame();});
    await Promise.all([a.waitForSelector('#aot-canvas',{timeout:45000}),b.waitForSelector('#aot-canvas',{timeout:45000})]);
    check(await c.locator('#aot-canvas').count()===0 && (await controller(c)).alive,'two-seat games leave overflow members in the party');
    await a.evaluate(()=>Netplay.Party.current.returnToParty());await b.evaluate(()=>Netplay.Party.current.returnToParty());
    await a.screenshot({path:path.join(SHOTS,'party-desktop.png')});
    console.log('== private messages, contacts and refresh ==');
    const guestId=await a.evaluate(()=>Netplay.Party.current.members.find(p=>p.name==='Guest').id);
    await a.evaluate(id=>Netplay.Party.current.addFriend(id),guestId);
    const secret='Only the recipient should read this';
    await a.evaluate(async({id,text})=>Netplay.Party.current.sendDirect(id,text),{id:guestId,text:secret});
    await b.waitForFunction(text=>Netplay.Party.current.messages.some(m=>m.text===text),secret,{timeout:10000});
    check(!(await c.evaluate(text=>Netplay.Party.current.messages.some(m=>m.text===text),secret)),'a third party member does not receive the direct-message plaintext');
    check(!(await a.evaluate(text=>JSON.stringify(window.__partyWire).includes(text),secret)),'direct-message plaintext never goes over the shared room wire');
    await b.reload({waitUntil:'load'});await b.waitForFunction(()=>Netplay.Party.current?.alive,null,{timeout:30000});await count(b,3);await count(a,3);
    check(true,'refresh restores party membership without a manual code entry');
    await b.evaluate(()=>openMessenger98());await b.waitForSelector('#ms98-chat-input');await send(b,'Back after refresh');await contains(a,'Back after refresh');
    console.log('== leadership and explicit leave ==');
    const next=await a.evaluate(()=>Netplay.Party.current.members.find(p=>p.name==='Guest').id);
    await a.evaluate(id=>Netplay.Party.current.transferLeadership(id),next);
    await b.waitForFunction(()=>!document.querySelector('#ms98-start').disabled,null,{timeout:30000});
    await Promise.all([count(a,3),count(b,3),count(c,3)]);await send(b,'New party leader');await contains(c,'New party leader');check(true,'acknowledged handoff keeps members and chat connected');
    await c.click('#ms98-leave');await c.waitForFunction(()=>!Netplay.Party.current?.alive);
    await c.reload({waitUntil:'load'});await c.waitForFunction(()=>typeof startMenuAction==='function');
    check(await c.evaluate(()=>!window.Netplay?.Party?.current?.alive),'explicit leave clears automatic reconnect');
    await a.evaluate(()=>Netplay.Party.current.leave());await b.evaluate(()=>Netplay.Party.current.leave());await ctx.close();
    console.log('== public relay transport and blocked storage ==');
    const relayCtx=await context(),r=await person(relayCtx,'RelayHost'),s=await person(relayCtx,'RelayGuest');
    const relayCode=await host(r,'bus');await join(s,relayCode,'bus');await count(r,2);await send(r,'Through the local test relays');await contains(s,'Through the local test relays');check(true,'internet relay party path is exercised without public services');
    await r.evaluate(()=>Netplay.Party.current.leave());await s.evaluate(()=>Netplay.Party.current.leave());await relayCtx.close();
    const blockedCtx=await context(),u=await person(blockedCtx,'NoStorage',{blocked:true});await host(u);check((await controller(u)).alive,'blocked storage does not prevent an in-memory party');await u.evaluate(()=>Netplay.Party.current.leave());await blockedCtx.close();
    console.log('== a phone ==');
    const phoneCtx=await context({viewport:{width:390,height:780},isMobile:true,hasTouch:true}),phone=await person(phoneCtx,'Phone');
    await host(phone);
    const bounds=await phone.evaluate(()=>{const r=document.querySelector('.ms98-body').closest('.app-window').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth};});
    check(bounds.left>=-1 && bounds.right<=bounds.width+1 && bounds.scroll<=bounds.width+1,'Messenger fits a narrow phone: '+JSON.stringify(bounds));
    await phone.screenshot({path:path.join(SHOTS,'party-phone.png')});await phone.evaluate(()=>Netplay.Party.current.leave());await phoneCtx.close();
    console.log('== window management, unread and notification controls ==');
    const uiCtx=await context(),ua=await person(uiCtx,'UIHost'),ub=await person(uiCtx,'UIGuest');
    const uiCode=await host(ua);await join(ub,uiCode);await count(ua,2);
    const uiFailures=[];
    const uiCheck=(value,message)=>{checks++;console.log((value?'  ok  ':'  FAIL  ')+message);if(!value)uiFailures.push(message);};
    const stack=await ua.evaluate(()=>{startMessenger98();const messenger=document.querySelector('.ms98-body').closest('.app-window');const other=createAppWindow('Party window regression');other.win.dispatchEvent(new Event('pointerdown'));const result={messenger:+messenger.style.zIndex,other:+other.win.style.zIndex};closeAppWindow(other.win.id);return result;});
    uiCheck(stack.other>stack.messenger,'reopening Messenger respects the shared window stacking order');
    await ua.evaluate(()=>{const win=document.querySelector('.ms98-body').closest('.app-window');document.getElementById(win.id+'-tb').click();});
    await send(ub,'Unread while minimized');await ua.waitForFunction(()=>document.querySelector('#ms98-tray').textContent.includes('(1)'));
    await ua.evaluate(()=>{const win=document.querySelector('.ms98-body').closest('.app-window');document.getElementById(win.id+'-tb').click();});
    await ua.evaluate(()=>Promise.resolve());
    uiCheck(!(await ua.locator('#ms98-tray').innerText()).includes('(1)'),'normal taskbar restore clears visible unread messages');
    await ua.evaluate(()=>{startMessenger98();window.__qaHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__qaHidden});document.dispatchEvent(new Event('visibilitychange'));});
    await send(ub,'Unread while tab hidden');await ua.waitForFunction(()=>document.querySelector('#ms98-tray').textContent.includes('(1)'));
    await ua.evaluate(()=>{window.__qaHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await ua.evaluate(()=>Promise.resolve());
    uiCheck(!(await ua.locator('#ms98-tray').innerText()).includes('(1)'),'visible-tab restoration clears visible unread messages');
    await ua.evaluate(()=>{startMessenger98();window.__ms98Toasts=0;const original=window.showToast;window.showToast=(...args)=>{if(args[0]==='Messenger98')window.__ms98Toasts++;return original?.(...args);};const win=document.querySelector('.ms98-body').closest('.app-window');document.getElementById(win.id+'-tb').click();});
    await send(ub,'Muted notification');await ua.waitForFunction(()=>document.querySelector('#ms98-tray').textContent.includes('(1)'));
    uiCheck((await ua.evaluate(()=>window.__ms98Toasts))===0,'mute notifications suppresses notification toasts');
    await ua.evaluate(()=>openMessenger98());
    await ua.getByRole('button',{name:'Add friend UIGuest',exact:true}).click();
    uiCheck(await ua.locator('#ms98-contacts').textContent().then(text=>text.includes('UIGuest')),'Add friend works through the real member button');
    ua.once('dialog',dialog=>dialog.accept('Private message from the real UI'));
    await ua.getByRole('button',{name:'Private message UIGuest',exact:true}).click();await contains(ub,'Private message from the real UI');
    uiCheck(true,'Private message works through the real member button');
    uiCheck(await ua.locator('#ms98-chatlog div').last().textContent().then(text=>/^\[\d\d:\d\d\] /.test(text)),'chat lines show the local time they were sent');
    const invite=await ua.inputValue('#ms98-invite-link');
    uiCheck(invite===BASE+'/?party='+uiCode+'&mode=local','Messenger shows a shareable invite link: '+invite);
    const uc=await person(uiCtx,'UILinked',{url:invite});
    await Promise.all([count(ua,3),count(uc,3)]);
    uiCheck((await controller(uc)).code===uiCode,'opening an invite link joins that party without typing the code');
    uiCheck(!(await uc.evaluate(()=>location.search)).includes('party='),'the invite code is removed from the address bar after use');
    const already=await person(uiCtx,'UIAlready');const otherCode=await host(already);
    await already.goto(invite,{waitUntil:'load'});await already.waitForFunction(()=>Netplay.Party.current?.alive,null,{timeout:30000});
    await already.waitForFunction(()=>document.querySelector('#ms98-status')?.textContent.includes('Leave'),null,{timeout:10000});
    uiCheck((await controller(already)).code===otherCode,'an invite link never silently moves a member out of their current party');
    await already.evaluate(()=>Netplay.Party.current.leave());await uc.evaluate(()=>Netplay.Party.current.leave());
    await ua.screenshot({path:path.join(SHOTS,'messenger-desktop.png')});
    await ua.evaluate(()=>Netplay.Party.current.leave());await ub.evaluate(()=>Netplay.Party.current.leave());await uiCtx.close();
    assert.equal(uiFailures.length,0,uiFailures.join('; '));
    check(errors.length===0,'no uncaught page errors: '+errors.join('; '));
    console.log('all '+checks+' party browser checks passed');
} catch(error) {
    console.error('PARTY BROWSER FAILED:',error.stack || error);
    console.error('PAGE ERRORS:',errors.join('\n'));
    for(const ctx of browser.contexts())for(const p of ctx.pages())try{await p.screenshot({path:path.join(SHOTS,'party-failure-'+Date.now()+'.png'),timeout:1500});}catch(_){}
    process.exitCode=1;
} finally {
    await browser.close();relay.kill();await new Promise(resolve=>server.close(resolve));
}
