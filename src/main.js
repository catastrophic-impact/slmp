// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// ==========================================
// 1. IMPORTS, VARIABLES & CONSTANTS
// ==========================================
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { SECTIONS, SETTINGS, SCREENSAVERS, OBSOLETE_KEYS, normalizeValue } = require('./config-schema');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.flac', '.wav', '.m4a', '.aac', '.opus']);

let server;
let serverPort;
let screensaverWin = null;
let screensaverType = null;
let mainWin = null;
let expandedBounds = null; // main window size/position before entering compact mode

const SCREENSAVER_TYPES = new Set(SCREENSAVERS.map((s) => s.id));


// ==========================================
// 2. HELPER & UTILITY FUNCTIONS
// ==========================================
const getConfigPath = () => {
  if (!app.isPackaged) {
    return path.join(process.cwd(), 'slmp.conf');
  } else if (process.env.APPIMAGE) {
    return path.join(path.dirname(process.env.APPIMAGE), 'slmp.conf');
  } else {
    return path.join(path.dirname(process.execPath), 'slmp.conf');
  }
};

function parseConfigText(text) {
  const raw = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    raw[key] = trimmed.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return raw;
}

// The file is always regenerated from the schema, so comments and key order
// stay consistent and new settings appear automatically. Unknown keys are kept.
function buildConfigText(values, extras) {
  const out = [];
  for (const section of SECTIONS) {
    out.push(`# ${section.header}`, '#======================');
    for (const setting of section.settings) {
      for (const line of setting.help || []) out.push(`# ${line}`);
      out.push(`${setting.key}=${values[setting.key]}`, '');
    }
  }
  const extraKeys = Object.keys(extras);
  if (extraKeys.length > 0) {
    out.push('# OTHER (unrecognised keys, kept as-is)', '#======================');
    for (const key of extraKeys) out.push(`${key}=${extras[key]}`);
    out.push('');
  }
  return out.join('\n');
}

// Reads slmp.conf (creating/upgrading it as needed) and returns a flat
// { 'section.key': 'value' } map of normalised values.
function readConfig() {
  const configPath = getConfigPath();
  let fileText = null;
  try {
    fileText = fsSync.readFileSync(configPath, 'utf-8');
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Failed to read slmp.conf:', err);
  }

  const raw = fileText ? parseConfigText(fileText) : {};
  const values = {};
  const extras = {};
  for (const [key, setting] of SETTINGS) {
    values[key] = key in raw ? normalizeValue(setting, raw[key]) : setting.default;
  }
  for (const key of Object.keys(raw)) {
    if (!SETTINGS.has(key) && !OBSOLETE_KEYS.has(key)) extras[key] = raw[key];
  }

  const text = buildConfigText(values, extras);
  if (text !== fileText) writeConfigText(text);

  return { ...extras, ...values };
}

function writeConfigText(text) {
  const configPath = getConfigPath();
  try {
    fsSync.mkdirSync(path.dirname(configPath), { recursive: true });
    fsSync.writeFileSync(configPath, text, 'utf-8');
  } catch (err) {
    console.error('Failed to write slmp.conf:', err);
  }
}

// Applies { key: value } changes, writes the file once, and tells every window.
function updateConfig(changes) {
  const config = readConfig();
  const changedKeys = [];
  for (const [key, value] of Object.entries(changes)) {
    const setting = SETTINGS.get(key);
    if (!setting) continue;
    const normalized = normalizeValue(setting, value);
    if (config[key] !== normalized) {
      config[key] = normalized;
      changedKeys.push(key);
    }
  }
  if (changedKeys.length === 0) return config;

  const extras = {};
  for (const key of Object.keys(config)) {
    if (!SETTINGS.has(key)) extras[key] = config[key];
  }
  writeConfigText(buildConfigText(config, extras));

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('config-changed', { config, keys: changedKeys });
  }

  // An open screensaver window follows the selected screensaver
  if (changedKeys.includes('general.screensaver') && screensaverWin && !screensaverWin.isDestroyed()) {
    loadScreensaver(config['general.screensaver']);
  }
  return config;
}

function getMimeType(ext) {
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.opus': return 'audio/opus';
    case '.flac': return 'audio/flac';
    case '.m4a': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    default: return 'application/octet-stream';
  }
}


