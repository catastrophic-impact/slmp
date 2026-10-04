// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

registerSaver('space', { label: 'Space', miniScale: 0.35, create: async (host) => {

	const randfRange = (min, max) => Math.random() * (max - min) + min;
	const config = host.config;

	// Planets are huge next to the mini view's height, so shrink them there
	const PLANET_SIZE_SCALE = host.mini ? 0.4 : 1.0;

	const palette = createBallPalette(config, 'space', {
		randomColor: () => ({ r: randfRange(0.3, 1.0) * 255, g: randfRange(0.3, 1.0) * 255, b: randfRange(0.3, 1.0) * 255 }),
		autoInterval: true
	});

	class SpaceObject {
		constructor() {
			this.graphics = createCircle();
			this.velocity = { x: 0.2, y: 0 };
			this.radius = 2.0;
			this.baseColor = { r: 1, g: 1, b: 1 };
			this.isPlanet = false;
			this.isStar = false;
			this.spawnTime = 0.0;
			this.glow = false;

			this.sparkleTimer = 0.0;
			this.sparkleDelay = 0.0;
			this.sparkleActive = false;
			// Shrinks toward 0 as a black hole swallows it
			this.squash = 1;
		}

		setSquash(value) {
			if (value === this.squash) return;
			this.squash = value;
			this.draw();
		}

		setupStar(pos, currentTimeSeconds) {
			this.graphics.x = pos.x;
			this.graphics.y = pos.y;
			this.velocity = { x: randfRange(10.0, 30.0) * 0.01, y: 0 };
			this.isStar = true;
			this.isPlanet = false;
			this.squash = 1;
			this.spawnTime = currentTimeSeconds;
			this.graphics.zIndex = 0;

			if (Math.floor(Math.random() * 10) === 0) {
				this.glow = true;
				this.baseColor = {
					r: 0.5 + Math.random() * 0.5,
					g: 0.5 + Math.random() * 0.5,
					b: 0.5 + Math.random() * 0.5
				};
				this.radius = randfRange(2.5, 10.0);
				this.sparkleDelay = randfRange(2.0, 10.0);
				this.sparkleTimer = 0.0;
				this.sparkleActive = false;
			} else {
				this.glow = false;
				this.baseColor = { r: 1, g: 1, b: 1 };
				this.radius = randfRange(1.0, 2.5);
			}
			this.draw();
		}

		setupPlanet(pos, currentTimeSeconds) {
			this.graphics.x = pos.x;
			this.graphics.y = pos.y;
			this.velocity = { x: randfRange(30.0, 60.0) * 0.01, y: 0 };
			this.radius = randfRange(20.0, 90.0) * PLANET_SIZE_SCALE;
			const c = palette.pick();
			this.baseColor = { r: c.r / 255, g: c.g / 255, b: c.b / 255 };
			this.isStar = false;
			this.isPlanet = true;
			this.spawnTime = currentTimeSeconds;
			this.graphics.zIndex = 1;
			this.draw();
		}

		// frameScale: 1.0 at 60fps; velocities are tuned in pixels per 60fps frame
		updateMotion(deltaSeconds, frameScale) {
			this.graphics.x += this.velocity.x * frameScale;
			this.graphics.y += this.velocity.y * frameScale;

			// Only sparkling stars (and planets in shared colour modes) change colour
			if (this.glow) {
				this.sparkleTimer += deltaSeconds;
				if (this.sparkleActive) {
					if (this.sparkleTimer >= 2.0) {
						this.sparkleActive = false;
						this.sparkleTimer = 0.0;
						this.sparkleDelay = randfRange(2.0, 10.0);
					}
				} else if (this.sparkleTimer >= this.sparkleDelay) {
					this.sparkleActive = true;
					this.sparkleTimer = 0.0;
				}
				this.draw();
			} else if (this.isPlanet && palette.shared) {
				this.baseColor = { r: palette.color.r / 255, g: palette.color.g / 255, b: palette.color.b / 255 };
				this.draw();
			}
		}

		draw() {
			let { r, g, b } = this.baseColor;

			if (this.glow && this.sparkleActive) {
				const phase = this.sparkleTimer / 2.0;
				const sparkle = phase < 0.5 ? phase * 2.0 : (1.0 - phase) * 2.0;
				r += (1.0 - r) * sparkle;
				g += (1.0 - g) * sparkle;
				b += (1.0 - b) * sparkle;
			}

			const size = this.radius * Math.max(0.15, this.squash);
			setCircle(this.graphics, size, rgbToHex(Math.floor(r * 255), Math.floor(g * 255), Math.floor(b * 255)));
		}

		destroy() {
			this.graphics.destroy();
		}
	}

	// --- BLACK HOLES ---
	// Rare visitors: a black hole forms, bends nearby stars and planets into a
	// spiral, swallows them (each meal feeds it a little), and slowly evaporates
	// until it collapses in a final flash.
	const BH_ENABLED = cfg.bool(config, 'space.blackholes', true);
	const BH_FREQUENCY = cfg.num(config, 'space.blackhole_frequency', 90);
	const BH_MAX_STRENGTH = cfg.num(config, 'space.blackhole_strength', 5);
	const BH_FORM_TIME = 2.5;
	const BH_COLLAPSE_TIME = 0.8;

	class BlackHole {
		constructor(pos) {
			this.x = pos.x;
			this.y = pos.y;
			this.strength = randfRange(0.3, 1.0) * BH_MAX_STRENGTH; // 0.3 .. 10
			this.fullRadius = (14 + this.strength * 5) * (host.mini ? 0.6 : 1.0);
			this.radius = 0;
			// Evaporates over 25-50s (meals extend that a little)
			this.decayRate = this.fullRadius / randfRange(25, 50);
			this.phase = 'forming';
			this.phaseTime = 0;
			this.age = 0;
			this.ringHue = randfRange(0, 60) + (Math.random() < 0.3 ? 220 : 0); // fiery orange or eerie blue-violet

			this.outerGlow = createCircle();
			this.innerGlow = createCircle();
			this.core = createCircle();
			for (const g of [this.outerGlow, this.innerGlow, this.core]) {
				g.x = this.x;
				g.y = this.y;
				g.zIndex = 2;
				worldContainer.addChild(g);
			}
			this.outerGlow.blendMode = 'add';
			this.innerGlow.blendMode = 'add';
		}

		get influence() {
			return this.radius * 14 + this.strength * 30;
		}

		feed(amount) {
			this.radius += amount;
			this.fullRadius = Math.max(this.fullRadius, this.radius);
		}

		// Returns false once it has fully collapsed
		update(deltaSeconds) {
			this.age += deltaSeconds;
			this.phaseTime += deltaSeconds;

			if (this.phase === 'forming') {
				const t = Math.min(1, this.phaseTime / BH_FORM_TIME);
				this.radius = this.fullRadius * t * t * (3 - 2 * t);
				if (t >= 1) { this.phase = 'active'; this.phaseTime = 0; }
			} else if (this.phase === 'active') {
				this.radius -= this.decayRate * deltaSeconds;
				if (this.radius <= 2) { this.phase = 'collapsing'; this.phaseTime = 0; }
			}

			const pulse = 1 + Math.sin(this.age * 3) * 0.08;
			const ringColor = hslToRgb(this.ringHue, 0.9, 0.5);
			const ringHex = rgbToHex(ringColor.r, ringColor.g, ringColor.b);

			if (this.phase === 'collapsing') {
				// Final flash: the glow bursts outward and fades as the core vanishes
				const t = Math.min(1, this.phaseTime / BH_COLLAPSE_TIME);
				setCircle(this.outerGlow, 6 + t * this.fullRadius * 4, ringHex);
				this.outerGlow.alpha = 0.6 * (1 - t);
				setCircle(this.innerGlow, 4 + t * this.fullRadius * 2, 0xffffff);
				this.innerGlow.alpha = 0.8 * (1 - t);
				setCircle(this.core, Math.max(0.5, 2 * (1 - t)), 0x000000);
				return t < 1;
			}

			setCircle(this.outerGlow, this.radius * 2.8 * pulse, ringHex);
			this.outerGlow.alpha = 0.3;
			setCircle(this.innerGlow, this.radius * 1.35, ringHex);
			this.innerGlow.alpha = 0.55;
			setCircle(this.core, this.radius, 0x000000);
			return true;
		}

		// Pull an object in. Returns true when it has been swallowed.
		attract(obj, frameScale) {
			if (this.phase === 'collapsing') return false;
			const dx = this.x - obj.graphics.x;
			const dy = this.y - obj.graphics.y;
			const distSq = dx * dx + dy * dy;
			const influence = this.influence;
			if (distSq > influence * influence) {
				obj.setSquash(1);
				return false;
			}

			const dist = Math.sqrt(distSq) || 0.001;
			if (dist < this.radius * 0.9 + (obj.isPlanet ? obj.radius * 0.5 : 0)) return true;

			// Gravity grows toward the centre; a tangential share makes things spiral
			const accel = Math.min(0.5, 0.004 * this.strength * Math.pow(influence / Math.max(dist, this.radius), 1.5)) * frameScale;
			const nx = dx / dist;
			const ny = dy / dist;
			obj.velocity.x += (nx - ny * 0.45) * accel;
			obj.velocity.y += (ny + nx * 0.45) * accel;
			// A little drag so orbits decay into the hole instead of looping forever
			obj.velocity.x *= 1 - 0.006 * frameScale;
			obj.velocity.y *= 1 - 0.006 * frameScale;

			// Shrink as things approach the event horizon
			obj.setSquash(Math.min(1, dist / (this.radius * 3)));
			return false;
		}

		destroy() {
			for (const g of [this.outerGlow, this.innerGlow, this.core]) {
				worldContainer.removeChild(g);
				g.destroy();
			}
		}
	}

	// --- MAIN APPLICATION SETUP ---
	const { app, view } = await createPixiApp(host);

	const STAR_COUNT = 100;
	const MAX_PLANETS = 3;
	const PLANET_IMMUNITY_TIME = 30.0;
	const PLANET_EXTRA_OFFSET = 200.0;
	const STAR_BACK_OFFSET = 10.0;
	const STAR_BUFFER = 20.0;
	const PLANET_BUFFER = 200.0;
	const CAMERA_ZOOM = 1.2;

	const screenSize = { x: view.width, y: view.height };
	const galaxyHalfSize = { x: screenSize.x * 1.5, y: screenSize.y * 1.5 };

	let objects = [];
	let planetTimer = 0.0;
	let planetTimeout = 20.0;
	let blackHole = null;
	let blackHoleTimer = randfRange(0.3, 1.0) * BH_FREQUENCY;

	// Camera Container Setup
	const worldContainer = new PIXI.Container();
	worldContainer.sortableChildren = true;
	app.stage.addChild(worldContainer);

	worldContainer.x = screenSize.x / 2;
	worldContainer.y = screenSize.y / 2;
	worldContainer.rotation = Math.random() * Math.PI * 2;
	worldContainer.scale.set(CAMERA_ZOOM, CAMERA_ZOOM);

	// Keep the camera centred when the window resizes or goes fullscreen
	const onResize = () => {
		worldContainer.x = view.width / 2;
		worldContainer.y = view.height / 2;
	};
	app.renderer.on('resize', onResize);

	const getCurrentTimeSeconds = () => performance.now() / 1000.0;

	const isOffscreen = (pos, isPlanet) => {
		const buffer = isPlanet ? PLANET_BUFFER : STAR_BUFFER;
		return (
			pos.x < -galaxyHalfSize.x - buffer ||
			pos.x > galaxyHalfSize.x + buffer ||
			pos.y < -galaxyHalfSize.y - buffer ||
			pos.y > galaxyHalfSize.y + buffer
		);
	};

	const getHorizontalSpawn = (offset) => {
		const y = (Math.random() * 2 - 1) * galaxyHalfSize.y;
		return { x: -galaxyHalfSize.x - offset, y };
	};

	// Black holes appear somewhere comfortably inside the visible area,
	// whatever the camera rotation is
	const spawnBlackHole = () => {
		const visibleRadius = Math.min(view.width, view.height) / 2 / CAMERA_ZOOM;
		const angle = randfRange(0, Math.PI * 2);
		const dist = randfRange(0, visibleRadius * 0.6);
		blackHole = new BlackHole({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist });
	};

	// --- Initial Spawning ---
	const initialTime = getCurrentTimeSeconds();

	for (let i = 0; i < STAR_COUNT * 9; i++) {
		const star = new SpaceObject();
		star.setupStar({
			x: randfRange(-galaxyHalfSize.x, galaxyHalfSize.x),
			y: randfRange(-galaxyHalfSize.y, galaxyHalfSize.y)
		}, initialTime);
		worldContainer.addChild(star.graphics);
		objects.push(star);
	}

	const sectorOffsets = [
		{ x: -screenSize.x, y: -screenSize.y },
		{ x: 0, y: -screenSize.y },
		{ x: screenSize.x, y: -screenSize.y },
		{ x: -screenSize.x, y: 0 },
		{ x: 0, y: 0 },
		{ x: screenSize.x, y: 0 },
		{ x: -screenSize.x, y: screenSize.y },
		{ x: 0, y: screenSize.y },
		{ x: screenSize.x, y: screenSize.y }
	];

	for (const offset of sectorOffsets) {
		const planet = new SpaceObject();
		planet.setupPlanet({
			x: randfRange(-screenSize.x / 2, screenSize.x / 2) + offset.x,
			y: randfRange(-screenSize.y / 2, screenSize.y / 2) + offset.y
		}, initialTime);
		worldContainer.addChild(planet.graphics);
		objects.push(planet);
	}

	planetTimeout = randfRange(10.0, 45.0);
	planetTimer = randfRange(0.0, planetTimeout * 0.8);

	// --- Main Tick Loop ---
	app.ticker.add((ticker) => {
		const frameScale = Math.min(ticker.deltaTime, 3);
		const deltaSeconds = ticker.deltaMS / 1000.0;
		const currentTime = getCurrentTimeSeconds();

		palette.update(deltaSeconds);

		if (BH_ENABLED && !blackHole) {
			blackHoleTimer -= deltaSeconds;
			if (blackHoleTimer <= 0) spawnBlackHole();
		}
		if (blackHole && !blackHole.update(deltaSeconds)) {
			blackHole.destroy();
			blackHole = null;
			blackHoleTimer = randfRange(0.5, 1.5) * BH_FREQUENCY;
		}

		planetTimer += deltaSeconds;
		let planetCount = 0;

		for (let i = 0; i < objects.length; i++) {
			const obj = objects[i];
			obj.updateMotion(deltaSeconds, frameScale);

			let swallowed = false;
			if (blackHole && blackHole.attract(obj, frameScale)) {
				swallowed = true;
				blackHole.feed(obj.isPlanet ? obj.radius * 0.08 : 0.12);
			}

			let shouldRemove = swallowed || isOffscreen(obj.graphics, obj.isPlanet);
			if (!swallowed && obj.isPlanet && currentTime - obj.spawnTime < PLANET_IMMUNITY_TIME) {
				shouldRemove = false;
			}

			if (!shouldRemove) {
				if (obj.isPlanet) planetCount++;
				continue;
			}

			if (obj.isStar) {
				// Recycle the star back to the left edge instead of reallocating it
				obj.setupStar(getHorizontalSpawn(STAR_BACK_OFFSET), currentTime);
			} else {
				worldContainer.removeChild(obj.graphics);
				obj.destroy();
				objects.splice(i, 1);
				i--;
			}
		}

		if (planetCount < MAX_PLANETS && planetTimer > planetTimeout) {
			const planet = new SpaceObject();
			planet.setupPlanet(getHorizontalSpawn(PLANET_EXTRA_OFFSET + STAR_BACK_OFFSET), currentTime);
			worldContainer.addChild(planet.graphics);
			objects.push(planet);

			planetTimer = 0.0;
			planetTimeout = randfRange(10.0, 45.0);
		}
	});

	return pixiHandle(app, () => app.renderer.off('resize', onResize));
} });
