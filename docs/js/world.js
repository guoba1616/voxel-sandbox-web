// ============================================================================
// world.js — chunked world: terrain generation, lighting, meshing, streaming
// ============================================================================
'use strict';

const CW = 16;            // chunk width
const WH = 128;           // world height
const SEA = 40;           // sea level
const CSIZE = CW * CW * WH;

// per-block lookup tables (filled after registry)
const OPACITY = new Uint8Array(512);   // light opacity 0..15
const EMIT = new Uint8Array(512);
const SOLID = new Uint8Array(512);
const OPAQUE = new Uint8Array(512);
(function buildTables() {
    for (let i = 1; i < 512; i++) {
        const d = DEFS[i];
        if (!d || !d.isBlock) continue;
        OPACITY[i] = d.opaque ? 15 : (d.render === 'leaves' ? 1 : (d.key === 'water' ? 3 : (d.key === 'lava' ? 2 : 0)));
        EMIT[i] = d.light || 0;
        SOLID[i] = d.solid ? 1 : 0;
        OPAQUE[i] = d.opaque ? 1 : 0;
    }
})();

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

class Chunk {
    constructor(cx, cz) {
        this.cx = cx; this.cz = cz;
        this.blocks = new Uint8Array(CSIZE);
        this.light = new Uint8Array(CSIZE);
        this.meta = new Map();
        this.generated = false;
        this.dirty = false;
        this.urgent = false;
        this.modified = false;
        this.maxY = 0;
        this.mesh = null;
        this.waterMesh = null;
        this.meshed = false;
    }
}

// ---------------------------------------------------------------------------
// Shaders / materials
// ---------------------------------------------------------------------------
const VERT = `
attribute float aShade;
attribute vec2 aLight;
varying vec2 vUv; varying float vShade; varying vec2 vLight; varying float vDist;
void main(){
    vUv = uv; vShade = aShade; vLight = aLight;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap; uniform float uSky; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform float uAlpha; uniform float uBright;
varying vec2 vUv; varying float vShade; varying vec2 vLight; varying float vDist;
void main(){
    vec4 t = texture2D(uMap, vUv);
    #ifdef CUTOUT
    if (t.a < 0.5) discard;
    #endif
    float L = max(vLight.x * uSky, vLight.y);
    float br = L / (4.0 - 3.0 * L);
    br = max(br, 0.045 + uBright);
    vec3 col = t.rgb * br * vShade;
    float f = clamp((vDist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    col = mix(col, uFogColor, f);
    gl_FragColor = vec4(col, uAlpha * t.a);
}`;

