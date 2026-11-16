// Wait on observed relay/session state instead of guessing startup/message delay.
export function waitForLobbyReady(page, { timeout = 10000 } = {}) {
    return page.waitForFunction(() => {
        const players = window.Netplay?.current?.players;
        return !!players && players.length >= 2 && players.every(p => p.ready || p.host);
    }, null, { timeout });
}
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitForPort(port, { host = '127.0.0.1', timeout = 5000 } = {}) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid relay port');
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('invalid readiness timeout');
    const until = performance.now() + timeout;
    while (performance.now() < until) {
        const ready = await new Promise(resolve => {
            const socket = net.createConnection({ host, port });
            socket.once('connect', () => { socket.destroy(); resolve(true); });
            socket.once('error', () => { socket.destroy(); resolve(false); });
            socket.setTimeout(Math.max(1, Math.min(250, until - performance.now())), () => { socket.destroy(); resolve(false); });
        });
        if (ready) return;
        await delay(Math.max(0, Math.min(25, until - performance.now())));
    }
    throw new Error(`relay ${host}:${port} not ready within ${timeout}ms`);
}
