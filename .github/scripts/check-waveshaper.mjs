import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const rules = fs.readFileSync('games/waveshaper/waveshaper-sim.js', 'utf8');
const ui = fs.readFileSync('games/waveshaper/waveshaper.js', 'utf8');
const context = vm.createContext({}); vm.runInContext(rules, context);
const W = context.WaveShaper;
let checks = 0;
function test(name, run) { run(); checks++; console.log('  ok    ' + name); }
function hit(game) { game.obstacles[0].x = W.PLAYER; game.cooldown = 0; return W.act(game, game.obstacles[0].action); }
function wait(game, seconds) { for(let t=0;t<seconds;t+=1/120) W.step(game,1/120); }

test('matching early costs a life, scores nothing and slows current speed by exactly 40%',()=>{
 const g=W.create(42), first=g.obstacles[0];g.speed=500;
 assert.equal(W.act(g,first.action).type,'early');assert.equal(g.score,0);assert.equal(g.lives,3);assert.equal(g.speed,300);assert.equal(g.obstacles[0],first);
});
test('only overlap with the receiver counts, including both exact boundaries',()=>{
 for(const delta of [-W.HIT_WINDOW,W.HIT_WINDOW,0]){const g=W.create(42);g.obstacles[0].x=W.PLAYER+delta;assert.equal(W.act(g,g.obstacles[0].action).type,'hit');assert.equal(g.score,1);}
 const g=W.create(42);g.obstacles[0].x=W.PLAYER+W.HIT_WINDOW+.01;assert.equal(W.act(g,g.obstacles[0].action).type,'early');assert.equal(g.score,0);
});
test('wrong inputs at the target and misses each cost one life and apply the same speed penalty',()=>{
 for(const type of ['wrong','miss']){const g=W.create(42);g.speed=500;g.obstacles[0].x=type==='miss'?W.PLAYER-W.HIT_WINDOW-1:W.PLAYER;
 const event=type==='miss'?W.step(g,.001)[0]:W.act(g,(g.obstacles[0].action+1)%4);assert.equal(event.type,type);assert.equal(g.lives,3);assert.equal(g.speed,300);assert.equal(g.obstacles[0].id,2);}
});
test('four mistakes end a run; game over cannot change the score or position',()=>{
 const g=W.create(42);for(let i=0;i<4;i++){g.cooldown=0;W.act(g,(g.obstacles[0].action+1)%4);}assert.ok(g.over);assert.equal(g.lives,0);
 const before=JSON.stringify(g);W.step(g,1);W.act(g,0);assert.equal(JSON.stringify(g),before);
});
test('hits increase current speed up to a limit; a mistake does not reset it to a score-derived speed',()=>{
 const g=W.create(42);for(let i=0;i<150;i++)hit(g);assert.equal(g.speed,W.config.cap);const score=g.score;
 g.obstacles[0].x=500;W.act(g,g.obstacles[0].action);assert.equal(g.speed,W.config.cap*.6);assert.equal(g.score,score);
 hit(g);assert.equal(g.speed,W.config.cap*.6+W.config.ramp);assert.ok(g.speed<W.config.cap);
});
test('repeated penalties respect a playable minimum; twenty consecutive hits restore one life',()=>{
 const g=W.create(42);for(let i=0;i<3;i++){g.cooldown=0;W.act(g,g.obstacles[0].action);}assert.equal(g.speed,W.config.floor);assert.equal(g.lives,1);
 for(let i=0;i<19;i++)hit(g);assert.equal(g.lives,1);assert.equal(hit(g).healed,true);assert.equal(g.lives,2);
});
test('holding or simultaneous inputs cannot mash through the early penalty',()=>{
 const g=W.create(42);W.act(g,g.obstacles[0].action);for(let i=0;i<40;i++)assert.equal(W.act(g,i%4),null);assert.equal(g.lives,3);assert.equal(g.score,0);
});
test('500 real timed hits survive at 30, 60 and 144fps with readable ordered obstacles',()=>{
 for(const fps of [30,60,144]){const g=W.create(865);for(let f=0;g.score<500&&f<fps*800;f++){W.step(g,1/fps);if(Math.abs(g.obstacles[0].x-W.PLAYER)<W.HIT_WINDOW*.6)W.act(g,g.obstacles[0].action);assert.ok(!g.over);assert.ok(g.obstacles.length<10);}assert.equal(g.score,500);assert.equal(g.speed,W.config.cap);}
});
test('stalled frames and invalid inputs cannot corrupt the run',()=>{
 const g=W.create(42),x=g.obstacles[0].x;W.step(g,3600);assert.ok(x-g.obstacles[0].x<=g.speed*.051);
 for(const delta of [Infinity,NaN,-1])W.step(g,delta);for(const action of [-1,4,NaN,'0'])assert.equal(W.act(g,action),null);assert.equal(g.lives,4);
});
test('shoulders, triggers and face buttons keep the four shape mappings',()=>{
 const p={buttons:Array.from({length:17},()=>({pressed:false,value:0}))};for(const [button,action]of [[4,0],[6,1],[5,2],[7,3],[3,0],[0,1],[2,2],[1,3]]){p.buttons[button].value=1;assert.deepEqual([...W.padActions(p)],[0,1,2,3].map(i=>i===action));p.buttons[button].value=0;}
});
function setup(storage = '{}') {
    const frames = new Map(), elements = new Map(), docEvents = {}, winEvents = {}, writes = [];
    const drawing = new Proxy({}, { get: () => () => {}, set: () => true });
    let frameId = 0, currentGame, pads = [], now = 0;
    const element = () => ({
        textContent: '', hidden: false, disabled: false, value: 'normal', dataset: {}, tagName: 'BUTTON',
        classList: { toggle() {} }, setAttribute() {}, focus() {}, getContext: () => drawing,
        addEventListener(type, fn) { this[type] = fn; }
    });
    const buttons = Array.from({ length: 4 }, (_, i) => ({ ...element(), dataset: { action: String(i) } }));
    const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    $('wave').tagName = 'CANVAS';
    const win = { addEventListener: (type, fn) => winEvents[type] = fn };
    const doc = {
        hidden: false, getElementById: $, querySelectorAll: () => buttons,
        addEventListener: (type, fn) => docEvents[type] = fn
    };
    const env = vm.createContext({
        window: win, document: doc, navigator: { getGamepads: () => pads },
        localStorage: { getItem: () => storage, setItem: (_, value) => writes.push(value) },
        matchMedia: () => ({ matches: true, addEventListener() {} }),
        requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id)
    });
    vm.runInContext(rules, env);
    const create = win.WaveShaper.create;
    win.WaveShaper.create = () => currentGame = create(42);
    vm.runInContext(ui, env);
    return {
        $, buttons, doc, winEvents, writes, get game() { return currentGame; },
        key(code, repeat = false) { docEvents.keydown({ code, repeat, target: $('wave'), preventDefault() {} }); },
        tick() { const fn = [...frames.values()][0]; frames.clear(); fn(now += 16.667); },
        pads(value) { pads = value; }, visibility() { docEvents.visibilitychange(); }
    };
}

