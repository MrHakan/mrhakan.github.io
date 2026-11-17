// Messenger98 is a view of the party, never its owner.
(function () {
    'use strict';
    const P = Netplay.Party;
    let view = null, bound = null, subscriptions = [], unread = 0, lastMessage = null;
    let muted = P.preferences.mute !== false, typingTimer;
    const inviteLink = party => location.origin + location.pathname.replace(/index\.html?$/, '') + '?party=' + party.code + (party.mode && party.mode !== 'auto' ? '&mode=' + party.mode : '');
    const clock = at => Number.isFinite(at) ? '[' + new Date(at).toTimeString().slice(0, 5) + '] ' : '';
    function tray() {
        let b = document.getElementById('ms98-tray');
        if (!b) {
            b = document.createElement('button'); b.id = 'ms98-tray'; b.className = 'bevel-out';
            b.onclick = () => window.openMessenger98();
            const clock = document.getElementById('taskbar-clock'); (clock?.parentNode || document.body).appendChild(b);
        }
        b.textContent = 'Messenger98' + (unread ? ' (' + unread + ')' : ''); b.title = P.current ? 'Open party chat' : 'Open Messenger98';
    }
    function markRead() {
        if (view?.win.isConnected && view.win.style.display !== 'none' && !document.hidden && unread) { unread = 0; tray(); }
    }
    document.addEventListener('visibilitychange', markRead);
    window.addEventListener('focus', markRead);
    function bind() {
        if (bound === P.current) return;
        subscriptions.forEach(u => u()); subscriptions = []; bound = P.current;
        if (!bound) { render(); return; }
        subscriptions.push(bound.on('change', render), bound.on('closed', () => {bound = null; render();}), bound.on('error', say));
        subscriptions.push(bound.on('typing', m => {
            if (!view || m.id === bound?.id) return;
            view.body.querySelector('#ms98-typing').textContent = m.name + ' is typing…';
            clearTimeout(typingTimer); typingTimer = setTimeout(() => {if(view)view.body.querySelector('#ms98-typing').textContent='';},2500);
        }));
        subscriptions.push(bound.on('message', message => {
            const hidden = !view || view.win.style.display === 'none' || document.hidden;
            if (message.from !== bound?.id && !message.system && hidden) {
                unread = Math.min(99, unread + 1); tray();
                if (!muted && typeof showToast === 'function') showToast('Messenger98', message.direct ? 'New private message' : 'New party message');
                if (!muted && typeof playSound === 'function') playSound('ding');
            }
        }));
        render();
    }
    function say(message) { if(view)view.body.querySelector('#ms98-status').textContent = String(message); }
    async function run(fn) { try { await fn(); bind(); render(); } catch(e) {say(e.message);} }
    function render() {
        tray(); if (!view) return;
        const body = view.body, party = P.current;
        const q = id => body.querySelector('#ms98-' + id);
        q('host').disabled = q('join').disabled = !!party;
        q('invite').textContent = party ? party.code : 'No party';
        q('invite-link').value = party ? inviteLink(party) : ''; q('copy').disabled = !party;
        q('status').textContent = party ? party.status + (party.match ? ' · ' + party.match.state + (party.match.error ? ': ' + party.match.error : '') : '') : 'Create a party or join with an invitation code. Closing this window does not leave.';
        q('leave').disabled = q('send').disabled = q('return').disabled = !party;
        q('game').disabled = !party?.isHost;
        q('start').disabled = !party?.isHost || ['preparing','playing'].includes(party?.match?.state);
        if (party) {
            q('game').value = party.gameId;
            const me = party.members.find(m => m.id === party.id);
            if(me){q('auto-follow').checked=me.autoFollow;q('presence').value=me.presence==='afk'?'afk':'online';}
        }
        const rows = q('players'); rows.replaceChildren();
        for (const m of party?.members || []) {
            const row = document.createElement('div');row.className='ms98-member';row.dataset.memberId=m.id;
            const state = m.presence==='reconnecting' ? 'Reconnecting' : m.presence==='afk' ? 'AFK' : party.match?.state==='playing'&&party.match.participants.includes(m.id)&&m.ready ? 'In game' : m.ready ? 'Ready' : 'Online';
            const label = document.createElement('span'); label.textContent=(m.avatar||'🙂')+' '+m.name+(m.id===party.hostId?' (Host)':'')+' — '+state+(m.autoFollow?'':' · Not following')+(m.keyStatus==='mismatch'?' · ⚠ Key mismatch, private messages blocked':'');row.appendChild(label);
            if(m.id!==party.id){
                const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.dataset.memberId=m.id;b.setAttribute('aria-label',text+' '+m.name);b.disabled=m.keyStatus==='mismatch'&&text!=='Transfer leadership';b.onclick=()=>run(fn);row.appendChild(b);};
                button('Add friend',()=>party.addFriend(m.id));
                button('Private message',()=>{const text=window.prompt('Private message to '+m.name+' (first-contact TOFU, not an account)');if(text)return party.sendDirect(m.id,text);});
                if(party.isHost)button('Transfer leadership',()=>party.transferLeadership(m.id));
            }
            rows.appendChild(row);
        }
        const contacts=q('contacts');contacts.replaceChildren();
        for(const f of P.contacts){const el=document.createElement('div'),m=party?.members.find(m=>m.fingerprint===f.fingerprint);el.textContent=f.name+' — '+(m?m.presence==='reconnecting'?'Reconnecting':'Connected in this party':'Offline / unknown');contacts.appendChild(el);}
        const log=q('chatlog'); const signature=JSON.stringify(party?.messages||[]);
        if(lastMessage!==signature){
            lastMessage=signature;log.replaceChildren();
            for(const m of party?.messages||[]){const el=document.createElement('div');el.className=m.system?'ms98-system':'';el.textContent=clock(m.at)+(m.system?'• ':m.direct?'[Private] '+m.name+': ':m.name+': ')+m.text;log.appendChild(el);}log.scrollTop=log.scrollHeight;
        }
        const options=q('options');
        if(options.dataset.game!==party?.gameId){options.replaceChildren();options.dataset.game=party?.gameId||'';
            for(const o of Netplay.byId(party?.gameId)?.options||[]){const label=document.createElement('label');label.textContent=o.label+' ';const select=document.createElement('select');select.dataset.option=o.key;for(const v of o.values){const option=document.createElement('option');option.value=v[0];option.textContent=v[1];select.appendChild(option);}select.onchange=()=>run(()=>{const opts={...party.gameOptions,[o.key]:select.value};party.selectGame(party.gameId,opts);});label.appendChild(select);options.appendChild(label);}}
        options.querySelectorAll('select').forEach(s=>{s.disabled=!party?.isHost;s.value=party?.gameOptions[s.dataset.option];});
    }
    // An invite link waits for any saved party to restore, then never replaces it silently.
    function acceptInvite(code, mode) {
        code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (code.length < 4 || !view) return;
        view.body.querySelector('#ms98-code').value = code;
        if (['auto', 'local', 'bus'].includes(mode)) view.body.querySelector('#ms98-mode').value = mode;
        restoring.then(() => {
            if (!view) return;
            if (P.current?.alive) { if (P.current.code !== code) say('You are already in party ' + P.current.code + '. Leave it before joining ' + code + '.'); return; }
            say('Joining party ' + code + '…');
            run(() => P.join(code, {mode: view.body.querySelector('#ms98-mode').value}));
        });
    }
    window.startMessenger98 = function (opts) {
        if(view?.win.isConnected){view.win.style.display='flex';view.win.dispatchEvent(new Event('pointerdown'));markRead();render();acceptInvite(opts?.joinCode,opts?.mode);return;}
        const app=createAppWindow('Messenger98',{icon:'group',width:620}); view=app;lastMessage=null;
        app.body.classList.add('ms98-body');
        app.body.innerHTML = '<div class="ms98-banner">Messenger98 — Your party stays together</div>'+
            '<div class="ms98-toolbar"><label>Nickname <input id="ms98-name" maxlength="16"></label><label>Avatar <select id="ms98-avatar"><option>🙂</option><option>🧙</option><option>🐱</option><option>🤖</option><option>⚓</option></select></label><button id="ms98-profile">Save profile</button></div>'+
            '<div class="ms98-toolbar"><label>Connection <select id="ms98-mode"><option value="auto">Auto (Internet)</option><option value="local">Local tabs</option><option value="bus">Bus (Internet relay)</option></select></label><button id="ms98-host">Create party</button><input id="ms98-code" maxlength="5" aria-label="Party invitation code"><button id="ms98-join">Join party</button> Code: <strong id="ms98-invite"></strong></div>'+
            '<div class="ms98-toolbar"><input id="ms98-invite-link" readonly aria-label="Party invitation link"><button id="ms98-copy">Copy invite link</button></div>'+
            '<div id="ms98-status" role="status"></div><div class="ms98-toolbar"><label><input type="checkbox" id="ms98-auto-follow" checked>Auto-follow games</label><label>Presence <select id="ms98-presence"><option value="online">Online</option><option value="afk">AFK</option></select></label><label><input type="checkbox" id="ms98-mute" checked>Mute notifications</label></div>'+
            '<div id="ms98-players" aria-label="Party members"></div><details><summary>Saved friends (this browser only)</summary><div id="ms98-contacts"></div></details>'+
            '<div class="ms98-toolbar"><label>Game <select id="ms98-game"></select></label><button id="ms98-start">Party start / Retry</button><button id="ms98-return">Return to party / Cancel</button></div><div id="ms98-options"></div>'+
            '<div id="ms98-chatlog" role="log" aria-live="polite"></div><div id="ms98-typing"></div><form id="ms98-form"><input id="ms98-chat-input" maxlength="500" aria-label="Party chat message" autocomplete="off"><button id="ms98-send">Send</button></form>'+
            '<div class="ms98-footer"><button id="ms98-reconnect">Retry connection</button><button id="ms98-leave">Leave party</button> Only Leave party ends membership. Private messages use TOFU keys, not verified accounts.</div>';
        const q=id=>app.body.querySelector('#ms98-'+id);
        q('name').value=Netplay.profile().name;q('mute').checked=muted;
        for(const g of Netplay.CATALOG){const o=document.createElement('option');o.value=g.id;o.textContent=g.name;q('game').appendChild(o);}
        q('host').onclick=()=>run(()=>P.create({mode:q('mode').value}));
        q('join').onclick=()=>run(()=>P.join(q('code').value.trim().toUpperCase(),{mode:q('mode').value}));
        q('leave').onclick=()=>run(()=>P.current?.leave());
        q('start').onclick=()=>run(()=>P.current?.startGame());q('return').onclick=()=>run(()=>P.current?.returnToParty());
        q('game').onchange=()=>run(()=>P.current?.selectGame(q('game').value));
        q('auto-follow').onchange=()=>run(()=>P.current?.setAutoFollow(q('auto-follow').checked));q('presence').onchange=()=>run(()=>P.current?.setPresence(q('presence').value));
        q('mute').onchange=()=>{muted=q('mute').checked;P.setPreferences({mute:muted});};
        q('profile').onclick=()=>run(()=>{Netplay.setName(q('name').value);Netplay.setAvatar(q('avatar').value);P.current?.setProfile({name:q('name').value,avatar:q('avatar').value});});
        q('reconnect').onclick=()=>P.current?.retryReconnect();
        q('copy').onclick=()=>{const field=q('invite-link');if(!field.value)return;const fallback=()=>{field.focus();field.select();say('Copy the selected invite link and send it to a friend.');};
            if(navigator.clipboard?.writeText)navigator.clipboard.writeText(field.value).then(()=>say('Invite link copied. Anyone who opens it joins this party.'),fallback);else fallback();};
        q('form').onsubmit=e=>{e.preventDefault();run(()=>{if(P.current?.sendChat(q('chat-input').value))q('chat-input').value='';});};
        q('chat-input').oninput=()=>P.current?.typing();
        const visibility = new MutationObserver(markRead);
        visibility.observe(app.win,{attributes:true,attributeFilter:['style']});
        app.win._cleanup=()=>{visibility.disconnect();view=null;lastMessage=null;tray();};
        app.win.addEventListener('pointerdown',markRead);
        unread=0;bind();render();acceptInvite(opts?.joinCode,opts?.mode);
    };
    tray();
    const restoring = P.restore().then(()=>{bind();render();}).catch(err=>say('Restore failed: '+err.message));
})();
