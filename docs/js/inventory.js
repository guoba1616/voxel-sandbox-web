// ============================================================================
// inventory.js — player inventory (36 slots: 0-8 hotbar), stacks, helpers
// ============================================================================
'use strict';

const Inv = {
    slots: new Array(36).fill(null),
    sel: 0,

    reset() { this.slots = new Array(36).fill(null); this.sel = 0; },
    held() { return this.slots[this.sel]; },
    heldDef() { const s = this.slots[this.sel]; return s ? DEFS[s.id] : null; },

    canAdd(id, dmg = 0) {
        const max = maxStack(id);
        for (let i = 0; i < 36; i++) {
            const s = this.slots[i];
            if (!s) return true;
            if (max > 1 && s.id === id && s.count < max) return true;
        }
        return false;
    },
    // returns the number of items that did NOT fit
    add(id, count, dmg = 0) {
        const max = maxStack(id);
        if (max > 1) {
            for (let i = 0; i < 36 && count > 0; i++) {
                const s = this.slots[i];
                if (s && s.id === id && s.count < max) {
                    const n = Math.min(max - s.count, count);
                    s.count += n; count -= n;
                }
            }
        }
        for (let i = 0; i < 36 && count > 0; i++) {
            if (!this.slots[i]) {
                const n = Math.min(max, count);
                this.slots[i] = { id, count: n, dmg };
                count -= n;
            }
        }
        return count;
    },
    countOf(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; },
    removeFrom(i, n = 1) {
        const s = this.slots[i];
        if (!s) return;
        s.count -= n;
        if (s.count <= 0) this.slots[i] = null;
    },
    // damage the held tool; returns true if it broke
    damageHeld(amount = 1) {
        const s = this.slots[this.sel];
        if (!s) return false;
        const d = DEFS[s.id];
        if (!d.durability) return false;
        s.dmg = (s.dmg || 0) + amount;
        if (s.dmg >= d.durability) {
            this.slots[this.sel] = null;
            Sound.block('glass', 'break', null);
            Sound.play('pop');
            return true;
        }
        return false;
    },
    serialize() { return { slots: this.slots.map(s => s ? [s.id, s.count, s.dmg || 0] : null), sel: this.sel }; },
    load(d) {
        this.slots = new Array(36).fill(null);
        d.slots.forEach((s, i) => { if (s && DEFS[s[0]]) this.slots[i] = { id: s[0], count: s[1], dmg: s[2] || 0 }; });
        this.sel = d.sel || 0;
    }
};

function cloneStack(s) { return s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null; }
