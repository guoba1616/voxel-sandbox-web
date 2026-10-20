// ============================================================================
// textures.js — procedural 16x16 pixel-art texture atlas, item sprites, icons
// ============================================================================
'use strict';

const ATLAS_COLS = 16;
const TILE_NAMES = [];
const TILE_PAINT = [];
const TILE = {};

function tile(name, fn) { TILE[name] = TILE_NAMES.length; TILE_NAMES.push(name); TILE_PAINT.push(fn); }

// ---- tiny pixel buffer helpers --------------------------------------------
const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v;
function newBuf() { return new Uint8ClampedArray(16 * 16 * 4); }
function put(b, x, y, c, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    const i = (y * 16 + x) * 4;
    b[i] = c[0]; b[i + 1] = c[1]; b[i + 2] = c[2]; b[i + 3] = a;
}
function get(b, x, y) { const i = (y * 16 + x) * 4; return [b[i], b[i + 1], b[i + 2], b[i + 3]]; }
const addC = (c, d) => [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)];
const mulC = (c, f) => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function noiseFill(b, base, amp, rnd) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(b, x, y, addC(base, (rnd() - 0.5) * 2 * amp));
}
function rect(b, x, y, w, h, c, a = 255) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(b, x + i, y + j, c, a); }
function speckle(b, color, n, rnd, size = 1) {
    for (let i = 0; i < n; i++) {
        const x = Math.floor(rnd() * 16), y = Math.floor(rnd() * 16);
        rect(b, x, y, size, size, color);
    }
}
function line(b, x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
        put(b, x0, y0, c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}
function voronoi(b, n, rnd, baseFn, borderMul) {
    const sites = [];
    for (let i = 0; i < n; i++) sites.push([rnd() * 16, rnd() * 16, rnd()]);
    const owner = new Int16Array(256);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        let best = 1e9, bi = 0;
        for (let i = 0; i < n; i++) {
            for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
                const d = (sites[i][0] + ox - x) ** 2 + (sites[i][1] + oy - y) ** 2;
                if (d < best) { best = d; bi = i; }
            }
        }
        owner[y * 16 + x] = bi;
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const o = owner[y * 16 + x];
        const edge = (x < 15 && owner[y * 16 + x + 1] !== o) || (y < 15 && owner[(y + 1) * 16 + x] !== o);
        const c = baseFn(sites[o][2], x, y);
        put(b, x, y, edge ? mulC(c, borderMul) : c);
    }
}
function blobs(b, color, n, rnd, shape) {
    for (let i = 0; i < n; i++) {
        const cx = 1 + Math.floor(rnd() * 13), cy = 1 + Math.floor(rnd() * 13);
        const pts = shape || [[0, 0], [1, 0], [0, 1], [1, 1]];
        pts.forEach(([dx, dy]) => { if (rnd() < 0.85) put(b, cx + dx, cy + dy, addC(color, (rnd() - 0.5) * 20)); });
    }
}

const STONE_C = [127, 127, 127];
const PLANK_C = [160, 130, 80];
const DIRT_C = [134, 96, 67];
const GRASS_C = [104, 176, 66];

