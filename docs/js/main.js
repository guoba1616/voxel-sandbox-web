// ============================================================================
// main.js — game state, sky/day-night, input, save/load, main loop
// ============================================================================
'use strict';

const Store = {
    db: null,
    open() {
        return new Promise((res) => {
            try {
                const rq = indexedDB.open('mc_clone', 1);
                rq.onupgradeneeded = () => rq.result.createObjectStore('worlds');
                rq.onsuccess = () => { this.db = rq.result; res(true); };
                rq.onerror = () => res(false);
            } catch (e) { res(false); }
        });
    },
    get(key) {
        return new Promise((res) => {
            if (!this.db) return res(null);
            try { const r = this.db.transaction('worlds').objectStore('worlds').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); } catch (e) { res(null); }
        });
    },
    put(key, val) {
        return new Promise((res) => {
            if (!this.db) return res(false);
            try { const tx = this.db.transaction('worlds', 'readwrite'); tx.objectStore('worlds').put(val, key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); }
        });
    },
    del(key) {
        return new Promise((res) => {
            if (!this.db) return res(false);
            try { const tx = this.db.transaction('worlds', 'readwrite'); tx.objectStore('worlds').delete(key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch (e) { res(false); }
        });
    }
};

const Game = {
    scene: null, camera: null, renderer: null, player: Player,
    mode: 'survival', peaceful: false, state: 'title', dead: false,
    timeOfDay: 0.04, dayCount: 1, shake: 0, hurtT: 0, hurtDir: 0,
    cameraMode: 0, showDebug: false, locked: false, freeLook: false, expectUnlock: false,
    keys: {}, timers: [], worldSeed: 0, saveTimer: 0, fps: 60, fpsAcc: 0, fpsN: 0,
    settings: { rd: 6, fov: 75, sens: 1, vol: 0.8, bright: 0 },
    loadInfo: null, titleAngle: 0, lastSaveToast: 0,

    // =====================================================================================
    init() {
        try { const s = JSON.parse(localStorage.getItem('mc_settings') || 'null'); if (s) Object.assign(this.settings, s); } catch (e) {}
        const canvas = $('game');
        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.autoClear = false;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.05, 800);
        this.scene.add(this.camera);

        buildAtlas();
        initWorldMaterials();
        world.scene = this.scene;
        world.onUnloadModified = (c) => {
            world.saved.set(world.key(c.cx, c.cz), { blocks: c.blocks.slice(), meta: Array.from(c.meta.entries()) });
        };
        Particles.init(this.scene);
        Interact.init(this.scene);
        Hand.init(); Hand.resize(window.innerWidth / window.innerHeight);
        this.buildSky();
        this.steve = buildModel('steve');
        this.steve.visible = false;
        this.scene.add(this.steve);
        UI.init();
        this.bindInput();
        this.bindMenus();
        this.applySettings();
        this.beginTitle();
        Store.open().then(() => this.refreshContinue());
        requestAnimationFrame((t) => { this.last = t; this.frame(t); });
        window.addEventListener('resize', () => this.onResize());
    },

    onResize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
        Hand.resize(w / h);
    },

    applySettings() {
        const s = this.settings;
        world.renderDist = s.rd;
        this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
        Sound.setVolume(s.vol);
        worldUniforms.uBright.value = s.bright * 0.08;
        $('opt-rd').value = s.rd; $('opt-rd-v').textContent = s.rd + ' 区块';
        $('opt-fov').value = s.fov; $('opt-fov-v').textContent = s.fov;
        $('opt-sens').value = s.sens; $('opt-sens-v').textContent = s.sens.toFixed(1) + 'x';
        $('opt-vol').value = s.vol; $('opt-vol-v').textContent = Math.round(s.vol * 100) + '%';
        $('opt-bright').value = s.bright; $('opt-bright-v').textContent = ['正常', '较亮', '最亮'][s.bright];
        try { localStorage.setItem('mc_settings', JSON.stringify(s)); } catch (e) {}
    },

    // =====================================================================================
    // Sky
    // =====================================================================================
    buildSky() {
        const domeMat = new THREE.ShaderMaterial({
            uniforms: { uTop: { value: new THREE.Color(0x78a7ff) }, uBottom: { value: new THREE.Color(0xc0d8ff) } },
            vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
            fragmentShader: 'uniform vec3 uTop; uniform vec3 uBottom; varying vec3 vP; void main(){ float h=normalize(vP).y; float t=clamp(h*1.5+0.02,0.0,1.0); t=pow(t,0.55); gl_FragColor=vec4(mix(uBottom,uTop,t),1.0); }',
            side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
        });
        this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), domeMat);
        this.dome.renderOrder = -10; this.dome.frustumCulled = false;
        this.scene.add(this.dome);

        const sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = 16;
        let g = sunCv.getContext('2d'); g.fillStyle = '#fff6c4'; g.fillRect(2, 2, 12, 12); g.fillStyle = '#ffffff'; g.fillRect(4, 4, 8, 8);
        const moonCv = document.createElement('canvas'); moonCv.width = moonCv.height = 16;
        g = moonCv.getContext('2d'); g.fillStyle = '#d8dce8'; g.fillRect(2, 2, 12, 12); g.fillStyle = '#b8bccc';
        [[4, 4, 3, 3], [9, 6, 3, 2], [5, 9, 2, 3], [10, 10, 2, 2]].forEach(r => g.fillRect(...r));
        const mkTex = (cv) => { const t = new THREE.CanvasTexture(cv); t.magFilter = t.minFilter = THREE.NearestFilter; return t; };
        const mk = (cv, size) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: mkTex(cv), alphaTest: 0.5, depthWrite: false, depthTest: true, fog: false }));
            m.renderOrder = -9; m.frustumCulled = false; this.scene.add(m); return m;
        };
        this.sun = mk(sunCv, 100); this.moon = mk(moonCv, 70);

        const sg = new THREE.BufferGeometry(), sp = [];
        const sr = mulberry32(99);
        for (let i = 0; i < 700; i++) {
            const a = sr() * Math.PI * 2, b = Math.acos(2 * sr() - 1), r = 450;
            sp.push(r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a));
        }
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: true, fog: false });
        this.stars = new THREE.Points(sg, this.starMat);
        this.stars.renderOrder = -9; this.stars.frustumCulled = false;
        this.scene.add(this.stars);

        // clouds
        const cc = document.createElement('canvas'); cc.width = cc.height = 64;
        g = cc.getContext('2d');
        const cp = new Perlin(4242);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
            const n = cp.fbm2(x / 9, y / 9, 3) + cp.noise2(x / 3, y / 3) * 0.12;
            if (n > 0.04) { g.fillStyle = '#fff'; g.fillRect(x, y, 1, 1); }
        }
        this.cloudTex = new THREE.CanvasTexture(cc);
        this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
        this.cloudTex.magFilter = this.cloudTex.minFilter = THREE.NearestFilter;
        this.cloudMat = new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide, fog: false });
        this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), this.cloudMat);
        this.clouds.rotation.x = -Math.PI / 2; this.clouds.renderOrder = -8; this.clouds.frustumCulled = false;
        this.scene.add(this.clouds);
        this.cloudTex.repeat.set(1200 / (64 * 12), 1200 / (64 * 12));
    },

    updateSky(dt) {
        const t = this.timeOfDay;
        const sh = Math.sin(t * Math.PI * 2);           // sun height  (+1 noon)
        const d = THREE.MathUtils.smoothstep(sh, -0.18, 0.22);
        const skyDay = new THREE.Color(0x78a7ff), skyNight = new THREE.Color(0x030612);
        const fogDay = new THREE.Color(0xc0d8ff), fogNight = new THREE.Color(0x070b18);
        const top = skyNight.clone().lerp(skyDay, d);
        const hor = fogNight.clone().lerp(fogDay, d);
        // sunset / sunrise tint
        const sunset = Math.max(0, 1 - Math.abs(sh) / 0.28);
        if (sunset > 0) {
            hor.lerp(new THREE.Color(0xff9a58), sunset * 0.65);
            top.lerp(new THREE.Color(0x6a78c8), sunset * 0.25);
        }
        this.skyTop = top; this.skyHor = hor;
        this.dome.material.uniforms.uTop.value.copy(top);
        this.dome.material.uniforms.uBottom.value.copy(hor);
        world.skyFactor = 0.36 + 0.64 * d;
        worldUniforms.uSky.value = world.skyFactor;

        const cam = this.camera.position;
        this.dome.position.copy(cam);
        const ang = t * Math.PI * 2;
        const sd = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.25).normalize();
        this.sun.position.copy(cam).addScaledVector(sd, 380);
        this.moon.position.copy(cam).addScaledVector(sd, -380);
        this.sun.lookAt(cam); this.moon.lookAt(cam);
        this.stars.position.copy(cam);
        this.stars.rotation.set(0, 0, ang * 0.9);
        this.starMat.opacity = Math.max(0, 1 - d * 1.4) * 0.95;
        // clouds
        const cy = 118;
        this.clouds.position.set(cam.x, cy, cam.z);
        const drift = performance.now() / 1000 * 0.9;
        this.cloudTex.offset.set((cam.x + drift) / (64 * 12), -(cam.z) / (64 * 12));
        this.cloudMat.color.setScalar(0.25 + 0.75 * d).lerp(new THREE.Color(1, 0.8, 0.7), sunset * 0.3);
        this.cloudMat.opacity = 0.5 + 0.35 * d;
    },

    // =====================================================================================
    // States
    // =====================================================================================
    beginTitle() {
        this.state = 'title';
        world.reset(20240601);
        this.clearEntities();
        this.titleAngle = 0;
        this.timeOfDay = 0.1;
        $('title').classList.remove('hidden');
        ['hud', 'loading', 'pause', 'death', 'gui', 'worldmenu', 'options'].forEach(id => this.showEl(id, false));
        this.showEl('title', true);
        this.showEl('titlemenu', true);
    },
    showEl(id, on) { $(id).classList.toggle('hidden', !on); },

    async refreshContinue() {
        const w = await Store.get('main');
        this.hasSave = !!w;
        $('btn-continue').classList.toggle('hidden', !w);
        $('btn-delete').classList.toggle('hidden', !w);
        if (w) $('save-info').textContent = `存档: 种子 ${w.seed} · ${w.mode === 'creative' ? '创造' : '生存'} · 第 ${w.dayCount} 天`;
        else $('save-info').textContent = '没有存档';
    },

    clearEntities() {
        Mobs.clear(); Items.clear(); Arrows.clear(); Falling.clear(); Tnt.clear();
        Particles.list.length = 0; this.timers.length = 0;
    },

    async startWorld(opts) {
        // opts: {seed, mode, peaceful, cont}
        this.state = 'loading';
        this.showEl('title', false); this.showEl('worldmenu', false);
        this.showEl('loading', true);
        $('loading-text').textContent = '正在生成地形…'; $('loading-fill').style.width = '0%';
        let data = null;
        if (opts.cont) data = await Store.get('main');
        const seed = data ? data.seed : opts.seed;
        this.worldSeed = seed;
        world.reset(seed);
        this.clearEntities();
        Inv.reset();
        Player.reset();
        this.dead = false;
        this.mode = data ? data.mode : opts.mode;
        this.peaceful = data ? data.peaceful : opts.peaceful;
        this.timeOfDay = data ? data.timeOfDay : 0.04;
        this.dayCount = data ? data.dayCount : 1;
        this.xpTimer = 0;
        if (data) {
            data.chunks.forEach(([k, blocks, meta]) => world.saved.set(k, { blocks: new Uint8Array(blocks), meta }));
            data.tiles.forEach(([k, te]) => world.tileEntities.set(k, te));
            Inv.load(data.inv);
            const p = data.player;
            Player.hp = p.hp; Player.food = p.food; Player.sat = p.sat; Player.xpTotal = p.xp || 0;
            Player.spawn = p.spawn;
            Player.yaw = p.yaw; Player.pitch = p.pitch;
            this.spawnPos = { x: p.x, y: p.y, z: p.z };
        } else {
            // find a spawn on land
            let sp = null;
            outer: for (let r = 0; r < 600; r += 6) {
                const n = Math.max(1, Math.floor(r / 3));
                for (let i = 0; i < n; i++) {
                    const a = i / n * Math.PI * 2, x = Math.floor(Math.cos(a) * r), z = Math.floor(Math.sin(a) * r);
                    const info = columnInfo(x, z);
                    if ((info.biome === BIOME.PLAINS || info.biome === BIOME.FOREST) && info.h > SEA + 1) { sp = { x, z }; break outer; }
                }
            }
            if (!sp) sp = { x: 0, z: 0 };
            this.spawnPos = { x: sp.x + 0.5, y: 0, z: sp.z + 0.5 };
            if (this.mode === 'creative') { Inv.add(B.stone, 1, 0); Inv.reset(); }
        }
        this.recomputeXP();
        this.loadInfo = { data };
        this.preloadCenter = { x: this.spawnPos.x, z: this.spawnPos.z };
        this.loadDone = false;
        UI.refreshHotbar(); UI.refreshStatus(true);
    },

    finishLoading() {
        // choose spawn height
        const sx = Math.floor(this.spawnPos.x), sz = Math.floor(this.spawnPos.z);
        if (!this.loadInfo.data) {
            let best = null;
            for (let r = 0; r < 12 && !best; r++) for (let dx = -r; dx <= r && !best; dx++) for (let dz = -r; dz <= r && !best; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                const x = sx + dx, z = sz + dz;
                const info = columnInfo(x, z);
                if (info.h <= SEA) continue;
                const y = info.h + 1;
                if (world.getBlock(x, y, z) === 0 && world.getBlock(x, y + 1, z) === 0 && world.getBlock(x, y - 1, z) !== 0 && !DEFS[world.getBlock(x, y - 1, z)].liquid) best = { x, y, z };
            }
            if (!best) best = { x: sx, y: Math.max(SEA + 2, world.surfaceY(sx, sz) + 1), z: sz };
            this.spawnPos = { x: best.x + 0.5, y: best.y, z: best.z + 0.5 };
            Player.spawn = { x: best.x + 0.5, y: best.y, z: best.z + 0.5 };
        }
        Player.teleport(this.spawnPos.x, this.spawnPos.y, this.spawnPos.z);
        if (!this.loadInfo.data) {
            Player.yaw = 0; Player.pitch = 0;
            if (this.mode === 'survival') { /* empty hands, vanilla start */ }
        }
        this.state = 'playing';
        this.showEl('loading', false); this.showEl('hud', true);
        this.setMode(this.mode, true);
        UI.refreshHotbar(); UI.refreshStatus(true);
        this.requestLock();
        this.saveTimer = 0;
    },

    setMode(m, silent) {
        this.mode = m;
        if (m === 'creative') { /* flying off by default */ }
        else Player.flying = false;
        $('survival-hud').style.display = m === 'creative' ? 'none' : '';
        UI.refreshStatus(true);
        if (!silent) UI.toast(m === 'creative' ? '游戏模式已更改为创造模式' : '游戏模式已更改为生存模式');
    },

    requestLock(fromGesture) {
        const c = $('game');
        if (!c.requestPointerLock) { this.freeLook = true; return; }
        try {
            const p = c.requestPointerLock();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {}
        // a click that still can't lock the pointer (e.g. sandboxed preview) falls back to hover-look
        if (fromGesture) setTimeout(() => { if (!document.pointerLockElement && this.state === 'playing') this.freeLook = true; }, 500);
    },
    releaseLock() {
        this.expectUnlock = true;
        if (document.pointerLockElement && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
        setTimeout(() => { this.expectUnlock = false; }, 100);
    },

    pause() {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        this.releaseLock();
        Interact.leftHeld = Interact.rightHeld = false;
        this.showEl('pause', true);
        this.saveWorld(true);
    },
    resume() {
        if (this.state !== 'paused') return;
        this.state = 'playing';
        this.showEl('pause', false); this.showEl('options', false);
        this.requestLock();
    },
    async quitToTitle() {
        await this.saveWorld(true);
        this.showEl('pause', false); this.showEl('hud', false); this.showEl('death', false); this.showEl('options', false);
        UI.closeGui && UI.guiOpen && UI.closeGui();
        this.steve.visible = false;
        this.beginTitle();
        this.refreshContinue();
    },
    onGuiOpen() {
        this.state = 'gui';
        Interact.leftHeld = Interact.rightHeld = false;
        this.releaseLock();
    },
    onGuiClose() {
        if (this.state === 'gui') { this.state = 'playing'; this.requestLock(); }
    },
    canControl() { return this.state === 'playing' && !this.dead; },

    // =====================================================================================
    // Input
    // =====================================================================================
    bindInput() {
        const canvas = $('game');
        document.addEventListener('pointerlockchange', () => {
            this.locked = document.pointerLockElement === canvas;
            if (!this.locked && this.state === 'playing' && !this.expectUnlock) this.pause();
        });
        window.addEventListener('mousemove', (e) => {
            if (this.state !== 'playing' || this.dead) return;
            if (this.locked || (this.freeLook && e.target === canvas)) {
                const s = 0.0022 * this.settings.sens;
                Player.yaw -= e.movementX * s;
                Player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, Player.pitch - e.movementY * s));
            }
        });
        window.addEventListener('mousedown', (e) => {
            Sound.init();
            if (this.state === 'playing' && !this.dead && e.target === canvas) {
                if (!this.locked && !this.freeLook) { this.requestLock(true); return; }
                if (e.button === 0) Interact.leftHeld = true;
                else if (e.button === 2) { Interact.rightHeld = true; Interact.rightFresh = true; }
                else if (e.button === 1) { e.preventDefault(); Interact.pickBlock(); }
            }
            if (this.state === 'gui' && e.target.id === 'gui') UI.dropCursor();
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) Interact.leftHeld = false;
            if (e.button === 2) { Interact.rightHeld = false; }
        });
        window.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('wheel', (e) => {
            if (this.state !== 'playing') return;
            Inv.sel = (Inv.sel + (e.deltaY > 0 ? 1 : 8)) % 9;
            UI.refreshHotbar();
        }, { passive: true });
        window.addEventListener('keydown', (e) => {
            if (e.target && (e.target.tagName === 'INPUT') && e.target.type === 'text') return;
            Sound.init();
            if (['Tab', 'F3', 'F5', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code) && (this.state === 'playing' || this.state === 'gui')) e.preventDefault();
            if (e.repeat && e.code !== 'KeyQ') { this.keys[e.code] = true; return; }
            this.keys[e.code] = true;
            if (this.state === 'playing' && !this.dead) {
                if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5), 10); if (n >= 1 && n <= 9) { Inv.sel = n - 1; UI.refreshHotbar(); } }
                else if (e.code === 'KeyE') UI.openInventory();
                else if (e.code === 'KeyQ') this.dropHeld(e.ctrlKey);
                else if (e.code === 'Escape' && this.freeLook) this.pause();
            } else if (this.state === 'paused' && e.code === 'Escape') this.resume();
            if (e.code === 'F3') { e.preventDefault(); this.showDebug = !this.showDebug; $('debug').classList.toggle('hidden', !this.showDebug); }
            if (e.code === 'F5' && this.state !== 'title') { this.cameraMode = (this.cameraMode + 1) % 2; }
            if (e.code === 'KeyF' && this.state === 'playing' && this.mode === 'creative') { Player.flying = !Player.flying; }
        });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
        window.addEventListener('blur', () => { this.keys = {}; Interact.leftHeld = Interact.rightHeld = false; });
        window.addEventListener('beforeunload', () => { if (this.state === 'playing' || this.state === 'paused' || this.state === 'gui') this.saveWorld(true); });
    },

    dropHeld(all) {
        const s = Inv.held();
        if (!s) return;
        const n = all ? s.count : 1;
        this.dropFromPlayer({ id: s.id, count: n, dmg: s.dmg });
        Inv.removeFrom(Inv.sel, n);
        UI.refreshHotbar();
    },
    dropFromPlayer(stack) {
        const P = Player.pos, cp = Math.cos(Player.pitch);
        const dx = -Math.sin(Player.yaw) * cp, dy = Math.sin(Player.pitch), dz = -Math.cos(Player.yaw) * cp;
        const e = Items.spawn(P.x, P.y + Player.eye - 0.3, P.z, stack.id, stack.count, stack.dmg || 0, { x: dx * 5 + Player.vel.x * 0.3, y: dy * 5 + 1.8, z: dz * 5 + Player.vel.z * 0.3 });
        if (e) e.delay = 1.5;
    },

    bindMenus() {
        const on = (id, fn) => $(id).addEventListener('click', (e) => { Sound.init(); Sound.play('click'); fn(e); });
        on('btn-single', () => { this.showEl('titlemenu', false); this.showEl('worldmenu', true); });
        on('btn-continue', () => this.startWorld({ cont: true }));
        on('btn-delete', async () => { if (confirm('确定删除存档吗?')) { await Store.del('main'); this.refreshContinue(); } });
        on('btn-world-back', () => { this.showEl('worldmenu', false); this.showEl('titlemenu', true); });
        on('btn-create', () => {
            const sv = $('seed-input').value.trim();
            let seed = Math.floor(Math.random() * 2147483647);
            if (sv) { const n = parseInt(sv, 10); if (!isNaN(n)) seed = n; else { seed = 0; for (const ch of sv) seed = (seed * 31 + ch.charCodeAt(0)) | 0; } }
            this.startWorld({ seed, mode: this.menuMode || 'survival', peaceful: !!this.menuPeaceful });
        });
        this.menuMode = 'survival'; this.menuPeaceful = false;
        on('btn-mode', () => { this.menuMode = this.menuMode === 'survival' ? 'creative' : 'survival'; $('btn-mode').textContent = '游戏模式: ' + (this.menuMode === 'survival' ? '生存' : '创造'); });
        on('btn-peace', () => { this.menuPeaceful = !this.menuPeaceful; $('btn-peace').textContent = '难度: ' + (this.menuPeaceful ? '和平' : '普通'); });
        on('btn-options-title', () => { this.optionsFrom = 'title'; this.showEl('titlemenu', false); this.showEl('options', true); });
        on('btn-resume', () => this.resume());
        on('btn-options', () => { this.optionsFrom = 'pause'; this.showEl('pause', false); this.showEl('options', true); });
        on('btn-options-back', () => {
            this.showEl('options', false);
            if (this.optionsFrom === 'title') this.showEl('titlemenu', true); else this.showEl('pause', true);
        });
        on('btn-quit', () => this.quitToTitle());
        on('btn-respawn', () => this.respawn());
        on('btn-death-title', () => { this.dead = false; this.quitToTitle(); });
        on('btn-mode-pause', () => { this.setMode(this.mode === 'survival' ? 'creative' : 'survival'); $('btn-mode-pause').textContent = '游戏模式: ' + (this.mode === 'survival' ? '生存' : '创造'); });
        const slider = (id, key, parse) => $(id).addEventListener('input', (e) => { this.settings[key] = parse(e.target.value); this.applySettings(); });
        slider('opt-rd', 'rd', v => parseInt(v, 10)); slider('opt-fov', 'fov', v => parseInt(v, 10));
        slider('opt-sens', 'sens', v => parseFloat(v)); slider('opt-vol', 'vol', v => parseFloat(v)); slider('opt-bright', 'bright', v => parseInt(v, 10));
    },

    // =====================================================================================
    // Game events
    // =====================================================================================
    damagePlayer(amount, src, fx, fz, noKb) {
        if (this.mode === 'creative' || this.dead || amount <= 0) return;
        if (Player.invuln > 0 && src !== 'void' && src !== 'lava') return;
        Player.hp = Math.max(0, Player.hp - amount);
        Player.invuln = 0.5;
        this.hurtT = 0.45;
        Sound.play('hurt');
        this.addExhaustion(0.1);
        if (fx !== undefined && !noKb) {
            const dx = Player.pos.x - fx, dz = Player.pos.z - fz, d = Math.hypot(dx, dz) || 1;
            Player.vel.x += dx / d * 6; Player.vel.z += dz / d * 6; Player.vel.y = Math.max(Player.vel.y, 4.5);
            this.hurtDir = Math.atan2(dx, dz);
        }
        UI.refreshStatus(true);
        if (Player.hp <= 0) this.die(src);
    },
    die(src) {
        this.dead = true;
        const msg = { fall: '摔死了', drown: '淹死了', lava: '试图在熔岩里游泳', fire: '被烧死了', zombie: '被僵尸杀死了', arrow: '被骷髅射杀了', explosion: '被炸飞了', cactus: '被仙人掌扎死了', void: '掉出了这个世界' }[src] || '死了';
        $('death-msg').textContent = '你' + msg;
        $('death-score').textContent = '得分: ' + Player.xpLevel;
        Sound.play('death');
        // scatter inventory
        for (let i = 0; i < 36; i++) {
            const s = Inv.slots[i]; if (!s) continue;
            const a = Math.random() * Math.PI * 2;
            Items.spawn(Player.pos.x, Player.pos.y + 1, Player.pos.z, s.id, s.count, s.dmg, { x: Math.cos(a) * 3, y: 4, z: Math.sin(a) * 3 });
            Inv.slots[i] = null;
        }
        Player.xpTotal = 0; this.recomputeXP();
        UI.refreshHotbar();
        if (UI.guiOpen) UI.closeGui();
        Interact.leftHeld = Interact.rightHeld = false;
        this.releaseLock();
        this.showEl('death', true); this.showEl('hud', false);
    },
    respawn() {
        this.showEl('death', false); this.showEl('hud', true);
        Player.reset();
        const s = Player.spawn;
        world.ensureGenerated(Math.floor(s.x / 16), Math.floor(s.z / 16));
        let y = s.y; while (collides(s.x, y, s.z, 0.6, 1.8) && y < WH - 3) y++;
        Player.teleport(s.x, y, s.z);
        this.dead = false;
        UI.refreshStatus(true);
        this.requestLock();
    },
    recomputeXP() {
        let total = Player.xpTotal, lvl = 0, need = xpForLevel(0);
        while (total >= need) { total -= need; lvl++; need = xpForLevel(lvl); }
        Player.xpLevel = lvl; Player.xpProg = total / need;
    },
    addXP(points) {
        const before = Player.xpLevel;
        Player.xpTotal += points; this.recomputeXP();
        if (Player.xpLevel > before) Sound.play('levelup');
        UI.refreshStatus(true);
    },
    addExhaustion(x) { if (this.mode === 'survival') Player.exh += x; },
    eat(def) {
        Player.food = Math.min(20, Player.food + def.food);
        Player.sat = Math.min(Player.food, Player.sat + def.sat);
        UI.refreshStatus(true);
    },
    updateSurvival(dt) {
        if (this.mode !== 'survival' || this.dead) return;
        const p = Player;
        if (p.exh >= 4) { p.exh -= 4; if (p.sat > 0) p.sat = Math.max(0, p.sat - 1); else p.food = Math.max(0, p.food - 1); }
        if (p.food >= 18 && p.hp < 20) {
            p.regenT += dt;
            const need = (p.food >= 20 && p.sat > 0) ? 0.5 : 4;
            if (p.regenT >= need) { p.regenT = 0; p.hp = Math.min(20, p.hp + 1); this.addExhaustion(need < 1 ? 1.5 : 6); UI.refreshStatus(true); }
        } else if (p.food <= 0) {
            p.starveT += dt;
            if (p.starveT >= 4) { p.starveT = 0; if (p.hp > 1) this.damagePlayer(1, 'starve'); }
        } else p.regenT = 0;
    },

    breakBlock(x, y, z, byPlayer) {
        const id = world.getBlock(x, y, z);
        if (!id) return;
        const def = DEFS[id];
        if (def.hardness < 0 && def.key !== 'obsidian' && !def.liquid) { if (def.key === 'bedrock') return; }
        const held = Inv.heldDef();
        if (byPlayer && this.mode === 'survival') {
            if (held && held.tool && def.hardness > 0) { Inv.damageHeld(held.tool.type === 'sword' ? 2 : 1); UI.refreshHotbar(); }
            this.addExhaustion(0.005);
        }
        this.onBlockBroken(x, y, z, id, byPlayer ? held : null, byPlayer);
        world.setBlock(x, y, z, 0);
        if (id === B.log || id === B.birch_log) this.leafDecayCheck(x, y, z);
    },
    onBlockBroken(x, y, z, id, toolDef, byPlayer) {
        const def = DEFS[id];
        Sound.block(def.sound, 'break', [x, y, z]);
        Particles.blockBurst(x, y, z, id, 18);
        const survival = this.mode === 'survival' || !byPlayer;
        if (survival) {
            const drops = blockDrops(id, toolDef, Math.random);
            drops.forEach(([i2, n]) => Items.spawn(x + 0.5, y + 0.3, z + 0.5, i2, n));
            if (def.xp && byPlayer && canHarvest(def, toolDef)) this.addXP(def.xp[0] + Math.floor(Math.random() * (def.xp[1] - def.xp[0] + 1)));
        }
        const key = `${x},${y},${z}`;
        const te = world.tileEntities.get(key);
        if (te) {
            te.slots.forEach(s => { if (s) Items.spawn(x + 0.5, y + 0.4, z + 0.5, s.id, s.count, s.dmg); });
            world.tileEntities.delete(key);
        }
    },
    leafDecayCheck(x, y, z) {
        // flood from remaining logs through leaves (max 4 steps); anything else decays
        const R = 6, reach = new Map();
        const q = [];
        for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
            const id = world.getBlock(x + dx, y + dy, z + dz);
            if (id === B.log || id === B.birch_log) { reach.set(`${x + dx},${y + dy},${z + dz}`, 0); q.push([x + dx, y + dy, z + dz, 0]); }
        }
        for (let i = 0; i < q.length; i++) {
            const [cx, cy, cz, d] = q[i];
            if (d >= 4) continue;
            for (const dv of DIRS) {
                const nx = cx + dv[0], ny = cy + dv[1], nz = cz + dv[2];
                const k = `${nx},${ny},${nz}`;
                if (reach.has(k)) continue;
                const id = world.getBlock(nx, ny, nz);
                if (id === B.leaves || id === B.birch_leaves) { reach.set(k, d + 1); q.push([nx, ny, nz, d + 1]); }
            }
        }
        for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
            const lx = x + dx, ly = y + dy, lz = z + dz;
            const id = world.getBlock(lx, ly, lz);
            if ((id === B.leaves || id === B.birch_leaves) && !reach.has(`${lx},${ly},${lz}`)) {
                this.timers.push({ t: 0.4 + Math.random() * 5, fn: () => {
                    const cur = world.getBlock(lx, ly, lz);
                    if (cur === B.leaves || cur === B.birch_leaves) {
                        Particles.blockBurst(lx, ly, lz, cur, 6);
                        blockDrops(cur, null, Math.random).forEach(([i2, n]) => Items.spawn(lx + 0.5, ly + 0.3, lz + 0.5, i2, n));
                        world.setBlock(lx, ly, lz, 0);
                    }
                } });
            }
        }
    },
    spawnFallingBlock(x, y, z, id) { Falling.spawn(x, y, z, id); },
    onChunkGenerated(c, infos) {
        if (this.state === 'title' || this.state === 'loading') { if (this.state === 'title') return; }
        if (!this.peaceful) Mobs.populateChunk(c, infos);
        else Mobs.populateChunk(c, infos);
    },

    // =====================================================================================
    // Furnaces & timers
    // =====================================================================================
    updateFurnaces(dt) {
        for (const [key, te] of world.tileEntities) {
            if (te.type !== 'furnace') continue;
            const [x, y, z] = key.split(',').map(Number);
            if (!world.isLoaded(x, z)) continue;
            const inp = te.slots[0], fuel = te.slots[1], out = te.slots[2];
            const recipe = inp ? SMELTING[inp.id] : null;
            const canSmelt = !!recipe && (!out || (out.id === recipe.out && out.count < maxStack(out.id)));
            if (te.burn <= 0 && canSmelt && fuel && FUEL[fuel.id]) {
                te.burnMax = te.burn = FUEL[fuel.id];
                fuel.count--; if (fuel.count <= 0) te.slots[1] = null;
            }
            if (te.burn > 0) {
                te.burn -= dt;
                if (canSmelt) {
                    te.cook += dt;
                    if (te.cook >= 10) {
                        te.cook = 0;
                        if (out) out.count++; else te.slots[2] = { id: recipe.out, count: 1, dmg: 0 };
                        inp.count--; if (inp.count <= 0) te.slots[0] = null;
                        te.xp = (te.xp || 0) + recipe.xp;
                    }
                } else te.cook = Math.max(0, te.cook - dt * 2);
            } else te.cook = Math.max(0, te.cook - dt * 2);
            const lit = te.burn > 0;
            const cur = world.getBlock(x, y, z);
            if (lit && cur === B.furnace) world.setBlock(x, y, z, B.furnace_lit, world.getMeta(x, y, z));
            else if (!lit && cur === B.furnace_lit) world.setBlock(x, y, z, B.furnace, world.getMeta(x, y, z));
        }
    },
    updateTimers(dt) {
        for (let i = this.timers.length - 1; i >= 0; i--) {
            this.timers[i].t -= dt;
            if (this.timers[i].t <= 0) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
        }
    },
    randomTicks(dt) {
        // saplings grow into trees; grass spreads to nearby dirt
        this.rtAcc = (this.rtAcc || 0) + dt;
        if (this.rtAcc < 0.5) return;
        this.rtAcc = 0;
        const px = Player.pos.x, pz = Player.pos.z;
        for (let n = 0; n < 220; n++) {
            const x = Math.floor(px + (Math.random() - 0.5) * 64), z = Math.floor(pz + (Math.random() - 0.5) * 64);
            const c = world.chunkAt(x, z);
            if (!c || !c.generated) continue;
            const y = Math.max(1, Math.min(c.maxY, SEA + Math.floor((Math.random() - 0.3) * 60)));
            const id = world.getBlock(x, y, z);
            if (id === B.dirt) {
                if (world.getBlock(x, y + 1, z) !== 0 && !DEFS[world.getBlock(x, y + 1, z)].replaceable) continue;
                if (((world.getLight(x, y + 1, z) >> 4) < 9)) continue;
                for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [1, -1, 0], [-1, -1, 0]]) {
                    if (world.getBlock(x + dx, y + dy, z + dz) === B.grass) { world.setBlock(x, y, z, B.grass); break; }
                }
            } else if (id === B.grass) {
                const above = world.getBlock(x, y + 1, z);
                if (above && DEFS[above].opaque) world.setBlock(x, y, z, B.dirt);
            } else if (id === B.sapling) {
                if (Math.random() < 0.25) this.growTree(x, y, z);
            }
        }
    },
    growTree(x, y, z) {
        const below = world.getBlock(x, y - 1, z);
        if (below !== B.grass && below !== B.dirt) return;
        const h = 4 + Math.floor(Math.random() * 3);
        for (let k = 1; k <= h + 1; k++) { const b = world.getBlock(x, y + k - 1, z); if (k > 1 && b !== 0 && !DEFS[b].replaceable && b !== B.leaves) return; }
        world.setBlock(x, y, z, 0);
        const top = y - 1 + h;
        for (let ly = top - 2; ly <= top + 1; ly++) {
            const r = ly >= top ? 1 : 2;
            for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
                if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 1 || Math.random() < 0.5)) continue;
                const b = world.getBlock(x + dx, ly, z + dz);
                if (b === 0 || DEFS[b].replaceable) world.setBlock(x + dx, ly, z + dz, B.leaves);
            }
        }
        for (let k = 0; k < h; k++) world.setBlock(x, y + k, z, B.log);
    },

    // =====================================================================================
    // Save / load
    // =====================================================================================
    async saveWorld(quiet) {
        if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'gui') return;
        const chunks = [];
        const seen = new Set();
        world.chunks.forEach((c, k) => { if (c.modified) { chunks.push([k, Array.from(c.blocks), Array.from(c.meta.entries())]); seen.add(k); } });
        world.saved.forEach((v, k) => { if (!seen.has(k)) chunks.push([k, Array.from(v.blocks), v.meta]); });
        const data = {
            seed: this.worldSeed, mode: this.mode, peaceful: this.peaceful, timeOfDay: this.timeOfDay, dayCount: this.dayCount,
            player: { x: Player.pos.x, y: Player.pos.y, z: Player.pos.z, yaw: Player.yaw, pitch: Player.pitch, hp: Player.hp, food: Player.food, sat: Player.sat, xp: Player.xpTotal, spawn: Player.spawn },
            inv: Inv.serialize(), tiles: Array.from(world.tileEntities.entries()), chunks
        };
        const ok = await Store.put('main', data);
        if (!quiet && ok) UI.toast('已保存');
    },

    // =====================================================================================
    // Main loop
    // =====================================================================================
    frame(now) {
        requestAnimationFrame((t) => this.frame(t));
        let dt = Math.min(0.05, (now - this.last) / 1000);
        this.last = now;
        this.fpsAcc += dt; this.fpsN++;
        if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }

        const st = this.state;
        const cam = this.camera;
        if (st === 'title') {
            this.titleAngle += dt * 0.05;
            const R = 5;
            const cx = Math.sin(this.titleAngle) * R, cz = Math.cos(this.titleAngle) * R;
            world.update(cx, cz, 10);
            cam.position.set(cx, SEA + 26, cz);
            cam.rotation.order = 'YXZ'; cam.rotation.set(-0.22, this.titleAngle + Math.PI, 0);
            this.timeOfDay = (this.timeOfDay + dt / 1500) % 1;
            this.updateSky(dt);
            this.setFog(0);
            this.render(false);
            return;
        }
        if (st === 'loading') {
            const c = this.preloadCenter;
            const info = world.update(c.x, c.z, 30);
            const R = 3;
            let ready = 0, total = 0;
            const pcx = Math.floor(c.x / 16), pcz = Math.floor(c.z / 16);
            for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
                total++;
                const ch = world.getChunk(pcx + dx, pcz + dz);
                if (ch && ch.generated && ch.meshed) ready++;
            }
            $('loading-fill').style.width = Math.floor(ready / total * 100) + '%';
            $('loading-text').textContent = `正在生成地形… ${Math.floor(ready / total * 100)}%`;
            cam.position.set(c.x, SEA + 40, c.z); cam.rotation.set(-0.5, 0, 0);
            this.render(false);
            if (ready >= total) this.finishLoading();
            return;
        }

        const paused = st === 'paused';
        if (!paused) this.simulate(dt);
        this.updateCamera(dt);
        this.render(true);
        if (this.showDebug) this.updateDebug();
    },

    simulate(dt) {
        this.timeOfDay += dt / 1200;
        if (this.timeOfDay >= 1) { this.timeOfDay -= 1; this.dayCount++; }
        const active = this.state === 'playing' && !this.dead;
        Player.update(dt, this.keys, active);
        Interact.update(dt, active);
        world.update(Player.pos.x, Player.pos.z, 7);
        world.tick(dt);
        this.updateSky(dt);
        Mobs.update(dt);
        if (!this.dead) Mobs.naturalSpawn(dt);
        Items.update(dt); Arrows.update(dt); Falling.update(dt); Tnt.update(dt);
        Particles.update(dt, this.camera);
        this.updateFurnaces(dt); this.updateTimers(dt); this.randomTicks(dt);
        this.updateSurvival(dt);
        Sound.listener = { x: Player.pos.x, y: Player.pos.y + Player.eye, z: Player.pos.z, yaw: Player.yaw };
        Hand.update(dt);
        UI.updateHud(dt); UI.updateGui(dt);
        if (this.hurtT > 0) this.hurtT -= dt;
        this.shake = Math.max(0, this.shake - dt * 1.5);
        UI.refreshStatus();
        $('clickhint').classList.toggle('hidden', !(this.state === 'playing' && !this.locked && !this.freeLook && !this.dead));
        if (this.peaceful) { for (let i = Mobs.list.length - 1; i >= 0; i--) if (!Mobs.list[i].T.passive) Mobs.remove(i); }
        this.saveTimer += dt;
        if (this.saveTimer > 60) { this.saveTimer = 0; this.saveWorld(true); }
    },

    updateCamera(dt) {
        const cam = this.camera, P = Player;
        // fov
        const baseFov = this.settings.fov;
        const target = baseFov + (P.sprinting ? 9 : 0) + (P.flying && P.sprinting ? 6 : 0);
        cam.fov += (target - cam.fov) * Math.min(1, dt * 10);
        cam.updateProjectionMatrix();
        const sh = this.shake;
        const ex = P.pos.x, ey = P.pos.y + P.eye, ez = P.pos.z;
        const bob = P.bobAmt, ph = P.bob;
        cam.rotation.order = 'YXZ';
        let roll = 0;
        if (this.hurtT > 0) roll = Math.sin(this.hurtT / 0.45 * Math.PI) * 0.12;
        if (this.dead) roll = 0.5;
        if (this.cameraMode === 0) {
            cam.position.set(ex + Math.sin(ph * 1.0) * 0.03 * bob + (sh ? (Math.random() - 0.5) * 0.3 * sh : 0), ey + Math.abs(Math.cos(ph)) * 0.045 * bob - 0.0 + (sh ? (Math.random() - 0.5) * 0.3 * sh : 0), ez);
            cam.rotation.set(P.pitch, P.yaw, roll + Math.sin(ph) * 0.006 * bob);
            this.steve.visible = false;
        } else {
            // third person: back (mode 1) — look at the player; mode >1 not used
            const cp = Math.cos(P.pitch);
            let back = 4.0;
            const dx = Math.sin(P.yaw) * cp, dy = -Math.sin(P.pitch), dz = Math.cos(P.yaw) * cp;
            for (let t = 0.3; t < 4.0; t += 0.2) { if (world.solidAt(Math.floor(ex + dx * t), Math.floor(ey + dy * t), Math.floor(ez + dz * t))) { back = Math.max(0.5, t - 0.3); break; } }
            cam.position.set(ex + dx * back, ey + dy * back, ez + dz * back);
            cam.rotation.set(P.pitch, P.yaw, roll);
            this.steve.visible = true;
            this.animateSteve(dt);
        }
        // underwater / lava tint & fog
        const headL = liquidAt(cam.position.x, cam.position.y, cam.position.z);
        $('water-overlay').style.display = headL === 1 ? 'block' : 'none';
        $('lava-overlay').style.display = headL === 2 ? 'block' : 'none';
        $('fire-overlay').style.display = (P.burning > 0 && this.mode === 'survival') ? 'block' : 'none';
        $('hurt-overlay').style.opacity = this.hurtT > 0 ? Math.min(0.6, this.hurtT * 1.6) : 0;
        this.setFog(headL);
    },
    animateSteve(dt) {
        const P = Player, s = this.steve, parts = s.userData.parts;
        s.position.set(P.pos.x, P.pos.y, P.pos.z);
        s.rotation.y = P.yaw + Math.PI;
        s.scale.setScalar(0.9375);
        const hs = Math.hypot(P.vel.x, P.vel.z);
        const swing = Math.sin(P.bob * 3.2) * 0.9 * P.bobAmt;
        parts.legR.rotation.x = -swing; parts.legL.rotation.x = swing;
        parts.armR.rotation.x = swing; parts.armL.rotation.x = -swing;
        if (Interact.swinging) parts.armR.rotation.x = -1.6 + Math.sin(Interact.swing * Math.PI) * -0.9;
        parts.head.rotation.x = P.pitch * -1;
        parts.head.rotation.y = 0;
        s.userData.mat.color.setScalar(brightnessAt(P.pos.x, P.pos.y + 1, P.pos.z));
        s.userData.model.position.y = P.sneaking ? -0.1 : 0;
    },

    setFog(headLiquid) {
        const u = worldUniforms;
        if (headLiquid === 1) {
            const d = world.skyFactor;
            u.uFogColor.value.setRGB(0.05 * d + 0.02, 0.16 * d + 0.03, 0.42 * d + 0.05);
            u.uFogNear.value = 1; u.uFogFar.value = 24;
            this.renderer.setClearColor(u.uFogColor.value, 1);
        } else if (headLiquid === 2) {
            u.uFogColor.value.setRGB(0.6, 0.15, 0.02); u.uFogNear.value = 0.5; u.uFogFar.value = 6;
            this.renderer.setClearColor(u.uFogColor.value, 1);
        } else {
            const rd = world.renderDist * 16;
            u.uFogNear.value = Math.max(10, rd * 0.62); u.uFogFar.value = Math.max(24, rd - 4);
            if (this.skyHor) u.uFogColor.value.copy(this.skyHor);
        }
    },

    render(withHand) {
        const r = this.renderer;
        r.clear();
        r.render(this.scene, this.camera);
        if (withHand && this.cameraMode === 0 && !this.dead && this.state !== 'title') Hand.render(r);
    },

    updateDebug() {
        const P = Player.pos;
        const bx = Math.floor(P.x), by = Math.floor(P.y), bz = Math.floor(P.z);
        const info = columnInfo(bx, bz);
        const names = ['海洋', '海滩', '平原', '森林', '沙漠', '雪原', '山地'];
        const yaw = ((Player.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const face = ['北 (-Z)', '西 (-X)', '南 (+Z)', '东 (+X)'][Math.floor(((yaw + Math.PI / 4) % (Math.PI * 2)) / (Math.PI / 2))];
        const l = world.getLight(bx, by, bz);
        const t = Interact.target;
        const hh = Math.floor(((this.timeOfDay * 24 + 6) % 24)), mm = Math.floor((((this.timeOfDay * 24 + 6) % 1) * 60));
        let meshed = 0; world.chunks.forEach(c => { if (c.meshed) meshed++; });
        const lines = [
            `Minecraft Web 1.21 (仿原版)   ${this.fps} fps`,
            `XYZ: ${P.x.toFixed(3)} / ${P.y.toFixed(3)} / ${P.z.toFixed(3)}`,
            `方块: ${bx} ${by} ${bz}   区块: ${bx >> 4} ${bz >> 4}`,
            `朝向: ${face}   (${(Player.yaw * 180 / Math.PI % 360).toFixed(1)} / ${(Player.pitch * 180 / Math.PI).toFixed(1)})`,
            `光照: 天空 ${l >> 4}  方块 ${l & 15}   群系: ${names[info.biome]}`,
            `区块: ${world.chunks.size} 已加载 / ${meshed} 已渲染   实体: ${Mobs.list.length} 生物 ${Items.list.length} 掉落物`,
            `时间: 第 ${this.dayCount} 天 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}   种子: ${this.worldSeed}`,
            t && t.kind === 'block' ? `目标方块: ${DEFS[t.id].name} (${t.x}, ${t.y}, ${t.z})` : (t && t.kind === 'mob' ? `目标生物: ${t.mob.T.label}` : '')
        ];
        $('debug').textContent = lines.join('\n');
    }
};

window.addEventListener('load', () => Game.init());
