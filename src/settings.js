// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// Settings panel: built entirely from the config schema in config-schema.js.
// Every change is saved to slmp.conf immediately (via main.js), which then
// broadcasts it so the mini visualizer and any open screensaver update live.
(() => {
  const panel = document.getElementById('settings-panel');
  const tabs = document.getElementById('settings-tabs');
  const body = document.getElementById('settings-body');
  const btnOpen = document.getElementById('btn-settings');
  const btnClose = document.getElementById('btn-settings-close');

  let schema = null;
  let config = {};
  let activeSection = 'general';
  // Settings don't fit the compact window, so it expands while they're open
  let restoreCompact = false;
  const controls = new Map(); // key -> { setting, update(value) }

  const visibleSettings = (section) => section.settings.filter((s) => !s.hidden);

  const toHex = (value) => {
    const m = /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(value || '');
    if (!m) return '#ffffff';
    return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  };
  const fromHex = (hex) => `(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)})`;

  const debounced = (fn, ms) => {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  function save(key, value) {
    config[key] = value;
    window.api.setConfig(key, value);
  }

  function optionLabel(setting, option) {
    if (setting.key === 'general.screensaver') {
      const saver = schema.screensavers.find((s) => s.id === option);
      if (saver) return saver.label;
    }
    return option;
  }

  // --- Control builders: each returns { el, update(value) } ---
  function buildSelect(setting) {
    const el = document.createElement('select');
    for (const option of setting.options) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = optionLabel(setting, option);
      el.appendChild(opt);
    }
    el.addEventListener('change', () => save(setting.key, el.value));
    return { el, update: (v) => { el.value = v; } };
  }

  function buildToggle(setting) {
    const label = document.createElement('label');
    label.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    const knob = document.createElement('span');
    label.append(input, knob);
    input.addEventListener('change', () => save(setting.key, input.checked ? 'true' : 'false'));
    return { el: label, update: (v) => { input.checked = v === 'true'; } };
  }

  function buildRange(setting) {
    const wrap = document.createElement('div');
    wrap.className = 'range-control';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = setting.min;
    input.max = setting.max;
    input.step = setting.step || (setting.type === 'int' ? 1 : 0.01);
    const out = document.createElement('output');
    wrap.append(input, out);

    const saveSoon = debounced((v) => save(setting.key, v), 150);
    input.addEventListener('input', () => {
      out.textContent = input.value;
      saveSoon(input.value);
    });
    input.addEventListener('change', () => save(setting.key, input.value));
    return { el: wrap, update: (v) => { input.value = v; out.textContent = v; } };
  }

  function buildColor(setting) {
    const input = document.createElement('input');
    input.type = 'color';
    const saveSoon = debounced((v) => save(setting.key, fromHex(v)), 150);
    input.addEventListener('input', () => saveSoon(input.value));
    return { el: input, update: (v) => { input.value = toHex(v); } };
  }

  function buildControl(setting) {
    switch (setting.type) {
      case 'enum': return buildSelect(setting);
      case 'bool': return buildToggle(setting);
      case 'int':
      case 'float': return buildRange(setting);
      case 'color': return buildColor(setting);
      default: return null;
    }
  }

  // --- Rendering ---
  function renderTabs() {
    const fragment = document.createDocumentFragment();
    for (const section of schema.sections) {
      if (visibleSettings(section).length === 0) continue;
      const btn = document.createElement('button');
      btn.textContent = section.title;
      btn.dataset.section = section.id;
      btn.classList.toggle('active', section.id === activeSection);
      fragment.appendChild(btn);
    }
    tabs.replaceChildren(fragment);
  }

  function renderSection() {
    controls.clear();
    const section = schema.sections.find((s) => s.id === activeSection);
    const fragment = document.createDocumentFragment();

    for (const setting of visibleSettings(section)) {
      const control = buildControl(setting);
      if (!control) continue;
      control.update(config[setting.key]);
      controls.set(setting.key, control);

      const row = document.createElement('div');
      row.className = 'setting-row';

      const label = document.createElement('div');
      label.className = 'setting-label';
      label.textContent = setting.label || setting.key;

      const keyName = document.createElement('code');
      keyName.textContent = setting.key;
      label.appendChild(keyName);

      row.append(label, control.el);

      if (setting.help && setting.help.length > 0) {
        const help = document.createElement('div');
        help.className = 'setting-help';
        help.textContent = setting.help.join('\n');
        row.appendChild(help);
      }
      fragment.appendChild(row);
    }

    const reset = document.createElement('button');
    reset.className = 'settings-reset';
    reset.textContent = `Reset ${section.title} to defaults`;
    reset.addEventListener('click', async () => {
      config = await window.api.resetConfigSection(section.id);
      renderSection();
    });
    fragment.appendChild(reset);

    body.replaceChildren(fragment);
    body.scrollTop = 0;
  }

  async function openPanel() {
    if (!schema) schema = await window.api.getConfigSchema();
    config = await window.api.getConfig();
    if (document.body.classList.contains('compact')) {
      restoreCompact = true;
      setCompact(false, { save: false }); // renderer.js
    }
    renderTabs();
    renderSection();
    panel.hidden = false;
  }

  function closePanel() {
    panel.hidden = true;
    if (restoreCompact) {
      restoreCompact = false;
      setCompact(true, { save: false });
    }
  }

  // --- Events ---
  btnOpen.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
  btnClose.addEventListener('click', closePanel);

  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-section]');
    if (!btn) return;
    activeSection = btn.dataset.section;
    renderTabs();
    renderSection();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });

  // Reflect changes made elsewhere (e.g. picking a saver from the mini menu),
  // without disturbing a control the user is currently dragging.
  window.addEventListener('slmp-config-changed', ({ detail }) => {
    config = detail.config;
    if (panel.hidden) return;
    for (const key of detail.keys) {
      const control = controls.get(key);
      if (control && !control.el.contains(document.activeElement)) control.update(config[key]);
    }
  });
})();
