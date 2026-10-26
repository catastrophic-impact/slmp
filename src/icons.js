// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// Inline SVG icons (stroke style after Lucide, ISC licence) so the UI looks the
// same everywhere without an icon font. Elements with [data-icon] are filled in
// on load; setIcon() swaps one at runtime.
(() => {
  // `fill: true` icons are solid shapes, the rest are outlines
  const ICONS = {
    play: { fill: true, d: '<path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l12-7.2a1 1 0 0 0 0-1.72l-12-7.2A1 1 0 0 0 7 4.8z"/>' },
    pause: { fill: true, d: '<rect x="5.5" y="4" width="4.5" height="16" rx="1.4"/><rect x="14" y="4" width="4.5" height="16" rx="1.4"/>' },
    prev: { fill: true, d: '<rect x="4" y="4.5" width="2.6" height="15" rx="1.2"/><path d="M20 5.6v12.8a1 1 0 0 1-1.55.83l-9.6-6.4a1 1 0 0 1 0-1.66l9.6-6.4A1 1 0 0 1 20 5.6z"/>' },
    next: { fill: true, d: '<rect x="17.4" y="4.5" width="2.6" height="15" rx="1.2"/><path d="M4 5.6v12.8a1 1 0 0 0 1.55.83l9.6-6.4a1 1 0 0 0 0-1.66l-9.6-6.4A1 1 0 0 0 4 5.6z"/>' },
    shuffle: { d: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>' },
    repeat: { d: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>' },
    repeat1: { d: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/>' },
    volume: { d: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>' },
    volumeLow: { d: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>' },
    mute: { d: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>' },
    settings: { d: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>' },
    compact: { d: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/>' },
    expand: { d: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>' },
    list: { d: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>' },
    folder: { d: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>' },
    music: { d: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
    chevron: { d: '<path d="m9 18 6-6-6-6"/>' },
    up: { d: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>' },
    close: { d: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' },
    monitor: { d: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>' },
    window: { d: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>' },
    fullscreen: { d: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>' },
    check: { d: '<path d="M20 6 9 17l-5-5"/>' }
  };

  function svg(name) {
    const icon = ICONS[name];
    if (!icon) return '';
    const paint = icon.fill
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    return `<svg viewBox="0 0 24 24" ${paint} aria-hidden="true">${icon.d}</svg>`;
  }

  function setIcon(el, name) {
    if (el.dataset.icon === name && el.firstChild) return;
    el.dataset.icon = name;
    el.innerHTML = svg(name);
  }

  window.setIcon = setIcon;
  window.iconSvg = svg;
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = svg(el.dataset.icon);
  });
})();
