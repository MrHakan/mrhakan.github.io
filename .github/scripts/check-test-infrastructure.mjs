// Infrastructure checks are small and deterministic; game samples stay in their own suites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

let loader;
try { loader = await import('./game-test-context.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof loader?.createTestScope, 'function', 'a lexical loader for trusted game IIFEs exists');
assert.equal(typeof loader?.loadGameScript, 'function', 'trusted IIFEs can be loaded into separate test scopes');
const { createTestScope, loadGameScript } = loader;
const a = createTestScope({ window: {}, marker: 7 }), b = createTestScope({ window: {}, marker: 9 });
loadGameScript('(function(root){root.value=marker;root.square=Math.sqrt(81);})(window);', a);
loadGameScript('(function(root){root.value=marker;})(window);', b);
assert.deepEqual(a.window, { value: 7, square: 9 });
assert.deepEqual(b.window, { value: 9 });
assert.equal(globalThis.value, undefined, 'loading one game does not write the process global');
const fallback = createTestScope();
loadGameScript('(function(root){root.result=42;})(typeof window!=="undefined"?window:globalThis);', fallback);
assert.equal(fallback.result, 42, 'globalThis-rooted game modules stay inside the test scope');
for (const seed of [1, 7, 2024]) {
    const fast = createTestScope(), reference = vm.createContext({});
    for (const name of ['age-of-troll-data.js', 'age-of-troll-sim.js']) {
        const source = fs.readFileSync(path.join(ROOT, 'games/age-of-troll', name), 'utf8');
        loadGameScript(source, fast, name); vm.runInContext(source, reference);
    }
    const run = A => {
        const s = A.newGame(seed), brains = [A.newBrain('normal', 'balanced', seed), A.newBrain('hard', 'rush', seed + 1)];
        for (let k = 0; k < 600; k++) { A.think(s, 0, brains[0]); A.think(s, 1, brains[1]); A.step(s); }
        return JSON.stringify(s);
    };
    assert.equal(run(fast.AOT), run(reference.AOT), 'lexical and VM simulations have identical state for seed ' + seed);
}
console.log('Game test loader: isolation, bindings and three reference-simulation parity checks passed.');

let telemetry;
try { telemetry = await import('./browser-diagnostics.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof telemetry?.createBrowserDiagnostics, 'function', 'browser phases and failure evidence have a reusable recorder');
const { createBrowserDiagnostics } = telemetry;
let now = 0;
const dir = path.join(ROOT, '.ci-shots', 'infrastructure-' + process.pid);
const recorder = createBrowserDiagnostics({ suite: 'timing-check', dir, now: () => now });
recorder.phase('open');
assert.equal(JSON.parse(fs.readFileSync(dir + '/timing-check-diagnostics.json', 'utf8')).current.name, 'open', 'last phase is persisted before a hard kill');
now = 25; recorder.phase('play'); now = 50;
const timing = await recorder.finish();
assert.equal(timing.status, 'passed');
assert.deepEqual(timing.phases.map(phase => phase.ms), [25, 25]);
assert.throws(() => createBrowserDiagnostics({ suite: '../escape', dir }), /suite/, 'suite labels cannot escape the artifact directory');
const failed = createBrowserDiagnostics({ suite: 'failure-check', dir });
failed.phase('join'); failed.failure('intentional fixture failure'); failed.phase('cleanup');
const failureReport = await failed.finish();
assert.equal(failureReport.status, 'failed', 'a recorded failure cannot be overwritten by successful teardown');
assert.equal(failureReport.evidence[0].phase, 'join', 'capture keeps the failure phase even if the next scenario starts');
console.log('Browser diagnostics: persisted phases, timings, safe paths and non-masking failure status passed.');
const signalProbe = createBrowserDiagnostics({ suite: 'signal-api', dir });
assert.equal(typeof signalProbe.installSignals, 'function', 'timeouts preserve evidence and exit non-zero');
await signalProbe.finish();
const helperUrl = pathToFileURL(path.join(ROOT, '.github/scripts/browser-diagnostics.mjs')).href;
const code = `import {createBrowserDiagnostics} from ${JSON.stringify(helperUrl)};
const d=createBrowserDiagnostics({suite:'signal-check',dir:${JSON.stringify(dir)}});
d.phase('stalled relay');d.installSignals();console.log('READY');setInterval(()=>{},1000);`;
const child = spawn(process.execPath, ['--input-type=module', '--eval', code], { stdio: ['ignore', 'pipe', 'pipe'] });
const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('signal fixture deadline')); }, 7000);
    let text = '', sent = false;
    child.stdout.on('data', data => { text += data; if (!sent && text.includes('READY')) { sent = true; child.kill('SIGTERM'); } });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve(code); });
});
assert.equal(exitCode, 1, 'SIGTERM must not turn an interrupted test green');
const interrupted = JSON.parse(fs.readFileSync(dir + '/signal-check-diagnostics.json', 'utf8'));
assert.equal(interrupted.status, 'failed');
assert.equal(interrupted.phases.at(-1).name, 'stalled relay');
assert.ok(interrupted.problems.includes('SIGTERM'));
console.log('Browser diagnostics: real subprocess SIGTERM preserves the phase and fails closed.');
const crashCode = `import importFs from 'node:fs';
import {createBrowserDiagnostics} from ${JSON.stringify(helperUrl)};
const d=createBrowserDiagnostics({suite:'crash-check',dir:${JSON.stringify(dir)}});
d.phase('relay startup');d.installSignals(() => {
    importFs.writeFileSync(${JSON.stringify(dir + '/crash-cleaned.txt')}, 'cleaned');
});throw new Error('boot refused');`;
const crashChild = spawn(process.execPath, ['--input-type=module', '--eval', crashCode], { stdio: ['ignore', 'ignore', 'pipe'] });
crashChild.stderr.resume();
const crashExit = await new Promise((resolve, reject) => { crashChild.on('error', reject); crashChild.on('close', resolve); });
assert.equal(crashExit, 1, 'uncaught startup failures remain failures');
const crash = JSON.parse(fs.readFileSync(dir + '/crash-check-diagnostics.json', 'utf8'));
assert.equal(crash.status, 'failed', 'startup exceptions mark diagnostics failed before Node exits');
assert.equal(crash.current.name, 'relay startup');
assert.ok(crash.problems.some(problem => problem.includes('boot refused')));
assert.ok(fs.existsSync(dir + '/crash-cleaned.txt'), 'uncaught startup cleanup runs synchronously before Node exits');
console.log('Browser diagnostics: uncaught startup failures preserve their cause.');