const worldUniforms = {
    uMap: { value: null }, uSky: { value: 1 }, uFogColor: { value: new THREE.Color(0xc0d8ff) },
    uFogNear: { value: 60 }, uFogFar: { value: 110 }, uBright: { value: 0 }
};
let solidMaterial = null, waterMaterial = null;
function initWorldMaterials() {
    worldUniforms.uMap.value = atlasTexture;
    solidMaterial = new THREE.ShaderMaterial({
        uniforms: Object.assign({ uAlpha: { value: 1 } }, worldUniforms),
        vertexShader: VERT, fragmentShader: FRAG, defines: { CUTOUT: 1 }
    });
    waterMaterial = new THREE.ShaderMaterial({
        uniforms: Object.assign({ uAlpha: { value: 0.72 } }, worldUniforms),
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const world = {
    seed: 0,
    chunks: new Map(),
    saved: new Map(),          // key -> {blocks, meta}  (modified chunks loaded from storage)
    tileEntities: new Map(),   // "x,y,z" -> object
    perlin: null, perlin2: null,
    scene: null,
    renderDist: 6,
    skyFactor: 1,
    _lastKey: null, _lastChunk: null,
    genQueue: [], dirtyList: [],
    pendingTicks: [],

    reset(seed) {
        this.chunks.forEach(c => this.disposeChunkMeshes(c));
        this.chunks.clear();
        this.saved.clear();
        this.tileEntities.clear();
        this.seed = seed | 0;
        this.perlin = new Perlin(this.seed);
        this.perlin2 = new Perlin(this.seed ^ 0x5bd1e995);
        this._lastKey = null; this._lastChunk = null;
        this.pendingTicks.length = 0;
        colCache.clear();
    },

    key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); },
    getChunk(cx, cz) {
        const k = this.key(cx, cz);
        if (k === this._lastKey) return this._lastChunk;
        const c = this.chunks.get(k);
        if (c) { this._lastKey = k; this._lastChunk = c; }
        return c;
    },
    chunkAt(x, z) { return this.getChunk(x >> 4, z >> 4); },

    getBlock(x, y, z) {
        if (y < 0 || y >= WH) return 0;
        const c = this.getChunk(x >> 4, z >> 4);
        if (!c || !c.generated) return 0;
        return c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)];
    },
    isLoaded(x, z) { const c = this.getChunk(x >> 4, z >> 4); return !!(c && c.generated); },
    getMeta(x, y, z) {
        const c = this.getChunk(x >> 4, z >> 4);
        if (!c) return 0;
        return c.meta.get((x & 15) + ((z & 15) << 4) + (y << 8)) || 0;
    },
    solidAt(x, y, z) {
        if (y < 0) return true;
        if (y >= WH) return false;
        const c = this.getChunk(x >> 4, z >> 4);
        if (!c || !c.generated) return true;       // unloaded = wall
        return SOLID[c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)]] === 1;
    },
    getLight(x, y, z) {   // packed sky<<4|block
        if (y < 0) return 0;
        if (y >= WH) return 0xF0;
        const c = this.getChunk(x >> 4, z >> 4);
        if (!c || !c.generated) return 0xF0;
        return c.light[(x & 15) + ((z & 15) << 4) + (y << 8)];
    },
    // effective light (0..15) taking time of day into account
    lightLevel(x, y, z) {
        const l = this.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
        return Math.max((l >> 4) * this.skyFactor, l & 15);
    },
    surfaceY(x, z) {   // highest solid block y (feet position = +1)
        const c = this.chunkAt(x, z);
        if (!c || !c.generated) return -1;
        for (let y = WH - 1; y >= 0; y--) if (SOLID[c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)]]) return y;
        return -1;
    },

    // -------- editing ---------------------------------------------------------
    setBlock(x, y, z, id, meta = 0, silent = false) {
        if (y < 0 || y >= WH) return false;
        const c = this.chunkAt(x, z);
        if (!c || !c.generated) return false;
        const lx = x & 15, lz = z & 15, idx = lx + (lz << 4) + (y << 8);
        const old = c.blocks[idx];
        const oldMeta = c.meta.get(idx) || 0;
        if (old === id && oldMeta === meta) return false;
        c.blocks[idx] = id;
        if (meta) c.meta.set(idx, meta); else c.meta.delete(idx);
        c.modified = true;
        if (y > c.maxY) c.maxY = y;

        // lighting
        if (!silent) {
            const wasLight = c.light[idx];
            if (wasLight) { this.removeLight(x, y, z, true); this.removeLight(x, y, z, false); }
            const op = OPACITY[id];
            if (op < 15) {
                const q = [];
                // recompute own value from neighbours
                let sky = 0, blk = 0;
                for (const d of DIRS) {
                    const l = this.getLight(x + d[0], y + d[1], z + d[2]);
                    if (d[1] === 1 && (l >> 4) === 15 && op === 0) sky = 15;
                    sky = Math.max(sky, (l >> 4) - Math.max(1, op));
                    blk = Math.max(blk, (l & 15) - Math.max(1, op));
                }
                if (EMIT[id] > blk) blk = EMIT[id];
                if (y === WH - 1 && op === 0) sky = 15;
                c.light[idx] = (Math.max(0, sky) << 4) | Math.max(0, blk);
                q.push(x, y, z);
                this.spreadLight(q, true); this.spreadLight(q.slice(), false);
            } else {
                c.light[idx] = 0;
            }
            this.markDirty(x, y, z, true);
            // neighbour block updates
            this.neighbourUpdates(x, y, z);
        }
        return true;
    },
    setMeta(x, y, z, meta) {
        const c = this.chunkAt(x, z);
        if (!c) return;
        const idx = (x & 15) + ((z & 15) << 4) + (y << 8);
        if (meta) c.meta.set(idx, meta); else c.meta.delete(idx);
        c.modified = true; this.markDirty(x, y, z, true);
    },

    markDirty(x, y, z, urgent) {
        const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
        const list = [[cx, cz]];
        if (lx === 0) list.push([cx - 1, cz]); if (lx === 15) list.push([cx + 1, cz]);
        if (lz === 0) list.push([cx, cz - 1]); if (lz === 15) list.push([cx, cz + 1]);
        if (lx === 0 && lz === 0) list.push([cx - 1, cz - 1]); if (lx === 15 && lz === 15) list.push([cx + 1, cz + 1]);
        if (lx === 0 && lz === 15) list.push([cx - 1, cz + 1]); if (lx === 15 && lz === 0) list.push([cx + 1, cz - 1]);
        for (const [a, b] of list) {
            const c = this.getChunk(a, b);
            if (c && c.generated) { c.dirty = true; if (urgent) c.urgent = true; }
        }
    },

    // -------- lighting ----------------------------------------------------------
    spreadLight(q, isSky) {
        let i = 0;
        while (i < q.length) {
            const x = q[i++], y = q[i++], z = q[i++];
            const c = this.chunkAt(x, z);
            const L = this.chanGet(c, x, y, z, isSky);
            if (L <= 1) continue;
            for (let d = 0; d < 6; d++) {
                const dir = DIRS[d];
                const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2];
                if (ny < 0 || ny >= WH) continue;
                const nc = this.chunkAt(nx, nz);
                if (!nc || !nc.generated) continue;
                const nidx = (nx & 15) + ((nz & 15) << 4) + (ny << 8);
                const op = OPACITY[nc.blocks[nidx]];
                if (op >= 15) continue;
                let nl = L - Math.max(1, op);
                if (isSky && d === 3 && L === 15 && op === 0) nl = 15;
                const cur = isSky ? (nc.light[nidx] >> 4) : (nc.light[nidx] & 15);
                if (cur < nl) {
                    nc.light[nidx] = isSky ? ((nl << 4) | (nc.light[nidx] & 15)) : ((nc.light[nidx] & 0xF0) | nl);
                    nc.dirty = true;
                    q.push(nx, ny, nz);
                }
            }
        }
    },
    chanGet(c, x, y, z, isSky) {
        const v = c.light[(x & 15) + ((z & 15) << 4) + (y << 8)];
        return isSky ? v >> 4 : v & 15;
    },
    removeLight(sx, sy, sz, isSky) {
        const rq = [], addq = [];
        const c0 = this.chunkAt(sx, sz);
        const L0 = this.chanGet(c0, sx, sy, sz, isSky);
        if (L0 === 0) return;
        this.chanSet(c0, sx, sy, sz, isSky, 0);
        rq.push(sx, sy, sz, L0);
        let i = 0;
        while (i < rq.length) {
            const x = rq[i++], y = rq[i++], z = rq[i++], L = rq[i++];
            for (let d = 0; d < 6; d++) {
                const dir = DIRS[d];
                const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2];
                if (ny < 0 || ny >= WH) continue;
                const nc = this.chunkAt(nx, nz);
                if (!nc || !nc.generated) continue;
                const nl = this.chanGet(nc, nx, ny, nz, isSky);
                if (nl === 0) continue;
                if (nl < L || (isSky && d === 3 && L === 15 && nl === 15)) {
                    this.chanSet(nc, nx, ny, nz, isSky, 0);
                    nc.dirty = true;
                    rq.push(nx, ny, nz, nl);
                } else if (nl >= L) {
                    addq.push(nx, ny, nz);
                }
            }
        }
        this.spreadLight(addq, isSky);
    },
    chanSet(c, x, y, z, isSky, v) {
        const idx = (x & 15) + ((z & 15) << 4) + (y << 8);
        c.light[idx] = isSky ? ((v << 4) | (c.light[idx] & 15)) : ((c.light[idx] & 0xF0) | v);
        c.dirty = true;
    },

    initChunkLight(c) {
        const ox = c.cx * 16, oz = c.cz * 16;
        const blocks = c.blocks, light = c.light;
        const tops = new Int16Array(256);
        // sky light columns
        for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
            let y = WH - 1;
            for (; y >= 0; y--) {
                const op = OPACITY[blocks[lx + (lz << 4) + (y << 8)]];
                if (op > 0) break;
                light[lx + (lz << 4) + (y << 8)] = 0xF0;
            }
            tops[lx + (lz << 4)] = y;
        }
        const skyQ = [], blkQ = [];
        for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
            const top = tops[lx + (lz << 4)];
            let nmax = -1;
            if (lx > 0) nmax = Math.max(nmax, tops[lx - 1 + (lz << 4)]);
            if (lx < 15) nmax = Math.max(nmax, tops[lx + 1 + (lz << 4)]);
            if (lz > 0) nmax = Math.max(nmax, tops[lx + ((lz - 1) << 4)]);
            if (lz < 15) nmax = Math.max(nmax, tops[lx + ((lz + 1) << 4)]);
            // leaf/semi-opaque cell directly under the open sky
            if (top >= 0 && OPACITY[blocks[lx + (lz << 4) + (top << 8)]] < 15) {
                const idx = lx + (lz << 4) + (top << 8);
                const above = top + 1 < WH ? 15 : 15;
                const v = above - Math.max(1, OPACITY[blocks[idx]]);
                light[idx] = (v << 4) | (light[idx] & 15);
                skyQ.push(ox + lx, top, oz + lz);
            }
            for (let y = Math.min(WH - 1, nmax); y > top; y--) skyQ.push(ox + lx, y, oz + lz);
        }
        for (let y = 0; y <= c.maxY; y++) for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
            const idx = lx + (lz << 4) + (y << 8);
            const e = EMIT[blocks[idx]];
            if (e) { light[idx] = (light[idx] & 0xF0) | e; blkQ.push(ox + lx, y, oz + lz); }
        }
        // pull light across borders from existing neighbours (both ways)
        const borderCells = (cc, side) => {
            const out = [];
            for (let y = 0; y < WH; y++) for (let t = 0; t < 16; t++) {
                let lx, lz;
                if (side === 0) { lx = 15; lz = t; } else if (side === 1) { lx = 0; lz = t; }
                else if (side === 2) { lx = t; lz = 15; } else { lx = t; lz = 0; }
                out.push(cc.cx * 16 + lx, y, cc.cz * 16 + lz);
            }
            return out;
        };
        const nb = [[c.cx - 1, c.cz, 0, 1], [c.cx + 1, c.cz, 1, 0], [c.cx, c.cz - 1, 2, 3], [c.cx, c.cz + 1, 3, 2]];
        c.generated = true;     // make visible to chunkAt / spread before spreading
        for (const [nx, nz, nside, myside] of nb) {
            const n = this.getChunk(nx, nz);
            if (n && n.generated) {
                const cells = borderCells(n, nside);
                for (let i = 0; i < cells.length; i += 3) { skyQ.push(cells[i], cells[i + 1], cells[i + 2]); blkQ.push(cells[i], cells[i + 1], cells[i + 2]); }
                n.dirty = true;
            }
        }
        const mine = [];
        for (let s = 0; s < 4; s++) mine.push(...borderCells(c, s));
        // my own border cells push light outward as well
        for (let i = 0; i < mine.length; i += 3) { skyQ.push(mine[i], mine[i + 1], mine[i + 2]); blkQ.push(mine[i], mine[i + 1], mine[i + 2]); }
        this.spreadLight(skyQ, true);
        this.spreadLight(blkQ, false);
    },

    // -------- block updates ------------------------------------------------------
    neighbourUpdates(x, y, z) {
        for (const d of DIRS) this.checkBlock(x + d[0], y + d[1], z + d[2]);
        this.checkBlock(x, y, z);
    },
    checkBlock(x, y, z) {
        const id = this.getBlock(x, y, z);
        if (!id) return;
        const def = DEFS[id];
        if (def.render === 'cross' || def.key === 'cactus') {
            const below = this.getBlock(x, y - 1, z);
            let ok;
            if (def.key === 'cactus') ok = below === B.sand || below === B.cactus;
            else ok = below === B.grass || below === B.dirt || (def.key !== 'tallgrass' && below === B.sand) || below === B.snow;
            if (!ok) this.breakNaturally(x, y, z);
        } else if (def.render === 'torch') {
            const m = this.getMeta(x, y, z);
            const dv = [[0, -1, 0], [-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1]][m];
            if (!SOLID[this.getBlock(x + dv[0], y + dv[1], z + dv[2])]) this.breakNaturally(x, y, z);
        } else if (def.gravity) {
            const below = this.getBlock(x, y - 1, z);
            if (below === 0 || DEFS[below].replaceable || DEFS[below].liquid) this.scheduleTick(x, y, z, 0.12);
        }
    },
    scheduleTick(x, y, z, delay) { this.pendingTicks.push({ x, y, z, t: delay }); },
    breakNaturally(x, y, z) {
        const id = this.getBlock(x, y, z);
        if (!id) return;
        this.setBlock(x, y, z, 0);
        if (typeof Game !== 'undefined') Game.onBlockBroken(x, y, z, id, null, false);
    },

    tick(dt) {
        for (let i = this.pendingTicks.length - 1; i >= 0; i--) {
            const p = this.pendingTicks[i];
            p.t -= dt;
            if (p.t > 0) continue;
            this.pendingTicks.splice(i, 1);
            const id = this.getBlock(p.x, p.y, p.z);
            if (id && DEFS[id].gravity) {
                const below = this.getBlock(p.x, p.y - 1, p.z);
                if (below === 0 || DEFS[below].replaceable || DEFS[below].liquid) {
                    if (typeof Game !== 'undefined') Game.spawnFallingBlock(p.x, p.y, p.z, id);
                    this.setBlock(p.x, p.y, p.z, 0);
                }
            }
        }
    },

    // -------- chunk streaming -------------------------------------------------------
    ensureGenerated(cx, cz) {
        let c = this.getChunk(cx, cz);
        if (!c) { c = new Chunk(cx, cz); this.chunks.set(this.key(cx, cz), c); }
        if (!c.generated) generateChunk(c);
        return c;
    },

    update(px, pz, budgetMs) {
        const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
        const RD = this.renderDist;
        const t0 = performance.now();
        // 1. generation (ring RD+2), nearest first
        const need = [];
        for (let dx = -RD - 2; dx <= RD + 2; dx++) for (let dz = -RD - 2; dz <= RD + 2; dz++) {
            const d2 = dx * dx + dz * dz;
            if (d2 > (RD + 2) * (RD + 2)) continue;
            const c = this.getChunk(pcx + dx, pcz + dz);
            if (!c || !c.generated) need.push([d2, pcx + dx, pcz + dz]);
        }
        need.sort((a, b) => a[0] - b[0]);
        let genCount = 0;
        for (const [, cx, cz] of need) {
            if (performance.now() - t0 > budgetMs * 0.55 && genCount > 0) break;
            this.ensureGenerated(cx, cz);
            genCount++;
        }
        // 2. meshing
        const todo = [];
        for (let dx = -RD; dx <= RD; dx++) for (let dz = -RD; dz <= RD; dz++) {
            const d2 = dx * dx + dz * dz;
            if (d2 > RD * RD) continue;
            const c = this.getChunk(pcx + dx, pcz + dz);
            if (!c || !c.generated) continue;
            if (!c.meshed || c.dirty) {
                if (!this.neighboursReady(c)) continue;
                todo.push([c.urgent ? -1 : d2, c]);
            }
        }
        todo.sort((a, b) => a[0] - b[0]);
        let meshed = 0;
        for (const [pri, c] of todo) {
            if (pri >= 0 && performance.now() - t0 > budgetMs && (meshed > 0 || genCount > 0)) break;
            buildChunkMesh(c);
            meshed++;
        }
        // 3. unload far chunks
        if (this.chunks.size > (2 * RD + 7) * (2 * RD + 7) * 0.9) {
            for (const [k, c] of this.chunks) {
                const dx = c.cx - pcx, dz = c.cz - pcz;
                if (dx * dx + dz * dz > (RD + 4) * (RD + 4)) {
                    if (c.modified && this.onUnloadModified) this.onUnloadModified(c);
                    this.disposeChunkMeshes(c);
                    this.chunks.delete(k);
                    if (this._lastKey === k) { this._lastKey = null; this._lastChunk = null; }
                }
            }
        }
        // visibility: only show meshes inside the render circle
        this.chunks.forEach(c => {
            const dx = c.cx - pcx, dz = c.cz - pcz;
            const vis = dx * dx + dz * dz <= (RD + 0.5) * (RD + 0.5);
            if (c.mesh) c.mesh.visible = vis;
            if (c.waterMesh) c.waterMesh.visible = vis;
        });
        return { gen: genCount, mesh: meshed, pending: need.length + todo.length };
    },
    neighboursReady(c) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dz) continue;
            const n = this.getChunk(c.cx + dx, c.cz + dz);
            if (!n || !n.generated) return false;
        }
        return true;
    },
    disposeChunkMeshes(c) {
        if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
        if (c.waterMesh) { this.scene.remove(c.waterMesh); c.waterMesh.geometry.dispose(); c.waterMesh = null; }
    }
};

