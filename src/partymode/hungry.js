// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

registerSaver('hungry', { label: 'Hungry', miniScale: 0.15, create: async (host) => {
		
	const BASE_BALL_COUNT = Math.round(cfg.num(host.config, 'hungry.ball_count', 50));
	const IMMUNITY_DURATION = 2.0;
	const BALL_MIN_RADIUS = 20.0;
	const BOUNCE_VARIANCE = 5.0;
	const EXPLOSION_OFFSET = 50.0;
	const SPEED_BOOST = 1.1; // 10% speed boost on eat
	const BASE_SPEED_MIN = -120.0;
	const BASE_SPEED_MAX = 120.0;
	const MIN_SPEED = 5.0;
	const GROW_SPEED = 12.0; // Lerp speed for smooth size/color transition

	class BallNode {
		constructor(pos, velocity, radius, color, immune) {
			this.graphics = createCircle();
			this.position = { x: pos.x, y: pos.y };
			this.velocity = { x: velocity.x, y: velocity.y };
			
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

		process(deltaSeconds, screenSize) {
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

			this.position.x += this.velocity.x * deltaSeconds;
			this.position.y += this.velocity.y * deltaSeconds;

			// Screen boundary bounces with variance
			if (this.position.x < this.radius) {
				this.position.x = this.radius;
				this.velocity.x *= -1;
				this.velocity.y += randfRange(-BOUNCE_VARIANCE, BOUNCE_VARIANCE);
			} else if (this.position.x > screenSize.x - this.radius) {
				this.position.x = screenSize.x - this.radius;
				this.velocity.x *= -1;
				this.velocity.y += randfRange(-BOUNCE_VARIANCE, BOUNCE_VARIANCE);
			}

			if (this.position.y < this.radius) {
				this.position.y = this.radius;
				this.velocity.y *= -1;
				this.velocity.x += randfRange(-BOUNCE_VARIANCE, BOUNCE_VARIANCE);
			} else if (this.position.y > screenSize.y - this.radius) {
				this.position.y = screenSize.y - this.radius;
				this.velocity.y *= -1;
				this.velocity.x += randfRange(-BOUNCE_VARIANCE, BOUNCE_VARIANCE);
			}

			this.graphics.x = this.position.x;
			this.graphics.y = this.position.y;
			
			this.draw();
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

	const safeVelocity = () => {
		let v = 0.0;
		while (Math.abs(v) < MIN_SPEED) {
			v = randfRange(BASE_SPEED_MIN, BASE_SPEED_MAX);
		}
		return v;
	};

	// --- Initialize App ---
	const { app, view } = await createPixiApp(host);

	// The mini view keeps roughly the same ball density as a 1280x720 window
	const INITIAL_BALL_COUNT = host.mini
		? Math.max(8, Math.round(BASE_BALL_COUNT * (view.width * view.height) / (1280 * 720)))
		: BASE_BALL_COUNT;

	const palette = createBallPalette(host.config, 'hungry', {
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
			const velocity = { x: safeVelocity(), y: safeVelocity() };
			const color = pickColor();
			const ball = new BallNode(pos, velocity, radius, color, false);
			app.stage.addChild(ball.graphics);
			balls.push(ball);
		}
	};

	const explodeAndReset = () => {
		const winner = balls[0];
		palette.reroll();
		const origin = { ...winner.position };

		// Clear current winner
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
			const velocity = { x: safeVelocity(), y: safeVelocity() };
			const color = pickColor();
			const ball = new BallNode(safeOrigin, velocity, radius, color, true);
			app.stage.addChild(ball.graphics);
			balls.push(ball);
		}

		immunityTimer = IMMUNITY_DURATION;
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

				// Use current target radius to prevent overlap glitching mid-animation
				const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
				if (dist < a.targetRadius + b.targetRadius) {
					const bigger = a.targetRadius >= b.targetRadius ? a : b;
					const smaller = bigger === a ? b : a;

					// Grow the winner instead of recreating it
					bigger.targetRadius = Math.sqrt(
						bigger.targetRadius * bigger.targetRadius + smaller.targetRadius * smaller.targetRadius
					);
					
					bigger.targetColor = {
						r: clamp(bigger.targetColor.r + 0.01, 0.2, 1.0),
						g: clamp(bigger.targetColor.g + 0.01, 0.2, 1.0),
						b: clamp(bigger.targetColor.b + 0.01, 0.2, 1.0)
					};

					bigger.velocity.x *= SPEED_BOOST;
					bigger.velocity.y *= SPEED_BOOST;

					if (Math.abs(bigger.velocity.x) < MIN_SPEED) {
						bigger.velocity.x = Math.sign(bigger.velocity.x || 1) * MIN_SPEED;
					}
					if (Math.abs(bigger.velocity.y) < MIN_SPEED) {
						bigger.velocity.y = Math.sign(bigger.velocity.y || 1) * MIN_SPEED;
					}

					toRemove.add(smaller);
					processed.add(a);
					processed.add(b);
				}
			}
		}

		// Process removals
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

		// Update ball physics & bounce logic
		for (const ball of balls) {
			ball.process(deltaSeconds, screenSize);
		}

		handleCollisions();

		// Check winner condition
		if (balls.length === 1 && immunityTimer <= 0.0) {
			explodeAndReset();
		}
	});
	return pixiHandle(app);
} });
