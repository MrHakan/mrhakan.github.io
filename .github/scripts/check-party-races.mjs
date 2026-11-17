import assert from 'node:assert/strict';
import {network,until,wait,deferred} from './party-test-fixtures.mjs';
let checks = 0, failures = 0;
async function test(name,fn) {
    const n = network();
    try { await fn(n); checks++; console.log('ok - '+name); }
    catch (error) { failures++; console.error('FAIL - '+name+'\n'+error.stack); }
    finally { n.close(); }
}
await test('a guest reconnects on two consecutive control disconnects',async n => {
    const {host,guest} = await n.pair();
    for (let attempt=0;attempt<2;attempt++) {
        const previous = guest.id;
        n.control(guest).emit('net:down','Fixture disconnect');
        await until(() => guest.id !== previous && guest.status === 'Connected' && guest.epoch && host.members.some(m => m.id === guest.id));
    }
});
await test('a stale host connection cannot orphan a newer launched match',async n => {
    const {a,host} = await n.pair(), gate = deferred(), opened = deferred();
    const original = a.host; let held = false;
    a.host = async (...args) => { const s = await original(...args); if(args[4]?.matchId && !held) { held=true; opened.resolve(s); await gate.promise; } return s; };
    const first = host.startGame(); await opened.promise;
    host.returnToParty(); await host.startGame(); await until(() => host.match?.state === 'playing');
    const current = a.launched.session;
    gate.resolve(); await first;
    assert.equal(current.alive,true);
    assert.ok(a.current===current,'late background connection does not replace the active legacy current');
    host.returnToParty(); assert.equal(current.alive,false,'Return must close the newer match Session');
});
await test('a delayed transport open cannot replace a newer active match',async n => {
    const {a,b,host} = await n.pair(), gate = deferred(), opening = deferred();
    const original = a.TRANSPORTS.local.make; let held = false;
    a.TRANSPORTS.local.make = (...args) => {
        const transport = original(...args);
        if (args[1] && !held) {
            held = true;
            const open = transport.open;
            transport.open = async () => { opening.resolve(); await gate.promise; return open.call(transport); };
        }
        return transport;
    };
    const first = host.startGame(); await opening.promise;
    host.returnToParty(); await host.startGame(); await until(() => host.match?.state === 'playing' && b.launched);
    const current = a.launched.session;
    gate.resolve(); await first;
    assert.equal(current.alive,true);
    assert.ok(a.current===current,'a late transport open must not publish over the newer active Session');
    a.setAvatar('after');
    await until(() => b.launched.session.players.some(p => p.id === current.id && p.avatar === 'after'));
    assert.equal(current.me.avatar,'after','profile updates still reach the active Session');
});
await test('Leave cancels an in-flight leadership redirect and cannot recreate resume metadata',async n => {
    const {a,host,guest} = await n.pair(), gate = deferred(), opened = deferred();
    const original = a.join;
    a.join = async (...args) => { const s = await original(...args); if(args[3]?.partyOnly) { opened.resolve(s); await gate.promise; } return s; };
    const transfer = host.transferLeadership(guest.id).catch(() => {}), late = await opened.promise;
    host.leave(); assert.equal(a.fixtureStore.has('mrhakan98-party-resume'),false);
    gate.resolve(); await transfer; await wait(40);
    assert.equal(late.alive,false); assert.equal(a.fixtureStore.has('mrhakan98-party-resume'),false);
});
await test('Leave cancels an in-flight leadership offer',async n => {
    const {b,host,guest} = await n.pair(), gate = deferred(), opened = deferred();
    const original = b.host;
    b.host = async (...args) => { const s = await original(...args); if(args[4]?.partyOnly) { opened.resolve(s); await gate.promise; } return s; };
    const transfer = host.transferLeadership(guest.id).catch(() => {}), late = await opened.promise;
    guest.leave(); gate.resolve(); await wait(40);
    assert.equal(late.alive,false); assert.equal(b.fixtureStore.has('mrhakan98-party-resume'),false);
    host.leave(); await transfer;
});
await test('Return during a guest preload cancels preparation instead of launching later',async n => {
    const {b,host,guest} = await n.pair(), gate = deferred(), loading = deferred();
    b.loadGame = async () => { loading.resolve(); await gate.promise; return {start(){}}; };
    await host.startGame(); await loading.promise; guest.returnToParty();
    await wait(30); gate.resolve(); await wait(200);
    assert.notEqual(host.match.state,'preparing'); assert.notEqual(host.match.state,'playing'); assert.equal(b.launched,undefined);
});
await test('readiness cannot acknowledge another participant seat',async n => {
    const {b,host,guest} = await n.pair(), gate = deferred(), loading = deferred();
    b.loadGame = async () => { loading.resolve(); await gate.promise; return {start(){}}; };
    await host.startGame(); await loading.promise;
    n.control(guest).send('party:prepared',{epoch:host.epoch,matchId:host.match.id,sessionId:host.match.hostId},host.id);
    await wait(40); assert.equal(host.match.state,'preparing');
    gate.resolve(); await until(() => host.match.state === 'playing');
});
await test('replacement of a control ID ends its old running match conservatively',async n => {
    const {b,host,guest} = await n.pair(); await host.startGame(); await until(() => host.match.state === 'playing' && b.launched);
    const previous = guest.id, session = b.launched.session;
    n.control(guest).emit('net:down','Fixture disconnect'); await until(() => guest.id !== previous && guest.status === 'Connected' && guest.epoch && host.members.some(m => m.id === guest.id));
    assert.equal(session.alive,false); assert.notEqual(host.match.state,'playing'); assert.notEqual(guest.match.state,'playing');
});
await test('an unadmitted match sender cannot seat itself or disrupt a guest directly',async n => {
    const {b,host,guest} = await n.pair(); await host.startGame(); await until(() => host.match.state === 'playing' && b.launched);
    const receiver = b.launched.session, stranger = 'unadmitted-fixture'; let gameplay = 0;
    receiver.on('fixture:packet',() => gameplay++);
    const packet = (type,data) => ({v:b.VERSION,t:type,d:data,f:stranger,to:receiver.id,matchId:host.match.id});
    receiver._onData(stranger,packet('np:hello',{name:'Stranger'}));
    assert.ok(!receiver.players.some(p => p.id === stranger),'guest membership must come from the admitted host roster');
    receiver._onData(stranger,packet('fixture:packet',{})); assert.equal(gameplay,0);
    receiver._onData(stranger,packet('np:full',{reason:'Unadmitted denial'})); await wait(30); assert.equal(host.match.state,'playing');
    receiver._onData(stranger,{...packet('np:hello',{}),v:0}); await wait(30); assert.equal(host.match.state,'playing','unadmitted version feedback cannot fail a match');
});
await test('waiting members cannot return or send a return command for another match',async n => {
    const {a,b,host} = await n.pair(), c = n.client();
    for (const np of [a,b,c]) np.CATALOG[0].max = 3;
    const waiting = await c.Party.join(host.code,{mode:'local'});
    await until(() => host.members.length === 3 && waiting.members.length === 3);
    waiting.setAutoFollow(false); await until(() => host.members.find(m => m.id === waiting.id)?.autoFollow === false);
    await host.startGame(); await until(() => host.match?.state === 'playing' && b.launched);
    assert.ok(!host.match.participants.includes(waiting.id));
    waiting.returnToParty(); await wait(30);
    assert.equal(host.match.state,'playing','a waiting member cannot stop the active participants');
    n.control(waiting).send('party:returned',{epoch:host.epoch,matchId:host.match.id},host.id);
    await wait(30); assert.equal(host.match.state,'playing','the host authorizes participant return commands');
    assert.equal(a.launched.session.alive,true);
});
await test('a failed leadership redirect recovers into the new room',async n => {
    const {a,host,guest} = await n.pair();
    const original = a.join; let failed = false;
    a.join = (...args) => { if(args[3]?.partyOnly && !failed) { failed = true; return Promise.reject(Error('Fixture redirect connection failure')); } return original(...args); };
    await assert.rejects(host.transferLeadership(guest.id),/Fixture redirect connection failure/);
    await until(() => guest.isHost && host.code === guest.code && host.status === 'Connected' && host.members.length === 2 && guest.members.length === 2);
    host.sendChat('Recovered after redirect');
    await until(() => guest.messages.some(m => m.text === 'Recovered after redirect'));
    assert.equal(JSON.parse(a.fixtureStore.get('mrhakan98-party-resume')).code,guest.code);
});
await test('a redirect retries after an older reconnect finishes in another generation',async n => {
    const {a,b,host,guest} = await n.pair(), c = n.client();
    for (const np of [a,b,c]) np.CATALOG[0].max = 3;
    const nextLeader = await c.Party.join(host.code,{mode:'local'});
    await until(() => host.members.length === 3 && nextLeader.members.length === 3);
    const original = b.join, gate = deferred(), opening = deferred();
    let attempts = 0, redirectFailed = false;
    b.join = async (...args) => {
        if (args[3]?.partyOnly) {
            attempts++;
            if (attempts === 1) { opening.resolve(); await gate.promise; }
            else if (attempts === 2) { redirectFailed = true; throw Error('Fixture overlapping redirect failure'); }
        }
        return original(...args);
    };
    n.control(guest).emit('net:down','Fixture overlapping reconnect'); await opening.promise;
    await host.transferLeadership(nextLeader.id); await until(() => redirectFailed);
    gate.resolve();
    await until(() => nextLeader.isHost && guest.code === nextLeader.code && guest.status === 'Connected' && nextLeader.members.length === 3);
    assert.ok(attempts >= 3,'the current generation retries after the stale attempt drains');
});
for (const [type,data,version] of [['np:full',{reason:'Unadmitted denial'},2],['np:hello',{},0]]) {
    await test('unadmitted '+type+' cannot abort a match during preparation',async n => {
        const {a,b,host} = await n.pair(), c=n.client(), gate=deferred(), loading=deferred();
        for (const np of [a,b,c]) np.CATALOG[0].max=3;
        const third=await c.Party.join(host.code,{mode:'local'});await until(()=>host.members.length===3&&third.members.length===3);
        c.loadGame=async()=>{loading.resolve();await gate.promise;return {start(){}};};
        try {
            await host.startGame();await loading.promise;
            let receiver;await until(()=>{receiver=n.sessions.find(s=>!s.isHost&&s.connectionOptions.matchId===host.match.id&&s.me.name===b.profile().name&&s._handlers['net:error']?.length);return !!receiver;});
            receiver._onData('stranger',{v:version,t:type,d:data,f:'stranger',to:receiver.id,matchId:host.match.id});
            await wait(30);assert.equal(host.match.state,'preparing');
        } finally {gate.resolve();}
    });
}
console.log(`${checks} party race/admission checks passed; ${failures} failed`);
if (failures) throw Error(`${failures} party race/admission regressions failed`);