// ---------------------------------------------------------------------------
// Terrain generation
// ---------------------------------------------------------------------------
const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DESERT: 4, TUNDRA: 5, MOUNTAINS: 6 };
const colCache = new Map();

function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function columnInfo(x, z) {
    const k = x * 65536 + z;
    const hit = colCache.get(k);
    if (hit) return hit;
    const P = world.perlin;
    const cont = P.fbm2(x / 260 + 11.3, z / 260 - 7.1, 3) * 2.0 + 0.3;
    const hills = P.fbm2(x / 70 + 100, z / 70 + 100, 4);
    const temp = P.fbm2(x / 420 + 500, z / 420 + 500, 2) * 2.0;
    const humid = P.fbm2(x / 360 - 500, z / 360 - 500, 2) * 2.0;
    const mnt = P.fbm2(x / 170 + 900, z / 170 - 900, 3) * 2.0;
    let base;
    if (cont < -0.12) base = SEA - 2 + (cont + 0.12) * 20;
    else base = SEA + 1.5 + (cont + 0.12) * 17;
    base += hills * (cont < -0.12 ? 2.5 : 5.5);
    const m = Math.max(0, mnt - 0.2);
    const land = smoothstep(-0.05, 0.3, cont);
    base += m * m * 70 * land + m * 14 * land;
    let h = Math.max(2, Math.min(WH - 8, Math.floor(base)));
    let biome;
    if (h < SEA) biome = BIOME.OCEAN;
    else if (m > 0.22 && land > 0.5) biome = BIOME.MOUNTAINS;
    else if (h <= SEA + 1) biome = BIOME.BEACH;
    else if (temp > 0.28 && humid < 0.2) biome = BIOME.DESERT;
    else if (temp < -0.3) biome = BIOME.TUNDRA;
    else if (humid > 0.14) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    const info = { h, biome, temp, humid };
    if (colCache.size > 40000) colCache.clear();
    colCache.set(k, info);
    return info;
}

