// SLMP - Simple Local Music Player
// Copyright (C) 2026 catastrophic-impact
// SPDX-License-Identifier: GPL-3.0-or-later

// STATE & VARIABLES

const audio = document.getElementById('audio-engine');
const pathDisplay = document.getElementById('path-display');
const fileList = document.getElementById('file-list');
const nowPlaying = document.getElementById('now-playing');
const timeElapsed = document.getElementById('time-elapsed');
const timeDuration = document.getElementById('time-duration');
const seekSlider = document.getElementById('seek-slider');
const volumeSlider = document.getElementById('volume-slider');

const btnPlay = document.getElementById('btn-play');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const btnCompact = document.getElementById('btn-compact');
const header = document.querySelector('.header');
const playerBar = document.querySelector('.player-bar');
const controlsRow = document.querySelector('.controls');

// Compact ("winamp") mode shows this many file list rows
const COMPACT_LIST_ROWS = 5;
let isCompact = false;

const miniViz = document.getElementById('mini-viz');
const miniStage = document.getElementById('mini-viz-stage');
const screensaverMenu = document.getElementById('screensaver-menu');
const screensaverList = document.getElementById('screensaver-list');

let config = {};
let currentDirectory = null;
let browseAudioFiles = [];   // audio files in the folder being viewed
let playlist = [];           // audio files of the folder playback started from
let currentIndex = -1;       // index into playlist
let isShuffle = false;
let isDraggingSeek = false;
let mediaServerPort = null;
let shuffleHistory = [];
const MAX_HISTORY = 500;
let shufflePlayed = new Set(); // indices played this shuffle pass (avoids repeats)

const REPEAT_MODES = ['all', 'one', 'off'];
const REPEAT_LABELS = { all: 'All', one: 'One', off: 'Off' };
let repeatMode = 'all';

let audioCtx = null;
let analyserNode = null;
const BIN_COUNT = 64;
const audioDataBuffer = new Uint8Array(BIN_COUNT);
const spectrum = createSpectrumEngine(); // party analyzer for Raindrops
let streamTimer = null;

let miniSaver = null;
let miniRestartTimer = null;
let screensaverOpen = false;
let volumeSaveTimer = null;

const KEY_COMMANDS = {
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

// HELPER & UTILITY FUNCTIONS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds <= 0 || !isFinite(seconds)) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function setupWebAudio() {
  if (audioCtx) return;

  audioCtx = new AudioContext();
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = BIN_COUNT * 2;

  // source -> party analyser -> original analyser -> speakers
  // (analysers pass audio through untouched)
  const partyAnalyser = spectrum.createAnalyser(audioCtx);
  const mediaSourceNode = audioCtx.createMediaElementSource(audio);
  mediaSourceNode.connect(partyAnalyser);
  partyAnalyser.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);
}

// Latest raw spectrum (original analyser: Bars, Chaos); zeros until playback
function readSpectrum() {
  if (analyserNode) analyserNode.getByteFrequencyData(audioDataBuffer);
  return audioDataBuffer;
}

// Latest party band levels (see spectrum.js: Raindrops)
function readBands() {
  return spectrum.read();
}

// Only pump spectrum data over IPC while a screensaver is actually open.
function setAudioStreaming(enabled) {
  if (enabled && !streamTimer) {
    streamTimer = setInterval(() => {
      if (!analyserNode) return;
      window.api.sendAudioData({ audio: Array.from(readSpectrum()), bands: Array.from(readBands()) });
    }, 1000 / 60);
  } else if (!enabled && streamTimer) {
    clearInterval(streamTimer);
    streamTimer = null;
  }
}

async function ensureAudioContextActive() {
  setupWebAudio();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
}

function updateActiveListItem() {
  const currentFile = playlist[currentIndex];
  fileList.querySelectorAll('li.audio').forEach((item) => {
    item.classList.toggle('active', Boolean(currentFile) && item.dataset.path === currentFile.path);
  });
}

