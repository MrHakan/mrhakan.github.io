// Only for trusted repository IIFE modules used by Node game checks.
// Sources must use window/globalThis roots, not top-level var/this or late globals.
// This is not a sandbox: lexical bindings avoid the VM global-proxy lookup
// on every Math/constant access without rewriting any game source or samples.
import { compileFunction } from 'node:vm';

export const createTestScope = (bindings = {}) => ({ ...bindings });
export function loadGameScript(source, scope, filename = 'trusted-game.js') {
    const bindings = { Math, window: undefined, ...scope, globalThis: scope };
    const names = Object.keys(bindings);
    return compileFunction(source, names, { filename })(...names.map(name => bindings[name]));
}
