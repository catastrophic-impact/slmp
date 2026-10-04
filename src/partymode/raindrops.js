// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// Raindrops: a spectrum visualizer made of rain. The screen is split into
// columns mapped to frequency bands exactly like the bars layouts; louder
// bands rain harder and with bigger drops, which splash into tiny droplets
// when they hit the ground.
registerSaver('raindrops', { label: 'Raindrops', miniScale: 0.3, create: async (host) => {
  const { app, view } = await createPixiApp(host, { antialias: true });
  const config = host.config;

  const LAYOUTS = ['lefthill', 'righthill', 'mountain', 'valley'];
  const COLUMNS = Math.round(cfg.num(config, 'raindrops.columns', 32));
  const layoutSetting = cfg.str(config, 'raindrops.layout', 'mountain');
  const LAYOUT = layoutSetting === 'random' ? LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)] : layoutSetting;
  const DENSITY = cfg.num(config, 'raindrops.density', 1.0);
  const MAX_SIZE = cfg.num(config, 'raindrops.max_size', 8);
  const MIN_SIZE = Math.min(1.5, MAX_SIZE);
  const FALL_SPEED = cfg.num(config, 'raindrops.fall_speed', 1.0);
  const SPLASH = Math.round(cfg.num(config, 'raindrops.splash', 6));

  // Rates are drops per second per column
  const DRIZZLE_RATE = 0.12;   // even silence gets a light drizzle
  const LOUD_RATE = 6.0;
  const GATE = 0.12;           // band levels below this count as silence
  const GRAVITY = 0.22;        // px per 60fps frame squared
  const SPLASH_GRAVITY = 0.2;
  const ATTACK = 0.35;         // smoothing toward louder levels
  const FALLOFF = 0.08;        // smoothing toward quieter levels
  const MAX_DROPS = 1500;
  const MAX_DROPLETS = 3000;

  const palette = createBallPalette(config, 'raindrops', { autoInterval: true });

  const randf = (min, max) => min + Math.random() * (max - min);
  const lighten = (c, amount) => ({
    r: Math.round(c.r + (255 - c.r) * amount),
    g: Math.round(c.g + (255 - c.g) * amount),
    b: Math.round(c.b + (255 - c.b) * amount)
  });

  // Graphics are pooled: drops and droplets come and go constantly
  const pool = [];
  const takeGraphics = () => {
    const g = pool.pop() || app.stage.addChild(createCircle());
    g.visible = true;
    g.alpha = 1;
    return g;
  };
  const releaseGraphics = (g) => {
    g.visible = false;
    pool.push(g);
  };

  let drops = [];
  let droplets = [];
  const levels = new Float32Array(COLUMNS);
  const credit = new Float32Array(COLUMNS);
  for (let i = 0; i < COLUMNS; i++) credit[i] = Math.random();

  function spawnDrop(col, level) {
    if (drops.length >= MAX_DROPS) return;
    const colWidth = view.width / COLUMNS;
    // Curved so only real peaks make the big drops
    const radius = MIN_SIZE + (MAX_SIZE - MIN_SIZE) * Math.pow(level, 1.5);
    // Loud drops glow a little brighter
    const color = lighten(palette.pick(), level * 0.35);
    const g = takeGraphics();
    const drop = {
      g,
      x: (col + 0.5 + randf(-0.3, 0.3)) * colWidth,
      y: -radius * 2 - randf(0, 30),
      vy: randf(3, 6) * FALL_SPEED,
      radius,
      level,
      color
    };
    setCircle(g, radius, rgbToHex(color.r, color.g, color.b));
    g.x = drop.x;
    g.y = drop.y;
    drops.push(drop);
  }

  function splash(drop, groundY) {
    const count = Math.round(SPLASH * (0.3 + 0.7 * drop.level));
    const sizeFactor = drop.radius / MAX_SIZE;
    const color = lighten(drop.color, 0.25);
    const hex = rgbToHex(color.r, color.g, color.b);

    for (let i = 0; i < count && droplets.length < MAX_DROPLETS; i++) {
      const g = takeGraphics();
      const droplet = {
        g,
        x: drop.x,
        y: groundY,
        vx: randf(-1.6, 1.6) * (0.5 + sizeFactor),
        vy: -randf(1.2, 3.8) * (0.6 + sizeFactor),
        life: 1.0
      };
      setCircle(g, Math.max(0.8, drop.radius * randf(0.22, 0.4)), hex);
      g.x = droplet.x;
      g.y = droplet.y;
      droplets.push(droplet);
    }
  }

  app.ticker.add((ticker) => {
    const f = Math.min(ticker.deltaTime, 3);
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    const groundY = view.height - 1;

    palette.update(dt);

    // 1. Audio -> smoothed per-column level (0..1), laid out like bars
    const values = layoutBands(host.getBands(), COLUMNS, LAYOUT);
    for (let col = 0; col < COLUMNS; col++) {
      const target = values[col] <= GATE ? 0 : (values[col] - GATE) / (1 - GATE);
      levels[col] += (target - levels[col]) * (target > levels[col] ? ATTACK : FALLOFF);

      const rate = DENSITY * (DRIZZLE_RATE + levels[col] * LOUD_RATE);
      credit[col] += rate * dt;
      while (credit[col] >= 1) {
        credit[col] -= 1;
        // Size jitters a little so a steady tone doesn't look mechanical
        spawnDrop(col, Math.min(1, levels[col] * randf(0.8, 1.1)));
      }
    }

    // 2. Falling drops; shared colour modes recolour drops in flight
    drops = drops.filter((drop) => {
      drop.vy += GRAVITY * FALL_SPEED * f;
      drop.y += drop.vy * f;

      if (drop.y + drop.radius >= groundY) {
        splash(drop, groundY);
        releaseGraphics(drop.g);
        return false;
      }
      if (palette.shared) {
        drop.color = lighten(palette.color, drop.level * 0.35);
        drop.g.tint = rgbToHex(drop.color.r, drop.color.g, drop.color.b);
      }
      drop.g.y = drop.y;
      return true;
    });

    // 3. Splash droplets arc up and fade out
    droplets = droplets.filter((d) => {
      d.vy += SPLASH_GRAVITY * f;
      d.x += d.vx * f;
      d.y += d.vy * f;
      d.life -= 0.035 * f;

      if (d.life <= 0 || d.y > groundY + 2) {
        releaseGraphics(d.g);
        return false;
      }
      d.g.x = d.x;
      d.g.y = d.y;
      d.g.alpha = d.life;
      return true;
    });
  });

  return pixiHandle(app);
} });
