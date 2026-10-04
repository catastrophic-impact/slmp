// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

const { contextBridge, ipcRenderer } = require('electron');

// Replaces any previous listener so a page can't accidentally stack duplicates.
const subscribe = (channel, callback) => {
  ipcRenderer.removeAllListeners(channel);
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
};

contextBridge.exposeInMainWorld('api', {
  readDirectory: (path) => ipcRenderer.invoke('read-directory', path),
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  openScreensaver: (type, opts) => ipcRenderer.invoke('open-screensaver', type, opts),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  // mode: 'compact' (with { width, height } content size) or 'expanded'
  setWindowMode: (mode, size) => ipcRenderer.invoke('set-window-mode', mode, size),

  // Parsed slmp.conf as a flat { 'section.key': 'value' } map
  getConfig: () => ipcRenderer.invoke('get-config'),
  getConfigSchema: () => ipcRenderer.invoke('get-config-schema'),
  // Both resolve to the full updated config map
  setConfig: (key, value) => ipcRenderer.invoke('set-config', key, value),
  resetConfigSection: (sectionId) => ipcRenderer.invoke('reset-config-section', sectionId),
  // Payload: { config, keys } with the keys that changed
  onConfigChanged: (callback) => subscribe('config-changed', callback),

  // Audio streaming IPC methods
  sendAudioData: (data) => ipcRenderer.send('audio-data', data),
  onAudioData: (callback) => subscribe('audio-data-update', callback),
  onScreensaverActive: (callback) => subscribe('screensaver-active', callback),

  // Global Keyboard & Status Sync Bridge
  sendPlayerCommand: (command) => ipcRenderer.send('player-command', command),
  onPlayerCommand: (callback) => subscribe('player-command', callback),

  showStatusOverlay: (statusText) => ipcRenderer.send('show-status-overlay', statusText),
  onShowStatusOverlay: (callback) => subscribe('show-status-overlay', callback)
});