function triggerStatusUpdate() {
  const isPlayingState = audio.paused ? "Paused" : "Playing";
  const volLevel = Math.round(audio.volume * 100) + "%";
  const shuffleState = isShuffle ? "On" : "Off";
  const songName = playlist[currentIndex] ? playlist[currentIndex].name : "None";

  window.api.showStatusOverlay(`Status: ${isPlayingState} | Volume level: ${volLevel} | Shuffle: ${shuffleState} | Repeat: ${REPEAT_LABELS[repeatMode]}\nSong: ${songName}`);
}

// CORE BUSINESS LOGIC FUNCTIONS
async function loadFolder(dirPath) {
  let result = await window.api.readDirectory(dirPath);

  if (result.error) {
    console.error(`Could not open ${dirPath}: ${result.error}`);
    // A stale saved path (e.g. removed SD card) shouldn't leave the browser empty
    if (currentDirectory !== null || !dirPath) return;
    result = await window.api.readDirectory(null);
    if (result.error) return;
  }

  currentDirectory = result.currentPath;
  pathDisplay.textContent = currentDirectory;
  // main.js only rewrites slmp.conf when the value actually changes
  window.api.setConfig('general.recentpath', currentDirectory);

  browseAudioFiles = result.items.filter((item) => item.type === 'audio');

  const fragment = document.createDocumentFragment();
  result.items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = `${item.type === 'directory' ? '📁 ' : '🎵 '}${item.name}`;
    li.title = item.name;
    li.className = item.type;
    li.dataset.path = item.path;
    fragment.appendChild(li);
  });

  fileList.replaceChildren(fragment);
  fileList.parentElement.scrollTop = 0;
  updateActiveListItem();
}

function resetPlaylistState() {
  shuffleHistory = [];
  shufflePlayed = new Set();
  currentIndex = -1;
}

function handleListClick(e) {
  const li = e.target.closest('li');
  if (!li) return;

  if (li.classList.contains('directory')) {
    loadFolder(li.dataset.path);
    return;
  }

  // Playing a track from the viewed folder makes that folder the playlist
  if (playlist !== browseAudioFiles) {
    playlist = browseAudioFiles;
    resetPlaylistState();
  }
  playIndex(playlist.findIndex((f) => f.path === li.dataset.path));
}

async function playIndex(targetIndex, { recordHistory = true } = {}) {
  if (targetIndex < 0 || targetIndex >= playlist.length) return;

  if (recordHistory && currentIndex !== -1 && currentIndex !== targetIndex) {
    shuffleHistory.push(currentIndex);
    if (shuffleHistory.length > MAX_HISTORY) shuffleHistory.shift();
  }
  currentIndex = targetIndex;
  shufflePlayed.add(targetIndex);

  await ensureAudioContextActive();

  const file = playlist[currentIndex];
  audio.src = `http://127.0.0.1:${mediaServerPort}/${encodeURIComponent(file.path)}`;
  audio.play().catch((err) => console.error('Playback error:', err));

  nowPlaying.textContent = `Playing: ${file.name}`;
  updateActiveListItem();
}

function startPlaylistFromView() {
  playlist = browseAudioFiles;
  resetPlaylistState();
  if (playlist.length === 0) return;
  playIndex(isShuffle ? Math.floor(Math.random() * playlist.length) : 0);
}