// ---- tiles ------------------------------------------------------------------
tile('stone', (b, r) => {
    noiseFill(b, STONE_C, 8, r);
    speckle(b, [105, 105, 105], 14, r);
    speckle(b, [145, 145, 145], 8, r);
});
tile('cobblestone', (b, r) => {
    voronoi(b, 8, r, (t) => { const v = 98 + t * 38; return [v, v, v]; }, 0.62);
    speckle(b, [140, 140, 140], 6, r);
});
tile('dirt', (b, r) => {
    noiseFill(b, DIRT_C, 9, r);
    speckle(b, [108, 76, 50], 22, r);
    speckle(b, [150, 110, 80], 8, r);
    speckle(b, [118, 118, 112], 3, r);
});
tile('grass_top', (b, r) => {
    noiseFill(b, GRASS_C, 11, r);
    speckle(b, [88, 150, 52], 22, r);
    speckle(b, [125, 195, 80], 14, r);
});
tile('grass_side', (b, r) => {
    noiseFill(b, DIRT_C, 9, r);
    speckle(b, [108, 76, 50], 18, r);
    speckle(b, [150, 110, 80], 6, r);
    for (let x = 0; x < 16; x++) {
        const d = 3 + Math.floor(r() * 3);
        for (let y = 0; y < d; y++) put(b, x, y, addC(GRASS_C, (r() - 0.5) * 22));
        if (r() < 0.55) put(b, x, d, addC(GRASS_C, -18));
    }
});
tile('sand', (b, r) => { noiseFill(b, [219, 207, 163], 7, r); speckle(b, [200, 187, 142], 12, r); speckle(b, [232, 222, 182], 8, r); });
tile('gravel', (b, r) => {
    noiseFill(b, [133, 128, 127], 12, r);
    blobs(b, [102, 98, 98], 10, r, [[0, 0], [1, 0], [1, 1]]);
    blobs(b, [165, 160, 158], 8, r, [[0, 0], [0, 1], [1, 1]]);
    blobs(b, [90, 110, 120], 3, r, [[0, 0], [1, 0]]);
});
tile('bedrock', (b, r) => {
    noiseFill(b, [86, 86, 86], 22, r);
    blobs(b, [38, 38, 38], 14, r, [[0, 0], [1, 0], [0, 1]]);
    blobs(b, [125, 125, 125], 8, r, [[0, 0], [1, 1]]);
});
tile('planks', (b, r) => {
    for (let y = 0; y < 16; y++) {
        const board = Math.floor(y / 4);
        const shift = (r() - 0.5) * 0;
        for (let x = 0; x < 16; x++) {
            let c = addC(PLANK_C, ((board % 2) ? 5 : -4) + (r() - 0.5) * 12);
            if (y % 4 === 3) c = mulC(c, 0.72);
            put(b, x, y, c);
        }
    }
    [[5, 0], [11, 1], [3, 2], [9, 3]].forEach(([x, bd]) => { for (let y = bd * 4; y < bd * 4 + 3; y++) put(b, x, y, mulC(PLANK_C, 0.78)); });
});
tile('log_side', (b, r) => {
    for (let x = 0; x < 16; x++) {
        const col = (r() - 0.5) * 18 + (x % 4 === 0 ? -12 : 0);
        for (let y = 0; y < 16; y++) put(b, x, y, addC([104, 83, 52], col + (r() - 0.5) * 10));
    }
});
tile('log_top', (b, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let c;
        if (d > 6.5) c = [104, 83, 52];
        else c = (Math.floor(d * 1.15) % 2) ? [158, 126, 78] : [182, 146, 92];
        put(b, x, y, addC(c, (r() - 0.5) * 8));
    }
});
tile('birch_log_side', (b, r) => {
    noiseFill(b, [216, 214, 204], 8, r);
    for (let i = 0; i < 9; i++) { const x = Math.floor(r() * 14), y = Math.floor(r() * 16); rect(b, x, y, 2 + Math.floor(r() * 3), 1, [52, 50, 48]); }
});
function leafPaint(base, holeChance) {
    return (b, r) => {
        noiseFill(b, base, 22, r);
        speckle(b, mulC(base, 0.7), 26, r);
        speckle(b, mulC(base, 1.25), 14, r);
        for (let i = 0; i < 256 * holeChance; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 16); put(b, x, y, [0, 0, 0], 0); }
    };
}
tile('leaves', leafPaint([62, 132, 40], 0.1));
tile('birch_leaves', leafPaint([112, 154, 62], 0.1));
tile('glass', (b, r) => {
    for (let i = 0; i < 16; i++) { put(b, i, 0, [200, 232, 240]); put(b, i, 15, [190, 222, 232]); put(b, 0, i, [200, 232, 240]); put(b, 15, i, [190, 222, 232]); }
    [[3, 3], [4, 4], [5, 5], [3, 5], [4, 6], [10, 9], [11, 10], [12, 11], [9, 10]].forEach(([x, y]) => put(b, x, y, [235, 250, 255], 255));
});
function oreTile(color, hi) {
    return (b, r) => {
        noiseFill(b, STONE_C, 8, r); speckle(b, [105, 105, 105], 12, r);
        for (let i = 0; i < 7; i++) {
            const cx = 1 + Math.floor(r() * 13), cy = 1 + Math.floor(r() * 13);
            [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0]].forEach(([dx, dy]) => { if (r() < 0.8) put(b, cx + dx, cy + dy, addC(color, (r() - 0.5) * 24)); });
            put(b, cx, cy, hi);
        }
    };
}
tile('coal_ore', oreTile([38, 38, 40], [70, 70, 74]));
tile('iron_ore', oreTile([216, 178, 150], [240, 215, 195]));
tile('gold_ore', oreTile([250, 226, 70], [255, 248, 160]));
tile('diamond_ore', oreTile([84, 224, 214], [200, 255, 250]));
tile('water', (b, r) => {
    noiseFill(b, [46, 90, 200], 8, r);
    for (let i = 0; i < 14; i++) { const x = Math.floor(r() * 14), y = Math.floor(r() * 16); rect(b, x, y, 3, 1, [86, 130, 232]); }
});
tile('lava', (b, r) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const n = (Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 0.8 - x * 0.3) + (r() - 0.5) * 1.6) * 0.25 + 0.5;
        put(b, x, y, mixC([170, 40, 8], [255, 205, 60], Math.max(0, Math.min(1, n))));
    }
});
tile('crafting_top', (b, r) => {
    noiseFill(b, [170, 134, 78], 8, r);
    rect(b, 0, 0, 16, 1, [96, 68, 34]); rect(b, 0, 15, 16, 1, [96, 68, 34]); rect(b, 0, 0, 1, 16, [96, 68, 34]); rect(b, 15, 0, 1, 16, [96, 68, 34]);
    for (let i = 1; i < 4; i++) { rect(b, 2 + i * 3 + (i - 1) * 0, 2, 1, 12, [90, 64, 32]); rect(b, 2, 2 + i * 3, 12, 1, [90, 64, 32]); }
    rect(b, 5, 5, 6, 6, [196, 160, 100]); rect(b, 6, 6, 4, 4, [170, 134, 78]);
});
function craftingSide(front) {
    return (b, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(b, x, y, addC(PLANK_C, (r() - 0.5) * 10 + (y % 4 === 3 ? -22 : 0)));
        rect(b, 0, 0, 16, 3, [98, 70, 38]); rect(b, 0, 15, 16, 1, [98, 70, 38]);
        if (front) { rect(b, 3, 5, 4, 8, [60, 60, 66]); rect(b, 4, 6, 2, 3, [145, 145, 150]); rect(b, 9, 6, 5, 2, [150, 150, 156]); rect(b, 11, 8, 1, 5, [110, 78, 40]); }
        else { rect(b, 3, 5, 3, 7, [66, 66, 72]); rect(b, 9, 6, 4, 6, [150, 150, 156]); rect(b, 10, 8, 2, 2, [100, 100, 106]); rect(b, 4, 5, 1, 8, [140, 100, 50]); }
    };
}
tile('crafting_side', craftingSide(false));
tile('crafting_front', craftingSide(true));
tile('furnace_top', (b, r) => { noiseFill(b, [118, 118, 118], 6, r); rect(b, 0, 0, 16, 1, [90, 90, 90]); rect(b, 0, 15, 16, 1, [90, 90, 90]); rect(b, 0, 0, 1, 16, [90, 90, 90]); rect(b, 15, 0, 1, 16, [90, 90, 90]); });
tile('furnace_side', (b, r) => { voronoi(b, 7, r, (t) => { const v = 104 + t * 28; return [v, v, v]; }, 0.78); });
function furnaceFront(lit) {
    return (b, r) => {
        voronoi(b, 7, r, (t) => { const v = 104 + t * 28; return [v, v, v]; }, 0.78);
        rect(b, 3, 2, 10, 4, [52, 52, 52]); rect(b, 4, 3, 8, 2, [28, 28, 28]);
        rect(b, 3, 7, 10, 7, [58, 58, 58]);
        if (lit) {
            rect(b, 4, 8, 8, 5, [225, 100, 20]); rect(b, 5, 10, 6, 3, [255, 190, 50]); rect(b, 6, 11, 4, 2, [255, 235, 140]);
        } else { rect(b, 4, 8, 8, 5, [26, 26, 26]); rect(b, 4, 12, 8, 1, [60, 56, 54]); }
    };
}
tile('furnace_front', furnaceFront(false));
tile('furnace_front_on', furnaceFront(true));
function chestPaint(kind) {
    return (b, r) => {
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) put(b, x, y, addC([156, 110, 46], (r() - 0.5) * 12 + (y % 5 === 4 ? -14 : 0)));
        rect(b, 0, 0, 16, 1, [88, 58, 20]); rect(b, 0, 15, 16, 1, [88, 58, 20]); rect(b, 0, 0, 1, 16, [88, 58, 20]); rect(b, 15, 0, 1, 16, [88, 58, 20]);
        if (kind === 'front') { rect(b, 0, 5, 16, 1, [88, 58, 20]); rect(b, 7, 4, 2, 4, [210, 210, 214]); rect(b, 7, 6, 2, 1, [90, 90, 96]); }
        if (kind === 'side') rect(b, 0, 5, 16, 1, [88, 58, 20]);
        if (kind === 'top') { rect(b, 2, 2, 12, 12, [172, 126, 58]); }
    };
}
tile('chest_side', chestPaint('side'));
tile('chest_front', chestPaint('front'));
tile('chest_top', chestPaint('top'));
tile('torch', (b, r) => {
    for (let y = 6; y < 16; y++) { put(b, 7, y, [138, 98, 48]); put(b, 8, y, [112, 78, 36]); }
    put(b, 7, 6, [255, 230, 80]); put(b, 8, 6, [250, 190, 40]);
    put(b, 7, 7, [250, 170, 30]); put(b, 8, 7, [230, 120, 20]);
    put(b, 7, 5, [255, 250, 190]); put(b, 8, 5, [255, 220, 90]);
});
tile('tallgrass', (b, r) => {
    for (let i = 0; i < 7; i++) {
        const x = 1 + Math.floor(r() * 14), h = 5 + Math.floor(r() * 8);
        const lean = (r() - 0.5) * 0.5;
        for (let k = 0; k < h; k++) put(b, Math.round(x + lean * k), 15 - k, addC([86, 160, 52], (k / h) * 40 - 15 + (r() - 0.5) * 14));
    }
});
tile('dandelion', (b, r) => {
    for (let y = 7; y < 16; y++) put(b, 7, y, [72, 140, 44]);
    put(b, 6, 11, [72, 140, 44]); put(b, 8, 9, [72, 140, 44]);
    rect(b, 6, 3, 4, 4, [250, 220, 40]); rect(b, 5, 4, 6, 2, [250, 210, 30]); put(b, 7, 4, [255, 245, 150]); put(b, 8, 5, [225, 160, 10]);
});
tile('poppy', (b, r) => {
    for (let y = 7; y < 16; y++) put(b, 7, y, [60, 120, 40]);
    put(b, 6, 12, [60, 120, 40]); put(b, 8, 10, [60, 120, 40]);
    rect(b, 5, 2, 6, 5, [206, 30, 30]); rect(b, 6, 1, 4, 7, [198, 26, 26]); put(b, 7, 4, [40, 20, 20]); put(b, 8, 4, [40, 20, 20]); put(b, 6, 3, [240, 80, 80]);
});
tile('sapling', (b, r) => {
    for (let y = 8; y < 16; y++) put(b, 7, y, [100, 76, 40]);
    for (let y = 2; y < 10; y++) for (let x = 3; x < 13; x++) {
        const d = Math.hypot(x - 7.5, y - 5.5);
        if (d < 4.2 && r() < 0.9) put(b, x, y, addC([54, 124, 38], (r() - 0.5) * 30));
    }
});
tile('cactus_side', (b, r) => {
    noiseFill(b, [16, 108, 34], 8, r);
    rect(b, 0, 0, 1, 16, [10, 74, 22]); rect(b, 15, 0, 1, 16, [10, 74, 22]); rect(b, 7, 0, 2, 16, [12, 90, 28]);
    for (let i = 0; i < 12; i++) put(b, 2 + Math.floor(r() * 12), Math.floor(r() * 16), [210, 220, 170]);
});
tile('cactus_top', (b, r) => {
    noiseFill(b, [28, 130, 44], 6, r);
    rect(b, 0, 0, 16, 1, [10, 74, 22]); rect(b, 0, 15, 16, 1, [10, 74, 22]); rect(b, 0, 0, 1, 16, [10, 74, 22]); rect(b, 15, 0, 1, 16, [10, 74, 22]);
    rect(b, 4, 4, 8, 8, [40, 150, 56]); rect(b, 6, 6, 4, 4, [20, 110, 34]);
});
tile('sandstone', (b, r) => {
    noiseFill(b, [218, 204, 156], 5, r);
    rect(b, 0, 3, 16, 1, [196, 182, 134]); rect(b, 0, 11, 16, 1, [196, 182, 134]); rect(b, 0, 4, 16, 1, [226, 213, 168]);
});
tile('sandstone_top', (b, r) => { noiseFill(b, [222, 208, 160], 4, r); rect(b, 0, 0, 16, 1, [200, 186, 138]); rect(b, 0, 15, 16, 1, [200, 186, 138]); rect(b, 0, 0, 1, 16, [200, 186, 138]); rect(b, 15, 0, 1, 16, [200, 186, 138]); });
tile('sandstone_bottom', (b, r) => { noiseFill(b, [212, 198, 150], 4, r); });
tile('snow', (b, r) => { noiseFill(b, [246, 249, 252], 4, r); speckle(b, [226, 234, 244], 10, r); });
tile('tnt_side', (b, r) => {
    noiseFill(b, [204, 56, 44], 8, r);
    rect(b, 0, 5, 16, 6, [236, 232, 220]);
    rect(b, 0, 4, 16, 1, [150, 36, 30]); rect(b, 0, 11, 16, 1, [150, 36, 30]);
    // T N T
    rect(b, 2, 6, 3, 1, [40, 40, 40]); rect(b, 3, 7, 1, 3, [40, 40, 40]);
    rect(b, 6, 6, 1, 4, [40, 40, 40]); rect(b, 9, 6, 1, 4, [40, 40, 40]); put(b, 7, 7, [40, 40, 40]); put(b, 8, 8, [40, 40, 40]);
    rect(b, 11, 6, 3, 1, [40, 40, 40]); rect(b, 12, 7, 1, 3, [40, 40, 40]);
});
tile('tnt_top', (b, r) => { noiseFill(b, [190, 160, 110], 8, r); rect(b, 6, 6, 4, 4, [60, 52, 44]); rect(b, 7, 7, 2, 2, [220, 120, 40]); rect(b, 0, 0, 16, 1, [150, 36, 30]); rect(b, 0, 15, 16, 1, [150, 36, 30]); rect(b, 0, 0, 1, 16, [150, 36, 30]); rect(b, 15, 0, 1, 16, [150, 36, 30]); });
tile('tnt_bottom', (b, r) => { noiseFill(b, [190, 160, 110], 8, r); rect(b, 0, 0, 16, 1, [150, 36, 30]); rect(b, 0, 15, 16, 1, [150, 36, 30]); rect(b, 0, 0, 1, 16, [150, 36, 30]); rect(b, 15, 0, 1, 16, [150, 36, 30]); });
tile('glowstone', (b, r) => {
    voronoi(b, 9, r, (t) => mixC([176, 120, 48], [255, 214, 110], t), 0.8);
    speckle(b, [255, 240, 170], 10, r);
});
tile('wool', (b, r) => {
    noiseFill(b, [232, 232, 232], 6, r);
    for (let i = 0; i < 20; i++) { const x = Math.floor(r() * 14), y = Math.floor(r() * 16); rect(b, x, y, 2, 1, [214, 214, 214]); }
});
tile('bricks', (b, r) => {
    rect(b, 0, 0, 16, 16, [188, 182, 170]);
    for (let row = 0; row < 4; row++) {
        const off = (row % 2) * 4;
        for (let seg = -1; seg < 3; seg++) {
            const x0 = seg * 8 + off;
            for (let y = row * 4; y < row * 4 + 3; y++) for (let x = Math.max(0, x0); x < Math.min(16, x0 + 7); x++) put(b, x, y, addC([152, 72, 56], (r() - 0.5) * 18));
        }
    }
});
function blockOfTile(base, edge, hi) {
    return (b, r) => {
        noiseFill(b, base, 5, r);
        for (let i = 0; i < 16; i++) { put(b, i, 0, edge); put(b, i, 15, edge); put(b, 0, i, edge); put(b, 15, i, edge); }
        for (let i = 1; i < 14; i++) { put(b, i, 1, hi); put(b, 1, i, hi); }
        speckle(b, hi, 6, r);
    };
}
tile('gold_block', blockOfTile([248, 214, 56], [200, 150, 20], [255, 248, 160]));
tile('iron_block', blockOfTile([220, 220, 222], [160, 160, 164], [250, 250, 252]));
tile('diamond_block', blockOfTile([92, 226, 210], [40, 160, 150], [200, 255, 250]));
tile('granite', (b, r) => { noiseFill(b, [152, 104, 86], 10, r); speckle(b, [176, 128, 108], 14, r, 2); speckle(b, [120, 80, 66], 10, r); });
tile('diorite', (b, r) => { noiseFill(b, [190, 190, 190], 8, r); speckle(b, [130, 130, 130], 14, r, 2); speckle(b, [226, 226, 226], 10, r); });
tile('andesite', (b, r) => { noiseFill(b, [136, 136, 136], 8, r); speckle(b, [166, 166, 166], 14, r, 2); speckle(b, [104, 104, 104], 10, r); });
tile('white', (b) => { rect(b, 0, 0, 16, 16, [255, 255, 255]); });
tile('obsidian', (b, r) => { noiseFill(b, [20, 12, 36], 6, r); speckle(b, [58, 30, 96], 18, r); speckle(b, [90, 50, 140], 5, r); });

