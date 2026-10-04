// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

registerSaver('blackholes', { label: 'Black Holes', miniScale: 0.15, create: async (host) => {

  const BASE_BALL_COUNT = Math.round(cfg.num(host.config, 'blackholes.ball_count', 50));
  const BALL_MIN_RADIUS = 20.0;
  const IMMUNITY_DURATION = 7.0;
  const MERGE_DISTANCE_FACTOR = 0.8;
  const GRAVITY_CONSTANT = 30000.0;
  const MAX_FORCE = 4000.0;
  const MIN_FORCE = 100.0;
  const DAMPING = 0.98;
  const MAX_SPEED = 700.0;
  const MIN_SPEED = 400.0;
  const EXPLOSION_OFFSET = 50.0;
  const WALL_REPULSION_STRENGTH = 5000000.0;
  const WALL_REPULSION_MAX = 5500.0;
  const GROW_SPEED = 12.0; // Lerp speed for smooth growth/color transitions
  // Endgame: with this few balls left, each steers toward its nearest rival.
  // Mass grows with radius^4 while gravity force is capped, so big final balls
  // barely accelerate from gravity alone and can circle each other for ages.
  const ENDGAME_BALLS = 3;
  const HOMING_RATE = 1.2;      // How quickly velocity turns toward the target (per second)
  const ENDGAME_MIN_SPEED = 150.0;

  class BallNode {
    constructor(pos, radius, color, immune) {
      this.graphics = createCircle();
      this.position = { x: pos.x, y: pos.y };
      this.velocity = { x: 0.0, y: 0.0 };

      // Set initial positions immediately to prevent top-left flash
      this.graphics.x = pos.x;
      this.graphics.y = pos.y;

      this.radius = radius;
      this.targetRadius = radius;

      this.color = { ...color }; // { r, g, b } normalized 0 to 1
      this.targetColor = { ...color };

      this.immune = immune;

      this.draw();
    }

    process(deltaSeconds, screenSize, totalBalls) {
      // Smoothly scale radius toward target radius
      if (Math.abs(this.radius - this.targetRadius) > 0.01) {
        this.radius += (this.targetRadius - this.radius) * Math.min(1.0, deltaSeconds * GROW_SPEED);
      } else {
        this.radius = this.targetRadius;
      }

      // Shared colour modes drive every ball's colour
      if (palette.shared) {
        this.targetColor = { r: palette.color.r / 255, g: palette.color.g / 255, b: palette.color.b / 255 };
      }

      // Smoothly lerp color toward target color
      this.color.r += (this.targetColor.r - this.color.r) * Math.min(1.0, deltaSeconds * GROW_SPEED);
      this.color.g += (this.targetColor.g - this.color.g) * Math.min(1.0, deltaSeconds * GROW_SPEED);
      this.color.b += (this.targetColor.b - this.color.b) * Math.min(1.0, deltaSeconds * GROW_SPEED);

      this.applyWallRepulsion(deltaSeconds, screenSize, totalBalls);

      // Endgame velocity bleed to resolve infinite figure-8 orbital loops
      if (totalBalls <= 3 && immunityTimer <= 0.0) {
        this.velocity.x *= 0.995;
        this.velocity.y *= 0.995;
      }

      this.position.x += this.velocity.x * deltaSeconds;
      this.position.y += this.velocity.y * deltaSeconds;

      const speed = Math.hypot(this.velocity.x, this.velocity.y);
      if (speed > MAX_SPEED) {
        this.velocity.x = (this.velocity.x / speed) * MAX_SPEED;
        this.velocity.y = (this.velocity.y / speed) * MAX_SPEED;
      } else {
        const minSpeed = (totalBalls <= ENDGAME_BALLS && immunityTimer <= 0.0) ? ENDGAME_MIN_SPEED : MIN_SPEED;
        if (speed < minSpeed && speed > 0.0) {
          this.velocity.x = (this.velocity.x / speed) * minSpeed;
          this.velocity.y = (this.velocity.y / speed) * minSpeed;
        }
      }

      this.clampToScreen(screenSize);

      this.graphics.x = this.position.x;
      this.graphics.y = this.position.y;

      this.draw();
    }

    applyDamping() {
      this.velocity.x *= DAMPING;
      this.velocity.y *= DAMPING;
    }

    applyWallRepulsion(deltaSeconds, screenSize, totalBalls) {
      // Scale back wall repulsion during the endgame so edge forces don't keep balls apart
      const wallMult = totalBalls <= 2 ? 0.25 : 1.0;
      const strength = WALL_REPULSION_STRENGTH * wallMult;

      const distLeft = Math.max(this.position.x - this.radius, 1.0);
      this.velocity.x += Math.min(strength / (distLeft * distLeft), WALL_REPULSION_MAX) * deltaSeconds;

      const distRight = Math.max(screenSize.x - this.position.x - this.radius, 1.0);
      this.velocity.x -= Math.min(strength / (distRight * distRight), WALL_REPULSION_MAX) * deltaSeconds;

      const distTop = Math.max(this.position.y - this.radius, 1.0);
      this.velocity.y += Math.min(strength / (distTop * distTop), WALL_REPULSION_MAX) * deltaSeconds;

      const distBottom = Math.max(screenSize.y - this.position.y - this.radius, 1.0);
      this.velocity.y -= Math.min(strength / (distBottom * distBottom), WALL_REPULSION_MAX) * deltaSeconds;
    }

    clampToScreen(screenSize) {
      this.position.x = clamp(this.position.x, this.radius, screenSize.x - this.radius);
      this.position.y = clamp(this.position.y, this.radius, screenSize.y - this.radius);
    }

    mass() {
      return Math.pow(this.targetRadius, 4);
    }

    visualMass() {
      return this.targetRadius * this.targetRadius;
    }

    draw() {
      const hexColor = rgbToHex(
        Math.floor(clamp(this.color.r, 0, 1) * 255),
        Math.floor(clamp(this.color.g, 0, 1) * 255),
        Math.floor(clamp(this.color.b, 0, 1) * 255)
      );
      setCircle(this.graphics, Math.max(1, this.radius), hexColor);
    }

    destroy() {
      this.graphics.destroy();
    }
  }

  // --- Helper Math Functions ---
  const randfRange = (min, max) => Math.random() * (max - min) + min;
  const randiRange = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randomColor = () => ({
    r: randfRange(0.2, 0.8),
    g: randfRange(0.2, 0.8),
    b: randfRange(0.2, 0.8)
  });
  const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

  // --- Initialize App ---
  const { app, view } = await createPixiApp(host);

  // The mini view keeps roughly the same ball density as a 1280x720 window
  const INITIAL_BALL_COUNT = host.mini
    ? Math.max(8, Math.round(BASE_BALL_COUNT * (view.width * view.height) / (1280 * 720)))
    : BASE_BALL_COUNT;

  const palette = createBallPalette(host.config, 'blackholes', {
    randomColor: () => { const c = randomColor(); return { r: c.r * 255, g: c.g * 255, b: c.b * 255 }; }
  });
  const pickColor = () => { const c = palette.pick(); return { r: c.r / 255, g: c.g / 255, b: c.b / 255 }; };
  
  let balls = [];
  let immunityTimer = 0.0;

  const spawnBalls = (count) => {
    const screenSize = { x: view.width, y: view.height };
    for (let i = 0; i < count; i++) {
      const radius = BALL_MIN_RADIUS;
      const pos = {
        x: randiRange(radius, screenSize.x - radius),
        y: randiRange(radius, screenSize.y - radius)
      };
      const color = pickColor();
      const ball = new BallNode(pos, radius, color, false);
      app.stage.addChild(ball.graphics);
      balls.push(ball);
    }
  };

  const applyGravity = (deltaSeconds) => {
    // Dynamic endgame multiplier: strengthens gravity on final surviving balls
    const endgameMultiplier = balls.length <= 2 ? 3.0 : (balls.length <= 5 ? 1.8 : 1.0);

    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distSq = Math.max(dx * dx + dy * dy, 100.0);
        const dist = Math.sqrt(distSq);

        let forceMag = (GRAVITY_CONSTANT * endgameMultiplier * a.mass() * b.mass()) / distSq;
        forceMag = clamp(forceMag, MIN_FORCE, MAX_FORCE * endgameMultiplier);

        const nx = dx / dist;
        const ny = dy / dist;

        const fx = nx * forceMag;
        const fy = ny * forceMag;

        const aMass = a.mass();
        const bMass = b.mass();

        a.velocity.x += (fx / aMass) * deltaSeconds;
        a.velocity.y += (fy / aMass) * deltaSeconds;

        b.velocity.x -= (fx / bMass) * deltaSeconds;
        b.velocity.y -= (fy / bMass) * deltaSeconds;
      }
    }
  };

  const applyEndgameHoming = (deltaSeconds) => {
    if (balls.length > ENDGAME_BALLS || balls.length < 2) return;
    const turn = Math.min(1.0, HOMING_RATE * deltaSeconds);

    for (const ball of balls) {
      let nearest = null;
      let nearestDist = Infinity;
      for (const other of balls) {
        if (other === ball) continue;
        const d = Math.hypot(other.position.x - ball.position.x, other.position.y - ball.position.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = other;
        }
      }
      if (!nearest || nearestDist === 0) continue;

      // Blend velocity toward a straight line at the rival, keeping current speed
      const speed = Math.max(Math.hypot(ball.velocity.x, ball.velocity.y), ENDGAME_MIN_SPEED);
      const desiredX = ((nearest.position.x - ball.position.x) / nearestDist) * speed;
      const desiredY = ((nearest.position.y - ball.position.y) / nearestDist) * speed;
      ball.velocity.x += (desiredX - ball.velocity.x) * turn;
      ball.velocity.y += (desiredY - ball.velocity.y) * turn;
    }
  };

  const handleCollisions = () => {
    const toRemove = new Set();
    const processed = new Set();

    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];

        if (a.immune || b.immune) continue;
        if (processed.has(a) || processed.has(b)) continue;

        const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        if (dist < (a.targetRadius + b.targetRadius) * MERGE_DISTANCE_FACTOR) {
          const aVM = a.visualMass();
          const bVM = b.visualMass();

          const bigger = aVM >= bVM ? a : b;
          const smaller = bigger === a ? b : a;

          const newVisualMass = aVM + bVM;
          const newRadius = Math.sqrt(newVisualMass);

          // Calculate conservation of momentum velocity
          const newVelX = (a.velocity.x * aVM + b.velocity.x * bVM) / newVisualMass;
          const newVelY = (a.velocity.y * aVM + b.velocity.y * bVM) / newVisualMass;

          bigger.targetRadius = newRadius;
          bigger.velocity = { x: newVelX, y: newVelY };

          // Lighten color slightly on merge (Godot lightened(0.05))
          bigger.targetColor = {
            r: clamp(bigger.targetColor.r + 0.05, 0.2, 1.0),
            g: clamp(bigger.targetColor.g + 0.05, 0.2, 1.0),
            b: clamp(bigger.targetColor.b + 0.05, 0.2, 1.0)
          };

          toRemove.add(smaller);
          processed.add(a);
          processed.add(b);
        }
      }
    }

    if (toRemove.size > 0) {
      balls = balls.filter(b => {
        if (toRemove.has(b)) {
          app.stage.removeChild(b.graphics);
          b.destroy();
          return false;
        }
        return true;
      });
    }
  };

  const explodeAndReset = () => {
    const winner = balls[0];
    palette.reroll();
    const origin = { ...winner.position };

    app.stage.removeChild(winner.graphics);
    winner.destroy();
    balls = [];

    const screenSize = { x: view.width, y: view.height };
    const safeOrigin = {
      x: clamp(origin.x, EXPLOSION_OFFSET, screenSize.x - EXPLOSION_OFFSET),
      y: clamp(origin.y, EXPLOSION_OFFSET, screenSize.y - EXPLOSION_OFFSET)
    };

    for (let i = 0; i < INITIAL_BALL_COUNT; i++) {
      const radius = BALL_MIN_RADIUS;
      const angle = randfRange(0, Math.PI * 2);
      const speed = randfRange(600, 1000);
      const velocity = {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
      };
      const color = pickColor();
      const ball = new BallNode(safeOrigin, radius, color, true);
      ball.velocity = velocity;
      app.stage.addChild(ball.graphics);
      balls.push(ball);
    }

    immunityTimer = IMMUNITY_DURATION;
  };

  spawnBalls(INITIAL_BALL_COUNT);


  // --- Main Tick Loop ---
  app.ticker.add((ticker) => {
    const deltaSeconds = ticker.deltaTime / 60.0;
    palette.update(deltaSeconds);
    const screenSize = { x: view.width, y: view.height };

    // Immunity timer update
    if (immunityTimer > 0.0) {
      immunityTimer -= deltaSeconds;
      if (immunityTimer <= 0.0) {
        for (const ball of balls) {
          ball.immune = false;
        }
      }
    }

    // Process damping during immunity phase
    for (const ball of balls) {
      if (immunityTimer > 0.0) {
        ball.applyDamping();
      }
      ball.process(deltaSeconds, screenSize, balls.length);
    }

    // Apply N-body gravitational attraction & collision check when active
    if (immunityTimer <= 0.0) {
      applyGravity(deltaSeconds);
      applyEndgameHoming(deltaSeconds);
      handleCollisions();
    }

    // Winner explosion trigger
    if (balls.length === 1 && immunityTimer <= 0.0) {
      explodeAndReset();
    }
  });
  return pixiHandle(app);
} });
