// ============================================================================
// sound.js — synthesised Minecraft-style sound effects (noise bursts + tones)
// ============================================================================
'use strict';

const Sound = {
    ctx: null, master: null, noiseBuf: null, volume: 0.8,
    listener: { x: 0, y: 0, z: 0, yaw: 0 },

    init() {
        if (!this.ctx) {
            const A = window.AudioContext || window.webkitAudioContext;
            if (!A) return;
            this.ctx = new A();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.volume;
            this.master.connect(this.ctx.destination);
            const len = this.ctx.sampleRate * 2;
            this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },

    // route through a gain+pan according to 3D position
    out(pos, vol) {
        const c = this.ctx;
        const g = c.createGain();
        let pan = 0, att = 1;
        if (pos) {
            const dx = pos[0] - this.listener.x, dy = pos[1] - this.listener.y, dz = pos[2] - this.listener.z;
            const d = Math.hypot(dx, dy, dz);
            att = Math.max(0, 1 - d / 28);
            att *= att;
            const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
            pan = d > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.max(d, 1))) * 0.8 : 0;
        }
        g.gain.value = vol * att;
        if (c.createStereoPanner) {
            const p = c.createStereoPanner(); p.pan.value = pan;
            g.connect(p); p.connect(this.master);
        } else g.connect(this.master);
        return att > 0.002 ? g : null;
    },

    noise(pos, { vol = 0.3, dur = 0.12, freq = 1500, q = 1, type = 'bandpass', sweep = null, attack = 0.002, rate = 1 }) {
        if (!this.ctx) return;
        const out = this.out(pos, vol); if (!out) return;
        const c = this.ctx, t = c.currentTime;
        const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = rate;
        src.loop = true;
        const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
        if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur);
        const env = c.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(1, t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(env); env.connect(out);
        src.start(t, Math.random()); src.stop(t + dur + 0.02);
    },
    tone(pos, { vol = 0.2, dur = 0.15, f0 = 300, f1 = null, type = 'square', vib = 0, lp = 0, delay = 0 }) {
        if (!this.ctx) return;
        const out = this.out(pos, vol); if (!out) return;
        const c = this.ctx, t = c.currentTime + delay;
        const o = c.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t);
        if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        const env = c.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(1, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        let last = o;
        if (vib) {
            const lfo = c.createOscillator(); lfo.frequency.value = vib;
            const lg = c.createGain(); lg.gain.value = f0 * 0.08;
            lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.05);
        }
        if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; last.connect(f); last = f; }
        last.connect(env); env.connect(out);
        o.start(t); o.stop(t + dur + 0.05);
    },

    // ---- block material sounds ------------------------------------------------
    block(kind, action, pos) {
        const p = pos ? [pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5] : null;
        const big = action === 'break' || action === 'place';
        const v = action === 'step' ? 0.1 : action === 'hit' ? 0.14 : 0.3;
        const dur = big ? 0.16 : 0.07;
        const pitch = 0.9 + Math.random() * 0.2;
        switch (kind) {
            case 'grass': case 'dirt':
                this.noise(p, { vol: v, dur, freq: 700 * pitch, q: 0.8, type: 'lowpass', sweep: 250 }); break;
            case 'gravel':
                this.noise(p, { vol: v, dur: dur * 1.3, freq: 1200 * pitch, q: 0.5, type: 'bandpass' });
                this.noise(p, { vol: v * 0.6, dur: dur, freq: 400, q: 0.5, type: 'lowpass' }); break;
            case 'sand':
                this.noise(p, { vol: v * 0.9, dur: dur * 1.2, freq: 2400 * pitch, q: 0.4, type: 'highpass', sweep: 1500 }); break;
            case 'wood':
                this.noise(p, { vol: v, dur: dur * 0.8, freq: 520 * pitch, q: 3, type: 'bandpass' });
                this.tone(p, { vol: v * 0.5, dur: dur * 0.8, f0: 190 * pitch, f1: 100, type: 'triangle' }); break;
            case 'glass':
                this.noise(p, { vol: v * 0.8, dur: dur * 1.2, freq: 5200 * pitch, q: 2, type: 'highpass' });
                this.tone(p, { vol: v * 0.3, dur: dur * 0.7, f0: 2400 * pitch, f1: 1800, type: 'sine' }); break;
            case 'cloth': case 'snow':
                this.noise(p, { vol: v * 0.8, dur, freq: 900 * pitch, q: 0.6, type: 'lowpass', sweep: 400 }); break;
            case 'water':
                this.noise(p, { vol: v * 0.7, dur: dur * 2, freq: 900 * pitch, q: 1.5, type: 'bandpass', sweep: 1600 }); break;
            default: // stone
                this.noise(p, { vol: v, dur, freq: 1900 * pitch, q: 1.4, type: 'bandpass', sweep: 900 });
                this.noise(p, { vol: v * 0.6, dur: dur * 0.8, freq: 260, q: 0.6, type: 'lowpass' });
        }
    },

    // ---- misc effects ----------------------------------------------------------------
    play(name, pos) {
        if (!this.ctx) return;
        const p = pos ? [pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2]] : null;
        switch (name) {
            case 'pop': this.tone(null, { vol: 0.18, dur: 0.09, f0: 520 + Math.random() * 300, f1: 1200, type: 'sine' }); break;
            case 'click': this.tone(null, { vol: 0.12, dur: 0.05, f0: 900, f1: 600, type: 'square' }); break;
            case 'hurt': this.tone(null, { vol: 0.3, dur: 0.22, f0: 260, f1: 110, type: 'sawtooth', lp: 900 }); break;
            case 'hit': this.noise(p, { vol: 0.3, dur: 0.1, freq: 700, q: 1, type: 'lowpass' }); this.tone(p, { vol: 0.12, dur: 0.08, f0: 180, f1: 90, type: 'square', lp: 700 }); break;
            case 'eat': for (let i = 0; i < 3; i++) setTimeout(() => this.noise(null, { vol: 0.22, dur: 0.07, freq: 1100, q: 2, type: 'bandpass' }), i * 110); break;
            case 'burp': this.tone(null, { vol: 0.25, dur: 0.3, f0: 120, f1: 70, type: 'sawtooth', lp: 400 }); break;
            case 'levelup': [0, 0.09, 0.18].forEach((d, i) => this.tone(null, { vol: 0.15, dur: 0.18, f0: 523 * Math.pow(1.26, i), type: 'triangle', delay: d })); break;
            case 'explode': this.noise(p, { vol: 0.9, dur: 1.3, freq: 700, q: 0.7, type: 'lowpass', sweep: 60, rate: 0.5 }); this.tone(p, { vol: 0.5, dur: 0.9, f0: 90, f1: 28, type: 'sawtooth', lp: 300 }); break;
            case 'fuse': this.noise(p, { vol: 0.35, dur: 1.4, freq: 5200, q: 0.5, type: 'highpass', attack: 0.05 }); break;
            case 'fire': this.noise(p, { vol: 0.4, dur: 0.25, freq: 2500, q: 0.6, type: 'highpass' }); break;
            case 'splash': this.noise(p, { vol: 0.4, dur: 0.35, freq: 1500, q: 0.8, type: 'bandpass', sweep: 600 }); break;
            case 'pig': this.tone(p, { vol: 0.28, dur: 0.14, f0: 230, f1: 170, type: 'sawtooth', lp: 900 }); this.tone(p, { vol: 0.25, dur: 0.1, f0: 190, f1: 140, type: 'sawtooth', lp: 800, delay: 0.14 }); break;
            case 'cow': this.tone(p, { vol: 0.3, dur: 0.7, f0: 120, f1: 95, type: 'sawtooth', lp: 500, vib: 5 }); break;
            case 'sheep': this.tone(p, { vol: 0.28, dur: 0.5, f0: 340, f1: 280, type: 'sawtooth', lp: 1200, vib: 22 }); break;
            case 'zombie': this.tone(p, { vol: 0.32, dur: 0.8, f0: 110, f1: 75, type: 'sawtooth', lp: 450, vib: 7 }); break;
            case 'zombie_hurt': this.tone(p, { vol: 0.3, dur: 0.25, f0: 170, f1: 90, type: 'sawtooth', lp: 600 }); break;
            case 'skeleton': for (let i = 0; i < 4; i++) this.noise(p, { vol: 0.2, dur: 0.04, freq: 3000 + i * 200, q: 4, type: 'bandpass', attack: 0.001 }); break;
            case 'bow': this.noise(p, { vol: 0.3, dur: 0.15, freq: 1800, q: 1, type: 'bandpass', sweep: 600 }); break;
            case 'creeper_hiss': this.noise(p, { vol: 0.5, dur: 1.3, freq: 3800, q: 0.5, type: 'highpass', attack: 0.05 }); break;
            case 'door': break;
            case 'chest_open': this.tone(null, { vol: 0.2, dur: 0.3, f0: 140, f1: 220, type: 'triangle', lp: 500 }); break;
            case 'chest_close': this.tone(null, { vol: 0.2, dur: 0.2, f0: 200, f1: 120, type: 'triangle', lp: 500 }); break;
            case 'death': this.tone(null, { vol: 0.35, dur: 0.6, f0: 300, f1: 60, type: 'sawtooth', lp: 800 }); break;
        }
    }
};
