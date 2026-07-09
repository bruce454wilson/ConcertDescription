/* Concert Word Score — Listen core (score-following engine).
   Pure functions, no DOM/audio dependencies: FFT -> chroma -> causal banded DTW.
   Validated against the Python pipeline (see autosync-poc/real_recording_test.py):
   Dvořák 9/i real recording, median error ~0.65s with fully causal smoothing.
   Loaded by index.html; also runnable in node for testing. */
"use strict";
const ListenCore = (() => {

  // ---------- FFT (iterative radix-2, real input, magnitudes for bins 0..N/2) ----------
  function makeFFT(N) {
    const levels = Math.log2(N) | 0;
    if (1 << levels !== N) throw new Error('FFT size must be a power of 2');
    const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = Math.sin(2 * Math.PI * i / N); }
    const rev = new Uint32Array(N);
    for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1); rev[i] = r; }
    const re = new Float64Array(N), im = new Float64Array(N);
    return function fftMag(input, out /* Float32Array N/2+1 */) {
      for (let i = 0; i < N; i++) { re[i] = input[rev[i]]; im[i] = 0; }
      for (let size = 2; size <= N; size <<= 1) {
        const half = size >> 1, step = N / size;
        for (let i = 0; i < N; i += size) {
          for (let j = i, k = 0; j < i + half; j++, k += step) {
            const tre = re[j + half] * cosT[k] + im[j + half] * sinT[k];
            const tim = -re[j + half] * sinT[k] + im[j + half] * cosT[k];
            re[j + half] = re[j] - tre; im[j + half] = im[j] - tim;
            re[j] += tre; im[j] += tim;
          }
        }
      }
      for (let k = 0; k <= N / 2; k++) out[k] = Math.hypot(re[k], im[k]);
      return out;
    };
  }

  // ---------- Chroma extractor (matches Python: band 55-2200Hz, bin->semitone mean, pc sum) ----------
  function ChromaExtractor(sampleRate, nfft) {
    nfft = nfft || 16384;
    const fft = makeFFT(nfft);
    const win = new Float64Array(nfft);
    for (let i = 0; i < nfft; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (nfft - 1)); // np.hanning
    const mags = new Float32Array(nfft / 2 + 1);
    // precompute: for each semitone (midi note) in band, list of bins
    const noteBins = new Map();
    for (let k = 1; k <= nfft / 2; k++) {
      const f = k * sampleRate / nfft;
      if (f < 55 || f > 2200) continue;
      const m = Math.round(69 + 12 * Math.log2(f / 440));
      if (!noteBins.has(m)) noteBins.set(m, []);
      noteBins.get(m).push(k);
    }
    const notes = [...noteBins.entries()].map(([m, bins]) => ({ pc: ((m % 12) + 12) % 12, bins }));
    const buf = new Float64Array(nfft);
    return {
      nfft,
      /* window: Float32Array(nfft) most-recent samples. Returns {chroma: Float32Array(12) L2-normalized, energy} */
      extract(window) {
        for (let i = 0; i < nfft; i++) buf[i] = window[i] * win[i];
        fft(buf, mags);
        const c = new Float32Array(12);
        let energy = 0;
        for (const { pc, bins } of notes) {
          let s = 0;
          for (const k of bins) s += mags[k];
          energy += s;
          c[pc] += s / bins.length;
        }
        let n = 0; for (let i = 0; i < 12; i++) n += c[i] * c[i];
        n = Math.sqrt(n) + 1e-9;
        for (let i = 0; i < 12; i++) c[i] /= n;
        return { chroma: c, energy };
      }
    };
  }

  // ---------- causal trailing smoother over chroma frames ----------
  function Smoother(w) {
    w = w || 20;
    const hist = [];
    const acc = new Float64Array(12);
    return {
      push(c) {
        hist.push(c); for (let i = 0; i < 12; i++) acc[i] += c[i];
        if (hist.length > w) { const old = hist.shift(); for (let i = 0; i < 12; i++) acc[i] -= old[i]; }
        const out = new Float32Array(12);
        let n = 0;
        for (let i = 0; i < 12; i++) { out[i] = acc[i] / hist.length; n += out[i] * out[i]; }
        n = Math.sqrt(n) + 1e-9;
        for (let i = 0; i < 12; i++) out[i] /= n;
        return out;
      },
      reset() { hist.length = 0; acc.fill(0); }
    };
  }

  // ---------- reference decoding (scoreref-*.json) ----------
  function decodeRef(refJson, b64decode /* optional for node */) {
    const raw = (b64decode || (s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0))))(refJson.data);
    const F = refJson.frames, D = refJson.dims || 12;
    if (raw.length !== F * D) throw new Error('scoreRef size mismatch');
    // dequantize + trailing-smooth (w=20) + L2 normalize -> Float32Array F*12
    const out = new Float32Array(F * D);
    const w = 20, acc = new Float64Array(D);
    const q = refJson.quant || 255;
    for (let j = 0; j < F; j++) {
      for (let i = 0; i < D; i++) acc[i] += raw[j * D + i] / q;
      if (j >= w) for (let i = 0; i < D; i++) acc[i] -= raw[(j - w) * D + i] / q;
      const len = Math.min(j + 1, w);
      let n = 0;
      for (let i = 0; i < D; i++) { const v = acc[i] / len; out[j * D + i] = v; n += v * v; }
      n = Math.sqrt(n) + 1e-9;
      for (let i = 0; i < D; i++) out[j * D + i] /= n;
    }
    return { frames: F, dims: D, hop: refJson.hop || 0.1, data: out, meta: refJson };
  }

  // ---------- causal banded online DTW follower ----------
  // Step penalties cure the "parking problem" on real audio (see RESULTS.md 2026-07-09).
  function Follower(ref /* from decodeRef */, opts) {
    opts = opts || {};
    const W = opts.W || 200, ph = opts.ph == null ? 0.3 : opts.ph, pv = opts.pv == null ? 0.5 : opts.pv;
    const N = ref.frames, R = ref.data, INF = 1e15;
    let Dprev = new Float64Array(N).fill(INF);
    let Dcur = new Float64Array(N).fill(INF);
    let c = 0, started = false;
    // energy gate: running median over a reservoir of recent energies
    const eres = []; let egateAbs = 0;
    function updGate(e) {
      eres.push(e); if (eres.length > 300) eres.shift();
      if (eres.length >= 30 && (eres.length % 10 === 0)) {
        const s = [...eres].sort((a, b) => a - b);
        egateAbs = 0.1 * s[s.length >> 1];
      }
    }
    return {
      /* seed the follower at a known score position (seconds) — e.g. mid-movement enable */
      seed(posSec) {
        c = Math.max(0, Math.min(N - 1, Math.round(posSec / ref.hop)));
        started = false; Dprev.fill(INF);
      },
      get positionSec() { return c * ref.hop; },
      get started() { return started; },
      /* smoothed chroma frame + raw energy -> position in score seconds (or null if gated) */
      step(pc12, energy) {
        updGate(energy);
        if (egateAbs > 0 && energy < egateAbs) return null; // silence: hold
        const lo = Math.max(0, c - W), hi = Math.min(N - 1, c + W);
        let left = INF;
        for (let i = lo; i <= hi; i++) {
          let d = 1.0;
          const o = i * 12;
          for (let k = 0; k < 12; k++) d -= R[o + k] * pc12[k];
          let base;
          if (!started) base = (i === lo) ? 0.0 : left + pv;
          else {
            base = Dprev[i] + ph;
            if (i > 0 && Dprev[i - 1] < base) base = Dprev[i - 1];
            if (left + pv < base) base = left + pv;
          }
          left = d + base; Dcur[i] = left;
        }
        started = true;
        let m = INF, mi = lo;
        for (let i = lo; i <= hi; i++) if (Dcur[i] < m) { m = Dcur[i]; mi = i; }
        for (let i = lo; i <= hi; i++) Dcur[i] -= m;
        c = mi;
        const t = Dprev; Dprev = Dcur; Dcur = t; Dcur.fill(INF);
        return c * ref.hop;
      }
    };
  }

  return { makeFFT, ChromaExtractor, Smoother, decodeRef, Follower };
})();
if (typeof module !== 'undefined') module.exports = ListenCore;
