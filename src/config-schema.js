// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// Single source of truth for slmp.conf: defaults, allowed values and the
// comments written into the file. main.js generates/normalises the file from
// this, and the settings panel builds its UI from it.
//
// Setting fields:
//   key      full 'section.name' key as written in slmp.conf
//   type     enum | bool | int | float | color | text
//   default  default value as it is written in the file
//   options  allowed values (enum)
//   min/max/step  numeric range (int/float)
//   label    short name for the settings panel
//   help     comment lines written above the key (and shown in the panel)
//   hidden   managed by the player itself; kept out of the settings panel

const SCREENSAVERS = [
  { id: 'bars', label: 'Bars' },
  { id: 'raindrops', label: 'Raindrops' },
  { id: 'chaos', label: 'Chaos' },
  { id: 'journey', label: 'Journey' },
  { id: 'space', label: 'Space' },
  { id: 'hungry', label: 'Hungry' },
  { id: 'blackholes', label: 'Black Holes' }
];

const LAYOUT_HELP = [
  'lefthill  |\\  : Standard (Bass left, Treble right)',
  'righthill /|  : Flipped (Treble left, Bass right)',
  'mountain  /\\  : Center Bass, Treble on left & right',
  'valley    \\/  : Center Treble, Bass on left & right'
];

// Colour settings shared by every ball screensaver.
// `cycle` describes when solid_random re-picks its colour for that saver.
function ballColorSettings(prefix, { cycle, interval = false, defaultMode = 'random', defaultColor = '(0,180,255)' }) {
  const settings = [
    {
      key: `${prefix}.color_mode`, type: 'enum', default: defaultMode, label: 'Color mode',
      options: ['random', 'solid_random', 'solid', 'shifting'],
      help: [
        'COLOR MODE:',
        'random:       Every ball gets its own random color.',
        `solid_random: All balls share one random color, re-picked ${cycle}.`,
        `solid:        All balls use ${prefix}.color.`,
        'shifting:     All balls share one color that slowly drifts through the hues.'
      ]
    },
    { key: `${prefix}.color`, type: 'color', default: defaultColor, label: 'Solid color', help: ['RGB color used by the solid color mode'] },
    {
      key: `${prefix}.shift_speed`, type: 'int', default: '15', min: 1, max: 120, step: 1, label: 'Shift speed',
      help: ['SHIFT SPEED: Degrees of hue per second for the shifting color mode']
    }
  ];
  if (interval) {
    settings.push({
      key: `${prefix}.solid_interval`, type: 'int', default: '30', min: 5, max: 300, step: 1, label: 'Solid re-pick interval',
      help: ['SOLID INTERVAL: Seconds between new colors in solid_random mode']
    });
  }
  return settings;
}