// Index of the track after the current one, or -1 when playback should stop.
// `auto` is true when a track ended by itself (repeat 'off' stops at the end);
// pressing Next always wraps around.
function getNextIndex({ auto = false } = {}) {
  const stopAtEnd = auto && repeatMode === 'off';

  if (!isShuffle) {
    if (currentIndex + 1 < playlist.length) return currentIndex + 1;
    return stopAtEnd ? -1 : 0;
  }

  // Shuffle works through every track once before any repeats
  let candidates = [];
  for (let i = 0; i < playlist.length; i++) {
    if (!shufflePlayed.has(i)) candidates.push(i);
  }
  if (candidates.length === 0) {
    if (stopAtEnd) return -1;
    shufflePlayed = new Set([currentIndex]);
    for (let i = 0; i < playlist.length; i++) {
      if (i !== currentIndex) candidates.push(i);
    }
    if (candidates.length === 0) return currentIndex; // single-track folder
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function togglePlayPause() {
  if (currentIndex === -1) {
    startPlaylistFromView();
    return;
  }

  if (audio.paused) {
    ensureAudioContextActive();
    audio.play().catch((err) => console.error('Play error:', err));
  } else {
    audio.pause();
  }
}

function playNext() {
  if (playlist.length === 0) {
    startPlaylistFromView();
    return;
  }
  playIndex(getNextIndex());
}

function handleTrackEnded() {
  if (repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play().catch((err) => console.error('Replay error:', err));
    return;
  }

  const next = getNextIndex({ auto: true });
  if (next === -1) {
    nowPlaying.textContent = 'End of folder';
    return;
  }
  playIndex(next);
}

function playPrev() {
  if (playlist.length === 0) return;

  if (isShuffle && shuffleHistory.length > 0) {
    playIndex(shuffleHistory.pop(), { recordHistory: false });
  } else {
    playIndex((currentIndex - 1 + playlist.length) % playlist.length, { recordHistory: false });
  }
}

function setShuffle(enabled) {
  isShuffle = enabled;
  btnShuffle.querySelector('.label').textContent = `Shuffle: ${isShuffle ? 'ON' : 'OFF'}`;
  btnShuffle.classList.toggle('active', isShuffle);
  shufflePlayed = new Set(currentIndex === -1 ? [] : [currentIndex]);
}

function toggleShuffle() {
  setShuffle(!isShuffle);
  window.api.setConfig('general.shuffle', String(isShuffle));

  if (isShuffle && currentIndex === -1) {
    startPlaylistFromView();
  }
}

function setRepeat(mode) {
  repeatMode = REPEAT_MODES.includes(mode) ? mode : 'all';
  btnRepeat.querySelector('.label').textContent = `Repeat: ${REPEAT_LABELS[repeatMode]}`;
  btnRepeat.querySelector('.icon').textContent = repeatMode === 'one' ? '🔂' : '🔁';
  btnRepeat.classList.toggle('active', repeatMode === 'one');
  btnRepeat.classList.toggle('off', repeatMode === 'off');
}

function cycleRepeat() {
  setRepeat(REPEAT_MODES[(REPEAT_MODES.indexOf(repeatMode) + 1) % REPEAT_MODES.length]);
  window.api.setConfig('general.repeat', repeatMode);
}

function setVolume(value, { save = true } = {}) {
  audio.volume = Math.min(1, Math.max(0, value));
  volumeSlider.value = audio.volume;
  if (!save) return;
  // Slider drags fire constantly; only write slmp.conf once it settles
  clearTimeout(volumeSaveTimer);
  volumeSaveTimer = setTimeout(() => window.api.setConfig('general.volume', String(audio.volume)), 500);
}

function handleCommand(cmd) {
  switch (cmd) {
    case 'next': playNext(); break;
    case 'prev': playPrev(); break;
    case 'shuffle': toggleShuffle(); break;
    case 'repeat': cycleRepeat(); break;
    case 'pause': togglePlayPause(); break;
    case 'vol_up': setVolume(Math.round((audio.volume + 0.05) * 20) / 20); break;
    case 'vol_down': setVolume(Math.round((audio.volume - 0.05) * 20) / 20); break;
    default: return;
  }
  // Defer so play()/pause() state has settled before reporting it
  setTimeout(triggerStatusUpdate, 50);
}

// COMPACT MODE
// Size of the window content that fits the header, COMPACT_LIST_ROWS list rows
// and the (single-row) player bar, measured from the real layout.
function measureCompactSize() {
  const sampleRow = fileList.querySelector('li');
  let rowHeight = 35;
  if (sampleRow) {
    const style = getComputedStyle(sampleRow);
    rowHeight = sampleRow.offsetHeight + parseFloat(style.marginBottom);
  }
  const listStyle = getComputedStyle(fileList.parentElement);
  const listPadding = parseFloat(listStyle.paddingTop) + parseFloat(listStyle.paddingBottom);

  const items = controlsRow.children;
  const rowWidth = items[items.length - 1].getBoundingClientRect().right - items[0].getBoundingClientRect().left;
  const barStyle = getComputedStyle(playerBar);
  const barPadding = parseFloat(barStyle.paddingLeft) + parseFloat(barStyle.paddingRight);

  return {
    width: Math.ceil(rowWidth + barPadding + 4),
    height: Math.ceil(header.offsetHeight + listPadding + rowHeight * COMPACT_LIST_ROWS + playerBar.offsetHeight)
  };
}

function setCompact(compact, { save = true } = {}) {
  isCompact = compact;
  document.body.classList.toggle('compact', compact);
  btnCompact.textContent = compact ? '⇱' : '⇲';
  btnCompact.title = compact ? 'Expand player' : 'Compact mode';

  // Layout has updated synchronously with the class change, so measure now
  window.api.setWindowMode(compact ? 'compact' : 'expanded', compact ? measureCompactSize() : null);
  if (save) window.api.setConfig('general.compact', String(compact));
}

// MINI VISUALIZER & SCREENSAVER MENU
function currentSaverType() {
  const type = config['general.screensaver'];
  return getSaverDef(type) ? type : 'bars';
}

function miniShouldRun() {
  return config['general.mini_visualizer'] !== 'false' && !screensaverOpen && !document.hidden;
}

// (Re)starts the mini view from scratch, or leaves it blank while the big
// screensaver runs, the player is hidden, or the mini view is turned off.
function mountMini() {
  clearTimeout(miniRestartTimer);
  if (miniSaver) miniSaver.destroy();
  miniSaver = null;

  const enabled = config['general.mini_visualizer'] !== 'false';
  miniViz.classList.toggle('disabled', !enabled);
  miniViz.title = `Screensaver: ${getSaverDef(currentSaverType()).label}`;
  if (!miniShouldRun()) return;

  miniSaver = mountSaver(currentSaverType(), {
    container: miniStage,
    mini: true,
    config,
    getAudio: readSpectrum,
    getBands: readBands
  });
}

function applyMiniPause() {
  if (miniShouldRun() !== Boolean(miniSaver)) mountMini();
}

function buildScreensaverMenu(screensavers) {
  const fragment = document.createDocumentFragment();
  for (const saver of screensavers) {
    const btn = document.createElement('button');
    btn.dataset.saver = saver.id;
    btn.textContent = saver.label;
    fragment.appendChild(btn);
  }
  screensaverList.replaceChildren(fragment);
}

function updateScreensaverMenuSelection() {
  const type = currentSaverType();
  screensaverList.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.saver === type);
  });
}

