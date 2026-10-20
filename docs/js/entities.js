// ============================================================================
// entities.js — physics, mobs (model + AI), item drops, TNT, arrows,
//               falling blocks, particles, explosions
// ============================================================================
'use strict';

const GRAVITY = 32;

// ---------------------------------------------------------------------------
// Shared physics (axis-aligned box vs voxel grid)
// ---------------------------------------------------------------------------
function collides(x, y, z, w, h) {
    const hw = w / 2;
    const x0 = Math.floor(x - hw), x1 = Math.floor(x + hw - 1e-7);
    const y0 = Math.floor(y), y1 = Math.floor(y + h - 1e-7);
    const z0 = Math.floor(z - hw), z1 = Math.floor(z + hw - 1e-7);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) for (let zz = z0; zz <= z1; zz++) {
        if (world.solidAt(xx, yy, zz)) return true;
    }
    return false;
}
function moveAxis(e, axis, delta) {
    if (delta === 0) return;
    const steps = Math.ceil(Math.abs(delta) / 0.4);
    const sd = delta / steps;
    const p = e.pos;
    for (let i = 0; i < steps; i++) {
        const p0 = p[axis];
        p[axis] = p0 + sd;
        if (collides(p.x, p.y, p.z, e.w, e.h)) {
            let lo = 0, hi = 1;
            for (let k = 0; k < 7; k++) {
                const mid = (lo + hi) / 2;
                p[axis] = p0 + sd * mid;
                if (collides(p.x, p.y, p.z, e.w, e.h)) hi = mid; else lo = mid;
            }
            p[axis] = p0 + sd * lo;
            e.vel[axis] = 0;
            if (axis === 'y') { if (sd < 0) e.onGround = true; else e.hitHead = true; }
            else if (axis === 'x') e.hitX = true; else e.hitZ = true;
            return;
        }
    }
}
function moveBody(e, dt) {
    e.onGround = false; e.hitX = false; e.hitZ = false; e.hitHead = false;
    if (collides(e.pos.x, e.pos.y, e.pos.z, e.w, e.h)) {      // stuck in a block: pop upwards
        for (let k = 0; k < 6 && collides(e.pos.x, e.pos.y, e.pos.z, e.w, e.h); k++) e.pos.y += 0.25;
    }
    moveAxis(e, 'y', e.vel.y * dt);
    moveAxis(e, 'x', e.vel.x * dt);
    moveAxis(e, 'z', e.vel.z * dt);
}
function liquidAt(x, y, z) {
    const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return id === B.water ? 1 : (id === B.lava ? 2 : 0);
}
function brightnessAt(x, y, z) {
    const L = Math.min(1, world.lightLevel(x, y, z) / 15);
    return Math.max(0.12, L / (4 - 3 * L));
}
function angleLerp(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * Math.min(1, t);
}

