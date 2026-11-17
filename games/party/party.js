// Persistent party control. Game engines only receive disposable match Sessions.
(function () {
    'use strict';
    const NP = window.Netplay;
    const PREFIX = 'mrhakan98-party-', LIMIT = 100;
    const enc = new TextEncoder(), dec = new TextDecoder();
    const random = () => { const b = new Uint8Array(16); crypto.getRandomValues(b); return hex(b); };
    const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
    const un64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const copy = o => JSON.parse(JSON.stringify(o));
    let storageOK = true, identityPromise, pending = null;
    function read(key, fallback) { try { return JSON.parse(localStorage.getItem(PREFIX + key)) || fallback; } catch (_) { storageOK = false; return fallback; } }
    function save(key, value) { try { if (value === null) localStorage.removeItem(PREFIX + key); else localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (_) { storageOK = false; } }
    async function identity() {
        if (identityPromise) return identityPromise;
        identityPromise = (async () => {
            if (!crypto.subtle) throw Error('Private messaging requires WebCrypto on HTTPS or localhost.');
            let saved = read('private-key', null), pair;
            try {
                if (saved) pair = { privateKey: await crypto.subtle.importKey('jwk', saved, {name:'ECDH',namedCurve:'P-256'}, false, ['deriveKey']), publicKey: await crypto.subtle.importKey('jwk', {kty:saved.kty,crv:saved.crv,x:saved.x,y:saved.y,ext:true}, {name:'ECDH',namedCurve:'P-256'}, true, []) };
            } catch (_) { saved = null; }
            if (!pair) {
                pair = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'}, true, ['deriveKey']);
                save('private-key', await crypto.subtle.exportKey('jwk', pair.privateKey));
            }
            const publicKey = b64(await crypto.subtle.exportKey('raw', pair.publicKey));
            return {privateKey:pair.privateKey, publicKey, fingerprint:hex(new Uint8Array(await crypto.subtle.digest('SHA-256', un64(publicKey))))};
        })();
        return identityPromise;
    }
    async function shared(key) {
        const mine = await identity();
        const other = await crypto.subtle.importKey('raw', un64(key), {name:'ECDH',namedCurve:'P-256'}, false, []);
        return crypto.subtle.deriveKey({name:'ECDH',public:other}, mine.privateKey, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
    }
    async function seal(key, text, context) {
        const iv = new Uint8Array(12); crypto.getRandomValues(iv);
        return {iv:b64(iv),ciphertext:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(context)}, await shared(key), enc.encode(text)))};
    }
    async function open(key, payload, context) {
        if (!payload || typeof payload.ciphertext !== 'string' || payload.ciphertext.length > 12000 || typeof payload.iv !== 'string') throw Error('Invalid encrypted message');
        return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(payload.iv),additionalData:enc.encode(context)}, await shared(key), un64(payload.ciphertext)));
    }
    function optionsFor(gameId, input) {
        const g = NP.byId(gameId); if (!g) throw Error('Unknown catalog game');
        if (input && (typeof input !== 'object' || Array.isArray(input))) throw Error('Invalid game options');
        const out = {};
        for (const key of Object.keys(input || {})) if (!(g.options || []).some(o => o.key === key)) throw Error('Unknown game option');
        for (const o of g.options || []) {
            const v = input && input[o.key] !== undefined ? String(input[o.key]) : String(o.values[0][0]);
            if (!o.values.some(x => String(x[0]) === v)) throw Error('Invalid game option: ' + o.key);
            out[o.key] = v;
        }
        return out;
    }
    // Background connections never publish NP.current, even when an old open finishes late.
    function connect(host, mode, code, opts) {
        const options = {...opts,background:true};
        return host ? NP.host(mode, null, code, undefined, options) : NP.join(mode, code, undefined, options);
    }
    const manager = NP.Party = {
        current:null,
        get contacts() { return copy(read('contacts', []).slice(0, 100)); },
        get preferences() { return copy(read('prefs', {mute:true})); },
        setPreferences(p) { save('prefs', {mute:!!p.mute}); },
        create(opts) { return begin(true, null, opts); },
        join(code, opts) { if (!/^[A-Z0-9]{4,5}$/.test(String(code))) return Promise.reject(Error('Enter a 4–5 character party code')); return begin(false, code, opts); },
        restore() { const r = read('resume', null); if (!r || manager.current || pending) return Promise.resolve(manager.current); return begin(!!r.host, r.code, {mode:r.mode,restore:r}); }
    };
    function begin(host, code, opts = {}) {
        if (manager.current?.alive) return Promise.reject(Error('Leave the current party first'));
        if (pending) return pending;
        pending = (async () => {
            const mode = opts.mode || 'auto'; if (!['local','auto','bus'].includes(mode)) throw Error('Unsupported party transport');
            const ident = await identity();
            const raw = await connect(host, mode, code, {partyOnly:true});
            const p = controller(raw, mode, ident, opts.restore); manager.current = p; return p;
        })().finally(() => { pending = null; });
        return pending;
    }
    function controller(initial, mode, ident, restored) {
        let raw = initial, epoch = raw.isHost ? random() : null, hostKey = restored?.hostKey || null;
        let members = [], messages = [], match = null, gameId = NP.CATALOG[0].id, gameOptions = optionsFor(gameId), alive = true;
        let autoFollow = true, presence = 'online', matchSession = null, unsubs = [], reconnectTimer = null, reconnecting = false, retries = 0, generation = 0;
        let staged = null, staging = null, handoff = null, prepareTimer = null, reconnectInFlight = false, stateRevision = 0, authorityProof = null, preparation = 0, redirectTarget = null;
        const handlers = {}, rates = new Map(), challenges = new Map(), prepared = new Map(), admitted = new Map(), seenDM = new Set();
        // Fingerprints are recomputed locally; a snapshot's claimed fingerprint is never trusted.
        const keyPrints = new Map([[ident.publicKey, ident.fingerprint]]);
        const p = {
            get id() { return raw.id; }, get hostId() { return raw.isHost ? raw.id : raw.hostId; }, get isHost() { return raw.isHost; },
            get code() { return raw.code; }, get mode() { return mode; }, get alive() { return alive; }, get epoch() { return epoch; },
            get members() { return copy(members).map(m => ({...m, keyStatus: keyStatus(m)})); }, get messages() { return copy(messages); }, get match() { return match ? copy(match) : null; },
            get gameId() { return gameId; }, get gameOptions() { return copy(gameOptions); }, get storageAvailable() { return storageOK; },
            get status() { return reconnecting ? 'Reconnecting' : !storageOK ? 'Connected — storage unavailable; refresh cannot restore this party' : 'Connected'; },
            on(type, fn) { (handlers[type] ||= []).push(fn); return () => p.off(type, fn); },
            off(type, fn) { handlers[type] = (handlers[type] || []).filter(f => f !== fn); },
            sendChat(text) { text = String(text || '').trim().slice(0, 500); if (!text || !allowed('send', 8)) return false; request('chat', {text}); return true; },
            setPresence(value) { if (!['online','afk'].includes(value)) throw Error('Invalid presence'); presence = value; hello(); },
            setAutoFollow(value) { autoFollow = !!value; hello(); },
            setProfile(profile) { NP.setName(profile.name); NP.setAvatar(profile.avatar); hello(); },
            typing() { if (allowed('typing-send', 1)) request('typing', {}); },
            selectGame(id, opts) { onlyHost(); idle(); const valid = optionsFor(id, opts); gameId = id; gameOptions = valid; notice('Selected ' + NP.byId(id).name); publish(); },
            async startGame() {
                onlyHost(); if (handoff) throw Error('Leadership handoff is pending');
                if (match && ['preparing','playing'].includes(match.state)) throw Error('Return to party before starting another game');
                const g = NP.byId(gameId), cap = Math.min(g.max, g.seats ? g.seats(gameOptions) : g.max);
                const candidates = members.filter(m => m.presence === 'online' && m.autoFollow && m.publicKey);
                const host = candidates.find(m => m.id === raw.id);
                if (!host) throw Error('The host must be online with auto-follow enabled');
                const participants = [host.id, ...candidates.filter(m => m !== host).map(m => m.id)].slice(0, cap);
                if (participants.length < (g.min || 2)) throw Error('Not enough online, opted-in members');
                stopMatch(); prepared.clear();
                match = {id:random(),gameId,state:'preparing',participants,options:copy(gameOptions),code:NP.makeCode(5),hostId:null};
                const current = match.id, attempt = preparation; publish();
                try {
                    const session = await connect(true, mode, match.code, {matchId:current,admit:admitMatch});
                    if (!alive || attempt !== preparation || match?.id !== current || match.state !== 'preparing') { session.leave(); return; }
                    matchSession = session; admitted.set(raw.id, session.id);
                    matchSession.gameId = gameId; matchSession.gameOptions = copy(gameOptions); match.hostId = matchSession.id;
                    watchMatch(matchSession, current); publish();
                    await prepare(current);
                } catch (err) { failMatch(current, err.message); }
            },
            returnToParty() {
                if (!alive || (match && !match.participants.includes(raw.id))) return;
                if (raw.isHost) { if (match) { match.state = 'ended'; stopMatch(); notice('Returned to party'); members.forEach(m => {m.ready = false;}); publish(); } }
                else { const id = match?.id; if (match) match.state = 'ended'; stopMatch(); request('returned', {matchId:id}); emit('change'); }
            },
            async transferLeadership(id) {
                onlyHost(); idle(); const member = members.find(m => m.id === id && m.publicKey && m.presence === 'online');
                if (!member || id === raw.id || handoff) throw Error('Choose a connected member');
                return new Promise((resolve, reject) => {
                    const token = random(); const timer = setTimeout(() => { handoff = null; reject(Error('Leadership handoff timed out')); emit('change'); }, 12000);
                    handoff = {id,token,resolve,reject,timer}; send('offer', {to:id,token}); emit('change');
                });
            },
            async addFriend(id) {
                const m = await verifiedMember(id);
                const list = manager.contacts.filter(f => f.fingerprint !== m.fingerprint);
                list.push({name:m.name,avatar:m.avatar,fingerprint:m.fingerprint,publicKey:m.publicKey}); save('contacts', list.slice(-100)); emit('change');
            },
            async sendDirect(id, text) {
                text = String(text || '').trim().slice(0, 500);
                if (!alive || !epoch || id === raw.id || !members.some(m => m.id === id && m.publicKey && m.presence !== 'reconnecting')) throw Error('Private messages require a connected party member');
                const m = await verifiedMember(id);
                if (!alive || !epoch || m.presence === 'reconnecting') throw Error('Private messages require a connected party member');
                if (!text || !allowed('dm-send', 8)) return false;
                const messageId = random(), context = [epoch,raw.id,id,messageId].join('|');
                const payload = await seal(m.publicKey, text, context);
                send('dm', {to:id,messageId,...payload}, id); append({id:messageId,from:raw.id,name:NP.profile().name,text,direct:true,to:id}); return true;
            },
            leave() {
                if (!alive) return; send('leave', {}); alive = false; generation++;
                clearTimeout(reconnectTimer); clearTimeout(prepareTimer); clearInterval(heartbeat); stopMatch();
                unsubs.forEach(u => u()); unsubs = []; raw.leave(); staged?.leave();
                if (handoff) {clearTimeout(handoff.timer);handoff.reject(Error('Party left'));handoff = null;}
                save('resume', null); if (manager.current === p) manager.current = null; emit('closed'); emit('change');
            },
            retryReconnect() { if (!alive || !reconnecting) return; retries = 0; scheduleReconnect(); }
        };
        function keyStatus(m) {
            if (!m.publicKey) return 'none';
            const print = keyPrints.get(m.publicKey);
            return print === undefined ? 'pending' : print === m.fingerprint ? 'verified' : 'mismatch';
        }
        async function learnKey(key) {
            if (typeof key !== 'string' || key.length > 200 || keyPrints.has(key)) return;
            let print;
            try { print = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', un64(key)))); } catch (_) { print = null; }
            keyPrints.set(key, print);
            if (keyPrints.size > 256) keyPrints.delete(keyPrints.keys().next().value);
            if (alive) emit('change');
        }
        async function verifiedMember(id) {
            const found = members.find(m => m.id === id && m.publicKey);
            if (!found) throw Error('Member identity is not verified yet');
            await learnKey(found.publicKey);
            const m = members.find(m => m.id === id && m.publicKey);
            if (!m || keyStatus(m) !== 'verified') throw Error('This member key does not match its fingerprint; refusing to trust it');
            return m;
        }
        function emit(type, data) { for (const f of [...handlers[type] || []]) { try { f(data); } catch (_) {} } }
        function onlyHost() { if (!alive || !raw.isHost || reconnecting) throw Error('Only the connected party host can do that'); }
        function idle() { if (match && ['playing','preparing'].includes(match.state)) throw Error('Return to party first; running game host migration is not supported'); }
        function allowed(key, limit) {
            const now = Date.now(); const r = rates.get(key) || {at:now,count:0}; if (now - r.at > 3000) { r.at = now; r.count = 0; }
            rates.set(key, r); if (rates.size > 256) rates.delete(rates.keys().next().value); return ++r.count <= limit;
        }
        function append(m) { messages.push({...m,at:Date.now()}); messages = messages.slice(-LIMIT); save('history', messages.filter(x => !x.direct).slice(-LIMIT)); emit('message', m); emit('change'); }
        function notice(text) { append({id:random(),system:true,text:String(text).slice(0,500)}); }
        function send(type, data, to) { if (alive && raw.alive) raw.send('party:' + type, {epoch,...data}, to); }
        function request(type, data) { if (!alive || reconnecting) return; if (raw.isHost) receive(type, {epoch,...data}, {id:raw.id}); else send(type,data,raw.hostId); }
        function remember() { save('resume', {code:raw.code,mode,host:raw.isHost,hostKey:raw.isHost ? ident.publicKey : hostKey}); }
        function publish() {
            if (!raw.isHost || !alive) return;
            remember(); send('state', {revision:++stateRevision,hostKey:ident.publicKey,gameId,options:gameOptions,members,messages:messages.filter(m => !m.direct),match}); emit('change');
        }
        function hello() {
            if (!alive || reconnecting) return;
            const profile = NP.profile(); const data = {publicKey:ident.publicKey,name:String(profile.name).slice(0,16),avatar:typeof profile.avatar === 'string' ? profile.avatar.slice(0,8) : null,presence,autoFollow};
            if (raw.isHost) accept(raw.id, {...data,fingerprint:ident.fingerprint}); else send('hello',data,raw.hostId);
        }
        function accept(id, data) {
            const old = members.find(m => m.id === id);
            if (old?.publicKey && old.publicKey !== data.publicKey) return;
            const prior = members.find(m => m.fingerprint === data.fingerprint && m.id !== id);
            if (prior) {
                if (match?.participants.includes(prior.id) && ['preparing','playing'].includes(match.state)) failMatch(match.id,'Participant reconnected; return to party before retrying');
                members = members.filter(m => m !== prior);
            }
            if (!old && members.length >= 32) return;
            const m = old || {id,ready:false};
            keyPrints.set(data.publicKey, data.fingerprint);
            Object.assign(m,{name:String(data.name || 'Player').slice(0,16),avatar:typeof data.avatar === 'string' ? data.avatar.slice(0,8) : null,publicKey:data.publicKey,fingerprint:data.fingerprint,presence:data.presence === 'afk' ? 'afk' : 'online',autoFollow:data.autoFollow !== false,seen:Date.now()});
            if (!old) { members.push(m); notice(m.name + ' joined the party'); }
            publish();
        }
        async function verifyHello(d, from) {
            if (!raw.isHost || !raw.players.some(m => m.id === from.id) || typeof d.publicKey !== 'string' || d.publicKey.length > 200) return;
            const old = members.find(m => m.id === from.id);
            if (old?.publicKey === d.publicKey) { accept(from.id, {...d,fingerprint:old.fingerprint}); return; }
            if (old?.publicKey || challenges.has(from.id)) return;
            const token = random(); challenges.set(from.id,{token,data:d,at:Date.now()});
            try { send('challenge', {to:from.id,key:ident.publicKey,...await seal(d.publicKey,token,epoch + '|proof|' + from.id)},from.id); } catch (_) {challenges.delete(from.id);}
        }
        async function receive(type, d, from) {
            if (!alive || !d || !from?.id) return;
            const isAuthority = from.id === (raw.isHost ? raw.id : raw.hostId);
            if (type === 'state') {
                if (!authorityProof || authorityProof.raw !== raw || authorityProof.id !== from.id || authorityProof.epoch !== d.epoch || authorityProof.key !== d.hostKey) return;
                if (raw.isHost || !isAuthority || typeof d.epoch !== 'string' || !/^[0-9a-f]{32}$/.test(d.epoch) || !Number.isSafeInteger(d.revision) || (epoch === d.epoch && d.revision <= stateRevision) || !Array.isArray(d.members) || d.members.length > 32 || typeof d.hostKey !== 'string') return;
                if (d.match && (!/^[0-9a-f]{32}$/.test(d.match.id) || !['preparing','playing','ended','error'].includes(d.match.state) || !Array.isArray(d.match.participants) || d.match.participants.length > (NP.byId(d.match.gameId)?.max || 0) || !/^[A-Z0-9]{4,5}$/.test(d.match.code))) return;
                if (hostKey && hostKey !== d.hostKey) { emit('error','Party host key changed. Leave and verify the invitation out of band.'); return; }
                if (epoch && epoch !== d.epoch) { stopMatch(); }
                try { optionsFor(d.gameId,d.options); } catch (_) { return; }
                hostKey = d.hostKey; epoch = d.epoch; stateRevision = d.revision; gameId = d.gameId; gameOptions = d.options;
                const previousMessageIds = new Set(messages.map(m => m.id));
                members = d.members.slice(0,32).filter(m => m && typeof m === 'object').map(({keyStatus,...m}) => m); for (const m of members) learnKey(m.publicKey);
                const localDM = messages.filter(m => m.direct);
                messages = (Array.isArray(d.messages) ? d.messages : []).filter(m => m && typeof m.text === 'string' && m.text.length <= 500).slice(-LIMIT).concat(localDM).slice(-LIMIT);
                for (const m of messages) if (!previousMessageIds.has(m.id)) emit('message',m);
                const oldMatch = match; match = d.match && NP.byId(d.match.gameId) && Array.isArray(d.match.participants) ? d.match : null;
                reconnecting = false; retries = 0; redirectTarget = null; clearTimeout(reconnectTimer); reconnectTimer = null; remember(); emit('change');
                if (match?.state === 'preparing' && match.hostId && match.participants.includes(raw.id) && (!oldMatch?.hostId || oldMatch.id !== match.id)) prepare(match.id);
                if (match && ['ended','error'].includes(match.state)) stopMatch();
                return;
            }
            // Initial key exchange is anchored to the authenticated Netplay host and member IDs.
            if (type === 'challenge' && !raw.isHost && isAuthority && d.to === raw.id && typeof d.epoch === 'string') {
                if (hostKey && hostKey !== d.key) return;
                if (!/^[0-9a-f]{32}$/.test(d.epoch) || typeof d.key !== 'string' || d.key.length > 200) return;
                const connection = raw, gen = generation;
                try {
                    const token = await open(d.key,d,d.epoch + '|proof|' + raw.id);
                    if (!alive || raw !== connection || generation !== gen) return;
                    authorityProof = {raw:connection,id:from.id,epoch:d.epoch,key:d.key};
                    hostKey = d.key;
                    raw.send('party:proof',{epoch:d.epoch,token},raw.hostId);
                } catch (_) {} return;
            }
            if (type === 'hello') { if (raw.isHost && (!d.epoch || d.epoch === epoch)) await verifyHello(d,from); return; }
            if (!epoch || d.epoch !== epoch) return;
            if (type === 'proof' && raw.isHost) {
                const challenge = challenges.get(from.id);
                if (!challenge || challenge.token !== d.token || Date.now() - challenge.at > 15000) return;
                challenges.delete(from.id); const fingerprint = hex(new Uint8Array(await crypto.subtle.digest('SHA-256',un64(challenge.data.publicKey))));
                accept(from.id,{...challenge.data,fingerprint}); return;
            }
            const member = members.find(m => m.id === from.id); if (!member) return;
            if (!allowed(type + ':' + from.id, type === 'typing' ? 2 : 12)) return;
            if (raw.isHost) member.seen = Date.now();
            if (type === 'chat' && raw.isHost) { const text = String(d.text || '').trim().slice(0,500); if (text) { append({id:random(),from:from.id,name:member.name,text}); publish(); } }
            if (type === 'typing') { if (raw.isHost) send('typing-notice',{id:from.id,name:member.name}); emit('typing',{id:from.id,name:member.name}); }
            if (type === 'typing-notice' && isAuthority) emit('typing',{id:d.id,name:d.name});
            if (type === 'leave' && raw.isHost && from.id !== raw.id) { members = members.filter(m => m !== member); notice(member.name + ' left the party'); if (match?.participants.includes(from.id)) failMatch(match.id,'A participant left. Return to party before retrying.'); publish(); }
            if (type === 'prepared' && raw.isHost && match?.id === d.matchId && match.state === 'preparing' && match.participants.includes(from.id)) {
                if (d.error) { failMatch(match.id,String(d.error).slice(0,200)); return; }
                if (typeof d.sessionId !== 'string' || admitted.get(from.id) !== d.sessionId || !matchSession?.players.some(m => m.id === d.sessionId)) return;
                prepared.set(from.id,d.sessionId); member.ready = true; maybeStart();
            }
            if (type === 'returned' && raw.isHost && match?.id === d.matchId && match.participants.includes(from.id)) { member.ready = false; member.presence = 'online'; if (['preparing','playing'].includes(match.state)) {match.state='ended';stopMatch();members.forEach(m=>m.ready=false);notice(member.name + ' returned to party');} publish(); }
            if (type === 'dm' && d.to === raw.id && typeof d.messageId === 'string' && !seenDM.has(d.messageId)) {
                seenDM.add(d.messageId); if (seenDM.size > 200) seenDM.delete(seenDM.values().next().value);
                try { const text = await open(member.publicKey,d,[epoch,from.id,raw.id,d.messageId].join('|')); if (text.length <= 500) append({id:d.messageId,from:from.id,name:member.name,text,direct:true,to:raw.id}); } catch (_) {} }
            if (type === 'offer' && isAuthority && d.to === raw.id && !staged && !staging && (!match || !['playing','preparing'].includes(match.state))) {
                const connection = raw, gen = generation, token = {}; staging = token;
                try {
                    const next = await connect(true,mode,null,{partyOnly:true});
                    if (!alive || generation !== gen || raw !== connection || staging !== token) { next.leave(); return; }
                    staged = next; send('offer-ready',{token:d.token,code:next.code,hostId:next.id,newEpoch:random()},from.id);
                } catch (err) { if (alive && generation === gen) emit('error',err.message); }
                finally { if (staging === token) staging = null; } }
            if (type === 'offer-ready' && raw.isHost && handoff?.id === from.id && handoff.token === d.token && /^[A-Z0-9]{4,5}$/.test(d.code) && typeof d.newEpoch === 'string') {
                const next = {code:d.code,hostId:d.hostId,newEpoch:d.newEpoch,key:member.publicKey,to:from.id};
                send('redirect',next); const h = handoff; handoff = null; clearTimeout(h.timer);
                try { if (await redirect(next)) h.resolve(); else h.reject(Error('Leadership handoff cancelled')); } catch(err) { h.reject(err); }
            }
            if (type === 'redirect' && isAuthority && !raw.isHost) await redirect(d);
        }
        async function redirect(d) {
            if (!alive || typeof d.newEpoch !== 'string' || !/^[A-Z0-9]{4,5}$/.test(d.code)) return;
            const old = raw, mine = staged?.code === d.code ? staged : null, gen = ++generation;
            unsubs.forEach(u=>u()); unsubs=[]; reconnecting=true; redirectTarget=d;
            clearTimeout(reconnectTimer); reconnectTimer=null; retries=0;
            save('resume',{code:d.code,mode,host:false,hostKey:d.key});
            let next;
            try { next = mine || await connect(false,mode,d.code,{partyOnly:true,expectedHostId:d.hostId}); }
            catch (err) {
                if (alive && generation === gen && raw === old) { scheduleReconnect(); emit('change'); }
                throw err;
            }
            if (!alive || generation !== gen || raw !== old) { next.leave(); return false; }
            staged=null; raw=next; authorityProof=null; epoch=d.newEpoch;stateRevision=0;hostKey=d.key;reconnecting=false; redirectTarget=null; old.leave();
            if (raw.isHost) {members=[];match=null;} bind();hello();remember();emit('change'); return true;
        }
        async function admitMatch(sessionId, proof) {
            if (!match || match.state !== 'preparing' || !proof || !match.participants.includes(proof.memberId)) return false;
            const m = members.find(m => m.id === proof.memberId && m.publicKey); if (!m) return false;
            const current = match, attempt = preparation;
            try {
                const valid = await open(m.publicKey,proof,[epoch,current.id,sessionId,proof.memberId].join('|')) === 'admit';
                if (!valid || !alive || preparation !== attempt || match !== current || match.state !== 'preparing') return false;
                const existing = admitted.get(m.id);
                if (existing && existing !== sessionId) return false;
                if ([...admitted].some(([id,seat]) => id !== m.id && seat === sessionId)) return false;
                admitted.set(m.id,sessionId); return true;
            } catch (_) { return false; }
        }
        function stopMatch() { preparation++; prepared.clear(); admitted.clear(); clearTimeout(prepareTimer); prepareTimer=null; const s = matchSession; matchSession=null; if(s?.alive){s.emit('net:down','Returned to party; this match has stopped');s.leave();} }
        function failMatch(id, reason) { if (!match || match.id !== id || ['ended','error'].includes(match.state)) return; match.state='error';match.error=String(reason).slice(0,200);stopMatch();members.forEach(m=>m.ready=false);notice('Game loading stopped: '+match.error);publish();emit('error',match.error); }
        function watchMatch(s,id) {
            s.on('closed',()=>{ if (matchSession === s && match?.id===id && match.state==='playing') { if(raw.isHost)p.returnToParty();else {request('returned',{matchId:id});emit('change');} } });
            s.on('net:down',()=>{ if(matchSession !== s)return; if(raw.isHost)failMatch(id,'Match host disconnected');else p.returnToParty(); });
            s.on('net:error',err=>{ if(matchSession !== s)return; if(raw.isHost)failMatch(id,String(err));else request('prepared',{matchId:id,error:String(err)}); });
        }
        async function prepare(id) {
            if (!match || match.id !== id || !match.participants.includes(raw.id)) return;
            const current=match, gen=generation, attempt=preparation;
            try {
                await NP.loadGame(current.gameId);
                if(!alive||gen!==generation||attempt!==preparation||match?.id!==id||match.state!=='preparing')return;
                if (!raw.isHost) {
                    const s = await connect(false,mode,current.code,{matchId:id,expectedHostId:current.hostId});
                    if(!alive||gen!==generation||attempt!==preparation||match?.id!==id||match.state!=='preparing'){s.leave();return;}
                    matchSession=s; const proof=await seal(hostKey,'admit',[epoch,id,s.id,raw.id].join('|'));
                    if(!alive||gen!==generation||attempt!==preparation||matchSession!==s||match?.id!==id||match.state!=='preparing'){s.leave();return;}
                    s.connectionOptions = s.connectionOptions || {};s.connectionOptions.admission={memberId:raw.id,...proof};s.announceProfile();watchMatch(s,id);
                    await new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(!alive||!s.alive||gen!==generation||attempt!==preparation||match?.id!==id||match.state!=='preparing')return reject(Error('Loading cancelled'));if(s.players.some(m=>m.id===s.id)&&s.players.some(m=>m.host))return resolve();if(++n>100)return reject(Error('Match admission timed out'));setTimeout(poll,100);};poll();});
                }
                request('prepared',{matchId:id,sessionId:matchSession.id});
                if(raw.isHost){prepareTimer=setTimeout(()=>failMatch(id,'Timed out waiting for actual client readiness'),20000);maybeStart();}
            } catch(err) {if(!alive||gen!==generation||attempt!==preparation||match?.id!==id||match.state!=='preparing')return;if(raw.isHost)failMatch(id,err.message);else request('prepared',{matchId:id,error:err.message});}
        }
        function maybeStart() {
            if(!raw.isHost||!matchSession||match?.state!=='preparing')return;
            if(!match.participants.every(id=>prepared.has(id))) {publish();return;}
            clearTimeout(prepareTimer);match.state='playing';members.forEach(m=>{m.ready=match.participants.includes(m.id);});notice('Starting '+NP.byId(match.gameId).name);publish();
            NP.current=matchSession;matchSession.startGame();
        }
        function bind() {
            for(const type of ['state','hello','challenge','proof','chat','typing','typing-notice','leave','prepared','returned','dm','offer','offer-ready','redirect']) unsubs.push(raw.on('party:'+type,(d,f)=>{Promise.resolve(receive(type,d,f)).catch(err=>emit('error',err.message));}));
            unsubs.push(raw.on('net:down',()=>down()),raw.on('net:up',()=>{if(!reconnecting)hello();}),raw.on('net:error',err=>emit('error',String(err))));
            unsubs.push(raw.on('roster',()=>{if(!raw.isHost)hello();}));
        }
        function down() {
            if(!alive||raw.isHost||reconnecting)return;reconnecting=true;generation++;
            if(match&&['playing','preparing'].includes(match.state)){match.state='ended';match.error='Host lost; running simulation cannot migrate safely';stopMatch();}
            members.forEach(m=>{if(m.id===p.hostId)m.presence='reconnecting';});emit('change');scheduleReconnect();
        }
        function scheduleReconnect() {
            if(!alive||reconnectTimer||reconnectInFlight||retries>=6)return;
            const delay=Math.min(15000,1000*Math.pow(2,retries++));
            reconnectTimer=setTimeout(async()=>{
                reconnectTimer=null;if(!alive||!reconnecting)return;const gen=generation,target=redirectTarget,code=target ? target.code : raw.code;
                reconnectInFlight=true;
                try {
                    const next=await connect(false,mode,code,{partyOnly:true,...(target ? {expectedHostId:target.hostId} : {})});
                    if(!alive||gen!==generation){next.leave();return;}
                    unsubs.forEach(u=>u());unsubs=[];raw.leave();raw=next;authorityProof=null;epoch=null;stateRevision=0;if(target)hostKey=target.key;bind();reconnecting=false;hello();
                    // No accepted snapshot is also a failed reconnect, not a tight hello loop.
                    reconnectTimer=setTimeout(()=>{reconnectTimer=null;if(alive&&!epoch){reconnecting=true;scheduleReconnect();}},6000);
                } catch(_){ /* The bounded scheduler retries after this attempt finishes. */ }
                finally { reconnectInFlight=false; if(alive&&reconnecting)scheduleReconnect(); }
                emit('change');
            },delay);
        }
        bind(); hello(); remember();
        const heartbeat=setInterval(()=>{
            if(!alive)return;
            if(raw.isHost){
                const now=Date.now();let changed=false;
                for(const m of members){if(m.id===raw.id)continue;if(now-m.seen>12000&&m.presence!=='reconnecting'){m.presence='reconnecting';changed=true;if(match?.participants.includes(m.id)&&['playing','preparing'].includes(match.state))failMatch(match.id,'Participant connection lost; return to party');}}
                members=members.filter(m=>m.id===raw.id||now-m.seen<120000);
                for(const [id,c] of challenges)if(now-c.at>15000)challenges.delete(id);
                if(changed)publish();
            }else if(!reconnecting)hello();
        },4000);
        return p;
    }
})();