const SECTIONS = [
  {
    id: 'general',
    title: 'General',
    header: 'GENERAL CONFIG',
    settings: [
      { key: 'general.recentpath', type: 'text', default: '', hidden: true, help: ['Last opened folder (updated automatically)'] },
      { key: 'general.volume', type: 'float', default: '1', min: 0, max: 1, step: 0.01, hidden: true, help: ['Player volume, 0 to 1 (updated automatically)'] },
      { key: 'general.shuffle', type: 'bool', default: 'false', hidden: true, help: ['Shuffle on/off (updated automatically)'] },
      { key: 'general.compact', type: 'bool', default: 'false', hidden: true, help: ['Compact (minimal) player window on/off (updated automatically)'] },
      { key: 'general.repeat', type: 'enum', default: 'all', options: ['all', 'one', 'off'], hidden: true, help: ['REPEAT: all (loop folder), one (loop track), off (stop at end of folder)'] },
      {
        key: 'general.screensaver', type: 'enum', default: 'bars', label: 'Screensaver',
        options: SCREENSAVERS.map((s) => s.id),
        help: ['SCREENSAVER: Shown in the mini visualizer and opened as a window/fullscreen']
      },
      {
        key: 'general.mini_visualizer', type: 'bool', default: 'true', label: 'Mini visualizer',
        help: ['MINI VISUALIZER: Run the selected screensaver in the player bar']
      }
    ]
  },
  {
    id: 'bars',
    title: 'Bars',
    header: 'BARS SCREENSAVER CONFIG',
    settings: [
      { key: 'bars.bars', type: 'enum', default: '64', options: ['32', '64', '128', 'random'], label: 'Bar count', help: ['BARS: 32, 64, 128, or random'] },
      { key: 'bars.bar_spacing', type: 'int', default: '4', min: 0, max: 16, step: 1, label: 'Bar spacing', help: ['BAR SPACING: Pixels between bars'] },
      {
        key: 'bars.brightness_dimmer', type: 'int', default: '0', min: 0, max: 100, step: 1, label: 'Brightness dimmer',
        help: ['BRIGHTNESS DIMMER: Percentage (0 to 100) to dim colors that exceed 50% brightness']
      },
      {
        key: 'bars.bar_falloff', type: 'float', default: '0.10', min: 0.01, max: 1, step: 0.01, label: 'Bar falloff',
        help: ['BAR FALLOFF: Speed at which bars drop back down (0.01 = floating decay, 1.0 = instant drop)']
      },
      {
        key: 'bars.bar_smoothing', type: 'float', default: '0.15', min: 0.01, max: 1, step: 0.01, label: 'Bar smoothing',
        help: ['BAR SMOOTHING: Attack speed rising to audio peaks (0.05 = super smooth/slow, 1.0 = instant snap/jittery)']
      },
      {
        key: 'bars.powerbars', type: 'enum', default: 'false', options: ['true', 'false', 'random'], label: 'Powerbars',
        help: ['POWERBARS: Dynamically shift brightness based on height (true, false, or random)']
      },
      {
        key: 'bars.segments', type: 'enum', default: 'false', options: ['true', 'false', 'random'], label: 'Segments',
        help: ['SEGMENT MODE: Draw bars as stacked 90s LED blocks (true, false, or random)']
      },
      {
        key: 'bars.segment_size', type: 'enum', default: 'random', options: ['4', '8', '16', '32', 'random'], label: 'Segment size',
        help: ['SEGMENT SIZE: Pixel height per LED block: 4, 8, 16, 32, or random']
      },
      {
        key: 'bars.markers', type: 'enum', default: 'random', options: ['true', 'false', 'random'], label: 'Peak markers',
        help: ['MARKERS: Floating peak caps above active bars (true, false, or random)']
      },
      {
        key: 'bars.layout', type: 'enum', default: 'random', options: ['lefthill', 'righthill', 'mountain', 'valley', 'random'], label: 'Layout',
        help: ['LAYOUT: Visual spectrum mapping (lefthill, righthill, mountain, valley, or random)', ...LAYOUT_HELP]
      },
      {
        key: 'bars.mode', type: 'enum', default: 'shifting', label: 'Color mode',
        options: ['single', 'gradient', 'single_random', 'gradient_random', 'shifting', 'random'],
        help: [
          'COLOR MODES:',
          'single: Uses bars.color1.',
          'gradient: Uses bars.color1 and bars.color2 for a gradient effect.',
          'single_random: Randomly chooses a solid single color.',
          'gradient_random: Randomly chooses 2 colors for gradient on the bars.',
          'shifting: Continual random colors are picked every bars.shifting_interval seconds.',
          'random: Pick a random color mode above.'
        ]
      },
      {
        key: 'bars.shifting_interval', type: 'int', default: '4', min: 1, max: 60, step: 1, label: 'Shifting interval',
        help: ['SHIFTING INTERVAL: Seconds between new colors in shifting mode (only without effects)']
      },
      { key: 'bars.color1', type: 'color', default: '(20,30,100)', label: 'Color 1', help: ['RGB color values'] },
      { key: 'bars.color2', type: 'color', default: '(100,69,0)', label: 'Color 2' },
      {
        key: 'bars.effects', type: 'enum', default: 'random', label: 'Effect',
        options: ['wave_left', 'wave_right', 'inout', 'outin', 'random', 'off'],
        help: [
          'EFFECTS:',
          'wave_left: A lighter and darker gradient of color works its way through the bars left to right',
          'wave_right: A lighter and darker gradient of color works its way through the bars right to left',
          'inout: A lighter and darker gradient of color works its way through the bars from the center out',
          'outin: A lighter and darker gradient of color works its way through the bars from the outsides in',
          'random: A random effect is chosen.',
          'off: Effects are off and not applied to COLOR MODES.'
        ]
      },
      {
        key: 'bars.effects_speed', type: 'int', default: '50', min: 10, max: 500, step: 5, label: 'Effect step (ms)',
        help: ['EFFECTS SPEED: Milliseconds per effect step (lower = faster)']
      },
      {
        key: 'bars.partymode', type: 'int', default: '30', min: 0, max: 600, step: 1, label: 'Partymode (s)',
        help: ['PARTYMODE: Re-roll all random visual settings every X seconds (0 = disabled)']
      }
    ]
  },
  {
    id: 'raindrops',
    title: 'Raindrops',
    header: 'RAINDROPS SCREENSAVER CONFIG',
    settings: [
      { key: 'raindrops.columns', type: 'enum', default: '32', options: ['16', '32', '64'], label: 'Columns', help: ['COLUMNS: Number of rain lanes across the screen (16, 32, 64)'] },
      {
        key: 'raindrops.layout', type: 'enum', default: 'mountain', options: ['lefthill', 'righthill', 'mountain', 'valley', 'random'], label: 'Layout',
        help: ['LAYOUT: Spectrum mapping, same as bars (lefthill, righthill, mountain, valley, or random)', ...LAYOUT_HELP]
      },
      {
        key: 'raindrops.density', type: 'float', default: '1.0', min: 0.1, max: 3, step: 0.1, label: 'Density',
        help: ['DENSITY: Multiplier for how many drops fall (louder bands always rain harder)']
      },
      {
        key: 'raindrops.max_size', type: 'int', default: '8', min: 3, max: 20, step: 1, label: 'Max drop size',
        help: ['MAX SIZE: Largest drop radius in pixels at full volume']
      },
      {
        key: 'raindrops.fall_speed', type: 'float', default: '1.0', min: 0.3, max: 3, step: 0.1, label: 'Fall speed',
        help: ['FALL SPEED: Gravity multiplier for falling drops']
      },
      {
        key: 'raindrops.splash', type: 'int', default: '6', min: 0, max: 20, step: 1, label: 'Splash droplets',
        help: ['SPLASH: Maximum droplets thrown up when a drop hits the ground (0 = no splash)']
      },
      // Raindrops use their own party analyzer (CAVA/Audacious-like); Bars and
      // Chaos keep the original one. The keys keep their analyzer.* names.
      {
        key: 'analyzer.tilt', type: 'float', default: '4', min: 0, max: 9, step: 0.5, label: 'Analyzer treble tilt (dB/octave)',
        help: ['TILT: Boost per octave above 1kHz (and cut below) so highs dance as much as lows. 0 = raw/accurate, 3-5 = party']
      },
      {
        key: 'analyzer.range', type: 'int', default: '42', min: 20, max: 80, step: 1, label: 'Analyzer dynamic range (dB)',
        help: ['RANGE: Decibels from the bottom to the top of the screen. Lower = punchier (only the loudest bands stand tall); higher = everything sits taller with less contrast']
      },
      {
        key: 'analyzer.auto_gain', type: 'bool', default: 'true', label: 'Analyzer auto gain',
        help: ['AUTO GAIN: Follow the music\'s loudness so quiet and loud tracks both fill the screen']
      },
      {
        key: 'analyzer.gain', type: 'float', default: '0', min: -20, max: 20, step: 1, label: 'Analyzer gain (dB)',
        help: ['GAIN: Extra boost or cut. With auto gain off, this is the main sensitivity control']
      },
      {
        key: 'analyzer.response', type: 'float', default: '0.5', min: 0, max: 0.95, step: 0.05, label: 'Analyzer smoothing',
        help: ['RESPONSE: Time smoothing inside the analyzer. 0 = twitchy/instant, 0.5 = snappy, 0.8 = floaty (like Bars)']
      },
      {
        key: 'analyzer.min_freq', type: 'int', default: '50', min: 20, max: 200, step: 5, label: 'Analyzer lowest frequency (Hz)',
        help: ['MIN FREQ: Left edge of the spectrum (kick drums live around 50-100Hz)']
      },
      {
        key: 'analyzer.max_freq', type: 'int', default: '16000', min: 4000, max: 20000, step: 500, label: 'Analyzer highest frequency (Hz)',
        help: ['MAX FREQ: Right edge of the spectrum']
      },
      ...ballColorSettings('raindrops', { cycle: 'every raindrops.solid_interval seconds', interval: true, defaultMode: 'shifting', defaultColor: '(80,160,255)' })
    ]
  },
  {
    id: 'chaos',
    title: 'Chaos',
    header: 'CHAOS SCREENSAVER CONFIG',
    settings: [
      { key: 'chaos.startcount', type: 'int', default: '3', min: 1, max: 20, step: 1, label: 'Starting balls', help: ['Starting ball count'] },
      ...ballColorSettings('chaos', { cycle: 'every chaos.solid_interval seconds', interval: true })
    ]
  },
  {
    id: 'journey',
    title: 'Journey',
    header: 'JOURNEY SCREENSAVER CONFIG',
    settings: [
      { key: 'journey.orb_count', type: 'int', default: '20', min: 5, max: 60, step: 1, label: 'Orb count', help: ['ORB COUNT: Orbs on screen at once'] },
      ...ballColorSettings('journey', { cycle: 'every journey.solid_interval seconds', interval: true })
    ]
  },
  {
    id: 'space',
    title: 'Space',
    header: 'SPACE SCREENSAVER CONFIG',
    settings: [
      { key: 'space.blackholes', type: 'bool', default: 'true', label: 'Black holes', help: ['BLACK HOLES: Rare black holes that pull in and swallow stars and planets'] },
      {
        key: 'space.blackhole_frequency', type: 'int', default: '90', min: 10, max: 600, step: 5, label: 'Black hole frequency (s)',
        help: ['BLACK HOLE FREQUENCY: Average seconds between black holes']
      },
      {
        key: 'space.blackhole_strength', type: 'int', default: '5', min: 1, max: 10, step: 1, label: 'Max black hole strength',
        help: ['BLACK HOLE STRENGTH: Maximum gravity (1 to 10); each black hole rolls a strength up to this']
      },
      ...ballColorSettings('space', { cycle: 'every space.solid_interval seconds (planets only)', interval: true })
    ]
  },
  {
    id: 'hungry',
    title: 'Hungry',
    header: 'HUNGRY SCREENSAVER CONFIG',
    settings: [
      { key: 'hungry.ball_count', type: 'int', default: '50', min: 10, max: 150, step: 1, label: 'Ball count', help: ['BALL COUNT: Balls spawned at the start of each round'] },
      ...ballColorSettings('hungry', { cycle: 'each time the last ball explodes' })
    ]
  },
  {
    id: 'blackholes',
    title: 'Black Holes',
    header: 'BLACK HOLES SCREENSAVER CONFIG',
    settings: [
      { key: 'blackholes.ball_count', type: 'int', default: '50', min: 10, max: 150, step: 1, label: 'Ball count', help: ['BALL COUNT: Balls spawned at the start of each round'] },
      ...ballColorSettings('blackholes', { cycle: 'each time the last ball explodes' })
    ]
  }
];

