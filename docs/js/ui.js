// ============================================================================
// ui.js — HUD, inventory / crafting / furnace / chest / creative screens
// ============================================================================
'use strict';

const $ = (id) => document.getElementById(id);

// pixel-art HUD icons (9x9)
const HEART_PIX = [
    '.........', '.XX...XX.', 'XXXX.XXXX', 'XXXXXXXXX', 'XXXXXXXXX', '.XXXXXXX.', '..XXXXX..', '...XXX...', '....X....'
];
const FOOD_PIX = [
    '.....XXX.', '....XXXXX', '...XXXXX.', '..XXXXX..', '.XXXXX...', 'XXXXX....', 'XXXX.....', 'XX.......', '.........'
];
function pixIcon(pix, fill, outline, hi) {
    const c = document.createElement('canvas'); c.width = c.height = 9;
    const g = c.getContext('2d');
    // outline pass
    const filled = (x, y) => x >= 0 && y >= 0 && x < 9 && y < 9 && pix[y][x] === 'X';
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        if (filled(x, y)) { g.fillStyle = fill; g.fillRect(x, y, 1, 1); }
    }
    g.fillStyle = outline;
    for (let y = -1; y < 10; y++) for (let x = -1; x < 10; x++) {
        if (!filled(x, y) && (filled(x + 1, y) || filled(x - 1, y) || filled(x, y + 1) || filled(x, y - 1))) g.fillRect(x, y, 1, 1);
    }
    if (hi) { g.fillStyle = hi; g.fillRect(2, 2, 1, 1); g.fillRect(2, 3, 1, 1); }
    return c.toDataURL();
}

