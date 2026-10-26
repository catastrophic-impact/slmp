// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// Shared screensaver core, loaded both by the screensaver window (saver.html)
// and by the player for the mini visualizer.
//
// Every saver registers itself with registerSaver(id, { label, miniScale, create }).
// create(host) receives:
//   host.container  element to render into (sized by CSS)
//   host.mini       true when running in the player's mini visualizer
//   host.scale      world scale; pixi savers simulate in a virtual space of
//                   (container size / scale) so the mini view is a shrunken copy
//   host.config     flat slmp.conf map
//   host.getAudio() latest raw 64-bin spectrum (array-like, 0..255) - the
//                   original analyzer used by Bars and Chaos
//   host.getBands() latest party-analyzer band levels (128, 0..255, display
//                   ready; see spectrum.js) - used by Raindrops
// and resolves to a handle { pause(), resume(), destroy() }.
(() => {
  const registry = {};

  window.registerSaver = (id, def) => {
    registry[id] = def;
  };

  window.getSaverDef = (id) => registry[id];

  // Mounts a saver and returns a handle that is safe to use before the
  // (async) saver has finished starting.
  window.mountSaver = (type, host) => {
    const def = registry[type] || registry.bars;
    let handle = null;
    let destroyed = false;
    let paused = false;

    def.create({ ...host, scale: host.mini ? def.miniScale : 1 })
      .then((h) => {
        if (destroyed) {
          h.destroy();
          return;
        }
        handle = h;
        if (paused) h.pause();
      })
      .catch((err) => console.error(`Screensaver '${type}' failed to start:`, err));

    return {
      pause() { paused = true; if (handle) handle.pause(); },
      resume() { paused = false; if (handle) handle.resume(); },
      destroy() {
        destroyed = true;
        if (handle) handle.destroy();
        handle = null;
      }
    };
  };

  // ---------------------------------------------------------
  // Pixi helpers
  // ---------------------------------------------------------

  // Pixi savers share one tessellated circle; each instance is just a scaled,
  // tinted reference to it, so per-frame size/colour changes cost nothing.
  const CIRCLE_BASE_RADIUS = 100;
  let circleContext = null;

  window.createCircle = () => {
    if (!circleContext) {
      circleContext = new PIXI.GraphicsContext().circle(0, 0, CIRCLE_BASE_RADIUS).fill(0xffffff);
    }
    return new PIXI.Graphics(circleContext);
  };

  window.setCircle = (graphics, radius, color) => {
    graphics.scale.set(Math.max(0.5, radius) / CIRCLE_BASE_RADIUS);
    graphics.tint = color;
  };

  window.rgbToHex = (r, g, b) => (r << 16) | (g << 8) | b;

  // Creates a pixi app filling host.container. `view` reports the virtual
  // simulation size, which is what savers should use for bounds.
  window.createPixiApp = async (host, { antialias = false } = {}) => {
    // A fresh renderer gets a fresh shared circle
    circleContext = null;

    const app = new PIXI.Application();
    await app.init({
      resizeTo: host.container,
      backgroundColor: 0x000000,
      antialias,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true
    });
    host.container.appendChild(app.canvas);
    app.stage.scale.set(host.scale);

    const view = {
      get width() { return app.screen.width / host.scale; },
      get height() { return app.screen.height / host.scale; }
    };
    return { app, view };
  };

  window.pixiHandle = (app, cleanup) => ({
    pause: () => app.ticker.stop(),
    resume: () => app.ticker.start(),
    destroy: () => {
      if (cleanup) cleanup();
      app.destroy({ removeView: true }, { children: true });
    }
  });

  // ---------------------------------------------------------
  // Config helpers (values are already normalised by main.js)
  // ---------------------------------------------------------
  window.cfg = {
    str: (config, key, def) => (config[key] !== undefined && config[key] !== '' ? String(config[key]) : def),
    num: (config, key, def) => {
      const n = parseFloat(config[key]);
      return Number.isFinite(n) ? n : def;
    },
    bool: (config, key, def) => (config[key] === 'true' ? true : config[key] === 'false' ? false : def),
    color: (config, key, def) => {
      const m = /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(config[key] || '');
      return m ? { r: +m[1], g: +m[2], b: +m[3] } : def;
    }
  };

  // ---------------------------------------------------------
  // Shared ball colour modes
  // ---------------------------------------------------------
  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
  }
  window.hslToRgb = hslToRgb;

  const vividColor = () => hslToRgb(Math.random() * 360, 0.6 + Math.random() * 0.3, 0.45 + Math.random() * 0.15);

  // Colour source for the ball savers' <prefix>.color_mode setting.
  //   palette.shared    true when every ball should use palette.color
  //   palette.color     the shared colour {r,g,b} (0..255)
  //   palette.pick()    colour for a newly spawned ball
  //   palette.reroll()  new solid_random colour (savers call this on restart)
  //   palette.update(dtSeconds)  advances shifting / timed re-picks / blends
  // `randomColor` is the saver's own per-ball random colour (0..255).
  window.createBallPalette = (config, prefix, { randomColor = vividColor, autoInterval = false } = {}) => {
    const mode = cfg.str(config, `${prefix}.color_mode`, 'random');
    const fixed = cfg.color(config, `${prefix}.color`, { r: 0, g: 180, b: 255 });
    const shiftSpeed = cfg.num(config, `${prefix}.shift_speed`, 15);
    const interval = cfg.num(config, `${prefix}.solid_interval`, 30);

    const BLEND_SECONDS = 1.5;
    let hue = Math.random() * 360;
    let from = null;
    let to = null;
    let blend = 1;
    let timer = 0;

    const palette = {
      mode,
      shared: mode !== 'random',
      color: mode === 'solid' ? { ...fixed } : mode === 'shifting' ? hslToRgb(hue, 0.75, 0.55) : vividColor(),

      pick() {
        return palette.shared ? { ...palette.color } : randomColor();
      },

      reroll() {
        if (mode !== 'solid_random') return;
        from = { ...palette.color };
        to = vividColor();
        blend = 0;
        timer = 0;
      },

      update(dt) {
        if (mode === 'shifting') {
          hue = (hue + shiftSpeed * dt) % 360;
          palette.color = hslToRgb(hue, 0.75, 0.55);
        } else if (mode === 'solid_random') {
          if (autoInterval) {
            timer += dt;
            if (timer >= interval) palette.reroll();
          }
          if (blend < 1) {
            blend = Math.min(1, blend + dt / BLEND_SECONDS);
            palette.color = {
              r: Math.round(from.r + (to.r - from.r) * blend),
              g: Math.round(from.g + (to.g - from.g) * blend),
              b: Math.round(from.b + (to.b - from.b) * blend)
            };
          }
        }
      }
    };
    return palette;
  };

  // Resamples band levels (0..255, see spectrum.js) to `count` values (0..1).
  // Downsampling keeps each group's loudest band so peaks aren't averaged away;
  // upsampling interpolates.
  window.resampleBands = (src, count) => {
    const out = new Array(count);
    const n = src.length;
    const step = n / count;
    for (let k = 0; k < count; k++) {
      if (step >= 1) {
        const start = Math.floor(k * step);
        const end = Math.max(start + 1, Math.floor((k + 1) * step));
        let max = 0;
        for (let i = start; i < end && i < n; i++) if (src[i] > max) max = src[i];
        out[k] = max / 255;
      } else {
        const pos = (k / Math.max(1, count - 1)) * (n - 1);
        const idx = Math.floor(pos);
        const v1 = src[idx] || 0;
        const v2 = idx + 1 < n ? src[idx + 1] : v1;
        out[k] = (v1 + (v2 - v1) * (pos - idx)) / 255;
      }
    }
    return out;
  };

  // Lays out per-bar values (low to high) according to a bars layout name.
  // mountain/valley mirror the spectrum, so each half gets half the bars.
  window.layoutBands = (src, total, layout) => {
    const mirrored = layout === 'mountain' || layout === 'valley';
    const half = Math.floor(total / 2);
    const sampled = resampleBands(src, mirrored ? half : total);
    if (layout === 'righthill') return sampled.reverse();
    if (!mirrored) return sampled;

    const out = new Array(total).fill(0);
    for (let i = 0; i < half; i++) {
      if (layout === 'mountain') {
        out[half - 1 - i] = sampled[i];
        out[half + i] = sampled[i];
      } else {
        out[i] = sampled[i];
        out[total - 1 - i] = sampled[i];
      }
    }
    return out;
  };
})();