function oreVein(c, rnd, id, count, size, minY, maxY) {
    for (let n = 0; n < count; n++) {
        let x = Math.floor(rnd() * 16), z = Math.floor(rnd() * 16), y = minY + Math.floor(rnd() * (maxY - minY));
        const sz = Math.max(2, Math.floor(size * (0.6 + rnd() * 0.6)));
        for (let k = 0; k < sz; k++) {
            if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH) {
                const idx = x + (z << 4) + (y << 8);
                const b = c.blocks[idx];
                if (b === B.stone || b === B.granite || b === B.diorite || b === B.andesite) c.blocks[idx] = id;
            }
            x += Math.floor(rnd() * 3) - 1; y += Math.floor(rnd() * 3) - 1; z += Math.floor(rnd() * 3) - 1;
        }
    }
}

function placeTree(c, tx, tz, groundY, kind, h) {
    const logId = kind === 'birch' ? B.birch_log : B.log;
    const leafId = kind === 'birch' ? B.birch_leaves : B.leaves;
    const ox = c.cx * 16, oz = c.cz * 16;
    const setIf = (wx, wy, wz, id, force) => {
        const lx = wx - ox, lz = wz - oz;
        if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || wy < 0 || wy >= WH) return;
        const idx = lx + (lz << 4) + (wy << 8);
        const cur = c.blocks[idx];
        if (cur === 0 || cur === B.tallgrass || (force && (cur === leafId || cur === B.leaves || cur === B.birch_leaves))) {
            c.blocks[idx] = id; if (wy > c.maxY) c.maxY = wy;
        }
    };
    const top = groundY + h;
    for (let ly = top - 2; ly <= top + 1; ly++) {
        const r = ly >= top ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r) {
                if (r === 1 || hash3(tx + dx, ly, tz + dz, world.seed + 3) < 0.5) continue;
                if (ly === top + 1) continue;
            }
            setIf(tx + dx, ly, tz + dz, leafId);
        }
    }
    for (let y = groundY + 1; y <= top; y++) setIf(tx, y, tz, logId, true);
}