let readiness;
try { readiness = await import('./browser-readiness.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof readiness?.waitForPort, 'function', 'relay startup waits for actual readiness, not a fixed sleep');
const net = await import('node:net');
const server = net.createServer(socket => socket.end());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await readiness.waitForPort(port);
await new Promise(resolve => server.close(resolve));
await assert.rejects(readiness.waitForPort(port, { timeout: 100 }), /not ready/, 'a missing relay times out instead of being assumed ready');
await assert.rejects(readiness.waitForPort(0), /port/, 'invalid relay ports are refused');
console.log('Relay readiness: real listening port, bounded unavailable-port failure and input validation passed.');
assert.equal(typeof readiness.waitForLobbyReady, 'function', 'lobby waits inspect actual player readiness, not the enabled start button');
await readiness.waitForLobbyReady({ waitForFunction: async (predicate, arg, options) => {
    assert.equal(options.timeout, 10000);
    const ready = session => vm.runInNewContext('(' + predicate.toString() + ')()', { window: { Netplay: { current: session } } });
    assert.equal(ready(null), false);
    assert.equal(ready({ players: [] }), false);
    const session = { players: [{ host: true, ready: false }, { host: false, ready: false }] };
    assert.equal(ready(session), false, 'an enabled button with a delayed guest ready message is not ready');
    session.players[1].ready = true;
    assert.equal(ready(session), true, 'only host-observed guest readiness permits start');
} });
console.log('Lobby readiness: pending guests cannot be confused with an enabled start button.');

