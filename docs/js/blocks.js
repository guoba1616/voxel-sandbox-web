// ============================================================================
// blocks.js — block / item registry, tool stats, drops, crafting & smelting
// ============================================================================
'use strict';

const DEFS = new Array(512).fill(null);   // id -> definition (blocks < 256, items >= 256)
const B = {};                              // block key -> id
const I = {};                              // item key  -> id (blocks are mirrored in here too)
let nextItemId = 256;

function defBlock(id, key, name, o = {}) {
    const d = Object.assign({
        id, key, name, isBlock: true,
        tiles: key, hardness: 1, tool: null, needTool: false, harvest: 0,
        sound: 'stone', render: 'cube', solid: true, opaque: true,
        light: 0, liquid: false, gravity: false, replaceable: false,
        drop: undefined, stack: 64, creative: true
    }, o);
    if (d.render !== 'cube') d.opaque = false;
    if (d.liquid) { d.solid = false; d.opaque = false; d.replaceable = true; d.hardness = -1; d.creative = false; }
    DEFS[id] = d; B[key] = id; I[key] = id;
    return d;
}

function defItem(key, name, o = {}) {
    const id = nextItemId++;
    const d = Object.assign({ id, key, name, isBlock: false, icon: key, stack: 64 }, o);
    DEFS[id] = d; I[key] = id;
    return d;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
defBlock(1,  'stone',       '石头',     { hardness: 1.5, tool: 'pickaxe', needTool: true, drop: () => [['cobblestone', 1]] });
defBlock(2,  'grass',       '草方块',   { hardness: 0.6, tool: 'shovel', sound: 'grass', drop: () => [['dirt', 1]],
    tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' } });
defBlock(3,  'dirt',        '泥土',     { hardness: 0.5, tool: 'shovel', sound: 'grass' });
defBlock(4,  'cobblestone', '圆石',     { hardness: 2, tool: 'pickaxe', needTool: true });
defBlock(5,  'planks',      '橡木木板', { hardness: 2, tool: 'axe', sound: 'wood' });
defBlock(6,  'sapling',     '橡树树苗', { hardness: 0, sound: 'grass', render: 'cross', solid: false, replaceable: false, tiles: 'sapling' });
defBlock(7,  'bedrock',     '基岩',     { hardness: -1, creative: false });
defBlock(8,  'water',       '水',       { liquid: true, tiles: 'water', sound: 'water' });
defBlock(9,  'lava',        '熔岩',     { liquid: true, tiles: 'lava', light: 15, sound: 'water' });
defBlock(10, 'sand',        '沙子',     { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
defBlock(11, 'gravel',      '沙砾',     { hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true,
    drop: (r) => r() < 0.1 ? [['flint', 1]] : [['gravel', 1]] });
defBlock(12, 'gold_ore',    '金矿石',   { hardness: 3, tool: 'pickaxe', needTool: true, harvest: 2 });
defBlock(13, 'iron_ore',    '铁矿石',   { hardness: 3, tool: 'pickaxe', needTool: true, harvest: 1 });
defBlock(14, 'coal_ore',    '煤矿石',   { hardness: 3, tool: 'pickaxe', needTool: true, drop: () => [['coal', 1]], xp: [0, 2] });
defBlock(15, 'log',         '橡木原木', { hardness: 2, tool: 'axe', sound: 'wood', tiles: { top: 'log_top', bottom: 'log_top', side: 'log_side' } });
defBlock(16, 'leaves',      '橡木树叶', { hardness: 0.2, sound: 'grass', render: 'leaves', solid: true,
    drop: (r) => { const o = []; if (r() < 0.05) o.push(['sapling', 1]); if (r() < 0.02) o.push(['stick', 1]); if (r() < 0.01) o.push(['apple', 1]); return o; } });
defBlock(17, 'glass',       '玻璃',     { hardness: 0.3, sound: 'glass', render: 'glass', drop: () => [] });
defBlock(18, 'diamond_ore', '钻石矿石', { hardness: 3, tool: 'pickaxe', needTool: true, harvest: 2, drop: () => [['diamond', 1]], xp: [3, 7] });
defBlock(19, 'crafting_table', '工作台', { hardness: 2.5, tool: 'axe', sound: 'wood', tiles: { top: 'crafting_top', bottom: 'planks', side: 'crafting_side' }, front: 'crafting_front', gui: 'crafting' });
defBlock(20, 'furnace',     '熔炉',     { hardness: 3.5, tool: 'pickaxe', needTool: true, tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side' }, front: 'furnace_front', facing: true, gui: 'furnace' });
defBlock(21, 'furnace_lit', '熔炉',     { hardness: 3.5, tool: 'pickaxe', needTool: true, light: 13, tiles: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side' }, front: 'furnace_front_on', facing: true, gui: 'furnace', drop: () => [['furnace', 1]], creative: false });
defBlock(22, 'chest',       '箱子',     { hardness: 2.5, tool: 'axe', sound: 'wood', tiles: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side' }, front: 'chest_front', facing: true, gui: 'chest' });
defBlock(23, 'torch',       '火把',     { hardness: 0, sound: 'wood', render: 'torch', solid: false, light: 14, tiles: 'torch' });
defBlock(24, 'tallgrass',   '草',       { hardness: 0, sound: 'grass', render: 'cross', solid: false, replaceable: true, tiles: 'tallgrass', drop: () => [], creative: true });
defBlock(25, 'dandelion',   '蒲公英',   { hardness: 0, sound: 'grass', render: 'cross', solid: false, tiles: 'dandelion' });
defBlock(26, 'poppy',       '虞美人',   { hardness: 0, sound: 'grass', render: 'cross', solid: false, tiles: 'poppy' });
defBlock(27, 'cactus',      '仙人掌',   { hardness: 0.4, sound: 'cloth', render: 'cactus', solid: true, tiles: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' } });
defBlock(28, 'sandstone',   '砂岩',     { hardness: 0.8, tool: 'pickaxe', needTool: true, tiles: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' } });
defBlock(29, 'snow',        '雪块',     { hardness: 0.2, tool: 'shovel', sound: 'snow' });
defBlock(30, 'tnt',         'TNT',      { hardness: 0, sound: 'grass', tiles: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' } });
defBlock(31, 'glowstone',   '荧石',     { hardness: 0.3, sound: 'glass', light: 15 });
defBlock(32, 'wool',        '白色羊毛', { hardness: 0.8, sound: 'cloth' });
defBlock(33, 'bricks',      '砖块',     { hardness: 2, tool: 'pickaxe', needTool: true });
defBlock(34, 'gold_block',  '金块',     { hardness: 5, tool: 'pickaxe', needTool: true, harvest: 2 });
defBlock(35, 'iron_block',  '铁块',     { hardness: 5, tool: 'pickaxe', needTool: true, harvest: 1 });
defBlock(36, 'diamond_block', '钻石块', { hardness: 5, tool: 'pickaxe', needTool: true, harvest: 2 });
defBlock(37, 'granite',     '花岗岩',   { hardness: 1.5, tool: 'pickaxe', needTool: true });
defBlock(38, 'diorite',     '闪长岩',   { hardness: 1.5, tool: 'pickaxe', needTool: true });
defBlock(39, 'andesite',    '安山岩',   { hardness: 1.5, tool: 'pickaxe', needTool: true });
defBlock(40, 'birch_log',   '白桦原木', { hardness: 2, tool: 'axe', sound: 'wood', tiles: { top: 'log_top', bottom: 'log_top', side: 'birch_log_side' } });
defBlock(41, 'birch_leaves', '白桦树叶', { hardness: 0.2, sound: 'grass', render: 'leaves', solid: true, tiles: 'birch_leaves',
    drop: (r) => { const o = []; if (r() < 0.05) o.push(['sapling', 1]); if (r() < 0.02) o.push(['stick', 1]); return o; } });
defBlock(42, 'obsidian',    '黑曜石',   { hardness: 50, tool: 'pickaxe', needTool: true, harvest: 3 });

const MAX_BLOCK_ID = 42;

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
defItem('stick', '木棍');
defItem('coal', '煤炭');
defItem('iron_ingot', '铁锭');
defItem('gold_ingot', '金锭');
defItem('diamond', '钻石');
defItem('flint', '燧石');
defItem('flint_and_steel', '打火石', { stack: 1, durability: 64 });
defItem('apple', '苹果', { food: 4, sat: 2.4 });
defItem('raw_porkchop', '生猪排', { food: 3, sat: 1.8 });
defItem('cooked_porkchop', '熟猪排', { food: 8, sat: 12.8 });
defItem('raw_beef', '生牛肉', { food: 3, sat: 1.8 });
defItem('steak', '牛排', { food: 8, sat: 12.8 });
defItem('raw_mutton', '生羊肉', { food: 2, sat: 1.2 });
defItem('cooked_mutton', '熟羊肉', { food: 6, sat: 9.6 });
defItem('rotten_flesh', '腐肉', { food: 4, sat: 0.8 });
defItem('bone', '骨头');
defItem('gunpowder', '火药');
defItem('arrow', '箭');

const TIERS = [
    { key: 'wooden',  name: '木',   speed: 2,  dur: 59 },
    { key: 'stone',   name: '石',   speed: 4,  dur: 131 },
    { key: 'iron',    name: '铁',   speed: 6,  dur: 250 },
    { key: 'diamond', name: '钻石', speed: 8,  dur: 1561 }
];
const TOOL_TYPES = [
    { key: 'pickaxe', name: '镐', dmg: [2, 3, 4, 5] },
    { key: 'axe',     name: '斧', dmg: [7, 9, 9, 9] },
    { key: 'shovel',  name: '锹', dmg: [2.5, 3.5, 4.5, 5.5] },
    { key: 'sword',   name: '剑', dmg: [4, 5, 6, 7] }
];
TOOL_TYPES.forEach(tt => TIERS.forEach((t, ti) => {
    defItem(`${t.key}_${tt.key}`, `${t.name}${tt.name}`, {
        stack: 1, durability: t.dur,
        tool: { type: tt.key, tier: ti, speed: t.speed, damage: tt.dmg[ti] }
    });
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getDef(id) { return DEFS[id] || null; }
function maxStack(id) { const d = DEFS[id]; return d ? d.stack : 64; }
function isBlockId(id) { return id > 0 && id < 256; }
function blockSolid(id) { const d = DEFS[id]; return !!(d && d.solid); }
function blockOpaque(id) { const d = DEFS[id]; return !!(d && d.opaque); }

function canHarvest(def, toolDef) {
    if (!def.needTool) return true;
    const t = toolDef && toolDef.tool;
    return !!(t && t.type === def.tool && t.tier >= def.harvest);
}

// Seconds needed to mine a block with the given held item (vanilla formula)
function breakTime(def, toolDef, inWater, onGround) {
    if (def.hardness < 0) return Infinity;
    const harvest = canHarvest(def, toolDef);
    let speed = 1;
    const t = toolDef && toolDef.tool;
    if (t && def.tool && t.type === def.tool) speed = t.speed;
    if (def.key === 'leaves' || def.key === 'birch_leaves' || def.key === 'wool') {
        if (t && t.type === 'sword') speed = 1.5;
    }
    if (inWater) speed /= 5;
    if (!onGround) speed /= 5;
    return def.hardness * (harvest ? 1.5 : 5) / speed;
}

// Returns [[itemId, count], ...]
function blockDrops(id, toolDef, rnd) {
    const def = DEFS[id];
    if (!def || def.hardness < 0) return [];
    if (!canHarvest(def, toolDef)) return [];
    let list;
    if (def.drop === undefined) list = [[def.key, 1]];
    else list = def.drop(rnd);
    return list.map(([k, n]) => [I[k], n]);
}

// ---------------------------------------------------------------------------
// Crafting recipes
// ---------------------------------------------------------------------------
const TAGS = {
    planks: () => [I.planks],
    logs: () => [I.log, I.birch_log]
};
function ingMatch(spec, id) {
    if (spec === ' ' || spec === 0) return id === 0;
    if (typeof spec === 'string' && spec[0] === '#') return TAGS[spec.slice(1)]().includes(id);
    return I[spec] === id;
}

const RECIPES = [];
function shaped(rows, map, result, count = 1) {
    const h = rows.length, w = rows[0].length;
    const grid = rows.map(r => [...r].map(c => c === ' ' ? 0 : map[c]));
    RECIPES.push({ shaped: true, w, h, grid, result, count });
}
function shapeless(list, result, count = 1) { RECIPES.push({ shaped: false, list, result, count }); }

shapeless(['#logs'], 'planks', 4);
shaped(['P', 'P'], { P: '#planks' }, 'stick', 4);
shaped(['PP', 'PP'], { P: '#planks' }, 'crafting_table');
shaped(['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, 'furnace');
shaped(['PPP', 'P P', 'PPP'], { P: '#planks' }, 'chest');
shaped(['C', 'S'], { C: 'coal', S: 'stick' }, 'torch', 4);
shaped(['SS', 'SS'], { S: 'sand' }, 'sandstone');
shaped(['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, 'tnt');
shapeless(['iron_ingot', 'flint'], 'flint_and_steel');
shaped(['WW', 'WW'], { W: 'sandstone' }, 'sandstone'); // harmless placeholder (sandstone compaction)
RECIPES.pop();
['gold', 'iron', 'diamond'].forEach(m => {
    const ing = m === 'diamond' ? 'diamond' : m + '_ingot';
    shaped(['III', 'III', 'III'], { I: ing }, m + '_block');
    shapeless([m + '_block'], ing, 9);
});
[['wooden', '#planks'], ['stone', 'cobblestone'], ['iron', 'iron_ingot'], ['diamond', 'diamond']].forEach(([t, m]) => {
    shaped(['MMM', ' S ', ' S '], { M: m, S: 'stick' }, `${t}_pickaxe`);
    shaped(['MM', 'MS', ' S'], { M: m, S: 'stick' }, `${t}_axe`);
    shaped(['M', 'S', 'S'], { M: m, S: 'stick' }, `${t}_shovel`);
    shaped(['M', 'M', 'S'], { M: m, S: 'stick' }, `${t}_sword`);
});

// grid: array of ids, width w, height h  ->  {id,count} | null
function matchRecipe(cells, w, h) {
    // trim to bounding box
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (cells[y * w + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
    if (maxX < 0) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const sub = [];
    for (let y = 0; y < bh; y++) { sub.push([]); for (let x = 0; x < bw; x++) sub[y].push(cells[(minY + y) * w + minX + x]); }
    const flat = sub.flat().filter(v => v);

    for (const r of RECIPES) {
        if (r.shaped) {
            if (r.w !== bw || r.h !== bh) continue;
            for (let mirror = 0; mirror < 2; mirror++) {
                let ok = true;
                for (let y = 0; y < bh && ok; y++) for (let x = 0; x < bw; x++) {
                    const spec = r.grid[y][mirror ? bw - 1 - x : x];
                    if (!ingMatch(spec, sub[y][x])) { ok = false; break; }
                }
                if (ok) return { id: I[r.result], count: r.count };
            }
        } else {
            if (r.list.length !== flat.length) continue;
            const used = new Array(flat.length).fill(false);
            let ok = true;
            for (const spec of r.list) {
                let found = false;
                for (let i = 0; i < flat.length; i++) {
                    if (!used[i] && ingMatch(spec, flat[i])) { used[i] = true; found = true; break; }
                }
                if (!found) { ok = false; break; }
            }
            if (ok) return { id: I[r.result], count: r.count };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Smelting & fuel
// ---------------------------------------------------------------------------
const SMELTING = {};
function smelt(inKey, outKey, xp = 0.35) { SMELTING[I[inKey]] = { out: I[outKey], xp }; }
smelt('iron_ore', 'iron_ingot', 0.7);
smelt('gold_ore', 'gold_ingot', 1.0);
smelt('sand', 'glass', 0.1);
smelt('cobblestone', 'stone', 0.1);
smelt('raw_porkchop', 'cooked_porkchop');
smelt('raw_beef', 'steak');
smelt('raw_mutton', 'cooked_mutton');

const FUEL = {};
FUEL[I.coal] = 80; FUEL[I.planks] = 15; FUEL[I.log] = 15; FUEL[I.birch_log] = 15;
FUEL[I.stick] = 5; FUEL[I.sapling] = 5; FUEL[I.crafting_table] = 15; FUEL[I.chest] = 15;
TIERS.forEach(t => { if (t.key === 'wooden') TOOL_TYPES.forEach(tt => FUEL[I[`wooden_${tt.key}`]] = 10); });

// Everything that shows up in the creative inventory
function creativeList() {
    const out = [];
    for (let i = 1; i < 512; i++) { const d = DEFS[i]; if (d && d.creative !== false) out.push(i); }
    return out;
}
