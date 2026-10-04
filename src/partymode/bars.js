// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

registerSaver('bars', { label: 'Bars', miniScale: 1, create: async (host) => {

  // STATE & VARIABLES
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const MINI = host.mini;
  let rafId = null;
  let destroyed = false;
  
  let config = {
    bars: 64,
    brightness_dimmer: 0,
    bar_spacing: 4,
    bar_falloff: 0.10,
    bar_smoothing: 0.15,
    powerbars: false,
    segments: 'random',
    segment_size: 'random',
    markers: 'random',
    layout: 'random',
    mode: 'single',
    shifting_interval: 10,
    effects: 'off',
    effects_speed: 50,
    partymode: 0,
    color1: { r: 255, g: 0, b: 0 },
    color2: { r: 255, g: 69, b: 0 }
  };

  let resolvedBars = 64;
  let resolvedSegments = false;
  let resolvedSegmentSize = 4;
  let resolvedMarkers = false;
  let resolvedLayout = 'random';
  let resolvedEffect = 'off';
  let resolvedPowerbars = false;
  let nonPartyRandomMode = null;

  let TOTAL_BARS = 64;
  let currentBarHeights = [];
  let peakHeights = [];
  let peakHoldTimers = [];
  let colorQueue = [];

  let sessionRandomColor1, sessionRandomColor2, sessionRandomHsl1, sessionRandomEffect, sessionRandomBars, sessionRandomSegmentSize, sessionRandomSegments, sessionRandomMarkers, sessionRandomLayout, sessionRandomMode, sessionRandomPowerbars;
  let currentShiftingColor = { r: 0, g: 0, b: 0 };
  let prevShiftingColor = { r: 0, g: 0, b: 0 };
  let targetShiftingColor = { r: 0, g: 0, b: 0 };
  let shiftProgress = 1.0;
  let waveStepCounter = 0;
  let shiftingTimer = null, partyTimer = null, effectsTimer = null, currentPartyInterval = 0;
  // Mini view: pixel sizes are scaled down to fit a button-height strip
  const PX = MINI ? 0.25 : 1;
  const segmentGap = MINI ? 1 : 2;
  const capHeight = MINI ? 1 : 3;
  let resetState = 'idle', pendingResetOrigin = 'user'; 

  // CONSTANTS
  const availableEffects = ['wave_left', 'wave_right', 'inout', 'outin'];
  const availableBarCounts = [32, 64, 128];
  const availableSegmentSizes = [4, 8, 16, 32];
  const availableLayouts = ['lefthill', 'righthill', 'mountain', 'valley'];
  const availableModes = ['single_random', 'gradient_random', 'shifting'];

  // HELPER & UTILITY FUNCTIONS
  function getRandomRGB() {
    return {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256)
    };
  }

function rgbToHsl(r, g, b) {
    let normalizedR = r / 255;
    let normalizedG = g / 255;
    let normalizedB = b / 255;

    const max = Math.max(normalizedR, normalizedG, normalizedB);
    const min = Math.min(normalizedR, normalizedG, normalizedB);
    
    let hue = 0;
    let saturation = 0;
    let lightness = (max + min) / 2;

    if (max === min) {
      hue = 0;
      saturation = 0;
    } 
    else {
      const difference = max - min;

      if (lightness > 0.5) { saturation = difference / (2 - max - min); } 
      else { saturation = difference / (max + min); }

      if (max === normalizedR) {
        hue = (normalizedG - normalizedB) / difference;
        if (normalizedG < normalizedB) { hue = hue + 6; }
      } 
      else if (max === normalizedG) {
        hue = (normalizedB - normalizedR) / difference + 2;
      } 
      else if (max === normalizedB) {
        hue = (normalizedR - normalizedG) / difference + 4;
      }
      hue = hue / 6;
    }

    return { 
      hue: Math.round(hue * 360), 
      baseLightness: Math.round(lightness * 100) 
    };
  }

  function parseRGB(str) {
    const match = str.match(/\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (match) {
      return {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10)
      };
    }
    return { r: 255, g: 255, b: 255 };
  }

  function getPerceptualLuminance(r, g, b) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

// Helper function pulled out of hiding to do the HSL-to-RGB math channel conversion
  function convertHueToRgbChannel(p, q, t) {
    let adjustedT = t;
    
    if (adjustedT < 0) {
      adjustedT = adjustedT + 1;
    }
    if (adjustedT > 1) {
      adjustedT = adjustedT - 1;
    }
    
    if (adjustedT < 1/6) {
      return p + (q - p) * 6 * adjustedT;
    }
    if (adjustedT < 1/2) {
      return q;
    }
    if (adjustedT < 2/3) {
      return p + (q - p) * (2/3 - adjustedT) * 6;
    }
    
    return p;
  }

  function applyPowerbarsHSL(colorNode, percent) {
    const h = colorNode.hue / 360;
    const s = 0.95;
    const l = colorNode.lightness / 100;

    let r = 0, g = 0, b = 0;

    if (s === 0) {
      r = l;
      g = l;
      b = l;
    } 
    else {
      let q = 0;
      if (l < 0.5) { q = l * (1 + s); } 
      else { q = l + s - (l * s); }

      const p = (2 * l) - q;

      r = convertHueToRgbChannel(p, q, h + 1/3);
      g = convertHueToRgbChannel(p, q, h);
      b = convertHueToRgbChannel(p, q, h - 1/3);
    }

    const convertedRgb = {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };

    return applyPowerbarsRGB(convertedRgb, percent);
  }

  function applyPowerbarsRGB(rgb, percent) {
    let r = rgb.r, g = rgb.g, b = rgb.b;
    const currentLuminance = getPerceptualLuminance(r, g, b);
    if (currentLuminance > 0.50 && config.brightness_dimmer > 0) {
      const dimFactor = 1 - (config.brightness_dimmer / 100);
      r = Math.round(r * dimFactor);
      g = Math.round(g * dimFactor);
      b = Math.round(b * dimFactor);
    }

    if (!resolvedPowerbars) { return `rgb(${r}, ${g}, ${b})`; }

    const minBrightness = 0.50; 
    const maxBrightness = 1.00; 
    const factor = minBrightness + (percent * (maxBrightness - minBrightness));

    r = Math.min(255, Math.max(0, Math.round(r * factor)));
    g = Math.min(255, Math.max(0, Math.round(g * factor)));
    b = Math.min(255, Math.max(0, Math.round(b * factor)));

    return `rgb(${r}, ${g}, ${b})`;
  }

  function makeWaveNode(topHue, topLight, bottomHue, bottomLight) {
    return {
      top: { hue: topHue, lightness: topLight },
      bottom: { hue: bottomHue, lightness: bottomLight }
    };
  }

  // CORE BUSINESS LOGIC FUNCTIONS
  function resolveActiveSettings() {
    const isParty = config.partymode > 0;

    resolvedBars = (isParty || config.bars === 'random') ? sessionRandomBars : config.bars;
    resolvedSegments = (isParty || config.segments === 'random') ? sessionRandomSegments : (config.segments === 'true');
    resolvedSegmentSize = (isParty || config.segment_size === 'random') ? sessionRandomSegmentSize : config.segment_size;
    resolvedMarkers = (isParty || config.markers === 'random') ? sessionRandomMarkers : (config.markers === 'true');
    resolvedLayout = (isParty || config.layout === 'random') ? sessionRandomLayout : config.layout;
    resolvedEffect = (isParty || config.effects === 'random') ? sessionRandomEffect : config.effects;
    resolvedPowerbars = (isParty || config.powerbars === 'random') ? sessionRandomPowerbars : (config.powerbars === 'true');

    const concreteModes = ['single', 'gradient', 'single_random', 'gradient_random', 'shifting'];

    if (isParty) { config.activeMode = sessionRandomMode; } 
    else if (config.mode === 'random') {
      if (!nonPartyRandomMode) { nonPartyRandomMode = concreteModes[Math.floor(Math.random() * concreteModes.length)]; }
      config.activeMode = nonPartyRandomMode;
    } 
    else { config.activeMode = config.mode; }

    TOTAL_BARS = resolvedBars;
    // Keep mini bars at least ~2px wide
    if (MINI) {
      while (TOTAL_BARS > 16 && canvas.width / TOTAL_BARS < 3) TOTAL_BARS /= 2;
    }
    if (currentBarHeights.length !== TOTAL_BARS) {
      currentBarHeights = new Array(TOTAL_BARS).fill(0);
      peakHeights = new Array(TOTAL_BARS).fill(0);
      peakHoldTimers = new Array(TOTAL_BARS).fill(0);
    }

    const activeMode = config.activeMode || config.mode;
    colorQueue = [];

    let topRgb, bottomRgb;

    if (activeMode === 'gradient_random') {
      topRgb = sessionRandomColor2;
      bottomRgb = sessionRandomColor1;
    } 
    else if (activeMode === 'gradient') {
      topRgb = config.color2;
      bottomRgb = config.color1;
    } 
    else {
      let seedRgb = config.color1;
      if (activeMode === 'single_random') { seedRgb = sessionRandomColor1; }
      else if (activeMode === 'shifting') { seedRgb = currentShiftingColor; }
      
      topRgb = seedRgb;
      bottomRgb = seedRgb;
    }

    const topHsl = rgbToHsl(topRgb.r, topRgb.g, topRgb.b);
    const bottomHsl = rgbToHsl(bottomRgb.r, bottomRgb.g, bottomRgb.b);

    for (let i = 0; i < TOTAL_BARS; i++) { colorQueue.push(makeWaveNode(topHsl.hue, topHsl.baseLightness, bottomHsl.hue, bottomHsl.baseLightness)); }
  }

  function reseedSession() {
    sessionRandomColor1 = getRandomRGB();
    sessionRandomColor2 = getRandomRGB();
    sessionRandomHsl1 = rgbToHsl(sessionRandomColor1.r, sessionRandomColor1.g, sessionRandomColor1.b);

    sessionRandomEffect = availableEffects[Math.floor(Math.random() * availableEffects.length)];
    sessionRandomBars = availableBarCounts[Math.floor(Math.random() * availableBarCounts.length)];
    sessionRandomSegmentSize = availableSegmentSizes[Math.floor(Math.random() * availableSegmentSizes.length)];
    sessionRandomSegments = Math.random() < 0.5;
    sessionRandomMarkers = Math.random() < 0.5;
    sessionRandomLayout = availableLayouts[Math.floor(Math.random() * availableLayouts.length)];
    sessionRandomPowerbars = Math.random() < 0.5;
    sessionRandomMode = availableModes[Math.floor(Math.random() * availableModes.length)];
    nonPartyRandomMode = null;

    currentShiftingColor = getRandomRGB();
    prevShiftingColor = { ...currentShiftingColor };
    targetShiftingColor = { ...currentShiftingColor };
    shiftProgress = 1.0;
    waveStepCounter = 0;
  }

  // Extracted so the timer doesn't have a messy function trapped inside it
  function handleShiftingTick() {
    currentShiftingColor = getRandomRGB();
    triggerAnalyzerReset('internal');
  }

  function setupShiftingInterval() {
    if (shiftingTimer) { 
      clearInterval(shiftingTimer); 
    }
    
    const activeMode = config.activeMode || config.mode;
    const shouldRunShifting = (activeMode === 'shifting' && resolvedEffect === 'off');

    if (shouldRunShifting) {
      const intervalInMilliseconds = config.shifting_interval * 1000;
      shiftingTimer = setInterval(handleShiftingTick, intervalInMilliseconds);
    }
  }

  async function loadConfig(all) {
    try {
      if (!all) all = await window.api.getConfig();

      for (const [rawKey, val] of Object.entries(all)) {
        if (!rawKey.startsWith('bars.')) continue;
        const key = rawKey.slice('bars.'.length);

        if (key === 'bars') {
          const v = val.toLowerCase();
          config.bars = (v === 'random') ? 'random' : ([32, 64, 128].includes(parseInt(val, 10)) ? parseInt(val, 10) : 64);
        }
        if (key === 'brightness_dimmer') {
          const parsedDim = parseFloat(val);
          config.brightness_dimmer = isNaN(parsedDim) ? 0 : Math.max(0, Math.min(100, parsedDim));
        }
        if (key === 'bar_spacing') config.bar_spacing = Math.max(0, parseInt(val, 10) || 0);
        if (key === 'bar_falloff') config.bar_falloff = Math.max(0.01, Math.min(1.0, parseFloat(val) || 0.10));
        if (key === 'bar_smoothing') config.bar_smoothing = Math.max(0.01, Math.min(1.0, parseFloat(val) || 0.15));
        if (key === 'powerbars') config.powerbars = val.toLowerCase();
        if (key === 'segments') config.segments = val.toLowerCase();
        if (key === 'segment_size') {
          const v = val.toLowerCase();
          config.segment_size = (v === 'random') ? 'random' : ([4, 8, 16, 32].includes(parseInt(val, 10)) ? parseInt(val, 10) : 4);
        }
        if (key === 'markers') config.markers = val.toLowerCase();
        if (key === 'layout') config.layout = val.toLowerCase();
        if (key === 'mode') config.mode = val.toLowerCase();
        if (key === 'shifting_interval') config.shifting_interval = Math.max(1, parseInt(val, 10) || 10);
        if (key === 'effects') config.effects = val.toLowerCase();
        if (key === 'effects_speed') config.effects_speed = Math.max(10, parseInt(val, 10) || 50);
        if (key === 'color1') config.color1 = parseRGB(val);
        if (key === 'color2') config.color2 = parseRGB(val);
        if (key === 'partymode') {
          const p = parseInt(val, 10);
          config.partymode = isNaN(p) ? 0 : Math.max(0, p);
        }
      }

      if (config.partymode !== currentPartyInterval) {
        currentPartyInterval = config.partymode;
        if (partyTimer) { clearInterval(partyTimer); }

        if (config.partymode > 0) {
          partyTimer = setInterval(handlePartyTick, config.partymode * 1000);
        }
      }

      // Effect speed comes from config, so (re)start the effect timer after loading it
      if (effectsTimer) { clearInterval(effectsTimer); }
      effectsTimer = setInterval(stepEffects, config.effects_speed);
    }
    catch (err) { console.warn("Using default settings", err); }
  }

  function handlePartyTick() {
    reseedSession();
    triggerAnalyzerReset('internal');
  }

  async function executeResetSwitch(origin) {
    if (origin === 'user') { await loadConfig(); }
    resolveActiveSettings();
    setupShiftingInterval();
  }

  //GAME LOOP
  function render() {
    // 1. Clear the canvas background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Calculate dimensions and get audio/reset data
    const spacing = MINI ? Math.min(config.bar_spacing, 1) : config.bar_spacing;
    const totalSpacing = spacing * (TOTAL_BARS + 1);
    const barWidth = Math.max(1, (canvas.width - totalSpacing) / TOTAL_BARS);

    const displayData = calculateDisplayData();

    // 3. Loop through and draw each bar
    for (let i = 0; i < TOTAL_BARS; i++) {
      let value = displayData[i] || 0;
      let percent = Math.min(1.0, Math.pow(value / 255, 2.2) * 0.95);
      let targetHeight = percent * (canvas.height * 0.90);

      if (resetState !== 'reset_dropping') {
        if (targetHeight >= currentBarHeights[i]) {
          currentBarHeights[i] += (targetHeight - currentBarHeights[i]) * config.bar_smoothing;
        } else {
          currentBarHeights[i] += (targetHeight - currentBarHeights[i]) * config.bar_falloff;
        }
      }

      const barHeight = currentBarHeights[i];
      const x = spacing + i * (barWidth + spacing);
      const y = canvas.height - barHeight;

      // Determine style (color or gradient)
      ctx.fillStyle = getBarStyle(i, percent, y);

      // Draw segments or solid bars
      if (resolvedSegments) {
        // Segment sizes are tuned for a ~720px tall window; the mini strip
        // scales them to its height so 16/32px blocks don't turn into 3 giant ones
        const segmentScale = MINI ? canvas.height / 720 : 1;
        const segmentHeight = Math.max(1, Math.round(resolvedSegmentSize * segmentScale));
        const totalSegBlock = segmentHeight + segmentGap;
        const numSegments = Math.floor(barHeight / totalSegBlock);
        
        for (let s = 0; s < numSegments; s++) {
          const segY = canvas.height - (s + 1) * totalSegBlock;
          ctx.fillRect(x, segY, barWidth, segmentHeight);
        }
      } 
      else { ctx.fillRect(x, y, barWidth, barHeight); }

      // Draw peak markers
      if (resolvedMarkers) {
        if (resetState !== 'reset_dropping') {
          if (barHeight >= peakHeights[i]) {
            peakHeights[i] = barHeight;
            peakHoldTimers[i] = 12;
          } 
          else {
            if (peakHoldTimers[i] > 0) { peakHoldTimers[i]--; } 
            else {
              peakHeights[i] -= 2.5 * PX;
              if (peakHeights[i] < barHeight) peakHeights[i] = barHeight;
            }
          }
        } 
        else {
          peakHeights[i] -= 12.0 * PX;
          if (peakHeights[i] < 0) peakHeights[i] = 0;
        }

        if (peakHeights[i] > 0) {
          const capY = canvas.height - peakHeights[i] - capHeight;
          ctx.fillRect(x, capY, barWidth, capHeight);
        }
      }
    }

    rafId = requestAnimationFrame(render);
  }

  // --- HELPER 1: Calculate audio data or dropping state ---
  function calculateDisplayData() {
    let displayData = new Array(TOTAL_BARS).fill(0);

    if (resetState === 'reset_dropping') {
      let allZero = true;
      for (let i = 0; i < TOTAL_BARS; i++) {
        let targetHeight = 0;
        if (targetHeight >= currentBarHeights[i]) { currentBarHeights[i] += (targetHeight - currentBarHeights[i]) * config.bar_smoothing; } 
        else { currentBarHeights[i] += (targetHeight - currentBarHeights[i]) * config.bar_falloff; }
        if (currentBarHeights[i] > 0.05 || peakHeights[i] > 0.05) { allZero = false; }
      }
      if (allZero) {
        executeResetSwitch(pendingResetOrigin);
        resetState = 'idle';
      }
      return displayData;
    }

    const rawAudioData = host.getAudio();
    const startIndex = 3;
    const activeDataLength = Math.floor((rawAudioData.length - startIndex) * 0.65);
    const activeData = rawAudioData.slice(startIndex, startIndex + activeDataLength);

    const isMirroredLayout = (resolvedLayout === 'mountain' || resolvedLayout === 'valley');
    const sampleCount = isMirroredLayout ? Math.floor(TOTAL_BARS / 2) : TOTAL_BARS;

    let sampledData = new Array(sampleCount);
    for (let k = 0; k < sampleCount; k++) {
      const pos = (k / (sampleCount - 1)) * (activeData.length - 1);
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const val1 = activeData[idx] || 0;
      const val2 = activeData[idx + 1] !== undefined ? activeData[idx + 1] : val1;
      sampledData[k] = val1 + (val2 - val1) * frac;
    }

    if (resolvedLayout === 'righthill') { displayData = [...sampledData].reverse(); } 
    else if (resolvedLayout === 'mountain') {
      const half = sampleCount;
      for (let i = 0; i < half; i++) {
        displayData[half - 1 - i] = sampledData[i];
        displayData[half + i] = sampledData[i];
      }
    } 
    else if (resolvedLayout === 'valley') {
      const half = sampleCount;
      for (let i = 0; i < half; i++) {
        displayData[i] = sampledData[i];
        displayData[TOTAL_BARS - 1 - i] = sampledData[i];
      }
    } 
    else { displayData = sampledData; }

    return displayData;
  }

  // --- HELPER 2: Resolve colors, effects, and gradients ---
  function getBarStyle(i, percent, y) {
    const activeMode = config.activeMode || config.mode;

    if (resolvedEffect !== 'off') {
      const node = colorQueue[i];
      if (!node) return "rgb(255,255,255)";

      const topRgb = applyPowerbarsHSL(node.top, percent);
      const bottomRgb = applyPowerbarsHSL(node.bottom, percent);
      const grad = ctx.createLinearGradient(0, canvas.height, 0, y);
      grad.addColorStop(0, bottomRgb);
      grad.addColorStop(1, topRgb);
      return grad;
    }

    if (activeMode === 'single') return applyPowerbarsRGB(config.color1, percent);
    if (activeMode === 'single_random') return applyPowerbarsRGB(sessionRandomColor1, percent);
    
    if (activeMode === 'gradient') {
      const grad = ctx.createLinearGradient(0, canvas.height, 0, y);
      grad.addColorStop(0, applyPowerbarsRGB(config.color1, 0));
      grad.addColorStop(1, applyPowerbarsRGB(config.color2, percent));
      return grad;
    }
    
    if (activeMode === 'gradient_random') {
      const grad = ctx.createLinearGradient(0, canvas.height, 0, y);
      grad.addColorStop(0, applyPowerbarsRGB(sessionRandomColor1, 0));
      grad.addColorStop(1, applyPowerbarsRGB(sessionRandomColor2, percent));
      return grad;
    }
    
    if (activeMode === 'shifting') return applyPowerbarsRGB(currentShiftingColor, percent);

    return "rgb(255,255,255)";
  }

  // EVENT LISTENERS
  function triggerAnalyzerReset(origin = 'user') {
    pendingResetOrigin = origin;
    resetState = 'reset_dropping';
  }

  function resizeCanvas() {
    const dpr = MINI ? (window.devicePixelRatio || 1) : 1;
    canvas.width = Math.max(1, Math.round(host.container.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(host.container.clientHeight * dpr));
  }

  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
    if (MINI) resolveActiveSettings();
  });

  function stepEffects() {
    if (resolvedEffect === 'off' || resetState !== 'idle') return;

    const activeMode = config.activeMode || config.mode;
    if (activeMode === 'shifting') {
      waveStepCounter++;
      if (waveStepCounter >= TOTAL_BARS) {
        prevShiftingColor = { ...currentShiftingColor };
        targetShiftingColor = getRandomRGB();
        waveStepCounter = 0;
        shiftProgress = 0.0;
      }
      shiftProgress = Math.min(1.0, shiftProgress + (1.0 / TOTAL_BARS));
      currentShiftingColor = {
        r: Math.round(prevShiftingColor.r + (targetShiftingColor.r - prevShiftingColor.r) * shiftProgress),
        g: Math.round(prevShiftingColor.g + (targetShiftingColor.g - prevShiftingColor.g) * shiftProgress),
        b: Math.round(prevShiftingColor.b + (targetShiftingColor.b - prevShiftingColor.b) * shiftProgress)
      };
    }

    let topRgb, bottomRgb;
    if (activeMode === 'gradient' || activeMode === 'gradient_random') {
      topRgb = (activeMode === 'gradient') ? config.color2 : sessionRandomColor2;
      bottomRgb = (activeMode === 'gradient') ? config.color1 : sessionRandomColor1;
    } else {
      const baseRgb =
        activeMode === 'single' ? config.color1 :
        activeMode === 'single_random' ? sessionRandomColor1 :
        currentShiftingColor;
      topRgb = baseRgb;
      bottomRgb = baseRgb;
    }

    const topHsl = rgbToHsl(topRgb.r, topRgb.g, topRgb.b);
    const bottomHsl = rgbToHsl(bottomRgb.r, bottomRgb.g, bottomRgb.b);

    const waveFactor = (Math.sin(Date.now() / 300) + 1) / 2;
    const brightnessOffset = (waveFactor * 0.60) - 0.30;

    let newTopLight = Math.max(0, Math.min(100, topHsl.baseLightness * (1 + brightnessOffset)));
    let newBottomLight = Math.max(0, Math.min(100, bottomHsl.baseLightness * (1 + brightnessOffset)));
    const waveNode = makeWaveNode(topHsl.hue, newTopLight, bottomHsl.hue, newBottomLight);

    const fx = resolvedEffect;
    const centerLeft = Math.floor((TOTAL_BARS - 1) / 2);
    const centerRight = Math.ceil((TOTAL_BARS - 1) / 2);

    if (fx === 'wave_right') {
      colorQueue.pop();
      colorQueue.unshift(waveNode);
    } 
    else if (fx === 'wave_left') {
      colorQueue.shift();
      colorQueue.push(waveNode);
    } 
    else if (fx === 'inout') {
      for (let i = 0; i < centerLeft; i++) colorQueue[i] = colorQueue[i + 1];
      for (let i = TOTAL_BARS - 1; i > centerRight; i--) colorQueue[i] = colorQueue[i - 1];
      colorQueue[centerLeft] = waveNode;
      colorQueue[centerRight] = waveNode;
    } 
    else if (fx === 'outin') {
      for (let i = centerLeft; i > 0; i--) colorQueue[i] = colorQueue[i - 1];
      for (let i = centerRight; i < TOTAL_BARS - 1; i++) colorQueue[i] = colorQueue[i + 1];
      colorQueue[0] = waveNode;
      colorQueue[TOTAL_BARS - 1] = waveNode;
    }
  }

  reseedSession();
  resizeCanvas();
  await loadConfig(host.config);
  resolveActiveSettings();
  setupShiftingInterval();
  resizeObserver.observe(host.container);

  if (!destroyed) render();

  return {
    pause() {
      cancelAnimationFrame(rafId);
      rafId = null;
    },
    resume() {
      if (rafId === null && !destroyed) render();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      clearInterval(shiftingTimer);
      clearInterval(partyTimer);
      clearInterval(effectsTimer);
      resizeObserver.disconnect();
      canvas.remove();
    }
  };
} });