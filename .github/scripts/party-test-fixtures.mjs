// Actual Netplay Sessions and Party controllers on an isolated in-memory bus.
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
const netplay = fs.readFileSync(new URL('../../games/netplay.js', import.meta.url), 'utf8');
const party = fs.readFileSync(new URL('../../games/party/party.js', import.meta.url), 'utf8');
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(predicate, timeout = 3500) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (predicate()) return; await wait(5); }
    assert.fail('Timed out waiting for the expected party transition');
}
export function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; }
export function network() {
    const channels = new Set(), timers = new Set(), people = [], sessions = [];
    class Channel {
        constructor(name) { this.name = name; this.listeners = new Set(); channels.add(this); }
        postMessage(data) { for (const other of channels) if (other !== this && other.name === this.name) queueMicrotask(() => { if (!channels.has(other)) return; const event = {data:structuredClone(data)}; other.onmessage?.(event); for (const fn of other.listeners) fn(event); }); }
        addEventListener(type, fn) { this.listeners.add(fn); }
        removeEventListener(type, fn) { this.listeners.delete(fn); }
        close() { channels.delete(this); }
    }
    function client() {
        const store = new Map(), storage = {getItem:key => store.get(key) || null, setItem:(key,value) => store.set(key,value), removeItem:key => store.delete(key)};
        const window = {crypto:webcrypto, BroadcastChannel:Channel, addEventListener(){}}; window.window = window;
        const context = vm.createContext({window, crypto:webcrypto, BroadcastChannel:Channel, localStorage:storage, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, Map, Set, JSON, Math, Date, Error, console, performance,
            setTimeout:(fn,ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); },ms); timers.add(timer); return timer; },
            clearTimeout:timer => { timers.delete(timer); clearTimeout(timer); },
            setInterval:(fn,ms) => { const timer = setInterval(fn,ms); timers.add(timer); return timer; },
            clearInterval:timer => { timers.delete(timer); clearInterval(timer); },
            btoa:value => Buffer.from(value,'binary').toString('base64'), atob:value => Buffer.from(value,'base64').toString('binary')});
        vm.runInContext(netplay,context); vm.runInContext(party,context);
        const np = window.Netplay;
        np.CATALOG = [{id:'duel',name:'Fixture duel',min:2,max:2}];
        np.loadGame = async () => ({start(){}});
        np.launch = (session,data) => { np.launched = {session,data}; };
        for (const method of ['host','join']) {
            const original = np[method];
            np[method] = async (...args) => { const session = await original(...args); sessions.push(session); return session; };
        }
        np.fixtureStore = store; people.push(np); return np;
    }
    return {client,sessions,
        control(p) { return sessions.find(s => s.alive && s.id === p.id); },
        async pair() { const a = client(), b = client(); const host = await a.Party.create({mode:'local'}), guest = await b.Party.join(host.code,{mode:'local'}); await until(() => host.members.length === 2 && guest.members.length === 2); return {a,b,host,guest}; },
        close() { for (const np of people) np.Party.current?.leave(); for (const session of sessions) session.leave(); for (const timer of timers) { clearTimeout(timer); clearInterval(timer); } channels.clear(); }
    };
}
