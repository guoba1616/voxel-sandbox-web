// ============================================================================
// noise.js — seeded PRNG, hashing and improved Perlin noise (2D / 3D / fbm)
// ============================================================================
'use strict';

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Deterministic position hash -> [0,1)
function hash2(x, z, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
function hash3(x, y, z, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 1103515245) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

class Perlin {
    constructor(seed) {
        const rnd = mulberry32(seed);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            const t = p[i]; p[i] = p[j]; p[j] = t;
        }
        this.p = new Uint8Array(512);
        for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    }
    static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    static grad(h, x, y, z) {
        h &= 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }
    noise3(x, y, z) {
        const p = this.p;
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
        x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
        const u = Perlin.fade(x), v = Perlin.fade(y), w = Perlin.fade(z);
        const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
        const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
        const g = Perlin.grad;
        const l = (a, b, t) => a + t * (b - a);
        return l(
            l(l(g(p[AA], x, y, z), g(p[BA], x - 1, y, z), u),
              l(g(p[AB], x, y - 1, z), g(p[BB], x - 1, y - 1, z), u), v),
            l(l(g(p[AA + 1], x, y, z - 1), g(p[BA + 1], x - 1, y, z - 1), u),
              l(g(p[AB + 1], x, y - 1, z - 1), g(p[BB + 1], x - 1, y - 1, z - 1), u), v),
            w);
    }
    noise2(x, y) { return this.noise3(x, y, 0.37); }
    fbm2(x, y, oct, lac = 2, gain = 0.5) {
        let amp = 1, f = 1, sum = 0, norm = 0;
        for (let i = 0; i < oct; i++) {
            sum += this.noise2(x * f, y * f) * amp;
            norm += amp; amp *= gain; f *= lac;
        }
        return sum / norm;
    }
    fbm3(x, y, z, oct, lac = 2, gain = 0.5) {
        let amp = 1, f = 1, sum = 0, norm = 0;
        for (let i = 0; i < oct; i++) {
            sum += this.noise3(x * f, y * f, z * f) * amp;
            norm += amp; amp *= gain; f *= lac;
        }
        return sum / norm;
    }
}