// ---------------------------------------------------------------------------
// Particles (billboarded textured quads, one draw call)
// ---------------------------------------------------------------------------
const Particles = {
    MAX: 700, list: [], mesh: null,
    init(scene) {
        const N = this.MAX;
        this.pos = new Float32Array(N * 12); this.uv = new Float32Array(N * 8); this.col = new Float32Array(N * 16);
        const idx = new Uint16Array(N * 6);
        for (let i = 0; i < N; i++) { const b = i * 4; idx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.setDrawRange(0, 0);
        const mat = new THREE.ShaderMaterial({
            uniforms: { uMap: { value: atlasTexture } }, transparent: true, depthWrite: false,
            vertexShader: 'attribute vec4 color; varying vec2 vUv; varying vec4 vC; void main(){ vUv=uv; vC=color; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
            fragmentShader: 'uniform sampler2D uMap; varying vec2 vUv; varying vec4 vC; void main(){ vec4 t=texture2D(uMap,vUv); if(t.a<0.5) discard; gl_FragColor=vec4(t.rgb*vC.rgb, vC.a); }'
        });
        this.mesh = new THREE.Mesh(g, mat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 5;
        scene.add(this.mesh);
    },
    add(p) {
        if (this.list.length >= this.MAX) this.list.shift();
        this.list.push(p);
    },
    blockBurst(x, y, z, id, count = 14) {
        const def = DEFS[id]; if (!def) return;
        const ti = def.faceTiles[0];
        const T = tileUV(ti);
        const br = brightnessAt(x, y, z);
        for (let i = 0; i < count; i++) {
            const ou = Math.floor(Math.random() * 3) / 4, ov = Math.floor(Math.random() * 3) / 4;
            const du = (T.u1 - T.u0), dv = (T.v1 - T.v0);
            this.add({
                x: x + 0.15 + Math.random() * 0.7, y: y + 0.15 + Math.random() * 0.7, z: z + 0.15 + Math.random() * 0.7,
                vx: (Math.random() - 0.5) * 3.2, vy: Math.random() * 3 + 0.6, vz: (Math.random() - 0.5) * 3.2,
                life: 0.5 + Math.random() * 0.6, size: 0.05 + Math.random() * 0.06, grav: 1, fade: false,
                u0: T.u0 + du * ou, v0: T.v0 + dv * ov, u1: T.u0 + du * (ou + 0.25), v1: T.v0 + dv * (ov + 0.25),
                r: br, g: br, b: br, a: 1
            });
        }
    },
    puff(x, y, z, count, color, size, speed, life, grav = -0.2, fire = false) {
        const T = tileUV('white');
        for (let i = 0; i < count; i++) {
            const sh = 0.75 + Math.random() * 0.25;
            this.add({
                x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.6, z: z + (Math.random() - 0.5) * 0.6,
                vx: (Math.random() - 0.5) * speed, vy: (Math.random() - 0.3) * speed, vz: (Math.random() - 0.5) * speed,
                life: life * (0.6 + Math.random() * 0.6), size: size * (0.7 + Math.random() * 0.6), grav, fade: true,
                u0: T.u0, v0: T.v0, u1: T.u1, v1: T.v1,
                r: color[0] * sh, g: color[1] * sh, b: color[2] * sh, a: 0.85, shrink: fire
            });
        }
    },
    update(dt, camera) {
        const L = this.list;
        const cr = new THREE.Vector3(), cu = new THREE.Vector3();
        camera.matrixWorld.extractBasis(cr, cu, new THREE.Vector3());
        let n = 0;
        for (let i = L.length - 1; i >= 0; i--) {
            const p = L[i];
            p.life -= dt;
            if (p.life <= 0) { L.splice(i, 1); continue; }
            p.vy -= GRAVITY * 0.5 * p.grav * dt;
            const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
            if (!world.solidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) { p.x = nx; p.y = ny; p.z = nz; }
            else { p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; }
            p.vx *= (1 - 1.5 * dt); p.vz *= (1 - 1.5 * dt);
        }
        for (let i = 0; i < L.length && n < this.MAX; i++, n++) {
            const p = L[i];
            let s = p.size;
            let a = p.a;
            if (p.fade) a *= Math.min(1, p.life * 2);
            if (p.shrink) s *= Math.min(1, p.life * 2);
            const rx = cr.x * s, ry = cr.y * s, rz = cr.z * s, ux = cu.x * s, uy = cu.y * s, uz = cu.z * s;
            const o = n * 12;
            this.pos[o] = p.x - rx - ux; this.pos[o + 1] = p.y - ry - uy; this.pos[o + 2] = p.z - rz - uz;
            this.pos[o + 3] = p.x + rx - ux; this.pos[o + 4] = p.y + ry - uy; this.pos[o + 5] = p.z + rz - uz;
            this.pos[o + 6] = p.x + rx + ux; this.pos[o + 7] = p.y + ry + uy; this.pos[o + 8] = p.z + rz + uz;
            this.pos[o + 9] = p.x - rx + ux; this.pos[o + 10] = p.y - ry + uy; this.pos[o + 11] = p.z - rz + uz;
            const uo = n * 8;
            this.uv[uo] = p.u0; this.uv[uo + 1] = p.v0; this.uv[uo + 2] = p.u1; this.uv[uo + 3] = p.v0;
            this.uv[uo + 4] = p.u1; this.uv[uo + 5] = p.v1; this.uv[uo + 6] = p.u0; this.uv[uo + 7] = p.v1;
            const co = n * 16;
            for (let k = 0; k < 4; k++) { this.col[co + k * 4] = p.r; this.col[co + k * 4 + 1] = p.g; this.col[co + k * 4 + 2] = p.b; this.col[co + k * 4 + 3] = a; }
        }
        const g = this.mesh.geometry;
        g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true; g.attributes.color.needsUpdate = true;
        g.setDrawRange(0, n * 6);
    }
};

// ---------------------------------------------------------------------------
// Item / block meshes (used for drops, falling blocks, TNT and the held item)
// ---------------------------------------------------------------------------
const extrudeCache = {};
function faceShadeFromNormal(nx, ny, nz) {
    if (ny > 0.5) return 1.0; if (ny < -0.5) return 0.55;
    if (Math.abs(nz) > 0.5) return 0.85; return 0.7;
}
function bakeShade(g) {
    const n = g.attributes.normal, c = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
        const s = faceShadeFromNormal(n.getX(i), n.getY(i), n.getZ(i));
        c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
}
function extrudeCanvas(cv, thick = 1) {
    const data = cv.getContext('2d').getImageData(0, 0, 16, 16).data;
    const pos = [], col = [], idx = [];
    const solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && data[(y * 16 + x) * 4 + 3] > 128;
    let n = 0;
    const q = (a, b, c2, d, r, g, bl, s) => {
        pos.push(...a, ...b, ...c2, ...d);
        for (let i = 0; i < 4; i++) col.push(r * s / 255, g * s / 255, bl * s / 255);
        idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
    };
    const T = thick / 16 / 2;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (!solid(x, y)) continue;
        const i = (y * 16 + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
        const x0 = x / 16 - 0.5, x1 = (x + 1) / 16 - 0.5, y0 = 0.5 - (y + 1) / 16, y1 = 0.5 - y / 16;
        q([x0, y0, T], [x1, y0, T], [x1, y1, T], [x0, y1, T], r, g, b, 1);                  // front
        q([x1, y0, -T], [x0, y0, -T], [x0, y1, -T], [x1, y1, -T], r, g, b, 0.85);           // back
        if (!solid(x - 1, y)) q([x0, y0, -T], [x0, y0, T], [x0, y1, T], [x0, y1, -T], r, g, b, 0.7);
        if (!solid(x + 1, y)) q([x1, y0, T], [x1, y0, -T], [x1, y1, -T], [x1, y1, T], r, g, b, 0.7);
        if (!solid(x, y - 1)) q([x0, y1, T], [x1, y1, T], [x1, y1, -T], [x0, y1, -T], r, g, b, 1.0);
        if (!solid(x, y + 1)) q([x0, y0, -T], [x1, y0, -T], [x1, y0, T], [x0, y0, T], r, g, b, 0.55);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return geo;
}
function tileCanvas(ti) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    c.getContext('2d').drawImage(atlasCanvas, (ti % ATLAS_COLS) * 16, Math.floor(ti / ATLAS_COLS) * 16, 16, 16, 0, 0, 16, 16);
    return c;
}
function itemSpriteCanvas(id) {
    const d = DEFS[id];
    if (!d) return null;
    if (!d.isBlock) return spriteCanvas(d.icon);
    if (d.render === 'cross' || d.render === 'torch') return tileCanvas(d.faceTiles[4]);
    return null;
}
function cubeGeometryFor(def, size) {
    const g = new THREE.BoxGeometry(size, size, size);
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
        const T = tileUV(def.faceTiles[f]);
        const b = f * 4;
        uv.setXY(b, T.u0, T.v1); uv.setXY(b + 1, T.u1, T.v1); uv.setXY(b + 2, T.u0, T.v0); uv.setXY(b + 3, T.u1, T.v0);
    }
    return bakeShade(g);
}
// returns { mesh, flat }
function createItemMesh(id, size = 0.3, thick = 1) {
    const def = DEFS[id];
    if (!def) return null;
    const cv = itemSpriteCanvas(id);
    if (cv) {
        const key = id + ':' + thick;
        if (!extrudeCache[key]) extrudeCache[key] = extrudeCanvas(cv, thick);
        const m = new THREE.Mesh(extrudeCache[key], new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        m.scale.setScalar(size * 1.6);
        return { mesh: m, flat: true };
    }
    const m = new THREE.Mesh(cubeGeometryFor(def, size), new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true }));
    return { mesh: m, flat: false };
}

// ---------------------------------------------------------------------------
// Dropped items
// ---------------------------------------------------------------------------
const Items = {
    list: [],
    spawn(x, y, z, id, count = 1, dmg = 0, vel = null) {
        if (!id || count <= 0) return;
        const it = createItemMesh(id, 0.28, 1.4);
        if (!it) return;
        const e = {
            kind: 'item', id, count, dmg, pos: { x, y, z }, vel: vel ? { x: vel.x, y: vel.y, z: vel.z } : { x: (Math.random() - 0.5) * 2.2, y: 3.5 + Math.random() * 1.5, z: (Math.random() - 0.5) * 2.2 },
            w: 0.25, h: 0.25, age: 0, delay: 0.5, mesh: it.mesh, flat: it.flat, spin: Math.random() * 6
        };
        Game.scene.add(it.mesh);
        this.list.push(e);
        return e;
    },
    update(dt) {
        const pl = Game.player;
        for (let i = this.list.length - 1; i >= 0; i--) {
            const e = this.list[i];
            e.age += dt; e.spin += dt * 1.8;
            if (e.age > 300 || e.pos.y < -10) { this.remove(i); continue; }
            const liq = liquidAt(e.pos.x, e.pos.y + 0.1, e.pos.z);
            e.vel.y -= (liq ? 4 : GRAVITY * 0.75) * dt;
            if (liq === 1) { e.vel.y += 9 * dt; e.vel.y = Math.max(e.vel.y, -1.5); }
            if (liq === 2) { Particles.puff(e.pos.x, e.pos.y, e.pos.z, 3, [1, 0.5, 0.1], 0.06, 2, 0.5); this.remove(i); continue; }
            moveBody(e, dt);
            const f = e.onGround ? 0.6 : 0.98;
            e.vel.x *= Math.pow(f, dt * 20); e.vel.z *= Math.pow(f, dt * 20);
            // merge
            if (e.age > 0.5) for (let j = i - 1; j >= 0; j--) {
                const o = this.list[j];
                if (o.id === e.id && o.dmg === e.dmg && Math.abs(o.pos.x - e.pos.x) < 0.7 && Math.abs(o.pos.z - e.pos.z) < 0.7 && Math.abs(o.pos.y - e.pos.y) < 0.7 && o.count + e.count <= maxStack(e.id)) {
                    o.count += e.count; this.remove(i); break;
                }
            }
            if (!this.list[i] || this.list[i] !== e) continue;
            // pickup
            if (e.age > e.delay && !Game.dead) {
                const dx = pl.pos.x - e.pos.x, dy = pl.pos.y + 0.8 - e.pos.y, dz = pl.pos.z - e.pos.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < 1.5 * 1.5 && Inv.canAdd(e.id, e.dmg)) {
                    if (d2 < 0.5) {
                        const left = Inv.add(e.id, e.count, e.dmg);
                        Sound.play('pop');
                        if (left > 0) e.count = left; else { this.remove(i); continue; }
                    } else {
                        const d = Math.sqrt(d2), s = 9 * dt / d;
                        e.pos.x += dx * s; e.pos.y += dy * s; e.pos.z += dz * s; e.vel.y = 0;
                    }
                }
            }
            const bob = e.onGround ? Math.sin(e.age * 3) * 0.04 : 0;
            e.mesh.position.set(e.pos.x, e.pos.y + (e.flat ? 0.28 : 0.2) + bob, e.pos.z);
            e.mesh.rotation.y = e.spin;
            const b = brightnessAt(e.pos.x, e.pos.y + 0.3, e.pos.z);
            e.mesh.material.color.setScalar(b);
        }
    },
    remove(i) { const e = this.list[i]; Game.scene.remove(e.mesh); this.list.splice(i, 1); },
    clear() { for (let i = this.list.length - 1; i >= 0; i--) this.remove(i); }
};

