// ============================================================================
// player.js — player physics & survival stats, block interaction, held item
// ============================================================================
'use strict';

const Player = {
    pos: { x: 0.5, y: 80, z: 0.5 }, vel: { x: 0, y: 0, z: 0 },
    w: 0.6, h: 1.8, eye: 1.62, yaw: 0, pitch: 0,
    onGround: false, flying: false, sprinting: false, sneaking: false,
    inWater: false, headWater: false, inLava: false, hitX: false, hitZ: false, hitHead: false,
    fallDist: 0, hp: 20, food: 20, sat: 5, exh: 0, regenT: 0, starveT: 0, air: 15, drownT: 0,
    invuln: 0, xpTotal: 0, xpLevel: 0, xpProg: 0, jumpCd: 0, lastWTap: -9, lastSpaceTap: -9, wasW: false, wasSpace: false,
    walkDist: 0, bob: 0, bobAmt: 0, stepAcc: 0, burning: 0, cactusT: 0, lavaT: 0, voidT: 0, swim: 0,
    spawn: { x: 0.5, y: 80, z: 0.5 },

    reset() {
        this.vel = { x: 0, y: 0, z: 0 };
        this.hp = 20; this.food = 20; this.sat = 5; this.exh = 0; this.air = 15; this.fallDist = 0; this.burning = 0;
        this.flying = false; this.sprinting = false; this.sneaking = false; this.h = 1.8; this.eye = 1.62;
        this.invuln = 1;
    },
    setSpawn(x, y, z) { this.spawn = { x, y, z }; },
    teleport(x, y, z) { this.pos.x = x; this.pos.y = y; this.pos.z = z; this.vel.x = this.vel.y = this.vel.z = 0; this.fallDist = 0; },

    update(dt, keys, canMove) {
        const k = canMove ? keys : {};
        const P = this.pos, V = this.vel;
        const creative = Game.mode === 'creative';
        this.invuln = Math.max(0, this.invuln - dt);
        this.jumpCd = Math.max(0, this.jumpCd - dt);
        const now = performance.now() / 1000;

        // ---- environment -----------------------------------------------------------------
        const feetL = liquidAt(P.x, P.y + 0.1, P.z), bodyL = liquidAt(P.x, P.y + 0.9, P.z), headL = liquidAt(P.x, P.y + this.eye, P.z);
        const wasWater = this.inWater;
        this.inWater = feetL === 1 || bodyL === 1;
        this.inLava = feetL === 2 || bodyL === 2;
        this.headWater = headL === 1;
        if (this.inWater && !wasWater && this.vel.y < -4) { Sound.play('splash', [P.x, P.y, P.z]); Particles.puff(P.x, P.y + 0.3, P.z, 14, [0.5, 0.65, 1], 0.07, 4, 0.7, 0.4); }

        // ---- input -> wish direction -----------------------------------------------------------
        const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
        const s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
        let wx = -Math.sin(this.yaw) * f + Math.cos(this.yaw) * s;
        let wz = -Math.cos(this.yaw) * f - Math.sin(this.yaw) * s;
        const wl = Math.hypot(wx, wz);
        if (wl > 0) { wx /= wl; wz /= wl; }

        // sneaking / sprinting
        const wantSneak = !!(k.ShiftLeft || k.ShiftRight) && !this.flying && !this.inWater;
        if (wantSneak) this.sneaking = true;
        else if (this.sneaking && !collides(P.x, P.y, P.z, this.w, 1.8)) this.sneaking = false;
        this.h = this.sneaking ? 1.5 : 1.8;
        const eyeT = this.sneaking ? 1.27 : 1.62;
        this.eye += (eyeT - this.eye) * Math.min(1, dt * 16);

        const wDown = !!(k.KeyW || k.ArrowUp);
        if (wDown && !this.wasW) { if (now - this.lastWTap < 0.3) this.sprintTap = true; this.lastWTap = now; }
        if (!wDown) this.sprintTap = false;
        this.wasW = wDown;
        if ((k.ControlLeft || k.ControlRight || this.sprintTap) && f > 0 && !this.sneaking && (this.food > 6 || creative)) this.sprinting = true;
        if (f <= 0 || this.sneaking || (this.food <= 6 && !creative)) this.sprinting = false;

        // creative flight toggle (double tap space)
        const spaceDown = !!k.Space;
        if (spaceDown && !this.wasSpace && creative) {
            if (now - this.lastSpaceTap < 0.28) { this.flying = !this.flying; this.vel.y = 0; }
            this.lastSpaceTap = now;
        }
        this.wasSpace = spaceDown;
        if (!creative) this.flying = false;
        if (this.flying && this.onGround && !spaceDown && this.vel.y <= 0 && k.ShiftLeft) { /* shift lands in vanilla only when on ground */ }

        // ---- horizontal velocity -----------------------------------------------------------------------
        let speed = 4.317;
        if (this.sprinting) speed = 5.612;
        if (this.sneaking) speed = 1.295;
        if (this.flying) speed = this.sprinting ? 21.6 : 10.9;
        else if (this.inLava) speed = 1.6;
        else if (this.inWater) speed = this.sprinting ? 3.4 : 2.6;
        const tvx = wx * speed, tvz = wz * speed;
        let a = this.flying ? 10 : (this.onGround ? 16 : (this.inWater || this.inLava ? 6 : 2.6));
        const kf = 1 - Math.exp(-a * dt);
        V.x += (tvx - V.x) * kf; V.z += (tvz - V.z) * kf;

        // ---- vertical ------------------------------------------------------------------------------------------
        if (this.flying) {
            const up = (spaceDown ? 1 : 0) - ((k.ShiftLeft || k.ShiftRight) ? 1 : 0);
            const vt = up * (this.sprinting ? 14 : 8.5);
            V.y += (vt - V.y) * (1 - Math.exp(-12 * dt));
        } else if (this.inWater) {
            if (spaceDown) V.y = Math.min(3.6, V.y + 22 * dt); else V.y = Math.max(-2.6, V.y - 7 * dt);
            V.y *= Math.pow(0.55, dt * 6 * 0.6);
            if (spaceDown && (this.hitX || this.hitZ)) V.y = 6.8;      // hop out of the water
        } else if (this.inLava) {
            if (spaceDown) V.y = Math.min(2.4, V.y + 14 * dt); else V.y = Math.max(-1.8, V.y - 4 * dt);
        } else {
            V.y -= GRAVITY * dt;
            if (V.y < -78) V.y = -78;
            if (spaceDown && this.onGround && this.jumpCd <= 0) {
                V.y = 9.0; this.jumpCd = 0.42; this.onGround = false;
                Game.addExhaustion(this.sprinting ? 0.2 : 0.05);
                if (this.sprinting) { V.x += wx * 2.2; V.z += wz * 2.2; }
            }
        }

        // ---- move with collision (sneak = don't walk off edges) ------------------------------------------------
        const prevGround = this.onGround;
        const prevY = P.y;
        this.onGround = false; this.hitX = false; this.hitZ = false; this.hitHead = false;
        if (collides(P.x, P.y, P.z, this.w, this.h)) { for (let q = 0; q < 6 && collides(P.x, P.y, P.z, this.w, this.h); q++) P.y += 0.25; }
        moveAxis(this, 'y', V.y * dt);
        const edge = this.sneaking && prevGround && !this.flying;
        const px = P.x;
        moveAxis(this, 'x', V.x * dt);
        if (edge && !collides(P.x, P.y - 0.6, P.z, this.w, 0.6)) { P.x = px; V.x = 0; }
        const pz = P.z;
        moveAxis(this, 'z', V.z * dt);
        if (edge && !collides(P.x, P.y - 0.6, P.z, this.w, 0.6)) { P.z = pz; V.z = 0; }
        if (this.flying && this.onGround && !spaceDown) { /* stay flying until toggled */ }
        if (this.sprinting && (this.hitX || this.hitZ) && !this.flying) this.sprinting = false;

        // ---- fall damage ---------------------------------------------------------------------------------------------
        if (this.inWater || this.inLava || this.flying) this.fallDist = 0;
        else if (!this.onGround && P.y < prevY) this.fallDist += prevY - P.y;
        if (this.onGround && !prevGround) {
            if (this.fallDist > 3 && !creative) {
                const dmg = Math.ceil(this.fallDist - 3);
                Game.damagePlayer(dmg, 'fall');
            }
            if (this.fallDist > 1.2) Sound.block(this.groundSound(), 'break', [P.x - 0.5, P.y - 1, P.z - 0.5]);
            this.fallDist = 0;
        }
        if (this.onGround) this.fallDist = 0;

        // ---- steps, bobbing -------------------------------------------------------------------------------------------------
        const hs = Math.hypot(V.x, V.z);
        if (this.onGround && hs > 0.5 && !this.flying) {
            this.walkDist += hs * dt;
            this.stepAcc += hs * dt;
            const stride = this.sprinting ? 2.0 : 1.6;
            if (this.stepAcc > stride && !this.sneaking) { this.stepAcc = 0; Sound.block(this.groundSound(), 'step', [P.x - 0.5, P.y - 1, P.z - 0.5]); }
            if (this.sprinting) Game.addExhaustion(0.1 * hs * dt);
        }
        this.bobAmt += ((this.onGround && hs > 0.5 ? Math.min(1, hs / 4.3) : 0) - this.bobAmt) * Math.min(1, dt * 12);
        this.bob += hs * dt * 1.7;

        // ---- hazards ------------------------------------------------------------------------------------------------------------------
        if (!creative) {
            if (this.headWater) {
                this.air -= dt;
                if (this.air < 0) { this.drownT -= dt; if (this.drownT <= 0) { this.drownT = 1; Game.damagePlayer(2, 'drown'); } }
            } else { this.air = Math.min(15, this.air + dt * 6); this.drownT = 0; }
            if (this.inLava) { this.burning = 8; this.lavaT -= dt; if (this.lavaT <= 0) { this.lavaT = 0.5; Game.damagePlayer(4, 'lava'); } }
            if (this.burning > 0) {
                if (this.inWater) this.burning = 0;
                this.burning -= dt; this.burnT = (this.burnT || 0) - dt;
                if (this.burnT <= 0) { this.burnT = 1; Game.damagePlayer(1, 'fire'); }
            }
            // cactus
            this.cactusT -= dt;
            if (this.cactusT <= 0) {
                const m = 0.32, x0 = Math.floor(P.x - 0.3 - m * 0.3), x1 = Math.floor(P.x + 0.3 + m * 0.3), z0 = Math.floor(P.z - 0.3 - m * 0.3), z1 = Math.floor(P.z + 0.3 + m * 0.3);
                outer: for (let y = Math.floor(P.y); y <= Math.floor(P.y + 1.4); y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
                    if (world.getBlock(x, y, z) === B.cactus) { Game.damagePlayer(1, 'cactus'); this.cactusT = 0.5; break outer; }
                }
            }
        } else { this.air = 15; this.burning = 0; }
        if (P.y < -64) { this.voidT -= dt; if (this.voidT <= 0) { this.voidT = 0.5; Game.damagePlayer(4, 'void', undefined, undefined, true); } }
        if (this.burning > 0 && Math.random() < dt * 12) Particles.puff(P.x + (Math.random() - 0.5) * 0.5, P.y + Math.random() * 1.5, P.z + (Math.random() - 0.5) * 0.5, 1, [1, 0.5, 0.1], 0.05, 1, 0.5, -0.5, true);
    },

    groundSound() {
        const id = world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z));
        return id ? DEFS[id].sound : 'stone';
    }
};