test('real keyboard and touch adapters reject early hits and accept a correctly timed hit',()=>{
 const e=setup();e.$('start').onclick();const a=e.game.obstacles[0].action,code=['KeyW','KeyS','ArrowUp','ArrowDown'][a];e.key(code,true);assert.equal(e.game.lives,4);e.key(code);assert.equal(e.game.lives,3);assert.equal(e.game.score,0);
 e.game.cooldown=0;e.game.obstacles[0].x=W.PLAYER;e.buttons[a].click();assert.equal(e.game.score,1);e.winEvents.blur();assert.equal(JSON.parse(e.writes.at(-1)).best,1);
});
test('blur and hidden tabs freeze the wave until explicit resume',()=>{
 const e=setup();e.$('start').onclick();e.tick();e.winEvents.blur();const x=e.game.obstacles[0].x;for(let i=0;i<20;i++)e.tick();assert.equal(e.game.obstacles[0].x,x);assert.equal(e.$('overlay').hidden,false);
 e.key('KeyP');e.tick();e.tick();assert.ok(e.game.obstacles[0].x<x);e.doc.hidden=true;e.visibility();e.doc.hidden=false;e.visibility();const paused=e.game.obstacles[0].x;e.tick();assert.equal(e.game.obstacles[0].x,paused);
});
test('gamepad triggers fire once and disconnect pauses the embedded game',()=>{
 const e=setup(),p={index:0,connected:true,mapping:'standard',buttons:Array.from({length:17},()=>({pressed:false}))};e.pads([p]);e.tick();p.buttons[9].pressed=true;e.tick();assert.equal(e.$('overlay').hidden,true);p.buttons[9].pressed=false;e.tick();
 e.game.obstacles[0].x=W.PLAYER;const button=[4,6,5,7][e.game.obstacles[0].action];p.buttons[button].pressed=true;e.tick();assert.equal(e.game.score,1);for(let i=0;i<10;i++)e.tick();assert.equal(e.game.score,1);e.pads([]);e.tick();assert.equal(e.$('overlay').hidden,false);
});
test('malformed optional storage cannot stop the timing game',()=>{
 for(const value of ['broken','null','42','"text"','[]']){const e=setup(value);e.$('start').onclick();e.game.obstacles[0].x=W.PLAYER;e.buttons[e.game.obstacles[0].action].click();e.winEvents.blur();assert.equal(JSON.parse(e.writes.at(-1)).best,1);}
});
console.log('\n'+checks+' WAVESHAPER timing and input checks passed.');
