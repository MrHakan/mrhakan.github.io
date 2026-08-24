/* echoes of the tide — the core layer.
 *
 * Two things that no other part of the game is allowed to know about each
 * other through: a save engine and an event bus.
 *
 *   SaveEngine    persistence, DJB2 checksum validation, a backup slot,
 *                 base64 export/import and a schema migration loop.
 *   GameEventBus  publisher/subscriber, so the combat engine can announce
 *                 a death without holding a reference to the nemesis
 *                 engine that cares about it.
 *
 * Module 6 of the design document. Both are plain classes on `window`,
 * because the site has no build step and never will.
 */

(function () {
    'use strict';

    // ---------- SaveEngine ----------
    function SaveEngine(storageKey) {
        this.storageKey = storageKey || 'ECHOES_OF_THE_TIDE_SAVE';
        this.currentVersion = '1.0.4';
        this.lastError = null;
    }

    // DJB2. Not a security measure — nobody is being kept out of their own
    // save file. It is a corruption check: a half-written localStorage
    // write or a hand-edit that breaks an invariant is caught before the
    // engine tries to load a profile with no attributes in it.
    SaveEngine.prototype.generateChecksum = function (str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash & hash;                     // keep it 32-bit
        }
        return Math.abs(hash).toString(16);
    };

    SaveEngine.prototype.saveGame = function (stateObject) {
        try {
            stateObject.save_version = this.currentVersion;
            stateObject.save_timestamp = Date.now();

            // the checksum cannot be part of what it checksums
            delete stateObject.checksum;
            const serialized = JSON.stringify(stateObject);
            stateObject.checksum = this.generateChecksum(serialized);

            const payload = JSON.stringify(stateObject);
            // the backup is written from the *previous* good save, not this
            // one — a backup that is always identical to the primary is not
            // a backup, it is a second copy of the same corruption
            const previous = localStorage.getItem(this.storageKey);
            if (previous) localStorage.setItem(this.storageKey + '_BACKUP', previous);
            localStorage.setItem(this.storageKey, payload);
            this.lastError = null;
            return true;
        } catch (err) {
            this.lastError = err;
            return false;
        }
    };

    SaveEngine.prototype.verify = function (raw) {
        let parsed;
        try { parsed = JSON.parse(raw); } catch (err) { return { ok: false, reason: 'unparseable' }; }
        if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not an object' };
        const saved = parsed.checksum;
        if (!saved) return { ok: false, reason: 'no checksum' };
        delete parsed.checksum;
        const computed = this.generateChecksum(JSON.stringify(parsed));
        parsed.checksum = saved;
        if (saved !== computed) return { ok: false, reason: 'checksum mismatch', state: parsed };
        return { ok: true, state: parsed };
    };

    SaveEngine.prototype.loadGame = function () {
        let raw = null;
        try { raw = localStorage.getItem(this.storageKey); } catch (err) { return null; }
        if (!raw) return null;
        const result = this.verify(raw);
        if (!result.ok) {
            this.lastError = result.reason;
            const backup = this.loadBackup();
            return backup ? this.migrate(backup) : null;
        }
        return this.migrate(result.state);
    };

    SaveEngine.prototype.loadBackup = function () {
        let raw = null;
        try { raw = localStorage.getItem(this.storageKey + '_BACKUP'); } catch (err) { return null; }
        if (!raw) return null;
        const result = this.verify(raw);
        return result.ok ? result.state : null;
    };

    // Migration runs forward one version at a time, so a save from any
    // released version arrives at the current one by the same path — and a
    // save from the future is refused rather than half-read.
    SaveEngine.prototype.MIGRATIONS = {
        '1.0.0': function (s) {
            if (!s.player.life_skills) s.player.life_skills = { smithing: { level: 1, xp: 0 }, fishing: { level: 1, xp: 0 } };
            return '1.0.1';
        },
        '1.0.1': function (s) {
            if (!s.player.vitals.marrow_mana) { s.player.vitals.marrow_mana = 0; s.player.vitals.max_marrow_mana = 0; }
            return '1.0.2';
        },
        '1.0.2': function (s) {
            if (!s.nemesis_roster) s.nemesis_roster = [];
            return '1.0.3';
        },
        '1.0.3': function (s) {
            if (!s.world_state.story_flags) s.world_state.story_flags = {};
            return '1.0.4';
        }
    };

    SaveEngine.prototype.migrate = function (state) {
        if (!state || !state.save_version) return null;
        if (state.save_version === this.currentVersion) return state;
        let guard = 0;
        while (state.save_version !== this.currentVersion && guard++ < 32) {
            const step = this.MIGRATIONS[state.save_version];
            if (!step) { this.lastError = 'no migration path from ' + state.save_version; return null; }
            const next = step(state);
            if (!next || next === state.save_version) { this.lastError = 'migration stalled'; return null; }
            state.save_version = next;
        }
        return state.save_version === this.currentVersion ? state : null;
    };

    // base64 of a URI-encoded JSON string, so a save survives being pasted
    // into a chat window and back out again
    SaveEngine.prototype.exportSaveString = function () {
        let raw = null;
        try { raw = localStorage.getItem(this.storageKey); } catch (err) { return null; }
        if (!raw) return null;
        try { return btoa(encodeURIComponent(raw)); } catch (err) { return null; }
    };

    SaveEngine.prototype.importSaveString = function (base64String) {
        try {
            const decoded = decodeURIComponent(atob(String(base64String).trim()));
            const result = this.verify(decoded);
            if (!result.ok) { this.lastError = 'imported save failed verification: ' + result.reason; return null; }
            const migrated = this.migrate(result.state);
            if (!migrated) return null;
            // keep whatever is already saved as the backup before overwriting
            const previous = localStorage.getItem(this.storageKey);
            if (previous) localStorage.setItem(this.storageKey + '_BACKUP', previous);
            localStorage.setItem(this.storageKey, JSON.stringify(migrated));
            return migrated;
        } catch (err) {
            this.lastError = err && err.message;
            return null;
        }
    };

    SaveEngine.prototype.clear = function () {
        try { localStorage.removeItem(this.storageKey); localStorage.removeItem(this.storageKey + '_BACKUP'); }
        catch (err) { /* nothing worth throwing over */ }
    };

    // ---------- GameEventBus ----------
    function GameEventBus() {
        this.events = {};
    }
    GameEventBus.prototype.on = function (eventName, listener) {
        if (!this.events[eventName]) this.events[eventName] = [];
        this.events[eventName].push(listener);
        return () => this.off(eventName, listener);
    };
    GameEventBus.prototype.once = function (eventName, listener) {
        const wrapped = payload => { this.off(eventName, wrapped); listener(payload); };
        return this.on(eventName, wrapped);
    };
    GameEventBus.prototype.emit = function (eventName, payload) {
        const listeners = this.events[eventName];
        if (!listeners || !listeners.length) return 0;
        // iterate a copy: a listener is allowed to unsubscribe itself
        for (const listener of listeners.slice()) {
            // one bad listener must not stop the others from hearing the event
            try { listener(payload); } catch (err) { if (window.console) console.error('[GameBus] ' + eventName, err); }
        }
        return listeners.length;
    };
    GameEventBus.prototype.off = function (eventName, listenerToRemove) {
        if (!this.events[eventName]) return;
        this.events[eventName] = this.events[eventName].filter(l => l !== listenerToRemove);
    };
    GameEventBus.prototype.clear = function (eventName) {
        if (eventName) delete this.events[eventName];
        else this.events = {};
    };

    window.SaveEngine = SaveEngine;
    window.GameEventBus = GameEventBus;
    window.GameBus = window.GameBus || new GameEventBus();
})();
