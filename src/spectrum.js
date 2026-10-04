// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// Party spectrum engine (used by Raindrops): CAVA/Audacious-like analysis
// with octave-spaced bands, high-frequency tilt compensation, a decibel
// scale, one global auto-gain and a fast response, so the whole spectrum
// dances, not just the lows. Bars and Chaos keep the original analyser.
//
// Output: SPECTRUM_BANDS values (0..255), low to high frequency, where the
// value is how tall/loud that band should look (255 = full height).
window.SPECTRUM_BANDS = 128;

window.createSpectrumEngine = () => {
  const BANDS = SPECTRUM_BANDS;
  const out = new Uint8Array(BANDS);

  const PARTY_FFT = 2048;
  const TILT_PIVOT_HZ = 1000;
  const AGC_DECAY_DB_PER_SEC = 8;   // how fast auto-gain recovers after loud parts
  const AGC_HEADROOM_DB = 3;        // loudest band peaks just under full height
  const AGC_MIN_TOP_DB = -65;       // never amplify near-silence into noise
  const FIXED_TOP_DB = -22;         // reference level when auto-gain is off

  let analyser = null;
  let sampleRate = 48000;
  let settings = {
    minFreq: 50, maxFreq: 16000, tilt: 4, range: 42, autoGain: true, gain: 0, response: 0.5
  };
  let bands = [];          // precomputed per-band bin ranges and tilt
  let floatData = null;
  let agcPeak = AGC_MIN_TOP_DB;
  let lastTime = 0;

  function applyAnalyserSettings() {
    if (!analyser) return;
    analyser.fftSize = PARTY_FFT;
    analyser.smoothingTimeConstant = settings.response;
    floatData = new Float32Array(analyser.frequencyBinCount);
    buildBands();
  }

  // Octave-spaced bands between minFreq and maxFreq
  function buildBands() {
    const binHz = sampleRate / PARTY_FFT;
    const maxFreq = Math.min(settings.maxFreq, sampleRate / 2 * 0.95);
    const minFreq = Math.min(settings.minFreq, maxFreq / 4);
    const ratio = Math.pow(maxFreq / minFreq, 1 / BANDS);

    bands = [];
    for (let b = 0; b < BANDS; b++) {
      const lo = minFreq * Math.pow(ratio, b);
      const hi = lo * ratio;
      const center = Math.sqrt(lo * hi);
      bands.push({
        firstBin: Math.ceil(lo / binHz),
        lastBin: Math.floor(hi / binHz),
        centerBin: center / binHz,
        tiltDb: settings.tilt * Math.log2(center / TILT_PIVOT_HZ)
      });
    }
  }

  const binDb = (i) => {
    const v = floatData[i];
    return v > -160 ? v : -160; // -Infinity during silence
  };

  function readParty(dt) {
    analyser.getFloatFrequencyData(floatData);

    const db = new Float32Array(BANDS);
    let frameMax = -Infinity;
    for (let b = 0; b < BANDS; b++) {
      const band = bands[b];
      let value;
      if (band.lastBin >= band.firstBin) {
        // Wide band: its loudest bin
        value = -Infinity;
        for (let i = band.firstBin; i <= band.lastBin; i++) value = Math.max(value, binDb(i));
      } else {
        // Narrow (bass) band thinner than one FFT bin: interpolate at its centre
        const i = Math.floor(band.centerBin);
        const frac = band.centerBin - i;
        value = binDb(i) + (binDb(i + 1) - binDb(i)) * frac;
      }
      value += band.tiltDb + settings.gain;
      db[b] = value;
      if (value > frameMax) frameMax = value;
    }

    let top;
    if (settings.autoGain) {
      // One global gain for all bands, so their natural differences survive
      // (kicks light the left, hi-hats the right) instead of all pumping together
      agcPeak = Math.max(frameMax, agcPeak - AGC_DECAY_DB_PER_SEC * dt, AGC_MIN_TOP_DB);
      top = agcPeak + AGC_HEADROOM_DB;
    } else {
      top = FIXED_TOP_DB;
    }
    const floor = top - settings.range;

    for (let b = 0; b < BANDS; b++) {
      const level = (db[b] - floor) / settings.range;
      out[b] = level <= 0 ? 0 : level >= 1 ? 255 : Math.round(level * 255);
    }
  }

  return {
    // Creates the engine's own analyser. It passes audio through unchanged,
    // so it can sit in the chain ahead of the original analyser.
    createAnalyser(audioCtx) {
      analyser = audioCtx.createAnalyser();
      sampleRate = audioCtx.sampleRate;
      applyAnalyserSettings();
      return analyser;
    },

    configure(config) {
      const num = (key, def) => {
        const n = parseFloat(config[key]);
        return Number.isFinite(n) ? n : def;
      };
      settings = {
        minFreq: num('analyzer.min_freq', 50),
        maxFreq: num('analyzer.max_freq', 16000),
        tilt: num('analyzer.tilt', 4),
        range: Math.max(10, num('analyzer.range', 42)),
        autoGain: config['analyzer.auto_gain'] !== 'false',
        gain: num('analyzer.gain', 0),
        response: Math.min(0.95, Math.max(0, num('analyzer.response', 0.5)))
      };
      applyAnalyserSettings();
    },

    // Latest band levels; zeros until playback has started the audio graph.
    // Safe to call from several consumers per frame (cached for a few ms).
    read() {
      if (!analyser) return out;
      const now = performance.now();
      if (now - lastTime < 4) return out;
      const dt = lastTime ? Math.min(0.25, (now - lastTime) / 1000) : 0;
      lastTime = now;

      readParty(dt);
      return out;
    }
  };
};