// ---------------------------------------------------------------------------
// Experience maths (vanilla formulas)
// ---------------------------------------------------------------------------
function xpForLevel(l) { return l <= 15 ? 2 * l + 7 : (l <= 30 ? 5 * l - 38 : 9 * l - 158); }

// ---------------------------------------------------------------------------
// Block / entity interaction
// ---------------------------------------------------------------------------
const Interact = {
    target: null,           // {kind:'block', x,y,z,nx,ny,nz,id,dist} | {kind:'mob', mob, dist}
    mineX: 0, mineY: 0, mineZ: 0, mineT: 0, mining: false,
    attackCd: 0, swing: 0, swinging: false, eatT: 0, eating: false, placeCd: 0, hitSoundT: 0,
    leftHeld: false, rightHeld: false, clickAttack: false,
    outline: null, crack: null, reach: 5,

    init(scene) {
        this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
        this.outline.visible = false; this.outline.renderOrder = 3;
        scene.add(this.outline);
        this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: crackCanvases[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        this.crack.visible = false; this.crack.renderOrder = 4;
        scene.add(this.crack);
    },

    raycast() {
        const P = Player.pos;
        const ox = P.x, oy = P.y + Player.eye, oz = P.z;
        const cp = Math.cos(Player.pitch);
        const dx = -Math.sin(Player.yaw) * cp, dy = Math.sin(Player.pitch), dz = -Math.cos(Player.yaw) * cp;
        const reach = Game.mode === 'creative' ? 5.5 : 4.5;
        let ix = Math.floor(ox), iy = Math.floor(oy), iz = Math.floor(oz);
        const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
        const tdx = dx !== 0 ? Math.abs(1 / dx) : 1e9, tdy = dy !== 0 ? Math.abs(1 / dy) : 1e9, tdz = dz !== 0 ? Math.abs(1 / dz) : 1e9;
        let tmx = dx > 0 ? (ix + 1 - ox) * tdx : (ox - ix) * tdx;
        let tmy = dy > 0 ? (iy + 1 - oy) * tdy : (oy - iy) * tdy;
        let tmz = dz > 0 ? (iz + 1 - oz) * tdz : (oz - iz) * tdz;
        let nx = 0, ny = 0, nz = 0, dist = 0, blockHit = null;
        for (let n = 0; n < 40 && dist <= reach; n++) {
            const id = world.getBlock(ix, iy, iz);
            if (id && !DEFS[id].liquid) {
                blockHit = { kind: 'block', x: ix, y: iy, z: iz, nx, ny, nz, id, dist };
                break;
            }
            if (tmx < tmy && tmx < tmz) { ix += sx; dist = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
            else if (tmy < tmz) { iy += sy; dist = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
            else { iz += sz; dist = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
        }
        // entities
        let mobHit = null, best = Math.min(blockHit ? blockHit.dist : reach, Game.mode === 'creative' ? 5.5 : 3.2);
        for (const m of Mobs.list) {
            if (m.dead || !m.mesh.visible) continue;
            const hw = m.w / 2 + 0.05;
            let t0 = 0, t1 = best;
            const mins = [m.pos.x - hw, m.pos.y, m.pos.z - hw], maxs = [m.pos.x + hw, m.pos.y + m.h, m.pos.z + hw];
            const o = [ox, oy, oz], d = [dx, dy, dz];
            let ok = true;
            for (let a = 0; a < 3; a++) {
                if (Math.abs(d[a]) < 1e-8) { if (o[a] < mins[a] || o[a] > maxs[a]) { ok = false; break; } }
                else {
                    let ta = (mins[a] - o[a]) / d[a], tb = (maxs[a] - o[a]) / d[a];
                    if (ta > tb) { const t = ta; ta = tb; tb = t; }
                    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
                    if (t0 > t1) { ok = false; break; }
                }
            }
            if (ok && t0 < best) { best = t0; mobHit = { kind: 'mob', mob: m, dist: t0 }; }
        }
        this.target = mobHit || blockHit;
        this.dir = { x: dx, y: dy, z: dz };
    },

    update(dt, active) {
        this.attackCd = Math.max(0, this.attackCd - dt);
        this.placeCd = Math.max(0, this.placeCd - dt);
        this.hitSoundT = Math.max(0, this.hitSoundT - dt);
        if (this.swinging) { this.swing += dt / 0.3; if (this.swing >= 1) { this.swing = 0; this.swinging = false; } }

        if (!active) { this.target = null; this.outline.visible = false; this.crack.visible = false; this.mining = false; this.eating = false; this.eatT = 0; return; }
        this.raycast();
        const t = this.target;

        // outline
        if (t && t.kind === 'block') {
            this.outline.visible = true;
            this.outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
        } else this.outline.visible = false;

        // ---- left button: mine / attack ---------------------------------------------------------------------
        if (this.leftHeld) {
            if (t && t.kind === 'mob') {
                this.mining = false;
                if (this.attackCd <= 0 && (this.clickAttack || true)) this.attackMob(t.mob);
            } else if (t && t.kind === 'block') {
                this.mineBlock(t, dt);
            } else { this.mining = false; this.swingArm(); }
        } else this.mining = false;
        if (!this.mining) { this.mineT = 0; this.crack.visible = false; }

        // ---- right button: eat / use ------------------------------------------------------------------------------
        const held = Inv.held(), hd = held ? DEFS[held.id] : null;
        if (this.rightHeld && hd && hd.food && (Player.food < 20 || false) && Game.mode === 'survival') {
            this.eating = true; this.eatT += dt;
            if (Math.floor(this.eatT * 6) !== Math.floor((this.eatT - dt) * 6)) Sound.play('eat');
            if (this.eatT >= 1.6) {
                this.eatT = 0;
                Game.eat(hd);
                Inv.removeFrom(Inv.sel, 1);
                Sound.play('burp'); UI.refreshHotbar();
            }
        } else { this.eating = false; this.eatT = 0; }
        if (this.rightHeld && this.placeCd <= 0 && !(hd && hd.food)) {
            // a fresh click always acts; holding the button repeats block placement (~4/s)
            if (this.rightFresh) { this.useItem(); this.rightFresh = false; this.placeCd = 0.22; }
            else if (hd && hd.isBlock) { this.useItem(); this.placeCd = 0.22; }
        }
        if (!this.rightHeld) this.rightFresh = false;
    },

    swingArm() { if (!this.swinging) { this.swinging = true; this.swing = 0; } },

    attackMob(m) {
        this.swingArm();
        const held = Inv.held(), hd = held ? DEFS[held.id] : null;
        let dmg = hd && hd.tool ? hd.tool.damage : 1;
        const crit = !Player.onGround && Player.vel.y < 0 && !Player.inWater;
        if (crit) { dmg *= 1.5; Particles.puff(m.pos.x, m.pos.y + m.h * 0.6, m.pos.z, 8, [1, 1, 0.8], 0.06, 3, 0.4, 0.5); }
        const kb = Player.sprinting ? 1.7 : 1;
        if (Mobs.damage(m, Math.ceil(dmg), Player.pos.x, Player.pos.z, kb)) {
            Particles.puff(m.pos.x, m.pos.y + m.h * 0.6, m.pos.z, 4, [0.9, 0.2, 0.2], 0.06, 2, 0.5, 1);
            if (hd && hd.tool) Inv.damageHeld(hd.tool.type === 'sword' ? 1 : 2);
            Game.addExhaustion(0.1);
            if (Player.sprinting) Player.sprinting = false;
            UI.refreshHotbar();
        }
        this.attackCd = 0.45;
    },

    mineBlock(t, dt) {
        this.swingArm();
        const id = world.getBlock(t.x, t.y, t.z);
        if (!id) { this.mining = false; return; }
        const def = DEFS[id];
        const creative = Game.mode === 'creative';
        if (creative) {
            if (this.attackCd <= 0 && def.hardness >= 0 || (def.hardness < 0 && def.key !== 'bedrock' && this.attackCd <= 0)) {
                if (def.key === 'bedrock') return;
                Game.breakBlock(t.x, t.y, t.z, true);
                this.attackCd = 0.2;
            }
            return;
        }
        if (def.hardness < 0) { this.mining = false; return; }
        if (!this.mining || t.x !== this.mineX || t.y !== this.mineY || t.z !== this.mineZ) {
            this.mining = true; this.mineX = t.x; this.mineY = t.y; this.mineZ = t.z; this.mineT = 0;
        }
        const held = Inv.heldDef();
        const need = breakTime(def, held, Player.headWater, Player.onGround || Player.flying);
        this.mineT += dt;
        // hit sounds while digging
        if (this.hitSoundT <= 0) { this.hitSoundT = 0.25; Sound.block(def.sound, 'hit', [t.x, t.y, t.z]); Particles.blockBurst(t.x + t.nx * 0.5 + (t.nx ? 0 : 0), t.y, t.z, id, 2); }
        const prog = Math.min(0.999, this.mineT / need);
        this.crack.visible = true;
        this.crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
        this.crack.material.map = crackCanvases[Math.min(9, Math.floor(prog * 10))];
        if (this.mineT >= need) {
            Game.breakBlock(t.x, t.y, t.z, true);
            this.mineT = 0; this.mining = false; this.crack.visible = false;
        }
    },

    // right click (single use)
    useItem() {
        const t = this.target;
        const held = Inv.held(), hd = held ? DEFS[held.id] : null;
        // GUI blocks
        if (t && t.kind === 'block') {
            const bd = DEFS[t.id];
            if (bd.gui && !Player.sneaking) { UI.openBlockGui(bd.gui, t.x, t.y, t.z); return; }
            if (t.id === B.tnt && hd && hd.key === 'flint_and_steel') {
                world.setBlock(t.x, t.y, t.z, 0); Tnt.prime(t.x, t.y, t.z, 4); Inv.damageHeld(1); this.swingArm(); UI.refreshHotbar(); return;
            }
        }
        if (!hd) return;
        if (hd.food) return;     // handled by eating
        if (hd.isBlock && t && t.kind === 'block') this.placeBlock(t, held, hd);
    },

    placeBlock(t, held, hd) {
        let x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
        const tdef = DEFS[t.id];
        if (tdef.replaceable) { x = t.x; y = t.y; z = t.z; }
        if (y < 0 || y >= WH) return;
        const cur = world.getBlock(x, y, z);
        const cdef = cur ? DEFS[cur] : null;
        if (cur && !cdef.replaceable) return;
        let meta = 0;
        // rules
        if (hd.render === 'torch') {
            const nx = x - t.x, ny = y - t.y, nz = z - t.z;
            if (tdef.replaceable) { if (!SOLID[world.getBlock(x, y - 1, z)]) return; meta = 0; }
            else if (ny === 1) { if (!SOLID[t.id]) return; meta = 0; }
            else if (ny === -1) return;
            else {
                if (!SOLID[t.id]) return;
                meta = nx === 1 ? 1 : nx === -1 ? 2 : nz === 1 ? 3 : 4;
            }
        } else if (hd.render === 'cross') {
            const below = world.getBlock(x, y - 1, z);
            const ok = below === B.grass || below === B.dirt || below === B.snow || (hd.key !== 'sapling' && hd.key !== 'tallgrass' && below === B.sand);
            if (!ok) return;
        } else if (hd.key === 'cactus') {
            const below = world.getBlock(x, y - 1, z);
            if (below !== B.sand && below !== B.cactus) return;
        }
        if (hd.front) {
            const dx = Player.pos.x - (x + 0.5), dz = Player.pos.z - (z + 0.5);
            meta = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 0 : 2);
        }
        // don't place inside the player or a mob
        if (hd.solid) {
            const p = Player.pos, hw = Player.w / 2;
            if (x + 1 > p.x - hw && x < p.x + hw && z + 1 > p.z - hw && z < p.z + hw && y + 1 > p.y && y < p.y + Player.h) return;
            for (const m of Mobs.list) { const mw = m.w / 2; if (x + 1 > m.pos.x - mw && x < m.pos.x + mw && z + 1 > m.pos.z - mw && z < m.pos.z + mw && y + 1 > m.pos.y && y < m.pos.y + m.h) return; }
        }
        world.setBlock(x, y, z, held.id, meta);
        if (hd.key === 'chest') world.tileEntities.set(`${x},${y},${z}`, { type: 'chest', slots: new Array(27).fill(null) });
        if (hd.key === 'furnace') world.tileEntities.set(`${x},${y},${z}`, { type: 'furnace', slots: [null, null, null], burn: 0, burnMax: 0, cook: 0 });
        Sound.block(hd.sound, 'place', [x, y, z]);
        this.swingArm();
        if (Game.mode === 'survival') { Inv.removeFrom(Inv.sel, 1); UI.refreshHotbar(); }
    },

    pickBlock() {   // middle click (creative)
        const t = this.target;
        if (!t || t.kind !== 'block' || Game.mode !== 'creative') return;
        const id = t.id === B.furnace_lit ? B.furnace : t.id;
        for (let i = 0; i < 9; i++) if (Inv.slots[i] && Inv.slots[i].id === id) { Inv.sel = i; UI.refreshHotbar(); return; }
        Inv.slots[Inv.sel] = { id, count: 64, dmg: 0 }; UI.refreshHotbar();
    }
};

// ---------------------------------------------------------------------------
// First-person hand (rendered in its own scene so it never clips into walls)
// ---------------------------------------------------------------------------
const Hand = {
    scene: null, cam: null, group: null, item: null, arm: null, curKey: '', equip: 1, lastSel: -1, bobX: 0, bobY: 0,
    init() {
        this.scene = new THREE.Scene();
        this.cam = new THREE.PerspectiveCamera(70, 1, 0.05, 10);
        this.group = new THREE.Group();
        this.scene.add(this.group);
        const g = mcBox(4, 12, 4, 40, 16, 64, 32);
        bakeShade(g);
        g.translate(0, -0.25, 0);
        this.arm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: getSkin('steve'), vertexColors: true }));
        this.arm.position.set(0.6, -0.5, -0.55);
        this.arm.rotation.set(-1.15, 0.25, 0.1);
        this.arm.scale.set(1.15, 1.15, 1.15);
        this.group.add(this.arm);
    },
    resize(aspect) { this.cam.aspect = aspect; this.cam.updateProjectionMatrix(); },
    setItem(stack) {
        const key = stack ? stack.id + '' : '';
        if (key === this.curKey) return;
        this.curKey = key;
        if (this.item) { this.group.remove(this.item); this.item = null; }
        if (!stack) { this.arm.visible = true; return; }
        this.arm.visible = false;
        const def = DEFS[stack.id];
        const made = createItemMesh(stack.id, def.isBlock && !(def.render === 'cross' || def.render === 'torch') ? 0.22 : 0.42, 1.3);
        this.item = made.mesh;
        this.itemFlat = made.flat;
        this.itemTool = !!def.tool || (!def.isBlock);
        this.group.add(this.item);
    },
    update(dt) {
        const held = Inv.held();
        if (Inv.sel !== this.lastSel) { this.equip = 0; this.lastSel = Inv.sel; }
        this.equip = Math.min(1, this.equip + dt * 5);
        this.setItem(held);
        const bright = brightnessAt(Player.pos.x, Player.pos.y + 1.0, Player.pos.z);
        const bob = Player.bobAmt, ph = Player.bob;
        const bx = Math.sin(ph * 2) * 0.02 * bob, by = Math.abs(Math.cos(ph * 2)) * 0.025 * bob;
        const s = Interact.swing, sq = Math.sqrt(s);
        const sw1 = Math.sin(sq * Math.PI), sw2 = Math.sin(sq * Math.PI * 2), sw3 = Math.sin(s * s * Math.PI);
        let eat = 0;
        if (Interact.eating) eat = Math.abs(Math.sin(Interact.eatT * 14)) * 0.04;
        const down = (1 - this.equip) * 0.6;
        const target = this.item || this.arm;
        if (this.item) {
            if (this.itemFlat) {
                target.position.set(0.58 + bx - sw1 * 0.3, -0.42 + by - down - sw2 * 0.12 + eat - sw1 * 0.0, -0.8 - sw3 * 0.2);
                target.rotation.set(-0.15 - sw1 * 0.9, 0.55 + sw1 * 0.3, -0.35 - sw3 * 0.3);
                if (Interact.eating) { target.position.y += 0.12; target.position.x -= 0.2; target.rotation.x = -0.6; }
            } else {
                target.position.set(0.55 + bx - sw1 * 0.3, -0.4 + by - down - sw2 * 0.12 + eat, -0.78 - sw3 * 0.2);
                target.rotation.set(0.1 - sw1 * 0.8, -0.7 + sw1 * 0.2, 0.05 - sw3 * 0.2);
            }
            this.item.material.color.setScalar(bright);
        } else {
            this.arm.position.set(0.58 + bx - sw1 * 0.25, -0.5 + by - down - sw2 * 0.1, -0.5 - sw3 * 0.25);
            this.arm.rotation.set(-1.15 - sw1 * 0.7, 0.25 + sw1 * 0.3, 0.1);
            this.arm.material.color.setScalar(bright);
        }
    },
    render(renderer) {
        renderer.clearDepth();
        renderer.render(this.scene, this.cam);
    }
};
