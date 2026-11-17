// Real party core, deterministic in-memory authenticated Session fixtures. No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source = fs.readFileSync(new URL('../../games/party/party.js', import.meta.url), 'utf8');
const rooms = new Map(), wire = [], clients = [];
let serial = 0;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await wait(5); } assert.fail('Timed out waiting for party state'); }
function client(blocked = false) {
    const store = new Map(), events = {}; let clockOffset = 0;
    class Clock extends Date { static now() { return Date.now() + clockOffset; } }
    const storage = { getItem: k => { if (blocked) throw Error('blocked'); return store.get(k) || null; }, setItem: (k,v) => { if (blocked) throw Error('blocked'); store.set(k,v); }, removeItem: k => store.delete(k) };
    const NP = { current: null, CATALOG: [{ id: 'duel', min: 2, max: 2, options: [{key:'map',values:[['desk','Desk']]}] }], profile: () => ({name:'Player',avatar:null}), makeCode: () => String(++serial).padStart(5,'A'), byId(id) { return this.CATALOG.find(g => g.id === id); }, loadGame: async () => ({start(){}}), launch(s,d) { NP.launched = {s,d}; } };
    function session(host, code, opts = {}) {
        const s = {id:'p'+ ++serial, isHost:host, code, alive:true, admitted:host||!opts.matchId, connectionOptions:opts, players:[], me:{}, hostId:null, _h:{}, on(k,f){(this._h[k] ||= []).push(f);return () => this.off(k,f);},off(k,f){this._h[k]=(this._h[k]||[]).filter(x=>x!==f);},emit(k,d,f){for(const cb of [...this._h[k]||[]]) cb(d,f);},send(k,d,to){ wire.push({k,d:structuredClone(d),from:s.id,to}); queueMicrotask(() => { for (const other of rooms.get(code)||[]) if(other!==s && other.alive && (!to||to==='*'||to===other.id)) other.emit(k,structuredClone(d),{id:s.id,name:'Player'}); });},leave(){if(!s.alive)return;s.alive=false;rooms.set(code,(rooms.get(code)||[]).filter(x=>x!==s));s.emit('closed');sync();},announceProfile(){const host=(rooms.get(code)||[]).find(p=>p.isHost&&p.alive);if(!s.isHost&&host?.connectionOptions.admit){Promise.resolve(host.connectionOptions.admit(s.id,s.connectionOptions.admission)).then(ok=>{if(ok&&s.alive){s.admitted=true;sync();}});}else sync();},startGame(){ const d={gameId:s.gameId,slots:s.players.map(p=>p.id)};s.send('np:start',d);NP.launch(s,d);},gameOptions:{},setOption(k,v){s.gameOptions[k]=v;}};
        s.me={id:s.id,name:'Player',host,me:true};s.gameId='duel';
        function sync(){for(const peer of rooms.get(code)||[]) {peer.players=(rooms.get(code)||[]).filter(x=>x.alive&&x.admitted).map(x=>({...x.me,me:x===peer}));peer.hostId=(peer.players.find(p=>p.host)||{}).id;peer.emit('roster',peer.players);}}
        (rooms.get(code)||rooms.set(code,[]).get(code)).push(s);sync();if(!opts.background)NP.current=s;return s;
    }
    NP.host = async (mode, game, code, status, opts) => session(true,code||NP.makeCode(),opts);
    NP.join = async (mode,code,status,opts) => {if(!(rooms.get(code)||[]).some(s=>s.isHost&&s.alive))throw Error('No host');return session(false,code,opts);};
    const win={Netplay:NP,crypto:webcrypto,localStorage:storage,addEventListener(k,f){events[k]=f;}};win.window=win;
    vm.runInNewContext(source,{window:win,crypto:webcrypto,localStorage:storage,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Promise,Map,Set,JSON,Math,Date:Clock,Error,console,setTimeout,clearTimeout,setInterval,clearInterval,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')});
    const c={NP,store,events,advance(ms){clockOffset+=ms;}};clients.push(c);return c;
}
let checks=0;
async function test(name,fn){await fn();console.log('ok - '+name);checks++;}
try {
    const a=client(),b=client(),c=client();
    let host,guest,third;
    await test('control session does not replace legacy current; late join sync and chat',async()=>{
        a.NP.current={legacy:true};host=await a.NP.Party.create({mode:'local'});assert.equal(a.NP.current.legacy,true);
        guest=await b.NP.Party.join(host.code,{mode:'local'});await until(()=>host.members.length===2&&guest.members.length===2);
        host.sendChat('<img src=x onerror=alert(1)>');await until(()=>guest.messages.some(m=>m.text.includes('<img')));
        third=await c.NP.Party.join(host.code,{mode:'local'});await until(()=>third.messages.some(m=>m.text.includes('<img')));
    });
    await test('catalog/options and host-only controls reject invalid input',async()=>{
        assert.throws(()=>guest.selectGame('duel'));assert.throws(()=>host.selectGame('missing'));assert.throws(()=>host.selectGame('duel',{map:'bad'}));
        const raw=(rooms.get(host.code)||[]).find(s=>s.id===guest.id);raw.send('party:state',{epoch:host.epoch,hostId:guest.id,members:[]});await wait(20);assert.equal(host.isHost,true);assert.equal(guest.hostId,host.id);
    });
    await test('AFK and auto-follow filter, capacity waits; actual prepare readiness',async()=>{
        guest.setPresence('afk');third.setAutoFollow(false);await until(()=>host.members.find(m=>m.id===guest.id).presence==='afk'&&!host.members.find(m=>m.id===third.id).autoFollow);
        host.selectGame('duel',{map:'desk'});await assert.rejects(()=>host.startGame());
        guest.setPresence('online');third.setAutoFollow(false);await until(()=>host.members.find(m=>m.id===guest.id).presence==='online'&&!host.members.find(m=>m.id===third.id).autoFollow);
        await host.startGame();await until(()=>host.match?.state==='playing'&&guest.match?.state==='playing');
        assert.equal(host.match.participants.length,2);assert.equal(c.NP.launched,undefined);
        assert.notEqual(a.NP.launched.s.code,host.code);a.NP.launched.s.leave();assert.equal(host.alive,true);
        host.returnToParty();await until(()=>guest.match?.state==='ended');
    });
    await test('load failure is visible and retry uses new match generation',async()=>{
        const old=host.match.id;b.NP.loadGame=async()=>{throw Error('fixture load failure');};await host.startGame();await until(()=>host.match?.state==='error');assert.match(host.match.error,/fixture/);
        b.NP.loadGame=async()=>({start(){}});await host.startGame();await until(()=>host.match?.state==='playing');assert.notEqual(host.match.id,old);
        const raw=rooms.get(host.code).find(s=>s.id===guest.id);raw.send('party:prepared',{epoch:host.epoch,matchId:old,error:'stale'});await wait(20);assert.equal(host.match.state,'playing');host.returnToParty();
    });
    await test('rate limiting and bounded history',async()=>{for(let i=0;i<400;i++)host.sendChat('message '+i);await wait(30);assert.ok(host.messages.length<=100);assert.ok(host.messages.length<400);});
    await test('ECDH DM is ciphertext, recipient only; contacts are local',async()=>{
        await until(()=>host.members.find(m=>m.id===guest.id)?.publicKey);host.addFriend(guest.id);await host.sendDirect(guest.id,'private fixture message');await until(()=>guest.messages.some(m=>m.text==='private fixture message'));
        assert.ok(!third.messages.some(m=>m.text==='private fixture message'));const dm=wire.findLast(m=>m.k==='party:dm');assert.ok(dm);assert.ok(!JSON.stringify(dm.d).includes('private fixture message'));
        const raw=rooms.get(host.code).find(s=>s.id===host.id);raw.send('party:dm',{...dm.d,to:third.id},third.id);await wait(30);assert.ok(!third.messages.some(m=>m.text==='private fixture message'));
    });
    await test('acknowledged idle leadership handoff preserves membership',async()=>{await host.transferLeadership(guest.id);await until(()=>guest.isHost&&host.code===guest.code&&guest.members.length>=2);assert.equal(host.alive,true);assert.equal(guest.alive,true);assert.ok(guest.members.length>=2);});
    await test('explicit leave cancels restore and reconnect, blocked storage is honest',async()=>{
        third.leave();assert.equal(c.NP.Party.current,null);assert.equal(c.store.has('mrhakan98-party-resume'),false);
        const d=client(true),p=await d.NP.Party.create({mode:'local'});assert.equal(p.storageAvailable,false);p.leave();
        host.leave();guest.leave();assert.equal(a.store.has('mrhakan98-party-resume'),false);
    });
    await test('a restored host key must be proved before accepting an authoritative snapshot', async () => {
        const hc=client(),vc=client(),rogue=client();
        const h=await hc.NP.Party.create({mode:'local'}),v=await vc.NP.Party.join(h.code,{mode:'local'});
        await until(()=>v.members.length===2);
        const resume=vc.store.get('mrhakan98-party-resume'),members=v.members,code=h.code;
        const publicHost=JSON.parse(resume).hostKey;
        v.leave();h.leave();vc.store.set('mrhakan98-party-resume',resume);
        const fake=await rogue.NP.host('local',null,code);
        try {
            const restored=await vc.NP.Party.restore();
            fake.send('party:state',{epoch:'a'.repeat(32),revision:999,hostKey:publicHost,gameId:'duel',options:{map:'desk'},members:members.map(m=>({...m,id:m.id===h.id?fake.id:restored.id})),messages:[{id:'forged',text:'Unproved authority'}],match:null});
            await wait(30);
            assert.ok(!restored.messages.some(m=>m.id==='forged'),'knowing the saved public host key does not prove possession of its private key');
            restored.leave();
        } finally {fake.leave();}
    });
    await test('real Netplay Sessions over in-memory BroadcastChannel prepare, admit and launch both clients', async () => {
        const channels = new Set(), timers = new Set();
        class Channel {
            constructor(name) {this.name=name;this.listeners=new Set();channels.add(this);}
            postMessage(data) {for(const c of channels)if(c!==this&&c.name===this.name)queueMicrotask(()=>{if(!channels.has(c))return;const e={data:structuredClone(data)};c.onmessage?.(e);for(const f of c.listeners)f(e);});}
            addEventListener(k,f){this.listeners.add(f);} removeEventListener(k,f){this.listeners.delete(f);}close(){channels.delete(this);}
        }
        const realSource=fs.readFileSync(new URL('../../games/netplay.js',import.meta.url),'utf8');
        function realClient(){
            const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
            const w={crypto:webcrypto,BroadcastChannel:Channel,addEventListener(){}};w.window=w;
            const context=vm.createContext({window:w,crypto:webcrypto,BroadcastChannel:Channel,localStorage:storage,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Promise,Map,Set,JSON,Math,Date,Error,console,performance,setTimeout:(fn,ms)=>{const t=setTimeout(()=>{timers.delete(t);fn();},ms);timers.add(t);return t;},clearTimeout:t=>{timers.delete(t);clearTimeout(t);},setInterval:(fn,ms)=>{const t=setInterval(fn,ms);timers.add(t);return t;},clearInterval:t=>{timers.delete(t);clearInterval(t);},btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary')});
            vm.runInContext(realSource,context);vm.runInContext(source,context);
            const np=w.Netplay;np.CATALOG=[{id:'duel',name:'Fixture duel',min:2,max:2}];np.loadGame=async()=>({start(){}});np.launch=(s,d)=>{np.launched={s,d};};return np;
        }
        const x=realClient(),y=realClient();
        try {
            const h=await x.Party.create({mode:'local'}),g=await y.Party.join(h.code,{mode:'local'});
            await until(()=>h.members.length===2&&g.members.length===2);await h.startGame();
            await until(()=>h.match?.state==='playing'&&!!y.launched);assert.ok(x.launched);assert.equal(y.launched.d.matchId,h.match.id);
            let packets=0;const receiver=y.launched.s,sender=x.launched.s;
            receiver.on('fixture:packet',()=>packets++);
            receiver._onData(sender.id,{v:x.VERSION,t:'fixture:packet',d:{},f:sender.id,to:'*',matchId:'stale-'+h.match.id});
            assert.equal(packets,0,'late gameplay packets from a different match generation are rejected');
            sender.send('fixture:packet',{});await until(()=>packets===1);
            x.launched.s.leave();assert.ok(h.alive);await until(()=>g.match?.state==='ended');
        } finally {x.Party.current?.leave();y.Party.current?.leave();for(const t of timers){clearTimeout(t);clearInterval(t);}channels.clear();}
    });
    console.log(`${checks} party checks passed`);
    await import('./check-party-races.mjs');
} finally {for(const c of clients)c.NP.Party.current?.leave();}