function generateChunk(c) {
    const P = world.perlin;
    const ox = c.cx * 16, oz = c.cz * 16;
    const blocks = c.blocks;
    const saved = world.saved.get(world.key(c.cx, c.cz));
    if (saved) {
        blocks.set(saved.blocks);
        saved.meta.forEach(([i, v]) => c.meta.set(i, v));
        c.modified = true;
        let my = 0;
        for (let y = WH - 1; y >= 0 && !my; y--) for (let i = 0; i < 256; i++) if (blocks[i + (y << 8)]) { my = y; break; }
        c.maxY = my;
        world.initChunkLight(c);
        c.generated = true;
        c.dirty = true;
        return;
    }
    const rnd = mulberry32(hash2(c.cx, c.cz, world.seed) * 4294967296);
    const infos = new Array(256);
    let maxY = 0;

    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const x = ox + lx, z = oz + lz;
        const info = columnInfo(x, z);
        infos[lx + (lz << 4)] = info;
        const top = info.h;
        const biome = info.biome;
        if (top > maxY) maxY = top;
        for (let y = 0; y <= top; y++) {
            let id = B.stone;
            const depth = top - y;
            if (y === 0) id = B.bedrock;
            else if (y <= 3 && hash3(x, y, z, world.seed) < (4 - y) * 0.2) id = B.bedrock;
            else if (depth > 0) {
                // underground: ore-less stone variants
                if (y < top - 4) {
                    const v = P.noise3(x * 0.045 + 33, y * 0.06, z * 0.045 - 17);
                    if (v > 0.5) id = B.granite;
                    else if (v < -0.5) id = B.diorite;
                    else {
                        const v2 = world.perlin2.noise3(x * 0.05 - 8, y * 0.07, z * 0.05 + 44);
                        if (v2 > 0.52) id = B.andesite;
                    }
                }
                if (biome === BIOME.OCEAN || biome === BIOME.BEACH) { if (depth <= 3) id = (top < SEA - 6 && P.noise2(x * 0.1, z * 0.1) > 0.15) ? B.gravel : B.sand; }
                else if (biome === BIOME.DESERT) { if (depth <= 3) id = B.sand; else if (depth <= 7) id = B.sandstone; }
                else if (biome === BIOME.MOUNTAINS) { if (top < 78 && depth <= 3) id = depth <= 0 ? B.grass : B.dirt; }
                else { if (depth <= 3) id = B.dirt; }
            } else {
                // surface block
                if (biome === BIOME.OCEAN || biome === BIOME.BEACH) id = (top < SEA - 6 && P.noise2(x * 0.1, z * 0.1) > 0.15) ? B.gravel : B.sand;
                else if (biome === BIOME.DESERT) id = B.sand;
                else if (biome === BIOME.TUNDRA) id = B.snow;
                else if (biome === BIOME.MOUNTAINS) id = top > 92 ? B.snow : (top < 78 ? B.grass : B.stone);
                else id = top < SEA ? B.dirt : B.grass;
            }
            // dirt under snow in tundra
            if (biome === BIOME.TUNDRA && depth > 0 && depth <= 3) id = B.dirt;
            blocks[lx + (lz << 4) + (y << 8)] = id;
        }
        // caves
        let carveTop = top - 3;
        if (top > SEA + 2 && P.noise2(x * 0.02 + 70, z * 0.02 - 40) > 0.38) carveTop = top + 1;
        for (let y = 5; y <= carveTop; y++) {
            const a = P.noise3(x * 0.034, y * 0.05, z * 0.034);
            let carve = false;
            if (Math.abs(a) < 0.085) {
                const b2 = world.perlin2.noise3(x * 0.034 + 57.3, y * 0.05 + 13.1, z * 0.034 - 31.7);
                if (Math.abs(b2) < 0.085) carve = true;
            }
            if (!carve && y < 48) {
                const cav = world.perlin2.noise3(x * 0.016, y * 0.03, z * 0.016 + 9.9);
                if (cav > 0.56 + (y > 30 ? (y - 30) * 0.012 : 0)) carve = true;
            }
            if (carve) {
                const idx = lx + (lz << 4) + (y << 8);
                const cur = blocks[idx];
                if (cur !== B.bedrock && cur !== B.water) blocks[idx] = y <= 8 ? B.lava : 0;
            }
        }
        // water fill
        for (let y = top + 1; y <= SEA; y++) blocks[lx + (lz << 4) + (y << 8)] = B.water;
        if (SEA > maxY) maxY = SEA;
    }

    // ores
    oreVein(c, rnd, B.coal_ore, 22, 12, 6, 96);
    oreVein(c, rnd, B.iron_ore, 16, 8, 5, 64);
    oreVein(c, rnd, B.gold_ore, 3, 7, 5, 30);
    oreVein(c, rnd, B.diamond_ore, 3, 6, 3, 16);

    // trees (including those rooted in neighbouring chunks)
    for (let tz = oz - 3; tz < oz + 19; tz++) for (let tx = ox - 3; tx < ox + 19; tx++) {
        const hv = hash2(tx, tz, world.seed + 11);
        if (hv > 0.04) continue;
        const info = columnInfo(tx, tz);
        let dens = 0;
        if (info.biome === BIOME.FOREST) dens = 0.03;
        else if (info.biome === BIOME.PLAINS) dens = 0.0035;
        else if (info.biome === BIOME.MOUNTAINS && info.h < 78) dens = 0.004;
        if (hv >= dens || info.h <= SEA + 1) continue;
        const kind = (info.biome === BIOME.FOREST && hash2(tx, tz, world.seed + 12) < 0.3) ? 'birch' : 'oak';
        const th = 4 + Math.floor(hash2(tx, tz, world.seed + 13) * 3);
        placeTree(c, tx, tz, info.h, kind, th);
        if (info.h + th + 1 > maxY) maxY = info.h + th + 1;
    }
    // ground cover
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const info = infos[lx + (lz << 4)];
        const x = ox + lx, z = oz + lz;
        const y = info.h;
        const above = lx + (lz << 4) + ((y + 1) << 8);
        if (blocks[above] !== 0) continue;
        const surf = blocks[lx + (lz << 4) + (y << 8)];
        const r = hash2(x, z, world.seed + 21);
        if (surf === B.grass && info.h > SEA) {
            const gd = info.biome === BIOME.FOREST ? 0.1 : (info.biome === BIOME.PLAINS ? 0.2 : 0.05);
            if (r < gd) blocks[above] = B.tallgrass;
            else if (r < gd + 0.012) blocks[above] = B.dandelion;
            else if (r < gd + 0.022) blocks[above] = B.poppy;
        } else if (surf === B.sand && info.biome === BIOME.DESERT && r < 0.006) {
            const ch = 1 + Math.floor(hash2(x, z, world.seed + 22) * 3);
            for (let k = 1; k <= ch; k++) blocks[lx + (lz << 4) + ((y + k) << 8)] = B.cactus;
            maxY = Math.max(maxY, y + ch);
        }
    }
    c.maxY = Math.min(WH - 1, maxY + 2);

    world.initChunkLight(c);
    c.generated = true;
    c.dirty = true;
    if (typeof Game !== 'undefined' && Game.onChunkGenerated) Game.onChunkGenerated(c, infos);
}