// ---------------------------------------------------------------------------
// Skin painting & humanoid / animal models
// ---------------------------------------------------------------------------
function mcBox(w, h, d, u, v, tw, th, inflate = 0) {
    const g = new THREE.BoxGeometry((w + inflate * 2) / 16, (h + inflate * 2) / 16, (d + inflate * 2) / 16);
    const uv = g.attributes.uv;
    const set = (face, x0, y0, x1, y1) => {
        const u0 = x0 / tw, u1 = x1 / tw, vt = 1 - y0 / th, vb = 1 - y1 / th, b = face * 4;
        uv.setXY(b, u0, vt); uv.setXY(b + 1, u1, vt); uv.setXY(b + 2, u0, vb); uv.setXY(b + 3, u1, vb);
    };
    set(0, u + d + w, v + d, u + d + w + d, v + d + h);
    set(1, u, v + d, u + d, v + d + h);
    set(2, u + d, v, u + d + w, v + d);
    set(3, u + d + w, v, u + d + 2 * w, v + d);
    set(4, u + d, v + d, u + d + w, v + d + h);
    set(5, u + d + w + d, v + d, u + 2 * d + 2 * w, v + d + h);
    return g;
}
function newSkin(tw, th) { const c = document.createElement('canvas'); c.width = tw; c.height = th; return { c, g: c.getContext('2d') }; }
function skinRect(g, x, y, w, h, col) { g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; g.fillRect(x, y, w, h); }
function skinNoise(g, x, y, w, h, base, amp, rnd) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const d = (rnd() - 0.5) * 2 * amp;
        skinRect(g, x + i, y + j, 1, 1, [clamp255(base[0] + d), clamp255(base[1] + d), clamp255(base[2] + d)]);
    }
}
function paintBoxArea(g, u, v, dx, dy, dz, base, amp, rnd) {
    skinNoise(g, u + dz, v, dx * 2, dz, base, amp, rnd);
    skinNoise(g, u, v + dz, dz * 2 + dx * 2, dy, base, amp, rnd);
}
function toTex(skin) {
    const t = new THREE.CanvasTexture(skin.c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
}

const SkinTex = {};
function getSkin(type) {
    if (SkinTex[type]) return SkinTex[type];
    const s = newSkin(64, 32), g = s.g;
    const r = mulberry32(type.length * 977 + 5);
    const eyeDark = [18, 12, 22];
    if (type === 'steve') {
        const skin = [196, 134, 98], hair = [74, 50, 28], shirt = [0, 156, 156], pants = [58, 56, 160];
        paintBoxArea(g, 0, 0, 8, 8, 8, skin, 6, r);
        skinRect(g, 8, 0, 8, 2, hair); skinRect(g, 8, 8, 8, 3, hair); skinRect(g, 0, 8, 8, 2, hair); skinRect(g, 16, 8, 8, 2, hair); skinRect(g, 24, 8, 8, 8, hair);
        skinRect(g, 8, 8, 1, 4, hair); skinRect(g, 15, 8, 1, 4, hair);
        skinRect(g, 9, 12, 2, 1, [255, 255, 255]); skinRect(g, 13, 12, 2, 1, [255, 255, 255]);
        skinRect(g, 11, 12, 1, 1, [70, 60, 130]); skinRect(g, 13, 12, 1, 1, [70, 60, 130]);
        skinRect(g, 11, 14, 2, 1, [150, 90, 70]); skinRect(g, 10, 15, 4, 1, [140, 84, 62]);
        paintBoxArea(g, 16, 16, 8, 12, 4, shirt, 5, r);
        paintBoxArea(g, 40, 16, 4, 12, 4, skin, 5, r);
        skinNoise(g, 44, 20, 16, 4, shirt, 4, r); skinNoise(g, 44, 16, 8, 4, shirt, 4, r);
        paintBoxArea(g, 0, 16, 4, 12, 4, pants, 5, r);
        skinRect(g, 4, 28, 4, 4, [90, 90, 94]); skinRect(g, 8, 28, 4, 4, [90, 90, 94]); skinRect(g, 12, 28, 4, 4, [90, 90, 94]); skinRect(g, 0, 28, 4, 4, [90, 90, 94]);
    } else if (type === 'zombie') {
        const skin = [84, 134, 70], shirt = [0, 150, 150], pants = [52, 48, 150];
        paintBoxArea(g, 0, 0, 8, 8, 8, skin, 8, r);
        skinRect(g, 9, 11, 2, 2, eyeDark); skinRect(g, 13, 11, 2, 2, eyeDark); skinRect(g, 11, 13, 2, 1, [60, 90, 50]); skinRect(g, 10, 14, 4, 1, [40, 60, 40]);
        paintBoxArea(g, 16, 16, 8, 12, 4, shirt, 6, r);
        paintBoxArea(g, 40, 16, 4, 12, 4, skin, 7, r);
        skinNoise(g, 44, 20, 16, 4, shirt, 4, r); skinNoise(g, 44, 16, 8, 4, shirt, 4, r);
        paintBoxArea(g, 0, 16, 4, 12, 4, pants, 6, r);
    } else if (type === 'skeleton') {
        const bone = [206, 206, 200], dark = [90, 90, 86];
        paintBoxArea(g, 0, 0, 8, 8, 8, bone, 8, r);
        skinRect(g, 9, 11, 2, 2, [20, 20, 20]); skinRect(g, 13, 11, 2, 2, [20, 20, 20]); skinRect(g, 11, 13, 2, 1, dark);
        skinRect(g, 10, 14, 4, 1, dark); skinRect(g, 9, 14, 1, 1, bone); skinRect(g, 12, 14, 1, 1, bone);
        paintBoxArea(g, 16, 16, 8, 12, 4, [28, 28, 28], 0, r);
        for (let y = 0; y < 12; y += 3) { skinRect(g, 20, 20 + y, 8, 2, bone); skinRect(g, 32, 20 + y, 8, 2, bone); }
        skinRect(g, 23, 20, 2, 12, bone);
        paintBoxArea(g, 40, 16, 2, 12, 2, bone, 8, r);
        paintBoxArea(g, 0, 16, 2, 12, 2, bone, 8, r);
    } else if (type === 'creeper') {
        const base = [74, 176, 64];
        paintBoxArea(g, 0, 0, 8, 8, 8, base, 22, r);
        paintBoxArea(g, 16, 16, 8, 12, 4, base, 22, r);
        paintBoxArea(g, 0, 16, 4, 6, 4, base, 22, r);
        skinRect(g, 9, 11, 2, 2, [14, 28, 14]); skinRect(g, 13, 11, 2, 2, [14, 28, 14]); skinRect(g, 11, 13, 2, 3, [14, 28, 14]);
        skinRect(g, 10, 14, 1, 3, [14, 28, 14]); skinRect(g, 13, 14, 1, 3, [14, 28, 14]);
    } else if (type === 'pig') {
        const pink = [232, 150, 148];
        paintBoxArea(g, 0, 0, 8, 8, 8, pink, 7, r);
        paintBoxArea(g, 28, 8, 10, 16, 8, pink, 7, r);
        paintBoxArea(g, 0, 16, 4, 6, 4, pink, 7, r);
        skinRect(g, 9, 11, 2, 1, [255, 255, 255]); skinRect(g, 13, 11, 2, 1, [255, 255, 255]); skinRect(g, 9, 11, 1, 1, [30, 20, 40]); skinRect(g, 14, 11, 1, 1, [30, 20, 40]);
        paintBoxArea(g, 16, 16, 4, 3, 1, [214, 120, 120], 4, r);
        skinRect(g, 18, 17, 1, 1, [100, 50, 56]); skinRect(g, 21, 17, 1, 1, [100, 50, 56]);
        // back/side pattern
        skinRect(g, 36, 8, 8, 2, [210, 128, 128]);
    } else if (type === 'cow') {
        const white = [232, 230, 226], brown = [58, 40, 30];
        paintBoxArea(g, 0, 0, 8, 8, 6, brown, 5, r);
        paintBoxArea(g, 18, 4, 12, 18, 10, white, 5, r);
        for (let i = 0; i < 16; i++) skinRect(g, 18 + Math.floor(r() * 30), 4 + Math.floor(r() * 28), 3 + Math.floor(r() * 4), 2 + Math.floor(r() * 4), brown);
        paintBoxArea(g, 0, 16, 4, 12, 4, [70, 54, 44], 5, r);
        skinRect(g, 6, 6, 1, 1, [255, 255, 255]); skinRect(g, 13, 6, 1, 1, [255, 255, 255]);
        skinRect(g, 6, 7, 1, 1, eyeDark); skinRect(g, 13, 7, 1, 1, eyeDark);
        skinRect(g, 8, 11, 6, 3, [200, 176, 160]); skinRect(g, 9, 12, 1, 1, [100, 60, 60]); skinRect(g, 12, 12, 1, 1, [100, 60, 60]);
        paintBoxArea(g, 22, 0, 1, 3, 1, [230, 226, 200], 3, r);
    } else if (type === 'sheep') {
        paintBoxArea(g, 0, 0, 6, 6, 8, [214, 184, 160], 6, r);
        paintBoxArea(g, 28, 8, 8, 16, 6, [236, 236, 236], 8, r);
        paintBoxArea(g, 0, 16, 4, 12, 4, [214, 184, 160], 6, r);
        skinRect(g, 8, 11, 1, 1, [255, 255, 255]); skinRect(g, 13, 11, 1, 1, [255, 255, 255]);
        skinRect(g, 8, 12, 1, 1, eyeDark); skinRect(g, 13, 12, 1, 1, eyeDark);
        skinRect(g, 10, 14, 3, 1, [240, 150, 170]);
    }
    return (SkinTex[type] = toTex(s));
}

function part(geo, mat, ox, oy, oz) { const m = new THREE.Mesh(geo, mat); m.position.set(ox, oy, oz); return m; }
function pivoted(parent, px, py, pz, geo, mat, mx, my, mz) {
    const p = new THREE.Group(); p.position.set(px / 16, py / 16, pz / 16);
    const m = new THREE.Mesh(geo, mat); m.position.set(mx / 16, my / 16, mz / 16);
    p.add(m); parent.add(p); return p;
}

function buildModel(type) {
    const tex = getSkin(type);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const root = new THREE.Group();
    const model = new THREE.Group();   // swapped for death-tilt
    root.add(model);
    const P = {};
    const sh = bakeShade;
    if (type === 'zombie' || type === 'steve' || type === 'skeleton') {
        const thin = type === 'skeleton';
        const aw = thin ? 2 : 4;
        P.head = pivoted(model, 0, 24, 0, sh(mcBox(8, 8, 8, 0, 0, 64, 32)), mat, 0, 4, 0);
        pivoted(model, 0, 18, 0, sh(mcBox(8, 12, 4, 16, 16, 64, 32)), mat, 0, 0, 0);
        P.armR = pivoted(model, -(4 + aw / 2), 22, 0, sh(mcBox(aw, 12, aw, 40, 16, 64, 32)), mat, 0, -4, 0);
        P.armL = pivoted(model, (4 + aw / 2), 22, 0, sh(mcBox(aw, 12, aw, 40, 16, 64, 32)), mat, 0, -4, 0);
        P.legR = pivoted(model, -2, 12, 0, sh(mcBox(aw, 12, aw, 0, 16, 64, 32)), mat, 0, -6, 0);
        P.legL = pivoted(model, 2, 12, 0, sh(mcBox(aw, 12, aw, 0, 16, 64, 32)), mat, 0, -6, 0);
        P.biped = true;
    } else if (type === 'creeper') {
        P.head = pivoted(model, 0, 18, 0, sh(mcBox(8, 8, 8, 0, 0, 64, 32)), mat, 0, 4, 0);
        pivoted(model, 0, 12, 0, sh(mcBox(8, 12, 4, 16, 16, 64, 32)), mat, 0, 6, 0);
        const lg = () => sh(mcBox(4, 6, 4, 0, 16, 64, 32));
        P.legs = [pivoted(model, -2, 6, 4, lg(), mat, 0, -3, 0), pivoted(model, 2, 6, 4, lg(), mat, 0, -3, 0),
                  pivoted(model, -2, 6, -4, lg(), mat, 0, -3, 0), pivoted(model, 2, 6, -4, lg(), mat, 0, -3, 0)];
    } else if (type === 'pig' || type === 'cow' || type === 'sheep') {
        const spec = {
            pig:   { head: [8, 8, 8], hy: 12, hz: 6, body: [10, 16, 8, 28, 8], by: 11, legH: 6, legX: 3, legZ: 5, ly: 6 },
            cow:   { head: [8, 8, 6], hy: 20, hz: 8, body: [12, 18, 10, 18, 4], by: 18, legH: 12, legX: 4, legZ: 7, ly: 12 },
            sheep: { head: [6, 6, 8], hy: 18, hz: 8, body: [8, 16, 6, 28, 8], by: 16, legH: 12, legX: 3, legZ: 6, ly: 12 }
        }[type];
        const [hw, hh, hd] = spec.head;
        P.head = pivoted(model, 0, spec.hy, spec.hz, sh(mcBox(hw, hh, hd, 0, 0, 64, 32)), mat, 0, 0, hd / 2 - 1);
        const [bw, bl, bh, bu, bv] = spec.body;
        const bg = mcBox(bw, bl, bh, bu, bv, 64, 32); bg.rotateX(-Math.PI / 2); sh(bg);
        pivoted(model, 0, spec.by, 0, bg, mat, 0, 0, 0);
        if (type === 'pig') pivoted(P.head, 0, 0, 0, sh(mcBox(4, 3, 1, 16, 16, 64, 32)), mat, 0, -1, 7.5);
        if (type === 'cow') {
            pivoted(P.head, -4, 5, 0, sh(mcBox(1, 3, 1, 22, 0, 64, 32)), mat, 0, 0, 1);
            pivoted(P.head, 4, 5, 0, sh(mcBox(1, 3, 1, 22, 0, 64, 32)), mat, 0, 0, 1);
        }
        const lg = () => sh(mcBox(4, spec.legH, 4, 0, 16, 64, 32));
        P.legs = [pivoted(model, -spec.legX, spec.ly, spec.legZ, lg(), mat, 0, -spec.legH / 2, 0), pivoted(model, spec.legX, spec.ly, spec.legZ, lg(), mat, 0, -spec.legH / 2, 0),
                  pivoted(model, -spec.legX, spec.ly, -spec.legZ, lg(), mat, 0, -spec.legH / 2, 0), pivoted(model, spec.legX, spec.ly, -spec.legZ, lg(), mat, 0, -spec.legH / 2, 0)];
    }
    // models are authored 1 unit = 1/16 block, humanoids rendered at 15/16
    root.userData = { mat, model, parts: P };
    return root;
}

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------
const MOB = {
    pig:      { hp: 10, w: 0.9, h: 0.9, speed: 1.8, passive: true, xp: [1, 3], snd: 'pig', label: '猪' },
    cow:      { hp: 10, w: 0.9, h: 1.4, speed: 1.7, passive: true, xp: [1, 3], snd: 'cow', label: '牛' },
    sheep:    { hp: 8,  w: 0.9, h: 1.3, speed: 1.7, passive: true, xp: [1, 3], snd: 'sheep', label: '羊' },
    zombie:   { hp: 20, w: 0.6, h: 1.95, speed: 3.4, passive: false, xp: [5, 5], snd: 'zombie', label: '僵尸', burns: true },
    skeleton: { hp: 20, w: 0.6, h: 1.95, speed: 3.2, passive: false, xp: [5, 5], snd: 'skeleton', label: '骷髅', burns: true },
    creeper:  { hp: 20, w: 0.6, h: 1.7, speed: 3.0, passive: false, xp: [5, 5], snd: 'creeper_hiss', label: '苦力怕' }
};

const Mobs = {
    list: [],
    spawn(type, x, y, z) {
        const T = MOB[type];
        const model = buildModel(type);
        const m = {
            kind: 'mob', type, T, mesh: model, mat: model.userData.mat, parts: model.userData.parts,
            pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, w: T.w, h: T.h,
            yaw: Math.random() * Math.PI * 2, hp: T.hp, hurt: 0, dead: 0, onGround: false,
            wanderT: Math.random() * 3, wanderYaw: 0, moving: false, limb: 0, limbAmp: 0,
            panic: 0, fuse: 0, shootT: 2, atkT: 0, burn: 0, soundT: 6 + Math.random() * 14, fuseOn: false, headYaw: 0, kb: { x: 0, z: 0 }, lightT: 0, br: 1
        };
        const sc = (type === 'zombie' || type === 'skeleton') ? 0.9375 : 1 / 1;
        model.scale.setScalar(sc / 1);
        // model units are already in blocks (px/16)
        Game.scene.add(model);
        this.list.push(m);
        return m;
    },
    remove(i) { Game.scene.remove(this.list[i].mesh); this.list.splice(i, 1); },
    clear() { for (let i = this.list.length - 1; i >= 0; i--) this.remove(i); },
    count(hostile) { let n = 0; for (const m of this.list) if (!m.T.passive === hostile) n++; return n; },

    damage(m, dmg, fromX, fromZ, kbMul = 1) {
        if (m.dead || m.hurt > 0.35) return false;     // brief invulnerability
        m.hp -= dmg; m.hurt = 0.5;
        const dx = m.pos.x - fromX, dz = m.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
        m.vel.x = dx / d * 5.5 * kbMul; m.vel.z = dz / d * 5.5 * kbMul; m.vel.y = Math.max(m.vel.y, 4.4);
        if (m.T.passive) m.panic = 5;
        Sound.play(m.type === 'zombie' || m.type === 'skeleton' ? 'zombie_hurt' : (m.T.passive ? m.T.snd : 'hit'), [m.pos.x, m.pos.y + 1, m.pos.z]);
        if (m.hp <= 0) this.kill(m);
        return true;
    },
    kill(m) {
        if (m.dead) return;
        m.dead = 0.001;
        Sound.play('death', [m.pos.x, m.pos.y, m.pos.z]);
        const R = () => Math.random();
        const drop = (id, n) => { if (n > 0) Items.spawn(m.pos.x, m.pos.y + 0.5, m.pos.z, id, n); };
        const cnt = (a, b) => a + Math.floor(R() * (b - a + 1));
        switch (m.type) {
            case 'pig': drop(m.burn > 0 ? I.cooked_porkchop : I.raw_porkchop, cnt(1, 3)); break;
            case 'cow': drop(m.burn > 0 ? I.steak : I.raw_beef, cnt(1, 3)); break;
            case 'sheep': drop(B.wool, 1); drop(m.burn > 0 ? I.cooked_mutton : I.raw_mutton, cnt(1, 2)); break;
            case 'zombie': drop(I.rotten_flesh, cnt(0, 2)); if (R() < 0.025) drop(I.iron_ingot, 1); break;
            case 'skeleton': drop(I.bone, cnt(0, 2)); drop(I.arrow, cnt(0, 2)); break;
            case 'creeper': drop(I.gunpowder, cnt(0, 2)); break;
        }
        if (Game.mode === 'survival') Game.addXP(cnt(m.T.xp[0], m.T.xp[1]));
    },

    update(dt) {
        const pl = Game.player;
        const night = world.skyFactor < 0.6;
        for (let i = this.list.length - 1; i >= 0; i--) {
            const m = this.list[i];
            const dxp = pl.pos.x - m.pos.x, dzp = pl.pos.z - m.pos.z, dyp = pl.pos.y - m.pos.y;
            const dist = Math.hypot(dxp, dzp);
            if (dist > 90 || (!m.T.passive && dist > 64 && Math.random() < dt * 0.5)) { this.remove(i); continue; }
            if (dist > 56) { m.mesh.visible = false; continue; }          // far away: freeze
            m.mesh.visible = true;
            if (m.dead) {
                m.dead += dt;
                m.mesh.rotation.z = Math.min(1, m.dead / 0.4) * Math.PI / 2;
                if (m.dead > 0.9) { this.remove(i); }
                m.vel.y -= GRAVITY * dt; moveBody(m, dt);
                m.mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
                m.mat.color.setRGB(1, 0.35, 0.35);
                continue;
            }
            m.hurt = Math.max(0, m.hurt - dt);
            m.atkT = Math.max(0, m.atkT - dt);

            const liq = liquidAt(m.pos.x, m.pos.y + 0.3, m.pos.z);
            const headLiq = liquidAt(m.pos.x, m.pos.y + m.h * 0.9, m.pos.z);

            // ---- burning in sunlight -------------------------------------------------
            if (m.T.burns) {
                const l = world.getLight(Math.floor(m.pos.x), Math.floor(m.pos.y + m.h), Math.floor(m.pos.z));
                const sunlit = (l >> 4) === 15 && world.skyFactor > 0.85 && !liq;
                if (sunlit) m.burn = 6; else if (liq === 1) m.burn = 0;
            }
            if (m.burn > 0) {
                m.burn -= dt; m.burnT = (m.burnT || 0) + dt;
                if (m.burnT > 1) { m.burnT = 0; this.damage(m, 1, m.pos.x, m.pos.z, 0); m.hurt = 0; if (!this.list[i] || this.list[i] !== m) continue; }
                if (Math.random() < dt * 14) Particles.puff(m.pos.x, m.pos.y + m.h * 0.7, m.pos.z, 1, [1, 0.55, 0.12], 0.07, 1, 0.5, -0.6, true);
            }
            if (liq === 2) { m.burn = 8; m.lavaT = (m.lavaT || 0) + dt; if (m.lavaT > 0.5) { m.lavaT = 0; this.damage(m, 4, m.pos.x, m.pos.z, 0); m.hurt = 0; } }

            // ---- AI -------------------------------------------------------------------------
            let tx = 0, tz = 0, speed = 0, face = null;
            m.soundT -= dt;
            if (m.soundT < 0) {
                m.soundT = 8 + Math.random() * 14;
                if (dist < 24 && m.type !== 'creeper') Sound.play(m.T.snd, [m.pos.x, m.pos.y + 1, m.pos.z]);
            }
            if (m.T.passive) {
                m.wanderT -= dt;
                if (m.panic > 0) {
                    m.panic -= dt;
                    const a = Math.atan2(-dxp, -dzp);   // away from the player
                    tx = Math.sin(a); tz = Math.cos(a); speed = m.T.speed * 1.6;
                } else if (m.wanderT <= 0) {
                    m.wanderT = 2 + Math.random() * 4;
                    m.moving = Math.random() < 0.55;
                    m.wanderYaw = Math.random() * Math.PI * 2;
                }
                if (m.panic <= 0 && m.moving) { tx = Math.sin(m.wanderYaw); tz = Math.cos(m.wanderYaw); speed = m.T.speed; }
                if (dist < 6 && !m.panic) face = Math.atan2(dxp, dzp);
            } else if (Game.mode === 'creative' && Game.cheatInvisible) {
                // idle
            } else if (!Game.dead && dist < (m.type === 'creeper' ? 18 : 28) && Math.abs(dyp) < 14) {
                const toYaw = Math.atan2(dxp, dzp);
                if (m.type === 'zombie') {
                    tx = Math.sin(toYaw); tz = Math.cos(toYaw); speed = m.T.speed; face = toYaw;
                    if (dist < 1.25 && Math.abs(dyp) < 1.8 && m.atkT <= 0) {
                        m.atkT = 1.0; Game.damagePlayer(3, 'zombie', m.pos.x, m.pos.z);
                    }
                    if (dist < 1.1) speed = 0;
                } else if (m.type === 'skeleton') {
                    face = toYaw;
                    if (dist < 6) { tx = -Math.sin(toYaw); tz = -Math.cos(toYaw); speed = m.T.speed * 0.8; }
                    else if (dist > 14) { tx = Math.sin(toYaw); tz = Math.cos(toYaw); speed = m.T.speed * 0.9; }
                    else { const s = Math.sin(m.pos.x * 0.1 + performance.now() * 0.0007) > 0 ? 1 : -1; tx = Math.cos(toYaw) * s; tz = -Math.sin(toYaw) * s; speed = m.T.speed * 0.4; }
                    m.shootT -= dt;
                    if (m.shootT <= 0 && dist < 16) {
                        m.shootT = 2 + Math.random() * 0.8;
                        const sx = m.pos.x, sy = m.pos.y + 1.5, sz = m.pos.z;
                        const ex = pl.pos.x - sx, ey = pl.pos.y + 1.0 - sy, ez = pl.pos.z - sz;
                        const d = Math.hypot(ex, ey, ez), spd = 22;
                        Arrows.spawn(sx, sy, sz, ex / d * spd, ey / d * spd + 7 * d / spd, ez / d * spd, 'mob');
                        Sound.play('bow', [sx, sy, sz]);
                    }
                } else if (m.type === 'creeper') {
                    face = toYaw;
                    if (dist < 3.2 || (m.fuseOn && dist < 7)) {
                        if (!m.fuseOn) { m.fuseOn = true; Sound.play('creeper_hiss', [m.pos.x, m.pos.y, m.pos.z]); }
                        m.fuse += dt; speed = 0;
                        const sw = 1 + Math.sin(m.fuse * 24) * 0.05 * m.fuse + m.fuse * 0.18;
                        m.mesh.scale.set(sw, 1 + m.fuse * 0.12, sw);
                        if (m.fuse >= 1.5) {
                            Explosion.explode(m.pos.x, m.pos.y + 0.6, m.pos.z, 3.0);
                            this.remove(i); continue;
                        }
                    } else {
                        m.fuseOn = false; m.fuse = Math.max(0, m.fuse - dt * 2);
                        m.mesh.scale.set(1, 1, 1);
                        tx = Math.sin(toYaw); tz = Math.cos(toYaw); speed = m.T.speed;
                    }
                }
            }

            // ---- movement -----------------------------------------------------------------------
            const wantYaw = face !== null ? face : (speed > 0 ? Math.atan2(tx, tz) : m.yaw);
            m.yaw = angleLerp(m.yaw, wantYaw, dt * 9);
            const acc = m.onGround ? 12 : 3;
            const tvx = tx * speed * (liq ? 0.6 : 1), tvz = tz * speed * (liq ? 0.6 : 1);
            if (m.hurt < 0.3) { m.vel.x += (tvx - m.vel.x) * Math.min(1, dt * acc); m.vel.z += (tvz - m.vel.z) * Math.min(1, dt * acc); }
            if (liq === 1) {
                m.vel.y += (headLiq ? 18 : 4) * dt; m.vel.y = Math.min(m.vel.y, 3); m.vel.y -= GRAVITY * 0.4 * dt;
            } else if (liq === 2) { m.vel.y += 12 * dt; m.vel.y -= GRAVITY * 0.5 * dt; }
            else m.vel.y -= GRAVITY * dt;
            if (m.vel.y < -60) m.vel.y = -60;
            const wasGround = m.onGround;
            moveBody(m, dt);
            if (speed > 0 && (m.hitX || m.hitZ) && (m.onGround || liq)) m.vel.y = liq ? 5 : 8.6;
            // fall damage
            if (m.onGround && !wasGround && m.lastVy < -14 && !liq) this.damage(m, Math.floor((-m.lastVy - 14) / 3), m.pos.x, m.pos.z, 0);
            m.lastVy = m.vel.y < 0 ? m.vel.y : (m.lastVy || 0);
            if (m.onGround) m.lastVy = 0;
            if (m.pos.y < -20) { this.remove(i); continue; }

            // ---- animation --------------------------------------------------------------------------
            const hs = Math.hypot(m.vel.x, m.vel.z);
            m.limbAmp += ((hs > 0.2 ? Math.min(1, hs / 3) : 0) - m.limbAmp) * Math.min(1, dt * 10);
            m.limb += hs * dt * 1.9;
            const swing = Math.sin(m.limb * 3.2) * 0.9 * m.limbAmp;
            const P = m.parts;
            if (P.biped) {
                if (m.type === 'zombie') { P.armR.rotation.x = -Math.PI / 2 + swing * 0.15; P.armL.rotation.x = -Math.PI / 2 - swing * 0.15; }
                else if (m.type === 'skeleton') { P.armR.rotation.x = -1.4 + swing * 0.1; P.armL.rotation.x = -1.2 - swing * 0.1; }
                else { P.armR.rotation.x = swing; P.armL.rotation.x = -swing; }
                P.legR.rotation.x = -swing; P.legL.rotation.x = swing;
            } else if (P.legs) {
                P.legs[0].rotation.x = swing; P.legs[3].rotation.x = swing; P.legs[1].rotation.x = -swing; P.legs[2].rotation.x = -swing;
            }
            if (P.head && face !== null) {
                const rel = ((face - m.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
                P.head.rotation.y += (Math.max(-0.9, Math.min(0.9, rel)) - P.head.rotation.y) * Math.min(1, dt * 8);
            } else if (P.head) P.head.rotation.y *= (1 - Math.min(1, dt * 6));

            m.mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
            m.mesh.rotation.y = m.yaw;
            m.lightT -= dt;
            if (m.lightT <= 0) { m.lightT = 0.25; m.br = brightnessAt(m.pos.x, m.pos.y + m.h * 0.5, m.pos.z); }
            if (m.hurt > 0) m.mat.color.setRGB(m.br * 1.0, m.br * 0.4, m.br * 0.4);
            else if (m.fuseOn && Math.floor(m.fuse * 8) % 2 === 0) m.mat.color.setScalar(2);
            else m.mat.color.setScalar(m.br);
        }
    },

    // ---- spawning --------------------------------------------------------------------------------
    spawnTimer: 0,
    naturalSpawn(dt) {
        if (Game.mode === 'creative' && false) return;
        this.spawnTimer -= dt;
        if (this.spawnTimer > 0) return;
        this.spawnTimer = 1.2;
        if (Game.peaceful) return;
        const pl = Game.player;
        if (this.count(true) >= 22) return;
        for (let tries = 0; tries < 6; tries++) {
            const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 22;
            const x = Math.floor(pl.pos.x + Math.cos(a) * r), z = Math.floor(pl.pos.z + Math.sin(a) * r);
            if (!world.isLoaded(x, z)) continue;
            // find a floor: scan down from player's height + 20
            let y = Math.min(WH - 3, Math.floor(pl.pos.y) + 20);
            let found = -1;
            for (; y > 2; y--) {
                if (SOLID[world.getBlock(x, y, z)] && !DEFS[world.getBlock(x, y, z)].liquid && world.getBlock(x, y + 1, z) === 0 && world.getBlock(x, y + 2, z) === 0) { found = y + 1; if (Math.abs(found - pl.pos.y) < 18) break; found = -1; }
            }
            if (found < 0) continue;
            if (world.lightLevel(x, found, z) > 7) continue;
            const w = Math.random();
            const type = w < 0.55 ? 'zombie' : (w < 0.8 ? 'skeleton' : 'creeper');
            this.spawn(type, x + 0.5, found, z + 0.5);
            return;
        }
    },
    populateChunk(c, infos) {
        if (Math.random() > 0.35) return;
        const types = ['pig', 'cow', 'sheep', 'sheep', 'pig'];
        const type = types[Math.floor(Math.random() * types.length)];
        const n = 2 + Math.floor(Math.random() * 3);
        const baseX = c.cx * 16 + 2 + Math.floor(Math.random() * 12), baseZ = c.cz * 16 + 2 + Math.floor(Math.random() * 12);
        for (let i = 0; i < n; i++) {
            const lx = Math.max(0, Math.min(15, baseX - c.cx * 16 + Math.floor(Math.random() * 5 - 2)));
            const lz = Math.max(0, Math.min(15, baseZ - c.cz * 16 + Math.floor(Math.random() * 5 - 2)));
            const info = infos[lx + (lz << 4)];
            if (info.biome !== BIOME.PLAINS && info.biome !== BIOME.FOREST) continue;
            const y = info.h + 1;
            if (c.blocks[lx + (lz << 4) + (info.h << 8)] !== B.grass) continue;
            if (c.blocks[lx + (lz << 4) + (y << 8)] !== 0 && c.blocks[lx + (lz << 4) + (y << 8)] !== B.tallgrass) continue;
            if (this.list.length > 60) return;
            this.spawn(type, c.cx * 16 + lx + 0.5, y, c.cz * 16 + lz + 0.5);
        }
    }
};

// ---------------------------------------------------------------------------
// Arrows
// ---------------------------------------------------------------------------
const Arrows = {
    list: [],
    spawn(x, y, z, vx, vy, vz, owner) {
        const geo = new THREE.BoxGeometry(0.04, 0.04, 0.7);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcdbb8a }));
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: 0x777777 }));
        head.position.z = 0.4; m.add(head);
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        f.position.z = -0.32; m.add(f);
        Game.scene.add(m);
        this.list.push({ pos: { x, y, z }, vel: { x: vx, y: vy, z: vz }, mesh: m, owner, life: 0, stuck: 0 });
    },
    update(dt) {
        const pl = Game.player;
        for (let i = this.list.length - 1; i >= 0; i--) {
            const a = this.list[i];
            if (a.stuck) { a.stuck -= dt; if (a.stuck <= 0) { Game.scene.remove(a.mesh); this.list.splice(i, 1); } continue; }
            a.life += dt;
            a.vel.y -= 14 * dt;
            const steps = 3;
            let hit = false;
            for (let s = 0; s < steps && !hit; s++) {
                a.pos.x += a.vel.x * dt / steps; a.pos.y += a.vel.y * dt / steps; a.pos.z += a.vel.z * dt / steps;
                if (world.solidAt(Math.floor(a.pos.x), Math.floor(a.pos.y), Math.floor(a.pos.z))) { a.stuck = 4; a.vel.x = a.vel.y = a.vel.z = 0; Sound.block('wood', 'hit', [a.pos.x, a.pos.y, a.pos.z]); hit = true; break; }
                if (a.owner === 'mob' && !Game.dead && Math.abs(a.pos.x - pl.pos.x) < 0.45 && Math.abs(a.pos.z - pl.pos.z) < 0.45 && a.pos.y > pl.pos.y && a.pos.y < pl.pos.y + pl.h) {
                    Game.damagePlayer(3, 'arrow', a.pos.x - a.vel.x, a.pos.z - a.vel.z); a.stuck = 0.001; hit = true; break;
                }
            }
            if (a.life > 20) { a.stuck = 0.001; }
            const sp = Math.hypot(a.vel.x, a.vel.y, a.vel.z);
            if (sp > 0.1) { a.mesh.lookAt(a.pos.x + a.vel.x, a.pos.y + a.vel.y, a.pos.z + a.vel.z); }
            a.mesh.position.set(a.pos.x, a.pos.y, a.pos.z);
        }
    },
    clear() { this.list.forEach(a => Game.scene.remove(a.mesh)); this.list.length = 0; }
};