// ==========================================
// 3. CORE BUSINESS LOGIC FUNCTIONS
// ==========================================
function startLocalServer() {
  server = http.createServer((req, res) => {
    let filePath;
    try {
      filePath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }

    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }

    // Only ever serve audio files; this server is reachable by anything on localhost.
    const ext = path.extname(filePath).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(ext)) {
      res.writeHead(403);
      return res.end();
    }

    let stat;
    try {
      stat = fsSync.statSync(filePath);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      console.error(`[404] File missing on disk: ${filePath}`);
      res.writeHead(404);
      return res.end('File not found');
    }

    const total = stat.size;
    const mime = getMimeType(ext);
    const range = req.headers.range;

    const sendStream = (opts) => {
      const stream = fsSync.createReadStream(filePath, opts);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    };

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start, end;
      if (match && match[1] !== '') {
        start = parseInt(match[1], 10);
        end = match[2] !== '' ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
      } else if (match && match[2] !== '') {
        // Suffix range: last N bytes
        start = Math.max(0, total - parseInt(match[2], 10));
        end = total - 1;
      }

      if (start === undefined || start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': (end - start) + 1,
        'Content-Type': mime,
      });
      sendStream({ start, end });
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes'
      });
      sendStream();
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    title: "SLMP Beta 1",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The main window feeds audio data to the screensaver, so it must keep
      // running at full speed while hidden behind or minimized under it.
      backgroundThrottling: false
    }
  });

  mainWin = win;
  win.on('closed', () => {
    mainWin = null;
    // A screensaver window on its own has no audio and would keep the app running
    if (screensaverWin && !screensaverWin.isDestroyed()) screensaverWin.close();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}


// ==========================================
// 4. IPC HANDLERS & EVENT LISTENERS
// ==========================================
ipcMain.handle('read-directory', async (event, dirPath) => {
  try {
    let targetDir = dirPath;

    if (!targetDir) {
      targetDir = app.getPath('music');
      try {
        await fs.access(targetDir);
      } catch {
        targetDir = os.homedir();
      }
    }

    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const contents = [];
    const parentDir = path.dirname(targetDir);

    if (parentDir !== targetDir) {
      contents.push({
        type: 'directory',
        name: '..',
        path: parentDir,
      });
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(targetDir, entry.name);

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const target = await fs.stat(fullPath);
          isDir = target.isDirectory();
          isFile = target.isFile();
        } catch {
          continue; // broken link
        }
      }

      if (isDir) {
        contents.push({ type: 'directory', name: entry.name, path: fullPath });
      } else if (isFile) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          contents.push({ type: 'audio', name: entry.name, path: fullPath });
        }
      }
    }

    contents.sort((a, b) => {
      if (a.name === '..') return -1;
      if (b.name === '..') return 1;
      if (a.type === b.type) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      return a.type === 'directory' ? -1 : 1;
    });

    return { currentPath: targetDir, items: contents };

  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const isFull = win.isFullScreen();
    win.setFullScreen(!isFull);
    return !isFull;
  }
  return false;
});

ipcMain.handle('set-window-mode', (event, mode, size) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== mainWin) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  if (win.isMaximized()) win.unmaximize();

  if (mode === 'compact' && size) {
    if (!expandedBounds) expandedBounds = win.getBounds();
    win.setContentSize(Math.max(200, size.width), Math.max(150, size.height));
  } else if (mode === 'expanded') {
    if (expandedBounds) win.setBounds(expandedBounds);
    else win.setSize(900, 650);
    expandedBounds = null;
  }
});

ipcMain.handle('get-config', () => readConfig());

ipcMain.handle('get-config-schema', () => ({ sections: SECTIONS, screensavers: SCREENSAVERS }));

ipcMain.handle('set-config', (event, key, value) => updateConfig({ [key]: value }));

ipcMain.handle('reset-config-section', (event, sectionId) => {
  const section = SECTIONS.find((s) => s.id === sectionId);
  if (!section) return readConfig();
  const changes = {};
  for (const setting of section.settings) {
    if (!setting.hidden) changes[setting.key] = setting.default;
  }
  return updateConfig(changes);
});

ipcMain.handle('get-server-port', () => serverPort);

function loadScreensaver(type) {
  screensaverType = type;
  screensaverWin.loadFile(path.join(__dirname, 'partymode', 'saver.html'), { query: { type } });
}

ipcMain.handle('open-screensaver', (event, type, { fullscreen = false } = {}) => {
  if (!SCREENSAVER_TYPES.has(type)) return;

  if (screensaverWin && !screensaverWin.isDestroyed()) {
    if (screensaverType !== type) loadScreensaver(type);
    if (fullscreen) screensaverWin.setFullScreen(true);
    screensaverWin.focus();
    return;
  }

  screensaverWin = new BrowserWindow({
    width: 1280,
    height: 720,
    x: 100,
    y: 100,
    alwaysOnTop: true,
    fullscreen,
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  loadScreensaver(type);

  screensaverWin.once('ready-to-show', () => {
    screensaverWin.show();
  });

  if (mainWin) mainWin.webContents.send('screensaver-active', true);

  screensaverWin.on('closed', () => {
    screensaverWin = null;
    screensaverType = null;
    if (mainWin) mainWin.webContents.send('screensaver-active', false);
  });
});

ipcMain.on('player-command', (event, command) => {
  const allWins = BrowserWindow.getAllWindows();
  allWins.forEach(win => {
    if (win.webContents !== event.sender) {
      win.webContents.send('player-command', command);
    }
  });
});

ipcMain.on('show-status-overlay', (event, text) => {
  const allWins = BrowserWindow.getAllWindows();
  allWins.forEach(win => {
    win.webContents.send('show-status-overlay', text);
  });
});

ipcMain.on('audio-data', (event, data) => {
  if (screensaverWin && !screensaverWin.isDestroyed()) {
    screensaverWin.webContents.send('audio-data-update', data);
  }
});


// ==========================================
// 5. APPLICATION ENTRY & EXIT LIFECYCLE
// ==========================================
// No File/Edit/View menu bar on any window
Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  readConfig();
  await startLocalServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});