// ---------------------------------------------------------------------------
// Meshing
// ---------------------------------------------------------------------------
const FACE = [
    { n: [1, 0, 0],  c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.8 },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.8 },
    { n: [0, 1, 0],  c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
    { n: [0, 0, 1],  c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.9 },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.9 }
];
// tangent axes + corner signs per face (for smooth light / AO sampling)
FACE.forEach(f => {
    f.ax = [0, 1, 2].filter(i => f.n[i] === 0);
    f.s = f.c.map(cc => [cc[f.ax[0]] ? 1 : -1, cc[f.ax[1]] ? 1 : -1]);
    f.e0 = [0, 0, 0]; f.e0[f.ax[0]] = 1; f.e1 = [0, 0, 0]; f.e1[f.ax[1]] = 1;
});
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
const FRONT_FACE = [4, 0, 5, 1];   // meta dir -> face index

class MeshBuf {
    constructor() { this.pos = []; this.uv = []; this.shade = []; this.light = []; this.idx = []; this.n = 0; }
    quad(v, u0, v0, u1, v1, sh, lt, flip) {
        for (let i = 0; i < 4; i++) { this.pos.push(v[i][0], v[i][1], v[i][2]); this.shade.push(sh[i]); this.light.push(lt[i][0], lt[i][1]); }
        this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        const b = this.n;
        if (flip) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
        else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        this.n += 4;
    }
    toMesh(material) {
        if (this.n === 0) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('aShade', new THREE.Float32BufferAttribute(this.shade, 1));
        g.setAttribute('aLight', new THREE.Float32BufferAttribute(this.light, 2));
        g.setIndex(this.idx);
        return new THREE.Mesh(g, material);
    }
}