// ---------------------------------------------------------------------------
// Falling blocks
// ---------------------------------------------------------------------------
const Falling = {
    list: [],
    spawn(x, y, z, id) {
        const def = DEFS[id];
        const m = new THREE.Mesh(cubeGeometryFor(def, 0.98), new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true }));
        Game.scene.add(m);
        this.list.push({ id, pos: { x: x + 0.5, y, z: z + 0.5 }, vel: { x: 0, y: 0, z: 0 }, w: 0.98, h: 0.98, mesh: m });
    },
    update(dt) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const f = this.list[i];
            f.vel.y -= GRAVITY * dt;
            moveBody(f, dt);
            f.mesh.position.set(f.pos.x, f.pos.y + 0.49, f.pos.z);
            f.mesh.material.color.setScalar(brightnessAt(f.pos.x, f.pos.y + 0.5, f.pos.z));
            if (f.onGround) {
                const bx = Math.floor(f.pos.x), by = Math.floor(f.pos.y + 0.05), bz = Math.floor(f.pos.z);
                Game.scene.remove(f.mesh); this.list.splice(i, 1);
                const cur = world.getBlock(bx, by, bz);
                if (cur === 0 || DEFS[cur].replaceable) { world.setBlock(bx, by, bz, f.id); Sound.block(DEFS[f.id].sound, 'place', [bx, by, bz]); }
                else Items.spawn(bx + 0.5, by + 0.3, bz + 0.5, f.id, 1);
            }
        }
    },
    clear() { this.list.forEach(f => Game.scene.remove(f.mesh)); this.list.length = 0; }
};

