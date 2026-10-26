// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

registerSaver('journey', { label: 'Journey', miniScale: 0.25, create: async (host) => {
  // ---------------------------------------------------------
  // Config
  // ---------------------------------------------------------
  const ORB_COUNT = Math.round(cfg.num(host.config, 'journey.orb_count', 20));
  const BUFFER = 200.0;
  const SPAWN_RETRY_INTERVAL = 5; // frame interval
  const CENTER_SAFE_RADIUS = 45.0;

  const MIN_SPEED = 12.0;
  const MAX_SPEED = 72.0;

  // ---------------------------------------------------------
  // PixiJS Initialization
  // Note: WebGL/WebGPU handles AA natively, so manual supersampling 
  // is omitted for superior GPU performance.
  // ---------------------------------------------------------
  const { app, view } = await createPixiApp(host, { antialias: true });

  // 'random' keeps Journey's original look: every orb cycles through the
  // rainbow on its own clock. The shared modes colour all orbs together.
  const palette = createBallPalette(host.config, 'journey', { autoInterval: true });

  // ---------------------------------------------------------
  // Utility
  // ---------------------------------------------------------
  function randf(minv, maxv) {
    return minv + Math.random() * (maxv - minv);
  }


  // ---------------------------------------------------------
  // Orb Class
  // ---------------------------------------------------------
  class Orb {
    constructor(x, y, dx, dy) {
      this.x = x;
      this.y = y;
      this.dx = dx; // Pixels per second
      this.dy = dy; // Pixels per second

      this.baseRadius = randf(10.0, 20.0);
      this.radius = this.baseRadius;
      this.time = 0.0;
      this.color = 0xffffff;

      this.graphics = createCircle();
      app.stage.addChild(this.graphics);
    }

    move(dt) {
      // Movement
      this.x += this.dx * dt;
      this.y += this.dy * dt;

      // Smooth radius animation
      this.time += dt;
      this.radius = this.baseRadius + Math.sin(this.time) * 7.0;

      // Smooth animated color
      if (palette.shared) {
        this.color = rgbToHex(palette.color.r, palette.color.g, palette.color.b);
        return;
      }
      const t = this.time;
      const r = Math.floor(127.5 + 127.5 * Math.sin(t));
      const g = Math.floor(127.5 + 127.5 * Math.sin(t + 1.0));
      const b = Math.floor(127.5 + 127.5 * Math.sin(t + 2.0));
      this.color = (r << 16) + (g << 8) + b;
    }

    draw() {
      setCircle(this.graphics, Math.max(1, this.radius), this.color);
      this.graphics.x = this.x;
      this.graphics.y = this.y;
    }

    destroy() {
      app.stage.removeChild(this.graphics);
      this.graphics.destroy();
    }
  }

  // ---------------------------------------------------------
  // Game State
  // ---------------------------------------------------------
  let orbs = [];
  let spawnRetryTimer = 0;

  // ---------------------------------------------------------
  // Spawn Orb
  // ---------------------------------------------------------
  function spawnOrb() {
    const w = view.width;
    const h = view.height;

    const angle = randf(0.0, Math.PI * 2);
    const speed = randf(MIN_SPEED, MAX_SPEED);

    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;

    const orb = new Orb(w * 0.5, h * 0.5, dx, dy);
    orbs.push(orb);
  }

  // ---------------------------------------------------------
  // Update Loop
  // ---------------------------------------------------------
  function update(dt) {
    const w = view.width;
    const h = view.height;

    // Update motion and bounds checking
    orbs = orbs.filter(orb => {
      orb.move(dt);

      const isOutOfBounds = (
        orb.x < -BUFFER ||
        orb.x > w + BUFFER ||
        orb.y < -BUFFER ||
        orb.y > h + BUFFER
      );

      if (isOutOfBounds) {
        orb.destroy();
        return false;
      }
      return true;
    });

    // Ball vs ball collisions
    const count = orbs.length;

    for (let i = 0; i < count; i++) {
      const a = orbs[i];

      for (let j = i + 1; j < count; j++) {
        const b = orbs[j];

        const dx = b.x - a.x;
        const dy = b.y - a.y;

        const minDist = a.radius + b.radius;
        const distSquared = dx * dx + dy * dy;

        // Cheap collision rejection
        if (distSquared >= minDist * minDist) {
          continue;
        }

        // Exact distance
        const dist = Math.sqrt(distSquared);
        let nx = 1.0;
        let ny = 0.0;

        if (dist > 0.0) {
          nx = dx / dist;
          ny = dy / dist;
        }

        // Push overlapping orbs apart
        const push = (minDist - dist) * 0.5;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;

        // Exchange velocities
        const tempDx = a.dx;
        const tempDy = a.dy;
        a.dx = b.dx;
        a.dy = b.dy;
        b.dx = tempDx;
        b.dy = tempDy;
      }
    }

    // Spawn retry timer
    spawnRetryTimer++;

    if (spawnRetryTimer >= SPAWN_RETRY_INTERVAL) {
      spawnRetryTimer = 0;

      if (orbs.length < ORB_COUNT) {
        const centerX = w * 0.5;
        const centerY = h * 0.5;
        const safeRadiusSquared = CENTER_SAFE_RADIUS * CENTER_SAFE_RADIUS;

        // Check if center is clear of orbs
        const isCenterSafe = !orbs.some(orb => {
          const dx = orb.x - centerX;
          const dy = orb.y - centerY;
          return (dx * dx + dy * dy) < safeRadiusSquared;
        });

        if (isCenterSafe) {
          spawnOrb();
        }
      }
    }

    // Draw frame
    for (let orb of orbs) {
      orb.draw();
    }
  }

  // ---------------------------------------------------------
  // Main Animation Loop
  // ---------------------------------------------------------
  app.ticker.add((ticker) => {
    // Convert deltaMS to seconds and clamp to prevent huge jumps (max 0.1s)
    let dt = ticker.deltaMS / 1000.0;
    dt = Math.min(dt, 0.1);

    palette.update(dt);

    update(dt);
  });

  return pixiHandle(app);
} });