function toggleScreensaverMenu() {
  screensaverMenu.hidden = !screensaverMenu.hidden;
  if (screensaverMenu.hidden) return;
  updateScreensaverMenuSelection();
  // Fit the menu in the space above the mini view (tight in compact mode);
  // anything beyond that scrolls
  screensaverMenu.style.maxHeight = `${Math.max(80, miniViz.getBoundingClientRect().top - 14)}px`;
}

function handleConfigChanged({ config: newConfig, keys }) {
  config = newConfig;

  if (keys.some((k) => k.startsWith('analyzer.'))) spectrum.configure(config);

  if (keys.includes('general.screensaver') || keys.includes('general.mini_visualizer')) {
    mountMini();
    updateScreensaverMenuSelection();
  } else if (keys.some((k) => k.startsWith(`${currentSaverType()}.`))) {
    // Debounced so dragging a settings slider doesn't restart it every step
    clearTimeout(miniRestartTimer);
    miniRestartTimer = setTimeout(mountMini, 300);
  }

  // settings.js listens for this (the IPC bridge allows one listener per channel)
  window.dispatchEvent(new CustomEvent('slmp-config-changed', { detail: { config: newConfig, keys } }));
}

// EVENT LISTENERS & BRIDGE HOOKS
const updateDuration = () => {
  timeDuration.textContent = formatTime(audio.duration);
};

audio.addEventListener('loadedmetadata', updateDuration);
audio.addEventListener('durationchange', updateDuration);
audio.addEventListener('ended', handleTrackEnded);
function setPlayButton(playing) {
  btnPlay.querySelector('.icon').textContent = playing ? '⏸' : '▶';
  btnPlay.querySelector('.label').textContent = playing ? 'Pause' : 'Play';
}