// ---------------------------------------------------------------------------
// TNT & explosions
// ---------------------------------------------------------------------------
const Tnt = {
    list: [],
    prime(x, y, z, fuse = 4.0) {
        const m = new THREE.Mesh(cubeGeometryFor(DEFS[B.tnt], 1.0), new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true }));
        Game.scene.add(m);
        const e = { pos: { x: x + 0.5, y, z: z + 0.5 }, vel: { x: (Math.random() - 0.5) * 2, y: 4.5, z: (Math.random() - 0.5) * 2 }, w: 0.98, h: 0.98, mesh: m, fuse };
        this.list.push(e);
        Sound.play('fuse', [x, y, z]);
    },
    update(dt) {
        for (let i = this.list.length - 1; i >= 0; i--) {
            const e = this.list[i];
            e.fuse -= dt;
            e.vel.y -= GRAVITY * dt;
            moveBody(e, dt);
            e.vel.x *= Math.pow(0.7, dt * 20 * (e.onGround ? 1 : 0.1)); e.vel.z *= Math.pow(0.7, dt * 20 * (e.onGround ? 1 : 0.1));
            const flash = Math.floor(e.fuse * 5) % 2 === 0;
            const s = 1 + Math.max(0, 0.5 - e.fuse) * 0.3;
            e.mesh.position.set(e.pos.x, e.pos.y + 0.5, e.pos.z);
            e.mesh.scale.setScalar(s * 0.98);
            e.mesh.material.color.setScalar(flash ? 2.6 : 1);
            if (Math.random() < dt * 10) Particles.puff(e.pos.x, e.pos.y + 1.1, e.pos.z, 1, [0.4, 0.4, 0.4], 0.07, 0.8, 0.6, -0.3);
            if (e.fuse <= 0) {
                Game.scene.remove(e.mesh); this.list.splice(i, 1);
                Explosion.explode(e.pos.x, e.pos.y + 0.5, e.pos.z, 4.0);
            }
        }
    },
    clear() { this.list.forEach(e => Game.scene.remove(e.mesh)); this.list.length = 0; }
};