const VERTS = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], SHADES = [1, 1, 1, 1], LIGHTS = [[0, 0], [0, 0], [0, 0], [0, 0]], AO4 = [1, 1, 1, 1];
function buildChunkMesh(c) {
    const solid = new MeshBuf(), water = new MeshBuf();
    const W = world;
    const ox = c.cx * 16, oz = c.cz * 16;
    const maxY = Math.min(WH - 1, c.maxY + 1);
    const S = 18, H = maxY + 3;
    // padded snapshot (x,z in -1..16, y in -1..maxY+1) so the hot loops never touch the chunk map
    const pb = new Uint8Array(S * S * H), pl = new Uint8Array(S * S * H);
    for (let yy = 0; yy < H; yy++) {
        const y = yy - 1;
        for (let zz = 0; zz < S; zz++) for (let xx = 0; xx < S; xx++) {
            const i = xx + S * (zz + S * yy);
            if (y < 0) { pb[i] = 1; pl[i] = 0; } else { pl[i] = 0xF0; }
        }
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nc = W.getChunk(c.cx + dx, c.cz + dz);
        if (!nc || !nc.generated) continue;
        const x0 = dx < 0 ? 15 : 0, x1 = dx > 0 ? 0 : (dx < 0 ? 15 : 15);
        const z0 = dz < 0 ? 15 : 0, z1 = dz > 0 ? 0 : (dz < 0 ? 15 : 15);
        for (let y = 0; y <= maxY + 1 && y < WH; y++) {
            for (let lz = z0; lz <= z1; lz++) for (let lx = x0; lx <= x1; lx++) {
                const si = lx + (lz << 4) + (y << 8);
                const di = (lx + dx * 16 + 1) + S * ((lz + dz * 16 + 1) + S * (y + 1));
                pb[di] = nc.blocks[si]; pl[di] = nc.light[si];
            }
        }
    }
    const blocks = c.blocks;
    const bAt = (x, y, z) => pb[(x + 1) + S * ((z + 1) + S * (y + 1))];
    const lAt = (x, y, z) => pl[(x + 1) + S * ((z + 1) + S * (y + 1))];

    for (let y = 0; y <= maxY; y++) {
        for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
            const idx = lx + (lz << 4) + (y << 8);
            const id = blocks[idx];
            if (id === 0) continue;
            const def = DEFS[id];
            const render = def.render;
            const x = ox + lx, z = oz + lz;

            if (render === 'cross') {
                const l = lAt(lx, y, lz);
                const t = tileUV(def.faceTiles[4]);
                const lt = [(l >> 4) / 15, (l & 15) / 15]; const L = [lt, lt, lt, lt];
                const sh = [0.92, 0.92, 0.92, 0.92];
                const a = 0.1, b2 = 0.9;
                const quads = [
                    [[lx + a, y, lz + a], [lx + b2, y, lz + b2], [lx + b2, y + 1, lz + b2], [lx + a, y + 1, lz + a]],
                    [[lx + b2, y, lz + b2], [lx + a, y, lz + a], [lx + a, y + 1, lz + a], [lx + b2, y + 1, lz + b2]],
                    [[lx + a, y, lz + b2], [lx + b2, y, lz + a], [lx + b2, y + 1, lz + a], [lx + a, y + 1, lz + b2]],
                    [[lx + b2, y, lz + a], [lx + a, y, lz + b2], [lx + a, y + 1, lz + b2], [lx + b2, y + 1, lz + a]]
                ];
                quads.forEach(q => solid.quad(q, t.u0, t.v0, t.u1, t.v1, sh, L, false));
                continue;
            }
            if (render === 'torch') {
                meshTorch(solid, def, x, y, z, ox, oz, c.meta.get(idx) || 0, lAt(lx, y, lz));
                continue;
            }

            const isLiquid = def.liquid;
            const target = (isLiquid && id === B.water) ? water : solid;
            const aboveId = isLiquid ? bAt(lx, y + 1, lz) : 0;
            const meta = (def.frontTile != null) ? (c.meta.get(idx) || 0) : 0;

            for (let f = 0; f < 6; f++) {
                const F = FACE[f];
                const nx = lx + F.n[0], ny = y + F.n[1], nz = lz + F.n[2];
                if (ny < 0) continue;
                const nid = bAt(nx, ny, nz);

                if (isLiquid) {
                    if (nid === id) continue;
                    if (nid && OPAQUE[nid]) continue;
                } else if (render === 'cactus') {
                    if ((f === 2 || f === 3) && nid === id) continue;
                } else if (render === 'leaves' || render === 'glass') {
                    if (nid && (OPAQUE[nid] || DEFS[nid].render === render)) continue;
                } else {
                    if (nid && OPAQUE[nid]) continue;
                }

                let ti = def.faceTiles[f];
                if (def.frontTile != null && f === FRONT_FACE[meta & 3]) ti = def.frontTile;
                const T = tileUV(ti);

                const verts = VERTS, sh = SHADES, lt = LIGHTS;
                const ao4 = AO4;
                const baseLight = lAt(nx, ny, nz);
                for (let k = 0; k < 4; k++) {
                    const cc = F.c[k];
                    let px = cc[0], py = cc[1], pz = cc[2];
                    if (isLiquid) {
                        if (py === 1 && aboveId !== id) py = 0.875;
                    } else if (render === 'cactus' && F.n[1] === 0) {
                        if (F.n[0] !== 0) px = F.n[0] > 0 ? 15 / 16 : 1 / 16;
                        if (F.n[2] !== 0) pz = F.n[2] > 0 ? 15 / 16 : 1 / 16;
                    }
                    const vv = verts[k]; vv[0] = lx + px; vv[1] = y + py; vv[2] = lz + pz;

                    if (isLiquid || def.light >= 14) {
                        ao4[k] = 1;
                        if (def.key === 'lava') { lt[k][0] = 1; lt[k][1] = 1; sh[k] = 1; }
                        else if (def.light) { lt[k][0] = (baseLight >> 4) / 15; lt[k][1] = 1; sh[k] = F.shade; }
                        else { lt[k][0] = (baseLight >> 4) / 15; lt[k][1] = (baseLight & 15) / 15; sh[k] = F.shade; }
                    } else {
                        const s1 = F.s[k][0], s2 = F.s[k][1], e0 = F.e0, e1 = F.e1;
                        const p1x = nx + s1 * e0[0], p1y = ny + s1 * e0[1], p1z = nz + s1 * e0[2];
                        const p2x = nx + s2 * e1[0], p2y = ny + s2 * e1[1], p2z = nz + s2 * e1[2];
                        const p3x = p1x + s2 * e1[0], p3y = p1y + s2 * e1[1], p3z = p1z + s2 * e1[2];
                        const o1 = OPAQUE[bAt(p1x, p1y, p1z)], o2 = OPAQUE[bAt(p2x, p2y, p2z)];
                        const o3 = OPAQUE[bAt(p3x, p3y, p3z)];
                        let sky = baseLight >> 4, blk = baseLight & 15, n = 1;
                        if (!o1) { const l = lAt(p1x, p1y, p1z); sky += l >> 4; blk += l & 15; n++; }
                        if (!o2) { const l = lAt(p2x, p2y, p2z); sky += l >> 4; blk += l & 15; n++; }
                        if (!(o1 && o2) && !o3) { const l = lAt(p3x, p3y, p3z); sky += l >> 4; blk += l & 15; n++; }
                        lt[k][0] = sky / n / 15; lt[k][1] = blk / n / 15;
                        const ao = (o1 && o2) ? 0 : 3 - (o1 + o2 + o3);
                        ao4[k] = AO_CURVE[ao];
                        sh[k] = F.shade * AO_CURVE[ao];
                    }
                }
                const flip = ao4[0] + ao4[2] < ao4[1] + ao4[3];
                target.quad(verts, T.u0, T.v0, T.u1, T.v1, sh, lt, flip);
            }
        }
    }

    // swap meshes
    W.disposeChunkMeshes(c);
    c.mesh = solid.toMesh(solidMaterial);
    c.waterMesh = water.toMesh(waterMaterial);
    for (const m of [c.mesh, c.waterMesh]) {
        if (!m) continue;
        m.position.set(ox, 0, oz);
        m.frustumCulled = true;
        W.scene.add(m);
    }
    if (c.waterMesh) c.waterMesh.renderOrder = 2;
    c.meshed = true; c.dirty = false; c.urgent = false;
}