// ---- item sprites (drawn straight into a 16x16 buffer) -------------------------
const SPRITES = {};
function sprite(key, fn) { SPRITES[key] = fn; }
const HANDLE = [128, 92, 44], HANDLE_D = [84, 58, 24];
const TIER_COL = {
    wooden:  { m: [166, 134, 82], l: [196, 166, 112], d: [112, 84, 40] },
    stone:   { m: [138, 138, 138], l: [172, 172, 172], d: [92, 92, 92] },
    iron:    { m: [214, 214, 218], l: [246, 246, 250], d: [160, 160, 168] },
    diamond: { m: [90, 228, 210], l: [180, 255, 245], d: [36, 160, 150] }
};
function handle(b, x0, y0, x1, y1) { line(b, x0, y0, x1, y1, HANDLE); line(b, x0 + 1, y0, x1 + 1, y1, HANDLE_D); }
function dots(b, list, c) { list.forEach(([x, y]) => put(b, x, y, c)); }
Object.keys(TIER_COL).forEach(t => {
    const c = TIER_COL[t];
    sprite(`${t}_pickaxe`, (b) => {
        handle(b, 2, 14, 10, 6);
        dots(b, [[4, 4], [5, 3], [6, 2], [7, 2], [8, 1], [9, 1], [10, 1], [11, 2], [12, 3], [13, 4], [14, 5], [14, 6], [14, 7]], c.m);
        dots(b, [[5, 4], [6, 3], [7, 3], [8, 2], [9, 2], [10, 2], [11, 3], [12, 4], [13, 5], [13, 6]], c.l);
        dots(b, [[4, 5], [3, 5], [14, 8], [10, 5], [11, 5], [12, 6], [12, 5], [13, 7]], c.d);
    });
    sprite(`${t}_axe`, (b) => {
        handle(b, 2, 14, 9, 7);
        dots(b, [[7, 2], [8, 2], [9, 2], [10, 2], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [8, 6], [9, 6], [10, 6]], c.m);
        dots(b, [[7, 2], [8, 2], [9, 2], [10, 2], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3]], c.l);
        dots(b, [[12, 4], [11, 5], [10, 6], [6, 4], [7, 5], [8, 6]], c.d);
    });
    sprite(`${t}_shovel`, (b) => {
        handle(b, 2, 14, 10, 6);
        dots(b, [[11, 2], [12, 2], [10, 3], [11, 3], [12, 3], [13, 3], [10, 4], [11, 4], [12, 4], [13, 4], [11, 5], [12, 5], [13, 5], [11, 1], [12, 1]], c.m);
        dots(b, [[11, 2], [12, 2], [11, 1], [12, 1], [10, 3], [11, 3]], c.l);
        dots(b, [[13, 4], [13, 5], [12, 5], [11, 5], [13, 3]], c.d);
    });
    sprite(`${t}_sword`, (b) => {
        for (let i = 0; i < 9; i++) { put(b, 14 - i, 1 + i, c.m); put(b, 13 - i, 1 + i, c.l); put(b, 15 - i, 1 + i, c.d); }
        dots(b, [[14, 1]], c.l);
        // guard
        for (let i = 0; i < 5; i++) { put(b, 4 + i, 8 + i - 0, HANDLE_D); put(b, 3 + i, 8 + i, HANDLE); }
        line(b, 2, 13, 4, 11, HANDLE); line(b, 3, 13, 5, 11, HANDLE_D); put(b, 1, 14, HANDLE_D); put(b, 2, 14, HANDLE);
    });
});
sprite('stick', (b) => { line(b, 3, 13, 12, 4, HANDLE); line(b, 4, 13, 13, 4, HANDLE_D); });
sprite('coal', (b) => {
    dots(b, [[6, 3], [7, 3], [8, 3], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [7, 10], [8, 10], [9, 10]], [38, 38, 42]);
    dots(b, [[6, 4], [7, 4], [5, 5], [6, 5], [8, 6]], [78, 78, 86]);
    dots(b, [[10, 8], [9, 9], [8, 10], [11, 7]], [18, 18, 20]);
});
function ingotSimple(b, m, l, d) {
    for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) {
        const x = 2 + i + (4 - j), y = 5 + j * 2;
        put(b, x, y, j === 0 ? l : m); put(b, x, y + 1, j === 4 ? d : m);
    }
    for (let j = 0; j < 5; j++) { put(b, 2 + 9 + (4 - j), 5 + j * 2, d); put(b, 2 + 9 + (4 - j), 6 + j * 2, d); }
}
sprite('iron_ingot', (b) => ingotSimple(b, [208, 208, 212], [245, 245, 248], [140, 140, 148]));
sprite('gold_ingot', (b) => ingotSimple(b, [248, 212, 54], [255, 246, 150], [190, 140, 20]));
sprite('diamond', (b) => {
    const m = [90, 228, 212], l = [190, 255, 248], d = [30, 140, 150];
    const rows = [[5, 10], [3, 12], [2, 13], [3, 12], [4, 11], [5, 10], [6, 9], [7, 8]];
    rows.forEach(([a, z], k) => { for (let x = a; x <= z; x++) put(b, x, 3 + k, (k < 2 && x < 8) ? l : (x > 9 ? d : m)); });
    dots(b, [[5, 5], [6, 4]], [255, 255, 255]);
});
sprite('flint', (b) => {
    dots(b, [[7, 4], [8, 4], [6, 5], [7, 5], [8, 5], [9, 5], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [7, 9], [8, 9], [9, 9]], [70, 70, 76]);
    dots(b, [[7, 5], [6, 6], [7, 6]], [120, 120, 128]); dots(b, [[10, 8], [9, 9], [10, 7]], [34, 34, 38]);
});
sprite('flint_and_steel', (b) => {
    // steel striker (rounded rectangle with a hole)
    const steel = [196, 196, 202], steelD = [120, 120, 128];
    for (let y = 8; y <= 13; y++) for (let x = 2; x <= 8; x++) put(b, x, y, (x === 2 || y === 13) ? steelD : steel);
    rect(b, 4, 10, 3, 2, [0, 0, 0], 0);
    put(b, 2, 8, [0, 0, 0], 0); put(b, 8, 8, [0, 0, 0], 0);
    // flint chip
    dots(b, [[9, 5], [10, 4], [11, 4], [10, 5], [11, 5], [12, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [10, 7], [11, 7], [12, 7]], [64, 64, 70]);
    dots(b, [[10, 5], [11, 5], [10, 4]], [112, 112, 120]);
    dots(b, [[8, 7], [9, 7], [8, 8], [9, 8]], [150, 150, 156]);
});
sprite('apple', (b) => {
    for (let y = 4; y <= 13; y++) for (let x = 3; x <= 12; x++) {
        const d = Math.hypot(x - 7.5, y - 8.8);
        if (d < 4.7) put(b, x, y, d > 3.7 ? [152, 24, 24] : (x < 7 && y < 9 ? [236, 64, 64] : [208, 38, 38]));
    }
    dots(b, [[5, 6], [5, 7], [6, 6]], [255, 190, 190]); dots(b, [[7, 2], [7, 3]], [110, 74, 20]); dots(b, [[8, 2], [9, 2], [9, 3]], [60, 160, 50]);
});
function meat(raw, kind) {
    return (b) => {
        const main = kind === 'pork' ? (raw ? [236, 150, 150] : [168, 96, 56]) : kind === 'beef' ? (raw ? [196, 60, 60] : [120, 66, 40]) : (raw ? [206, 100, 96] : [150, 88, 52]);
        const edge = mulC(main, 0.7), hi = mulC(main, 1.2);
        for (let y = 3; y <= 12; y++) for (let x = 2; x <= 13; x++) {
            const d = Math.hypot((x - 7.5) / 1.35, y - 7.5);
            if (d < 4.4) put(b, x, y, d > 3.4 ? edge : ((x + y) % 5 === 0 ? hi : main));
        }
        if (kind === 'mutton') { rect(b, 11, 10, 3, 3, [236, 228, 214]); }
        if (kind === 'pork') { dots(b, [[10, 10], [11, 11], [12, 12], [12, 10]], [244, 236, 224]); }
        dots(b, [[5, 5], [6, 5]], mulC(main, 1.35));
    };
}
sprite('raw_porkchop', meat(true, 'pork')); sprite('cooked_porkchop', meat(false, 'pork'));
sprite('raw_beef', meat(true, 'beef')); sprite('steak', meat(false, 'beef'));
sprite('raw_mutton', meat(true, 'mutton')); sprite('cooked_mutton', meat(false, 'mutton'));
sprite('rotten_flesh', (b, r) => {
    for (let y = 3; y <= 12; y++) for (let x = 2; x <= 13; x++) {
        const d = Math.hypot((x - 7.5) / 1.3, y - 7.5);
        if (d < 4.4) put(b, x, y, (x * 7 + y * 3) % 4 === 0 ? [140, 150, 80] : (d > 3.4 ? [100, 70, 50] : [150, 96, 70]));
    }
});
sprite('bone', (b) => {
    line(b, 4, 12, 11, 5, [236, 234, 224]); line(b, 5, 12, 12, 5, [210, 208, 196]);
    dots(b, [[3, 11], [3, 13], [4, 13], [2, 12], [11, 4], [12, 4], [13, 5], [13, 3], [12, 3]], [236, 234, 224]);
    dots(b, [[2, 13], [13, 4]], [200, 198, 186]);
});
sprite('gunpowder', (b, r) => {
    for (let y = 5; y <= 12; y++) for (let x = 3; x <= 12; x++) {
        const d = Math.hypot((x - 7.5) / 1.3, (y - 9)) + (r() - 0.5);
        if (d < 3.6) put(b, x, y, [70 + r() * 36, 70 + r() * 36, 74 + r() * 36].map(Math.round));
    }
});
sprite('arrow', (b) => {
    line(b, 3, 12, 12, 3, [150, 112, 60]); line(b, 4, 12, 13, 3, [110, 78, 36]);
    dots(b, [[13, 2], [14, 1], [12, 2], [13, 3], [14, 2]], [160, 160, 168]);
    dots(b, [[2, 12], [3, 13], [2, 11], [1, 13], [3, 14], [2, 13]], [236, 236, 236]);
});

// ---- atlas & icon generation -------------------------------------------------
let atlasCanvas = null, atlasTexture = null;
const iconCache = {};
const crackCanvases = [];

function tileUV(name) {
    const i = typeof name === 'number' ? name : TILE[name];
    const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
    const e = 0.0015;
    return { u0: col / ATLAS_COLS + e, u1: (col + 1) / ATLAS_COLS - e, v0: 1 - (row + 1) / ATLAS_COLS + e, v1: 1 - row / ATLAS_COLS - e };
}

function resolveBlockTiles() {
    for (let id = 1; id < 256; id++) {
        const d = DEFS[id];
        if (!d) continue;
        const t = d.tiles;
        let top, bottom, side;
        if (typeof t === 'string') top = bottom = side = t;
        else { top = t.top; bottom = t.bottom; side = t.side; }
        // face order: +x -x +y -y +z -z
        d.faceTiles = [TILE[side], TILE[side], TILE[top], TILE[bottom], TILE[side], TILE[side]];
        d.frontTile = d.front ? TILE[d.front] : null;
        if (d.faceTiles.some(v => v === undefined)) console.warn('missing tile for', d.key, d.tiles);
    }
}

function buildAtlas() {
    const size = ATLAS_COLS * 16;
    atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = atlasCanvas.height = size;
    const g = atlasCanvas.getContext('2d');
    TILE_PAINT.forEach((fn, i) => {
        const b = newBuf();
        const rnd = mulberry32(1000 + i * 7919);
        fn(b, rnd);
        g.putImageData(new ImageData(b, 16, 16), (i % ATLAS_COLS) * 16, Math.floor(i / ATLAS_COLS) * 16);
    });
    atlasTexture = new THREE.CanvasTexture(atlasCanvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
    resolveBlockTiles();

    // destroy-stage crack overlays
    const rnd = mulberry32(777);
    const crackPix = [];
    let cx = 8, cy = 8;
    for (let k = 0; k < 90; k++) {
        crackPix.push([cx, cy]);
        const a = rnd();
        if (a < 0.25) cx++; else if (a < 0.5) cx--; else if (a < 0.75) cy++; else cy--;
        if (cx < 0 || cx > 15 || cy < 0 || cy > 15 || rnd() < 0.04) { cx = 4 + Math.floor(rnd() * 8); cy = 4 + Math.floor(rnd() * 8); }
    }
    for (let s = 0; s < 10; s++) {
        const c = document.createElement('canvas'); c.width = c.height = 16;
        const cg = c.getContext('2d');
        const n = Math.floor((s + 1) * 9);
        const buf = newBuf();
        for (let k = 0; k < n; k++) { const [x, y] = crackPix[k]; put(buf, x, y, [0, 0, 0], 150); if (s > 4 && k % 3 === 0) put(buf, x + 1, y, [0, 0, 0], 120); }
        cg.putImageData(new ImageData(buf, 16, 16), 0, 0);
        const tex = new THREE.CanvasTexture(c);
        tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
        crackCanvases.push(tex);
    }
}

function spriteCanvas(key) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const b = newBuf();
    const fn = SPRITES[key];
    if (fn) fn(b, mulberry32(key.length * 131 + 17));
    c.getContext('2d').putImageData(new ImageData(b, 16, 16), 0, 0);
    return c;
}

// 3-face isometric block icon (32x32)
function blockIconCanvas(def) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (def.render === 'cross' || def.render === 'torch') {
        const t = def.faceTiles[4];
        g.drawImage(atlasCanvas, (t % ATLAS_COLS) * 16, Math.floor(t / ATLAS_COLS) * 16, 16, 16, 0, 0, 32, 32);
        return c;
    }
    const src = (t) => [(t % ATLAS_COLS) * 16, Math.floor(t / ATLAS_COLS) * 16];
    const top = src(def.faceTiles[2]);
    const sideL = src(def.frontTile != null ? def.frontTile : def.faceTiles[4]);
    const sideR = src(def.faceTiles[0]);
    // top
    g.save(); g.setTransform(1, 0.5, -1, 0.5, 16, 0);
    g.drawImage(atlasCanvas, top[0], top[1], 16, 16, 0, 0, 16, 16);
    g.restore();
    // left
    g.save(); g.setTransform(1, 0.5, 0, 1, 0, 8);
    g.drawImage(atlasCanvas, sideL[0], sideL[1], 16, 16, 0, 0, 16, 16);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, 16, 16);
    g.restore();
    // right
    g.save(); g.setTransform(1, -0.5, 0, 1, 16, 16);
    g.drawImage(atlasCanvas, sideR[0], sideR[1], 16, 16, 0, 0, 16, 16);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 0, 16, 16);
    g.restore();
    return c;
}

function getIconCanvas(id) {
    if (iconCache[id]) return iconCache[id];
    const d = DEFS[id];
    if (!d) return null;
    const c = d.isBlock ? blockIconCanvas(d) : spriteCanvas(d.icon);
    iconCache[id] = c;
    return c;
}
const iconURLCache = {};
function getIconURL(id) {
    if (iconURLCache[id]) return iconURLCache[id];
    const c = getIconCanvas(id);
    return (iconURLCache[id] = c ? c.toDataURL() : '');
}