const Explosion = {
    explode(x, y, z, power) {
        Sound.play('explode', [x, y, z]);
        const R = Math.ceil(power * 1.5);
        const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
        let destroyed = 0;
        for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > power * 1.5) continue;
            const px = bx + dx, py = by + dy, pz = bz + dz;
            if (py < 1 || py >= WH) continue;
            const id = world.getBlock(px, py, pz);
            if (!id) continue;
            const def = DEFS[id];
            if (def.hardness < 0 || def.liquid || def.key === 'obsidian') continue;
            const strength = power * (0.75 + Math.random() * 0.55) * (1 - d / (power * 1.5)) * 2.3;
            const resist = def.hardness * 0.9 + 0.4;
            if (strength <= resist) continue;
            if (id === B.tnt) { world.setBlock(px, py, pz, 0, 0, true); Tnt.prime(px, py, pz, 0.4 + Math.random() * 1.1); continue; }
            world.setBlock(px, py, pz, 0, 0, true);
            destroyed++;
            if (Math.random() < 0.25) {
                const drops = blockDrops(id, null, Math.random);
                drops.forEach(([i2, n]) => Items.spawn(px + 0.5, py + 0.3, pz + 0.5, i2, n));
            }
            if (Math.random() < 0.12) Particles.puff(px + 0.5, py + 0.5, pz + 0.5, 1, [0.5, 0.5, 0.5], 0.3, 1.5, 1.2, -0.1);
        }
        // fix lighting & neighbours in the affected cube
        relightRegion(bx - R - 1, by - R - 1, bz - R - 1, bx + R + 1, by + R + 1, bz + R + 1);
        Particles.puff(x, y, z, 40, [0.85, 0.85, 0.85], 0.55, 6, 1.4, -0.1);
        Particles.puff(x, y, z, 24, [1, 0.7, 0.2], 0.4, 7, 0.7, 0.4, true);

        // entities
        const ent = [];
        Mobs.list.forEach(m => ent.push({ m, p: m.pos, h: m.h }));
        const hitEntity = (px, py, pz, applyDmg, applyKb) => {
            const dx = px - x, dy = py - y, dz = pz - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const q = power * 2;
            if (d >= q) return;
            const impact = (1 - d / q);
            const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * q + 1);
            applyDmg(dmg);
            const k = impact * 1.2 * 9 / (d || 1);
            applyKb(dx * k, Math.max(dy * k, 2) , dz * k);
        };
        Mobs.list.slice().forEach(m => {
            hitEntity(m.pos.x, m.pos.y + m.h / 2, m.pos.z, (dmg) => { if (!m.dead) { m.hurt = 0; Mobs.damage(m, dmg, x, z, 0); } }, (kx, ky, kz) => { m.vel.x += kx; m.vel.y += ky; m.vel.z += kz; });
        });
        const pl = Game.player;
        if (!Game.dead) hitEntity(pl.pos.x, pl.pos.y + 0.9, pl.pos.z, (dmg) => Game.damagePlayer(dmg, 'explosion', x, z, true), (kx, ky, kz) => { pl.vel.x += kx; pl.vel.y += ky * 0.8; pl.vel.z += kz; });
        Items.list.forEach(it => { const d = Math.hypot(it.pos.x - x, it.pos.y - y, it.pos.z - z); if (d < power * 1.5) { it.vel.x += (it.pos.x - x) / (d + 0.1) * 6; it.vel.y += 5; it.vel.z += (it.pos.z - z) / (d + 0.1) * 6; } });
        Game.shake = Math.max(Game.shake || 0, Math.min(1, 1.6 - Math.hypot(pl.pos.x - x, pl.pos.y - y, pl.pos.z - z) / 25));
    }
};

