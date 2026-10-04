// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

registerSaver('chaos', { label: 'Chaos', miniScale: 0.12, create: async (host) => {
  const { app, view } = await createPixiApp(host, { antialias: true });

  const MIN_BALLS = 6;
  const MAX_BALLS = 20;
  const SPAWN_OFFSET = 200; // Distance outside the screen new balls start from
  // Balls that never make it on screen are culled after this long, or once
  // they are further out than any spawn point
  const ENTRY_TIMEOUT = 12.0;
  const CULL_MARGIN = SPAWN_OFFSET + 150;

  const START_COUNT = Math.max(1, Math.round(cfg.num(host.config, 'chaos.startcount', 3)));
  let balls = [];
  let particles = [];

  // Helper Functions
  function randfRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function safeVelocity() {
    let v = 0;
    while (Math.abs(v) < 1.5) {
      v = randfRange(-4.5, 4.5);
    }
    return v;
  }

  function randomColorRGB() {
    return {
      // Keep your wider range so you can get rich, moody dark colors if desired
      r: Math.floor(randfRange(40, 255)),
      g: Math.floor(randfRange(40, 255)),
      b: Math.floor(randfRange(40, 255))
    };
  }

  const palette = createBallPalette(host.config, 'chaos', { randomColor: randomColorRGB, autoInterval: true });
  const ballColor = (ball) => (palette.shared ? palette.color : ball.baseColorRGB);

  // --- BALL CLASS ---
  class Ball {
    constructor(x, y, dx, dy, radius, baseColorRGB, gen, isImmune) {
      this.x = x;
      this.y = y;
      this.dx = dx;
      this.dy = dy;
      this.radius = radius;
      this.baseColorRGB = baseColorRGB;
      this.generation = gen;
      this.immune = isImmune;
      this.spawnTime = performance.now() / 1000;

      // Track whether the ball has fully entered the screen bounds at least once
      this.hasEnteredScreen = false;

      this.graphics = createCircle();
      this.draw(0);
      app.stage.addChild(this.graphics);
    }

    draw(audioPercent = 0) {
      // 1. DIM FLOOR: Quiet moments drop down to 30% intensity so dark colors stay dark
      // 2. POWERBAR SURGE: Heavy beats push past 100% (up to 1.6) to force a bright punch
      const factor = 0.30 + (audioPercent * 1.30);
      const base = ballColor(this);

      // To prevent it from clipping straight to flat boring white,
      // we scale the RGB up while subtly pulling them toward white only at the absolute peak (factor > 1.0)
      let r = base.r * factor;
      let g = base.g * factor;
      let b = base.b * factor;

      if (factor > 1.0) {
        // Whiten the color slightly as it over-drives into maximum powerbar territory
        const whiteness = (factor - 1.0) * 0.4; // blend factor
        r = r + (255 - r) * whiteness;
        g = g + (255 - g) * whiteness;
        b = b + (255 - b) * whiteness;
      }

      const finalR = Math.min(255, Math.max(0, Math.round(r)));
      const finalG = Math.min(255, Math.max(0, Math.round(g)));
      const finalB = Math.min(255, Math.max(0, Math.round(b)));

      setCircle(this.graphics, this.radius, rgbToHex(finalR, finalG, finalB));
      this.graphics.x = this.x;
      this.graphics.y = this.y;
    }

    isFullyInside(width, height) {
      return (
        this.x >= this.radius &&
        this.x <= width - this.radius &&
        this.y >= this.radius &&
        this.y <= height - this.radius
      );
    }

    move(width, height, masterAudioVal, dt) {
      this.x += this.dx * dt;
      this.y += this.dy * dt;

      if (!this.hasEnteredScreen && this.isFullyInside(width, height)) {
        this.hasEnteredScreen = true;
      }

      // Still entering: if a collision knocked it outward, turn it back toward
      // the screen so it doesn't visibly fly away (it would only get culled)
      if (!this.hasEnteredScreen) {
        if ((this.x < this.radius && this.dx < 0) || (this.x > width - this.radius && this.dx > 0)) this.dx *= -1;
        if ((this.y < this.radius && this.dy < 0) || (this.y > height - this.radius && this.dy > 0)) this.dy *= -1;
      }

      // Only bounce off screen borders once it has safely cleared the threshold.
      // Bounces set the direction explicitly and clamp the ball back inside, so a
      // ball pushed past an edge (e.g. by a collision) can't flip-flop its way out.
      if (this.hasEnteredScreen) {
        if (this.x - this.radius < 0) {
          this.x = this.radius;
          this.dx = Math.abs(this.dx);
          this.dy += randfRange(-0.5, 0.5);
        } else if (this.x + this.radius > width) {
          this.x = width - this.radius;
          this.dx = -Math.abs(this.dx);
          this.dy += randfRange(-0.5, 0.5);
        }
        if (this.y - this.radius < 0) {
          this.y = this.radius;
          this.dy = Math.abs(this.dy);
          this.dx += randfRange(-0.5, 0.5);
        } else if (this.y + this.radius > height) {
          this.y = height - this.radius;
          this.dy = -Math.abs(this.dy);
          this.dx += randfRange(-0.5, 0.5);
        }
      }

      if (this.immune && (performance.now() / 1000) - this.spawnTime > 1.0) {
        this.immune = false;
      }

      this.draw(masterAudioVal);
    }

    // A ball that never made it on screen (deflected away while entering) is lost
    isLost(width, height) {
      if (this.hasEnteredScreen) return false;
      if ((performance.now() / 1000) - this.spawnTime > ENTRY_TIMEOUT) return true;
      return (
        this.x < -CULL_MARGIN || this.x > width + CULL_MARGIN ||
        this.y < -CULL_MARGIN || this.y > height + CULL_MARGIN
      );
    }

    destroy() {
      app.stage.removeChild(this.graphics);
      this.graphics.destroy();
    }
  }

  // --- PARTICLE CLASS ---
  class Particle {
    constructor(x, y, velocity, colorRGB) {
      this.x = x;
      this.y = y;
      this.vx = velocity.x;
      this.vy = velocity.y;
      this.life = 1.0;

      this.graphics = createCircle();
      setCircle(this.graphics, 3, rgbToHex(colorRGB.r, colorRGB.g, colorRGB.b));
      this.graphics.x = x;
      this.graphics.y = y;
      app.stage.addChild(this.graphics);
    }

    move(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.life -= 0.02 * dt;
      this.graphics.alpha = Math.max(0, this.life);
      this.graphics.x = this.x;
      this.graphics.y = this.y;
    }

    destroy() {
      app.stage.removeChild(this.graphics);
      this.graphics.destroy();
    }
  }

  function spawnBall(isImmune = true) {
    const radius = 60;
    const width = view.width;
    const height = view.height;

    // Pick a random line/edge: 1=Left, 2=Top, 3=Right, 4=Bottom
    const line = Math.floor(randfRange(1, 5));

    let x, y, dx, dy;

    // 15% to 85% range to stay away from corners
    const minPct = 0.15;
    const maxPct = 0.85;

    if (line === 1) {
      // Left line -> travel strictly East (+dx)
      x = -SPAWN_OFFSET;
      y = height * randfRange(minPct, maxPct);
      dx = randfRange(2.0, 4.0);
      dy = 0;
    } else if (line === 2) {
      // Top line -> travel strictly South (+dy)
      x = width * randfRange(minPct, maxPct);
      y = -SPAWN_OFFSET;
      dx = 0;
      dy = randfRange(2.0, 4.0);
    } else if (line === 3) {
      // Right line -> travel strictly West (-dx)
      x = width + SPAWN_OFFSET;
      y = height * randfRange(minPct, maxPct);
      dx = -randfRange(2.0, 4.0);
      dy = 0;
    } else {
      // Bottom line -> travel strictly North (-dy)
      x = width * randfRange(minPct, maxPct);
      y = height + SPAWN_OFFSET;
      dx = 0;
      dy = -randfRange(2.0, 4.0);
    }

    balls.push(new Ball(x, y, dx, dy, radius, palette.pick(), 0, isImmune));
  }

  function bounceBalls(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;

    const nx = dx / dist;
    const ny = dy / dist;

    const relX = b.dx - a.dx;
    const relY = b.dy - a.dy;
    const velAlongNormal = relX * nx + relY * ny;

    if (velAlongNormal < 0) {
      const impulse = -velAlongNormal;
      a.dx -= nx * impulse;
      a.dy -= ny * impulse;
      b.dx += nx * impulse;
      b.dy += ny * impulse;
    }

    const overlap = (a.radius + b.radius) - dist;
    if (overlap > 0) {
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
    }
  }

  const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

  for (let i = 0; i < START_COUNT; i++) {
    spawnBall(true);
  }

  // Main Animation Loop
  app.ticker.add((ticker) => {
    // Speeds were tuned per-frame at 60fps; scale so 90Hz displays don't run faster
    const dt = Math.min(ticker.deltaTime, 3);
    const width = view.width;
    const height = view.height;

    palette.update(ticker.deltaMS / 1000);

    // 1. Exact same spectrum slice configuration as bars.js
    const rawAudioData = host.getAudio();
    const startIndex = 3;
    const activeDataLength = Math.floor((rawAudioData.length - startIndex) * 0.65);
    let sum = 0;
    for (let i = 0; i < activeDataLength; i++) sum += rawAudioData[startIndex + i];

    // 2. Compute a single master audio level for brightness glow
    const avgRaw = activeDataLength > 0 ? sum / activeDataLength : 0;
    const masterAudioVal = Math.min(1.0, Math.pow(avgRaw / 255, 2.2) * 1.2);

    // 3. Move all balls, dropping any that got lost off screen
    balls = balls.filter((ball) => {
      ball.move(width, height, masterAudioVal, dt);
      if (ball.isLost(width, height)) {
        ball.destroy();
        return false;
      }
      return true;
    });

    // Move particles, removing dead ones
    particles = particles.filter((p) => {
      p.move(dt);
      if (p.life <= 0) {
        p.destroy();
        return false;
      }
      return true;
    });

    const newBalls = [];
    const removed = new Set();

    // Collision Detection Loop
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];

        // A ball already destroyed this frame can't split again
        if (removed.has(a) || removed.has(b)) continue;

        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const minDist = a.radius + b.radius;

        if (dist < minDist) {
          if (a.immune || b.immune) {
            bounceBalls(a, b);
            continue;
          }

          removed.add(a);
          removed.add(b);

          const collisionX = (a.x + b.x) / 2;
          const collisionY = (a.y + b.y) / 2;

          for (let k = 0; k < 5; k++) {
            const p = new Particle(
              collisionX,
              collisionY,
              { x: randfRange(-2.0, 2.0), y: randfRange(-2.0, 2.0) },
              ballColor(a)
            );
            particles.push(p);
          }

          for (let ball of [a, b]) {
            if (ball.generation < 3) {
              const childRadius = ball.radius / 2;
              for (let k = 0; k < 2; k++) {
                // Children start inside the screen so they always bounce
                const newBall = new Ball(
                  clamp(ball.x + randfRange(-5, 5), childRadius, width - childRadius),
                  clamp(ball.y + randfRange(-5, 5), childRadius, height - childRadius),
                  safeVelocity(),
                  safeVelocity(),
                  childRadius,
                  palette.pick(),
                  ball.generation + 1,
                  true
                );
                newBall.hasEnteredScreen = true;
                newBalls.push(newBall);
              }
            }
          }
        }
      }
    }

    if (removed.size > 0) {
      balls = balls.filter(b => {
        if (removed.has(b)) {
          b.destroy();
          return false;
        }
        return true;
      });
    }

    balls.push(...newBalls);

    if (balls.length < MIN_BALLS) {
      spawnBall(true);
    }

    const hasGenZero = balls.some(b => b.generation === 0);
    if (!hasGenZero && balls.length < MAX_BALLS) {
      spawnBall(true);
    }
  });

  return pixiHandle(app);
} });