audio.addEventListener('play', () => setPlayButton(true));
audio.addEventListener('pause', () => setPlayButton(false));
audio.addEventListener('error', () => {
  if (currentIndex !== -1) nowPlaying.textContent = `Could not play: ${playlist[currentIndex].name}`;
});

audio.addEventListener('timeupdate', () => {
  if (isDraggingSeek) return;
  const pos = audio.currentTime || 0;
  const dur = audio.duration;
  seekSlider.value = (isFinite(dur) && dur > 0) ? (pos / dur) * 100 : 0;
  timeElapsed.textContent = formatTime(pos);
});

// Pointer events so seeking works with mouse and the Deck's touchscreen alike
seekSlider.addEventListener('pointerdown', () => isDraggingSeek = true);

seekSlider.addEventListener('input', () => {
  if (isFinite(audio.duration)) {
    timeElapsed.textContent = formatTime((seekSlider.value / 100) * audio.duration);
  }
});

seekSlider.addEventListener('change', () => {
  if (isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = (seekSlider.value / 100) * audio.duration;
  }
  isDraggingSeek = false;
});

fileList.addEventListener('click', handleListClick);
btnPlay.addEventListener('click', togglePlayPause);
btnNext.addEventListener('click', playNext);
btnPrev.addEventListener('click', playPrev);
btnShuffle.addEventListener('click', toggleShuffle);
btnRepeat.addEventListener('click', cycleRepeat);
btnCompact.addEventListener('click', () => setCompact(!isCompact));

volumeSlider.addEventListener('input', (e) => {
  setVolume(parseFloat(e.target.value));
  triggerStatusUpdate();
});

miniViz.addEventListener('click', toggleScreensaverMenu);
miniViz.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') toggleScreensaverMenu();
});

screensaverMenu.addEventListener('click', (e) => {
  const saverBtn = e.target.closest('button[data-saver]');
  if (saverBtn) {
    // main.js also swaps an open screensaver window to the new choice
    window.api.setConfig('general.screensaver', saverBtn.dataset.saver);
    screensaverMenu.hidden = true;
    return;
  }
  const actionBtn = e.target.closest('button[data-action]');
  if (actionBtn) {
    screensaverMenu.hidden = true;
    window.api.openScreensaver(currentSaverType(), { fullscreen: actionBtn.dataset.action === 'fullscreen' });
  }
});

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'Escape' && !screensaverMenu.hidden) {
    screensaverMenu.hidden = true;
    return;
  }
  const cmd = KEY_COMMANDS[e.key];
  if (!cmd) return;
  e.preventDefault();
  handleCommand(cmd);
});

window.addEventListener('pointerdown', (e) => {
  const target = e.target;
  // Drop focus after clicks so Space keeps meaning play/pause. Settings
  // controls keep focus: blurring would close <select> and colour popups.
  if (['BUTTON', 'INPUT'].includes(target.tagName) && !target.closest('#settings-panel')) {
    setTimeout(() => target.blur(), 0);
  }
  if (!screensaverMenu.hidden && !e.target.closest('.mini-viz-wrap')) {
    screensaverMenu.hidden = true;
  }
});

document.addEventListener('visibilitychange', applyMiniPause);

// Commands relayed from screensaver windows
window.api.onPlayerCommand(handleCommand);
window.api.onScreensaverActive((active) => {
  screensaverOpen = active;
  setAudioStreaming(active);
  applyMiniPause();
});
window.api.onConfigChanged(handleConfigChanged);

// INITIALIZATION EXECUTION
async function initializeApp() {
  mediaServerPort = await window.api.getServerPort();

  const schema = await window.api.getConfigSchema();
  buildScreensaverMenu(schema.screensavers.filter((s) => getSaverDef(s.id)));

  config = await window.api.getConfig();
  spectrum.configure(config);
  const savedVolume = parseFloat(config['general.volume']);
  setVolume(Number.isFinite(savedVolume) ? savedVolume : 1, { save: false });
  setShuffle(config['general.shuffle'] === 'true');
  setRepeat(config['general.repeat']);
  mountMini();

  await loadFolder(config['general.recentpath'] || null);
  // After the list is filled so a real row can be measured
  if (config['general.compact'] === 'true') setCompact(true, { save: false });
}

initializeApp();
