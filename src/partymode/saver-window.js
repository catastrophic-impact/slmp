// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// Behaviour for the standalone screensaver window: player shortcuts,
// fullscreen, exit on click / other keys, the now-playing status banner,
// and restarting the saver when its settings change.
(() => {
  const PLAYER_KEYS = {
    'n': 'next',
    'p': 'prev',
    's': 'shuffle',
    'S': 'shuffle',
    'r': 'repeat',
    'R': 'repeat',
    ' ': 'pause',
    '.': 'vol_up',
    ',': 'vol_down'
  };

  const type = new URLSearchParams(location.search).get('type') || 'bars';
  let statusTimeout = null;
  let audioData = new Array(64).fill(0);
  let bandData = new Array(128).fill(0);
  let saver = null;
  let restartTimer = null;

  function showStatus(text) {
    const banner = document.getElementById('status-banner');
    banner.textContent = text;
    banner.classList.add('visible');

    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => banner.classList.remove('visible'), 5000);
  }

  function start(config) {
    if (saver) saver.destroy();
    saver = mountSaver(type, {
      container: document.getElementById('saver-root'),
      mini: false,
      config,
      getAudio: () => audioData,
      getBands: () => bandData
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.repeat && !PLAYER_KEYS[e.key]) return;

    if (PLAYER_KEYS[e.key]) {
      e.preventDefault();
      window.api.sendPlayerCommand(PLAYER_KEYS[e.key]);
    } else if (e.key === 'f' || e.key === 'F') {
      window.api.toggleFullscreen();
    } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      window.close();
    }
  });

  window.addEventListener('pointerdown', () => window.close());

  window.api.onShowStatusOverlay(showStatus);

  window.api.onAudioData((data) => {
    if (!data) return;
    if (data.audio) audioData = data.audio;
    if (data.bands) bandData = data.bands;
  });

  // Live-apply settings for this saver; debounced so dragging a slider
  // doesn't restart it on every step.
  window.api.onConfigChanged(({ config, keys }) => {
    if (!keys.some((k) => k.startsWith(`${type}.`))) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => start(config), 300);
  });

  document.addEventListener('DOMContentLoaded', async () => {
    const def = getSaverDef(type);
    if (def) document.title = def.label;
    start(await window.api.getConfig());
  });
})();
