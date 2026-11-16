// Phase checkpoints survive a hard kill; failure captures are bounded and
// best-effort, so diagnostics never replace the test's own assertion result.
import fs from 'node:fs';
import path from 'node:path';

const bounded = async (work, ms = 1800) => {
    let timer;
    try {
        return await Promise.race([Promise.resolve().then(work), new Promise(resolve => {
            timer = setTimeout(() => resolve({ error: 'diagnostic deadline exceeded' }), ms);
        })]);
    } catch (error) { return { error: String(error.message || error).slice(0, 500) }; }
    finally { clearTimeout(timer); }
};

export function createBrowserDiagnostics({ suite, dir = '.ci-shots', now = () => performance.now() }) {
    if (!/^[a-z0-9-]+$/.test(suite)) throw new Error('invalid diagnostics suite label');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, suite + '-diagnostics.json'), start = now();
    const report = { suite, status: 'running', startedAt: new Date().toISOString(), phases: [], problems: [], evidence: [] };
    const pages = new Map(), pending = new Set();
    let current = null, captureId = 0, pageId = 0;
    const persist = () => {
        report.elapsedMs = Math.max(0, now() - start);
        report.current = current ? { name: current.name, startedMs: current.at - start, elapsedMs: Math.max(0, now() - current.at) } : null;
        try { fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n'); }
        catch (error) { console.error('[diagnostics] cannot save checkpoint: ' + error.message); }
    };
    const endPhase = () => {
        if (current) report.phases.push({ name: current.name, ms: Math.max(0, now() - current.at) });
        current = null;
    };
    const phase = name => { endPhase(); current = { name: String(name).slice(0, 200), at: now() }; persist(); };
    const capture = async reason => {
        const id = ++captureId, capturedPhase = current?.name;
        const evidence = await Promise.all([...pages].filter(([page]) => !page.isClosed()).map(async ([page, n]) => {
            const url = page.url().slice(0, 400);
            const state = await bounded(() => page.evaluate(() => {
                const g = (window.WZ_ENGINE || window.AOT_ENGINE)?.state?.();
                const session = g?.session || window.Netplay?.current;
                return { readyState: document.readyState, visibility: document.visibilityState,
                    tick: g?.s?.tick, phase: g?.s?.phase, over: g?.s?.over,
                    host: g?.isHost, sessionState: session?.state, transport: session?.transport?.kind,
                    players: session?.players?.length,
                    directConnections: (window.__conns || []).map(c => ({ open: !!c.open, closed: !!c.closed })) };
            }));
            const screenshot = path.join(dir, `${suite}-failure-${id}-page-${n}.png`);
            const image = await bounded(() => page.screenshot({ path: screenshot, timeout: 1500 }).then(() => ({ path: screenshot })));
            return { page: n, url, state, screenshot: image };
        }));
        report.evidence.push({ reason: String(reason).slice(0, 500), phase: capturedPhase, pages: evidence });
        persist();
    };
    const failure = reason => {
        report.status = 'failed';
        if (report.problems.length < 32) report.problems.push(String(reason).slice(0, 1000));
        persist();
        if (captureId < 3) {
            const task = capture(reason); pending.add(task);
            task.then(() => pending.delete(task), () => pending.delete(task));
        }
    };
    const flush = () => Promise.allSettled([...pending]);
    const trackContext = context => {
        const track = page => {
            if (pages.has(page)) return;
            pages.set(page, ++pageId);
            page.once('close', () => pages.delete(page));
            page.on('pageerror', error => failure('pageerror: ' + error.message));
            const close = page.close.bind(page);
            page.close = async (...args) => { await flush(); return close(...args); };
        };
        context.on('page', track); context.pages().forEach(track);
        // Drain evidence before a scenario tears down its context. No extra wait
        // on the successful path, and no assertions/input timing are changed.
        const close = context.close.bind(context);
        context.close = async (...args) => { await flush(); return close(...args); };
    };
    const listeners = [];
    let cleanup = () => {};
    const installSignals = (onStop = () => {}) => {
        cleanup = onStop;
        if (listeners.length) return;
        const crash = error => {
            failure('uncaught: ' + String(error.message || error));
            // Node exits immediately after this monitor; start cleanup synchronously.
            try { const stopped = cleanup(); stopped?.catch?.(() => {}); } catch (_) { }
        };
        listeners.push(['uncaughtExceptionMonitor', crash]); process.once('uncaughtExceptionMonitor', crash);
        for (const signal of ['SIGTERM', 'SIGINT']) {
            const handler = async () => {
                failure(signal);
                const force = setTimeout(() => { try { cleanup(); } finally { process.exit(1); } }, 4500).unref();
                try { await finish({ failures: 1 }); }
                finally { await bounded(cleanup, 500); clearTimeout(force); process.exit(1); }
            };
            listeners.push([signal, handler]); process.once(signal, handler);
        }
    };
    const finish = async ({ failures = 0 } = {}) => {
        await flush(); endPhase();
        for (const [signal, handler] of listeners.splice(0)) process.removeListener(signal, handler);
        report.status = failures || report.status === 'failed' ? 'failed' : 'passed';
        persist();
        const summary = ['\n### ' + suite + ' browser phases', '| phase | seconds |', '| --- | ---: |',
            ...report.phases.map(p => '| ' + p.name.replace(/\|/g, '\\|') + ' | ' + (p.ms / 1000).toFixed(2) + ' |')].join('\n') + '\n';
        if (process.env.GITHUB_STEP_SUMMARY) {
            try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary); }
            catch (error) { console.error('[diagnostics] cannot save summary: ' + error.message); }
        }
        console.log('[timing] ' + suite + ': ' + report.phases.map(p => p.name + '=' + (p.ms / 1000).toFixed(2) + 's').join('; '));
        return report;
    };
    persist();
    return { phase, failure, capture, flush, trackContext, installSignals, finish };
}