const SETTINGS = new Map();
for (const section of SECTIONS) {
  for (const setting of section.settings) SETTINGS.set(setting.key, setting);
}

function parseColor(value) {
  const m = /^\(?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/.exec(String(value).trim());
  if (!m) return null;
  return [m[1], m[2], m[3]].map((n) => Math.min(255, parseInt(n, 10)));
}

// Returns the canonical string for a value, or the default if it's invalid.
function normalizeValue(setting, raw) {
  const value = String(raw ?? '').trim();
  switch (setting.type) {
    case 'enum': {
      const v = value.toLowerCase();
      return setting.options.includes(v) ? v : setting.default;
    }
    case 'bool': {
      const v = value.toLowerCase();
      return v === 'true' || v === 'false' ? v : setting.default;
    }
    case 'int':
    case 'float': {
      let n = Number(value);
      if (value === '' || !Number.isFinite(n)) return setting.default;
      n = Math.min(setting.max, Math.max(setting.min, n));
      if (setting.type === 'int') return String(Math.round(n));
      // Trim float noise from slider steps (0.30000000000000004)
      return String(parseFloat(n.toFixed(4)));
    }
    case 'color': {
      const c = parseColor(value);
      return c ? `(${c.join(',')})` : setting.default;
    }
    default:
      return value.replace(/[\r\n]/g, '');
  }
}

// Keys from earlier versions that are dropped from slmp.conf when it's rewritten
const OBSOLETE_KEYS = new Set(['analyzer.style', 'bars.falloff_style']);

module.exports = { SECTIONS, SETTINGS, SCREENSAVERS, OBSOLETE_KEYS, normalizeValue };