const UI = {
    guiOpen: false, guiType: null, guiCtx: null, slots: [], cursor: null, craftGrid: null, craftResult: null,
    mouse: { x: 0, y: 0 }, hoverDesc: null, hotbarEls: [], heartEls: [], foodEls: [], bubbleEls: [],
    nameT: 0, lastNameId: -1, icons: {},

    init() {
        this.icons.heartFull = pixIcon(HEART_PIX, '#e51a1a', '#2a0505', '#ff9a9a');
        this.icons.heartEmpty = pixIcon(HEART_PIX, '#2c2020', '#000', null);
        this.icons.foodFull = pixIcon(FOOD_PIX, '#c07838', '#201008', '#f0c890');
        this.icons.foodEmpty = pixIcon(FOOD_PIX, '#2a2420', '#000', null);
        // half icons: draw the left/right half of full over empty
        this.icons.heartHalf = this.halfIcon(HEART_PIX, '#e51a1a', '#2c2020', '#2a0505', '#ff9a9a');
        this.icons.foodHalf = this.halfIcon(FOOD_PIX, '#c07838', '#2a2420', '#201008', '#f0c890', true);

        // hotbar
        const hb = $('hotbar');
        hb.innerHTML = '';
        for (let i = 0; i < 9; i++) {
            const s = document.createElement('div'); s.className = 'slot hb';
            hb.appendChild(s); this.hotbarEls.push(s);
        }
        const sel = document.createElement('div'); sel.id = 'hotbar-sel'; hb.appendChild(sel); this.selEl = sel;
        // hearts / food / bubbles
        const mk = (parent, n, arr, cls) => { parent.innerHTML = ''; for (let i = 0; i < n; i++) { const im = document.createElement('img'); im.className = cls; parent.appendChild(im); arr.push(im); } };
        mk($('hearts'), 10, this.heartEls, 'hud-ico');
        mk($('foodbar'), 10, this.foodEls, 'hud-ico');
        mk($('bubbles'), 10, this.bubbleEls, 'hud-ico');
        const bub = (() => {
            const c = document.createElement('canvas'); c.width = c.height = 9; const g = c.getContext('2d');
            const pts = ['..XXX..', '.X...X.', 'X.....X', 'X.....X', 'X.....X', '.X...X.', '..XXX..'];
            g.fillStyle = '#a8d8ff'; pts.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') g.fillRect(x + 1, y + 1, 1, 1); }));
            g.fillStyle = '#fff'; g.fillRect(3, 3, 1, 1);
            return c.toDataURL();
        })();
        this.bubbleEls.forEach(b => b.src = bub);
        this.cursorEl = $('cursor-item');
        this.tooltip = $('tooltip');
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = e.clientX; this.mouse.y = e.clientY;
            if (this.guiOpen) this.positionCursor();
        });
        window.addEventListener('keydown', (e) => this.onKey(e));
    },
    halfIcon(pix, fill, empty, outline, hi, rightHalf) {
        const full = new Image(); const emp = new Image();
        const c = document.createElement('canvas'); c.width = c.height = 9;
        const g = c.getContext('2d');
        full.src = pixIcon(pix, fill, outline, hi); emp.src = pixIcon(pix, empty, '#000', null);
        const draw = () => {
            g.clearRect(0, 0, 9, 9);
            g.drawImage(emp, 0, 0);
            g.save(); g.beginPath();
            if (rightHalf) g.rect(5, 0, 5, 9); else g.rect(0, 0, 5, 9);
            g.clip(); g.drawImage(full, 0, 0); g.restore();
        };
        const res = { url: '' };
        full.onload = emp.onload = () => { if (full.complete && emp.complete) { draw(); res.url = c.toDataURL(); UI.refreshStatus(true); } };
        return res;
    },

    // ---- item slot rendering -------------------------------------------------------------------
    fillSlot(el, stack, showCount = true) {
        el.innerHTML = '';
        if (!stack) return;
        const d = DEFS[stack.id];
        const img = document.createElement('img'); img.src = getIconURL(stack.id); img.draggable = false; img.className = 'ico';
        el.appendChild(img);
        if (showCount && stack.count > 1) { const n = document.createElement('span'); n.className = 'count'; n.textContent = stack.count; el.appendChild(n); }
        if (d.durability && stack.dmg > 0) {
            const bar = document.createElement('div'); bar.className = 'durbar';
            const f = 1 - stack.dmg / d.durability;
            const inner = document.createElement('div');
            inner.style.width = (f * 100) + '%';
            inner.style.background = `hsl(${Math.round(f * 120)},100%,45%)`;
            bar.appendChild(inner); el.appendChild(bar);
        }
    },
    refreshHotbar() {
        for (let i = 0; i < 9; i++) this.fillSlot(this.hotbarEls[i], Inv.slots[i]);
        this.selEl.style.left = (Inv.sel * 40) + 'px';
        const s = Inv.held();
        if (s) { $('item-name').textContent = DEFS[s.id].name; this.nameT = 2.0; } else { this.nameT = 0; }
        if (this.guiOpen) this.refreshGui();
    },
    refreshStatus(force) {
        const p = Player;
        const creative = Game.mode === 'creative';
        $('survival-hud').style.display = creative ? 'none' : '';
        const hp = Math.ceil(p.hp), fd = Math.ceil(p.food);
        const t = performance.now();
        for (let i = 0; i < 10; i++) {
            const h = this.heartEls[i], f = this.foodEls[9 - i] ? this.foodEls[i] : this.foodEls[i];
            const hv = hp - i * 2;
            const src = hv >= 2 ? this.icons.heartFull : (hv === 1 ? (this.icons.heartHalf.url || this.icons.heartFull) : this.icons.heartEmpty);
            if (h.dataset.s !== src) { h.src = src; h.dataset.s = src; }
            const fv = fd - (9 - i) * 2 - 0;   // food drains from the left, drawn right-aligned
            const ff = this.foodEls[i];
            const fvv = fd - (9 - i) * 2;
            const fsrc = fvv >= 2 ? this.icons.foodFull : (fvv === 1 ? (this.icons.foodHalf.url || this.icons.foodFull) : this.icons.foodEmpty);
            if (ff.dataset.s !== fsrc) { ff.src = fsrc; ff.dataset.s = fsrc; }
            // low health shake
            h.style.transform = (p.hp <= 4 && !creative) ? `translateY(${Math.sin(t * 0.03 + i * 2) > 0.6 ? -2 : 0}px)` : '';
        }
        // bubbles
        const showB = p.headWater || p.air < 14.5;
        $('bubbles').style.visibility = (showB && !creative) ? 'visible' : 'hidden';
        const nb = Math.ceil(Math.max(0, p.air) / 1.5);
        for (let i = 0; i < 10; i++) this.bubbleEls[i].style.visibility = i < nb ? 'inherit' : 'hidden';
        // xp
        $('xp-fill').style.width = (p.xpProg * 100) + '%';
        $('xp-level').textContent = p.xpLevel > 0 ? p.xpLevel : '';
    },
    toast(msg) {
        const el = $('toast');
        el.textContent = msg; el.classList.add('show');
        clearTimeout(this._toastT); this._toastT = setTimeout(() => el.classList.remove('show'), 2200);
    },
    updateHud(dt) {
        if (this.nameT > 0) { this.nameT -= dt; $('item-name').style.opacity = Math.min(1, this.nameT * 2); } else $('item-name').style.opacity = 0;
    },

    // ---- screens ------------------------------------------------------------------------------------------
    show(id, on) { $(id).classList.toggle('hidden', !on); },

    // ---- GUI containers ----------------------------------------------------------------------------------------
    openInventory() {
        if (Game.mode === 'creative') this.openGui('creative');
        else this.openGui('inventory');
    },
    openBlockGui(type, x, y, z) {
        const te = world.tileEntities.get(`${x},${y},${z}`);
        if (type === 'chest') {
            let t = te; if (!t) { t = { type: 'chest', slots: new Array(27).fill(null) }; world.tileEntities.set(`${x},${y},${z}`, t); }
            Sound.play('chest_open');
            this.openGui('chest', { te: t, x, y, z });
        } else if (type === 'furnace') {
            let t = te; if (!t) { t = { type: 'furnace', slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 }; world.tileEntities.set(`${x},${y},${z}`, t); }
            this.openGui('furnace', { te: t, x, y, z });
        } else if (type === 'crafting') this.openGui('crafting', { x, y, z });
    },
    openGui(type, ctx) {
        this.guiOpen = true; this.guiType = type; this.guiCtx = ctx || {};
        this.cursor = null;
        this.craftGrid = type === 'inventory' ? new Array(4).fill(null) : (type === 'crafting' ? new Array(9).fill(null) : null);
        this.craftResult = null;
        this.buildGui();
        this.show('gui', true);
        Game.onGuiOpen();
        this.refreshGui();
        this.positionCursor();
    },
    closeGui() {
        if (!this.guiOpen) return;
        // return crafting grid + cursor items to the player
        const giveBack = (s) => { if (!s) return; const left = Inv.add(s.id, s.count, s.dmg); if (left > 0) Game.dropFromPlayer({ id: s.id, count: left, dmg: s.dmg }); };
        if (this.craftGrid) this.craftGrid.forEach(giveBack);
        giveBack(this.cursor);
        this.craftGrid = null; this.cursor = null;
        if (this.guiType === 'chest') Sound.play('chest_close');
        this.guiOpen = false; this.guiType = null;
        this.show('gui', false);
        this.cursorEl.style.display = 'none';
        this.tooltip.style.display = 'none';
        this.refreshHotbar();
        Game.onGuiClose();
    },

    // slot descriptor helpers
    arrSlot(arr, i, extra) { return Object.assign({ get: () => arr[i], set: (s) => { arr[i] = s; }, group: 'x' }, extra || {}); },

    buildGui() {
        const root = $('gui'); root.innerHTML = '';
        this.slots = [];
        const type = this.guiType;
        const panel = document.createElement('div'); panel.className = 'gui-panel';
        root.appendChild(panel);
        const title = document.createElement('div'); title.className = 'gui-title';
        title.textContent = { inventory: '合成', crafting: '工作台', furnace: '熔炉', chest: '箱子', creative: '创造模式物品栏' }[type];
        panel.appendChild(title);

        const slotEl = (desc, parent) => {
            const el = document.createElement('div'); el.className = 'slot';
            parent.appendChild(el);
            this.slots.push({ el, desc });
            el.addEventListener('mousedown', (e) => { e.preventDefault(); this.onSlotClick(desc, e.button, e.shiftKey); });
            el.addEventListener('mouseenter', () => { this.hoverDesc = desc; this.refreshTooltip(); });
            el.addEventListener('mouseleave', () => { if (this.hoverDesc === desc) this.hoverDesc = null; this.refreshTooltip(); });
            el.addEventListener('contextmenu', e => e.preventDefault());
            return el;
        };
        const grid = (cols, descs, parent, cls) => {
            const g = document.createElement('div'); g.className = 'slot-grid ' + (cls || ''); g.style.gridTemplateColumns = `repeat(${cols}, 36px)`;
            descs.forEach(d => slotEl(d, g));
            parent.appendChild(g); return g;
        };
        const invMain = [], invHot = [];
        for (let i = 9; i < 36; i++) invMain.push(this.arrSlot(Inv.slots, i, { group: 'inv' }));
        for (let i = 0; i < 9; i++) invHot.push(this.arrSlot(Inv.slots, i, { group: 'inv', hot: true }));

        if (type === 'inventory' || type === 'crafting') {
            const n = type === 'inventory' ? 2 : 3;
            const row = document.createElement('div'); row.className = 'craft-row';
            if (type === 'inventory') {
                const prev = document.createElement('div'); prev.className = 'player-preview';
                prev.innerHTML = '<canvas id="preview-canvas" width="120" height="160"></canvas>';
                row.appendChild(prev);
            }
            const gdescs = [];
            for (let i = 0; i < n * n; i++) gdescs.push(this.arrSlot(this.craftGrid, i, { group: 'craft', onChange: () => this.updateCraft() }));
            grid(n, gdescs, row, 'craft-grid');
            const arrow = document.createElement('div'); arrow.className = 'arrow'; arrow.textContent = '➜'; row.appendChild(arrow);
            const out = { get: () => this.craftResult, set: () => {}, group: 'out', output: true };
            const og = document.createElement('div'); og.className = 'slot-grid'; og.style.gridTemplateColumns = '36px';
            slotEl(out, og); row.appendChild(og);
            panel.appendChild(row);
            this.updateCraft();
            if (type === 'inventory') this.drawPreview();
        } else if (type === 'furnace') {
            const te = this.guiCtx.te;
            const row = document.createElement('div'); row.className = 'furnace-row';
            const left = document.createElement('div'); left.className = 'furnace-left';
            grid(1, [this.arrSlot(te.slots, 0, { group: 'furn', furnace: 'in' })], left);
            const flame = document.createElement('div'); flame.className = 'flame'; flame.innerHTML = '<div id="flame-fill"></div>'; left.appendChild(flame);
            grid(1, [this.arrSlot(te.slots, 1, { group: 'furn', furnace: 'fuel', accept: (s) => !!FUEL[s.id] })], left);
            row.appendChild(left);
            const mid = document.createElement('div'); mid.className = 'prog'; mid.innerHTML = '<div id="prog-fill"></div>'; row.appendChild(mid);
            const og = document.createElement('div'); og.className = 'slot-grid'; og.style.gridTemplateColumns = '36px';
            slotEl(this.arrSlot(te.slots, 2, { group: 'furn', output: true, noPlace: true, takeOnly: true, furnaceOut: true }), og);
            row.appendChild(og);
            panel.appendChild(row);
        } else if (type === 'chest') {
            const te = this.guiCtx.te;
            const d = []; for (let i = 0; i < 27; i++) d.push(this.arrSlot(te.slots, i, { group: 'chest' }));
            grid(9, d, panel, 'chest-grid');
        } else if (type === 'creative') {
            const items = creativeList();
            const pal = document.createElement('div'); pal.className = 'creative-grid';
            panel.appendChild(pal);
            items.forEach(id => {
                const stackRef = { id, count: maxStack(id) === 1 ? 1 : 64, dmg: 0 };
                const d = { get: () => stackRef, set: () => {}, group: 'palette', palette: true, id };
                slotEl(d, pal);
            });
            const trashRow = document.createElement('div'); trashRow.className = 'trash-row';
            const t = document.createElement('div'); t.className = 'trash-label'; t.textContent = '销毁物品 ➜'; trashRow.appendChild(t);
            const tg = document.createElement('div'); tg.className = 'slot-grid'; tg.style.gridTemplateColumns = '36px';
            slotEl({ get: () => null, set: () => {}, group: 'trash', trash: true }, tg); trashRow.appendChild(tg);
            panel.appendChild(trashRow);
        }
        const lbl = document.createElement('div'); lbl.className = 'gui-label'; lbl.textContent = '物品栏'; panel.appendChild(lbl);
        grid(9, invMain, panel, 'inv-main');
        const hotG = grid(9, invHot, panel, 'inv-hot');
        hotG.style.marginTop = '6px';
        this.fitPanel(panel);
    },

    fitPanel(panel) {
        panel.style.zoom = 1;
        const k = Math.min(1, (window.innerHeight * 0.96) / panel.scrollHeight, (window.innerWidth * 0.96) / panel.scrollWidth);
        panel.style.zoom = k;
    },
    refreshGui() {
        this.slots.forEach(({ el, desc }) => {
            if (desc.trash) { el.innerHTML = '<span class="trash-ico">🗑</span>'; return; }
            this.fillSlot(el, desc.get(), !desc.palette);
        });
        this.setCursor(this.cursor);
        if (this.guiType === 'furnace') this.updateFurnaceBars();
        this.refreshTooltip();
    },
    setCursor(s) {
        this.cursor = s;
        if (!s) { this.cursorEl.style.display = 'none'; return; }
        this.fillSlot(this.cursorEl, s);
        this.cursorEl.style.display = 'block';
        this.positionCursor();
    },
    positionCursor() {
        this.cursorEl.style.left = (this.mouse.x - 16) + 'px';
        this.cursorEl.style.top = (this.mouse.y - 16) + 'px';
        if (this.tooltip.style.display === 'block') {
            this.tooltip.style.left = (this.mouse.x + 14) + 'px'; this.tooltip.style.top = (this.mouse.y - 30) + 'px';
        }
    },
    refreshTooltip() {
        const d = this.hoverDesc;
        const s = d && !this.cursor ? d.get() : null;
        if (!s) { this.tooltip.style.display = 'none'; return; }
        const def = DEFS[s.id];
        let txt = def.name;
        if (def.durability) txt += `\n耐久: ${def.durability - (s.dmg || 0)} / ${def.durability}`;
        this.tooltip.textContent = txt;
        this.tooltip.style.display = 'block';
        this.positionCursor();
    },

    // ---- crafting -----------------------------------------------------------------------------------------------
    updateCraft() {
        if (!this.craftGrid) return;
        const n = this.craftGrid.length === 4 ? 2 : 3;
        const ids = this.craftGrid.map(s => s ? s.id : 0);
        const r = matchRecipe(ids, n, n);
        this.craftResult = r ? { id: r.id, count: r.count, dmg: 0 } : null;
        const outSlot = this.slots.find(s => s.desc.output && s.desc.group === 'out');
        if (outSlot) this.fillSlot(outSlot.el, this.craftResult);
    },
    consumeCraft() {
        this.craftGrid.forEach((s, i) => { if (s) { s.count--; if (s.count <= 0) this.craftGrid[i] = null; } });
    },

    // ---- clicks ---------------------------------------------------------------------------------------------------------
    onSlotClick(desc, button, shift) {
        const cur = this.cursor;
        if (desc.trash) { if (cur) this.setCursor(null); return; }
        if (desc.palette) {
            const pal = desc.get();
            if (shift) { Inv.add(pal.id, pal.count, 0); }
            else if (cur && cur.id === pal.id) this.setCursor(null);
            else this.setCursor({ id: pal.id, count: button === 2 ? pal.count : (button === 2 ? pal.count : pal.count), dmg: 0 });
            this.refreshGui(); this.refreshHotbarOnly(); return;
        }
        if (desc.group === 'out') {      // crafting result
            if (!this.craftResult) return;
            const r = this.craftResult;
            if (shift) {
                let guard = 0;
                while (this.craftResult && guard++ < 64) {
                    const rr = this.craftResult;
                    if (!Inv.canAdd(rr.id)) break;
                    const left = Inv.add(rr.id, rr.count, 0);
                    if (left > 0) { Game.dropFromPlayer({ id: rr.id, count: left, dmg: 0 }); }
                    this.consumeCraft(); this.updateCraft();
                }
            } else if (!cur) { this.setCursor({ id: r.id, count: r.count, dmg: 0 }); this.consumeCraft(); this.updateCraft(); }
            else if (cur.id === r.id && cur.count + r.count <= maxStack(r.id)) { cur.count += r.count; this.consumeCraft(); this.updateCraft(); this.setCursor(cur); }
            Sound.play('click'); this.refreshGui(); this.refreshHotbarOnly(); return;
        }
        if (shift) { this.quickMove(desc); this.refreshGui(); this.refreshHotbarOnly(); return; }

        const slot = desc.get();
        const accepts = (s) => !desc.noPlace && (!desc.accept || desc.accept(s)) && (desc.furnace !== 'in' || true);
        if (button === 0) {
            if (!cur) { if (slot) { this.setCursor(cloneStack(slot)); desc.set(null); } }
            else if (!slot) { if (accepts(cur)) { desc.set(cloneStack(cur)); this.setCursor(null); } }
            else if (slot.id === cur.id && maxStack(slot.id) > 1) {
                if (desc.noPlace) { const room = maxStack(cur.id) - cur.count; const take = Math.min(room, slot.count); if (take > 0) { cur.count += take; slot.count -= take; if (slot.count <= 0) desc.set(null); this.setCursor(cur); } }
                else { const n = Math.min(maxStack(slot.id) - slot.count, cur.count); slot.count += n; cur.count -= n; this.setCursor(cur.count > 0 ? cur : null); }
            } else if (accepts(cur)) { const t = cloneStack(slot); desc.set(cloneStack(cur)); this.setCursor(t); }
        } else if (button === 2) {
            if (!cur) { if (slot) { const half = Math.ceil(slot.count / 2); this.setCursor({ id: slot.id, count: half, dmg: slot.dmg }); slot.count -= half; if (slot.count <= 0) desc.set(null); } }
            else if (accepts(cur)) {
                if (!slot) { desc.set({ id: cur.id, count: 1, dmg: cur.dmg }); cur.count--; this.setCursor(cur.count > 0 ? cur : null); }
                else if (slot.id === cur.id && slot.count < maxStack(slot.id)) { slot.count++; cur.count--; this.setCursor(cur.count > 0 ? cur : null); }
                else { const t = cloneStack(slot); desc.set(cloneStack(cur)); this.setCursor(t); }
            }
        }
        if (desc.onChange) desc.onChange();
        Sound.play('click');
        this.refreshGui(); this.refreshHotbarOnly();
    },
    refreshHotbarOnly() { for (let i = 0; i < 9; i++) this.fillSlot(this.hotbarEls[i], Inv.slots[i]); },

    quickMove(desc) {
        const s = desc.get(); if (!s) return;
        const moveInto = (descs, stack) => {
            const max = maxStack(stack.id);
            for (const d of descs) {   // merge first
                const t = d.get();
                if (t && t.id === stack.id && max > 1 && t.count < max) { const n = Math.min(max - t.count, stack.count); t.count += n; stack.count -= n; if (stack.count <= 0) return true; }
            }
            for (const d of descs) {
                if (!d.get() && (!d.accept || d.accept(stack))) { d.set({ id: stack.id, count: stack.count, dmg: stack.dmg }); stack.count = 0; return true; }
            }
            return stack.count <= 0;
        };
        const stack = cloneStack(s);
        let done = false;
        const invDescs = (hotFirst) => {
            const a = []; for (let i = 0; i < 36; i++) a.push(this.arrSlot(Inv.slots, i));
            return hotFirst ? a : a.slice(9).concat(a.slice(0, 9));
        };
        if (desc.group === 'inv') {
            // into container if one is open
            if (this.guiType === 'chest') { const te = this.guiCtx.te; const ds = te.slots.map((_, i) => this.arrSlot(te.slots, i)); done = moveInto(ds, stack); }
            else if (this.guiType === 'furnace') {
                const te = this.guiCtx.te;
                if (SMELTING[stack.id]) done = moveInto([this.arrSlot(te.slots, 0)], stack);
                else if (FUEL[stack.id]) done = moveInto([this.arrSlot(te.slots, 1, { accept: () => true })], stack);
                else done = false;
            } else {
                // hotbar <-> main
                const targets = desc.hot ? invDescs(false).slice(0, 27) : invDescs(true).slice(0, 9);
                done = moveInto(targets, stack);
            }
        } else {
            done = moveInto(invDescs(false), stack);
        }
        if (stack.count < s.count) { if (stack.count <= 0) desc.set(null); else s.count = stack.count; }
        if (desc.onChange) desc.onChange();
        this.updateCraft && this.craftGrid && this.updateCraft();
        Sound.play('click');
    },

    onKey(e) {
        if (!this.guiOpen) return;
        if (e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); this.closeGui(); return; }
        if (e.code.startsWith('Digit') && this.hoverDesc) {
            const n = parseInt(e.code.slice(5), 10);
            if (n >= 1 && n <= 9 && !this.hoverDesc.output && !this.hoverDesc.palette && !this.hoverDesc.trash) {
                const d = this.hoverDesc, a = d.get(), b = Inv.slots[n - 1];
                if (d.noPlace) return;
                d.set(cloneStack(b)); Inv.slots[n - 1] = cloneStack(a);
                if (d.onChange) d.onChange();
                this.refreshGui(); this.refreshHotbarOnly();
            }
        }
    },
    // click on the dimmed backdrop: throw the cursor stack away
    dropCursor() {
        if (this.cursor) { Game.dropFromPlayer(this.cursor); this.setCursor(null); }
    },

    updateFurnaceBars() {
        const te = this.guiCtx.te;
        const ff = $('flame-fill'), pf = $('prog-fill');
        if (ff) ff.style.height = (te.burnMax > 0 ? Math.max(0, te.burn / te.burnMax) * 100 : 0) + '%';
        if (pf) pf.style.width = (te.cook / 10 * 100) + '%';
    },
    updateGui(dt) {
        if (!this.guiOpen) return;
        if (this.guiType === 'furnace') { this.updateFurnaceBars(); this.slots.forEach(({ el, desc }) => this.fillSlot(el, desc.get())); }
        if (this.guiType === 'inventory') this.drawPreview();
    },
    drawPreview() {
        const cv = $('preview-canvas'); if (!cv) return;
        if (!this._prevRenderer) {
            this._prevRenderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: false });
            this._prevRenderer.setSize(120, 160, false);
            this._prevScene = new THREE.Scene();
            this._prevCam = new THREE.PerspectiveCamera(30, 120 / 160, 0.1, 20);
            this._prevCam.position.set(0, 1.0, 4.2);
            this._prevModel = buildModel('steve');
            this._prevScene.add(this._prevModel);
        } else if (this._prevRenderer.domElement !== cv) {
            this._prevRenderer.dispose(); this._prevRenderer = null; this.drawPreview(); return;
        }
        // look toward the mouse
        const r = cv.getBoundingClientRect();
        const dx = (this.mouse.x - (r.left + r.width / 2)) / 200, dy = (this.mouse.y - (r.top + r.height / 3)) / 200;
        this._prevModel.rotation.y = Math.max(-1, Math.min(1, dx)) * 0.9 + 0.3;
        this._prevModel.userData.parts.head.rotation.x = Math.max(-0.5, Math.min(0.5, dy));
        this._prevModel.userData.mat.color.setScalar(1);
        this._prevCam.lookAt(0, 0.95, 0);
        this._prevRenderer.render(this._prevScene, this._prevCam);
    }
};