// Recompute lighting after bulk edits (explosions): clear + reseed the region
function relightRegion(x0, y0, z0, x1, y1, z1) {
    const skyQ = [], blkQ = [];
    y0 = Math.max(0, y0); y1 = Math.min(WH - 1, y1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const c = world.chunkAt(x, z); if (!c || !c.generated) continue;
        for (let y = y0; y <= y1; y++) {
            const idx = (x & 15) + ((z & 15) << 4) + (y << 8);
            c.light[idx] = 0; c.dirty = true;
        }
    }
    // reseed: every cell of the region from outside neighbours + sky columns + emitters
    for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) for (let y = Math.max(0, y0 - 1); y <= Math.min(WH - 1, y1 + 1); y++) {
        const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= y0 && y <= y1;
        const c = world.chunkAt(x, z); if (!c || !c.generated) continue;
        const idx = (x & 15) + ((z & 15) << 4) + (y << 8);
        if (inside) {
            const id = c.blocks[idx];
            if (EMIT[id]) { c.light[idx] = EMIT[id]; blkQ.push(x, y, z); }
            if (OPACITY[id] === 0) {
                // sky exposed if everything above is transparent to light
                let open = true;
                for (let yy = y + 1; yy < WH; yy++) { if (OPACITY[world.getBlock(x, yy, z)] > 0) { open = false; break; } }
                if (open) { c.light[idx] = (15 << 4) | (c.light[idx] & 15); skyQ.push(x, y, z); }
            }
        } else if (c.light[idx]) { skyQ.push(x, y, z); blkQ.push(x, y, z); }
    }
    world.spreadLight(skyQ, true);
    world.spreadLight(blkQ, false);
    for (let z = z0; z <= z1; z += 8) for (let x = x0; x <= x1; x += 8) world.markDirty(x, y0, z, true);
    world.markDirty(x1, y0, z1, true); world.markDirty(x0, y0, z0, true);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { if ((x & 15) === 0 || (x & 15) === 15 || (z & 15) === 0 || (z & 15) === 15) world.markDirty(x, y0, z, true); }
}