function meshTorch(buf, def, x, y, z, ox, oz, meta, l) {
    const lt = [(l >> 4) / 15, Math.max(l & 15, 14) / 15];
    const L = [lt, lt, lt, lt];
    // meta 0: standing; 1..4: wall attached to -x,+x,-z,+z neighbour
    const wall = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]][meta];
    const h = 0.625, half = 0.0625;
    const baseY = meta ? 0.2 : 0;
    const bx = 0.5 + wall[0] * 0.34, bz = 0.5 + wall[1] * 0.34;
    const tx = 0.5 + wall[0] * 0.06, tz = 0.5 + wall[1] * 0.06;
    const B_ = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const bot = B_.map(([a, b]) => [bx + a * half, baseY, bz + b * half]);
    const top = B_.map(([a, b]) => [tx + a * half, baseY + h, tz + b * half]);
    const tp = tileUV(def.faceTiles[4]);
    const du = (tp.u1 - tp.u0) / 16, dv = (tp.v1 - tp.v0) / 16;
    const su0 = tp.u0 + du * 7, su1 = tp.u0 + du * 9;
    const sv0 = tp.v0, sv1 = tp.v0 + dv * 10;     // 10px tall stick (rows 6..15)
    const toLocal = p => [p[0] + x - ox, p[1] + y, p[2] + z - oz];
    const sides = [[0, 1], [1, 2], [2, 3], [3, 0]];
    const sh = [0.9, 0.9, 0.9, 0.9];
    sides.forEach(([a, b]) => {
        buf.quad([toLocal(bot[a]), toLocal(bot[b]), toLocal(top[b]), toLocal(top[a])], su0, sv0, su1, sv1, sh, L, false);
    });
    // flame top
    buf.quad([toLocal(top[3]), toLocal(top[2]), toLocal(top[1]), toLocal(top[0])],
        tp.u0 + du * 7, tp.v0 + dv * 8, tp.u0 + du * 9, tp.v0 + dv * 10, [1, 1, 1, 1], L, false);
}
