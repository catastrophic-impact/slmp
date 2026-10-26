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
const btnUp = document.getElementById('btn-up');
const btnList = document.getElementById('btn-list');
const nowPlayingInner = nowPlaying.querySelector('.marquee-inner');
const volIcon = document.getElementById('vol-icon');
const nowFolder = document.getElementById('now-folder');
const seekTip = document.getElementById('seek-tip');
const topbar = document.querySelector('.topbar');
const playerBar = document.querySelector('.player-bar');

// Compact ("winamp") mode is a fixed-width window showing this many list rows
const COMPACT_WIDTH = 380;
const COMPACT_LIST_ROWS = 4;
let isCompact = false;
let listHidden = false; // file list hidden (shared by the full and compact views)

const miniViz = document.getElementById('mini-viz');
const miniStage = document.getElementById('mini-viz-stage');
const screensaverMenu = document.getElementById('screensaver-menu');
const screensaverList = document.getElementById('screensaver-list');

let config = {};
let currentDirectory = null;
let parentDirectory = null;
let preMuteVolume = 0.6;
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
// Tracks of an hour or more show hh:mm:ss on both stamps (see .progress-container.long)
function formatTime(seconds, forceHours = audio.duration >= 3600) {
  if (isNaN(seconds) || seconds <= 0 || !isFinite(seconds)) return forceHours ? '00:00:00' : '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return (hrs > 0 || forceHours) ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

// Now-playing title: slides back and forth when it doesn't fit
function updateMarquee() {
  nowPlaying.classList.remove('overflowing');
  const overflow = nowPlayingInner.offsetWidth - nowPlaying.clientWidth;
  if (overflow <= 1) return;
  nowPlaying.style.setProperty('--shift', `${-(overflow + 14)}px`);
  nowPlaying.style.setProperty('--dur', `${((overflow / 35) + 1.2) / 0.64}s`);
  nowPlaying.classList.add('overflowing');
}

function setTitle(text) {
  nowPlayingInner.textContent = text;
  nowPlaying.title = text;
  updateMarquee();
}
new ResizeObserver(updateMarquee).observe(nowPlaying);

// Fills a range input's track up to its current value (see input[type=range] in styles.css)
function paintRange(input) {
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--fill', `${Math.min(100, Math.max(0, pct || 0))}%`);
}
window.paintRange = paintRange;
document.addEventListener('input', (e) => {
  if (e.target.type === 'range') paintRange(e.target);
});

// Applies general.accent: sets the CSS accent colour and picks readable text for it
function applyAccent(value) {
  const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value || '');
  const [r, g, b] = m ? [m[1], m[2], m[3]].map(Number) : [137, 180, 250];
  const root = document.documentElement.style;
  root.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  root.setProperty('--on-accent', luma > 0.55 ? '#0b0b12' : '#ffffff');
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
  renderCrumbs(currentDirectory);
  // main.js only rewrites slmp.conf when the value actually changes
  window.api.setConfig('general.recentpath', currentDirectory);

  const parentItem = result.items.find((item) => item.name === '..');
  parentDirectory = parentItem ? parentItem.path : null;
  btnUp.disabled = !parentDirectory;

  const items = result.items.filter((item) => item.name !== '..');
  browseAudioFiles = items.filter((item) => item.type === 'audio');

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const isDir = item.type === 'directory';
    const li = document.createElement('li');
    li.title = item.name;
    li.className = item.type;
    li.dataset.path = item.path;

    const icon = document.createElement('span');
    icon.className = 'row-icon';
    icon.innerHTML = iconSvg(isDir ? 'folder' : 'music') + (isDir ? '' : '<span class="eq"><i></i><i></i><i></i></span>');

    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = isDir ? item.name : displayTitle(item.name);

    li.append(icon, name);
    if (isDir) {
      const end = document.createElement('span');
      end.className = 'row-end';
      end.innerHTML = iconSvg('chevron');
      li.appendChild(end);
    }
    fragment.appendChild(li);
  });

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `${iconSvg('music')}<span>No music or folders here</span>`;
    fragment.appendChild(empty);
  }

  fileList.replaceChildren(fragment);
  fileList.parentElement.scrollTop = 0;
  updateActiveListItem();
}

// Track name without its file extension
function displayTitle(fileName) {
  return fileName.replace(/\.[^./]+$/, '');
}

// Clickable path segments; scrolled so the current folder is always in view
function renderCrumbs(dirPath) {
  const parts = dirPath.split('/').filter(Boolean);
  const fragment = document.createDocumentFragment();
  const addCrumb = (label, target) => {
    if (fragment.childNodes.length) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.innerHTML = iconSvg('chevron');
      sep.firstChild.style.cssText = 'width:12px;height:12px';
      fragment.appendChild(sep);
    }
    const crumb = document.createElement('span');
    crumb.className = 'crumb';
    crumb.textContent = label;
    crumb.dataset.path = target;
    fragment.appendChild(crumb);
  };
  addCrumb('/', '/');
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    addCrumb(part, acc);
  }
  pathDisplay.title = dirPath;
  pathDisplay.replaceChildren(fragment);
  scrollCrumbsToEnd();
}

// Keep the current folder in view. Sizes aren't final right after load or a
// window/mode change, so this also re-runs from the observers below.
function scrollCrumbsToEnd() {
  pathDisplay.scrollLeft = pathDisplay.scrollWidth;
  requestAnimationFrame(() => { pathDisplay.scrollLeft = pathDisplay.scrollWidth; });
}
new ResizeObserver(scrollCrumbsToEnd).observe(pathDisplay);
document.fonts.ready.then(scrollCrumbsToEnd);

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

  setTitle(displayTitle(file.name));
  nowFolder.textContent = file.path.split('/').slice(-2, -1)[0] || '';
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
    setTitle('End of folder');
    nowFolder.textContent = '';
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
  btnShuffle.title = `Shuffle: ${isShuffle ? 'On' : 'Off'} (S)`;
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
  btnRepeat.title = `Repeat: ${REPEAT_LABELS[repeatMode]} (R)`;
  setIcon(btnRepeat, repeatMode === 'one' ? 'repeat1' : 'repeat');
  btnRepeat.classList.toggle('active', repeatMode !== 'off');
  btnRepeat.classList.toggle('off', repeatMode === 'off');
}

function cycleRepeat() {
  setRepeat(REPEAT_MODES[(REPEAT_MODES.indexOf(repeatMode) + 1) % REPEAT_MODES.length]);
  window.api.setConfig('general.repeat', repeatMode);
}

function setVolume(value, { save = true } = {}) {
  audio.volume = Math.min(1, Math.max(0, value));
  volumeSlider.value = audio.volume;
  paintRange(volumeSlider);
  if (audio.volume > 0) preMuteVolume = audio.volume;
  setIcon(volIcon, audio.volume === 0 ? 'mute' : audio.volume < 0.5 ? 'volumeLow' : 'volume');
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
  let listHeight = 0;
  if (!listHidden) {
    const sampleRow = fileList.querySelector('li');
    let rowHeight = 38;
    if (sampleRow) {
      const style = getComputedStyle(sampleRow);
      rowHeight = sampleRow.offsetHeight + parseFloat(style.marginBottom);
    }
    const listStyle = getComputedStyle(fileList.parentElement);
    listHeight = parseFloat(listStyle.paddingTop) + parseFloat(listStyle.paddingBottom) + rowHeight * COMPACT_LIST_ROWS;
  }
  return {
    width: COMPACT_WIDTH,
    height: Math.ceil(topbar.offsetHeight + listHeight + playerBar.offsetHeight)
  };
}

// Syncs the list visibility and window size with the current mode. Layout has
// updated synchronously with the class changes, so the measurements are current.
function applyLayout({ resize = true } = {}) {
  const hidden = listHidden;
  document.body.classList.toggle('no-list', hidden);
  btnList.classList.toggle('active', !hidden);
  btnList.title = hidden ? 'Show file list' : 'Hide file list';

  if (resize) {
    if (isCompact) window.api.setWindowMode('compact', measureCompactSize());
    else if (hidden) window.api.setWindowMode('collapsed', { height: collapsedHeight() });
    else window.api.setWindowMode('expanded', null);
  }
  updateMarquee();
  scrollCrumbsToEnd();
}

function collapsedHeight() {
  return Math.ceil(topbar.offsetHeight + playerBar.offsetHeight);
}

// The window height follows the content in compact and list-hidden layouts. The
// bar's height depends on the window width (stacked below 720px), so it's
// re-fitted once a mode switch has settled, and when a track adds the folder line.
let lastFitHeight = 0;
function fitWindowHeight() {
  if (!isCompact && !listHidden) return;
  const height = isCompact ? measureCompactSize().height : collapsedHeight();
  if (height === lastFitHeight) return;
  lastFitHeight = height;
  window.api.setWindowMode('fit-height', { height });
}
const fitObserver = new ResizeObserver(() => requestAnimationFrame(fitWindowHeight));
fitObserver.observe(topbar);
fitObserver.observe(playerBar);

function setListHidden(hidden, { save = true } = {}) {
  listHidden = hidden;
  applyLayout();
  if (save) window.api.setConfig('general.list_hidden', String(hidden));
}

function setCompact(compact, { save = true } = {}) {
  isCompact = compact;
  document.body.classList.toggle('compact', compact);
  setIcon(btnCompact, compact ? 'expand' : 'compact');
  btnCompact.title = compact ? 'Expand player' : 'Compact mode';
  applyLayout();
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
  const rect = miniViz.getBoundingClientRect();
  // With the file list hidden there's no room above the mini view, so the menu
  // opens to its left as a wide grid instead (when the window is wide enough)
  const openLeft = !isCompact && listHidden && rect.left >= 440;
  screensaverMenu.classList.toggle('left', openLeft);
  // Otherwise fit the menu in the space above the mini view; anything beyond that scrolls
  screensaverMenu.style.maxHeight = openLeft
    ? `${Math.max(80, rect.bottom - 10)}px`
    : `${Math.max(80, rect.top - 14)}px`;
}

function handleConfigChanged({ config: newConfig, keys }) {
  config = newConfig;

  if (keys.some((k) => k.startsWith('analyzer.'))) spectrum.configure(config);
  if (keys.includes('general.accent')) applyAccent(config['general.accent']);

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
  if (!isDraggingSeek) timeElapsed.textContent = formatTime(audio.currentTime || 0);
};

audio.addEventListener('loadedmetadata', updateDuration);
audio.addEventListener('durationchange', updateDuration);
audio.addEventListener('ended', handleTrackEnded);
function setPlayButton(playing) {
  setIcon(btnPlay, playing ? 'pause' : 'play');
  document.body.classList.toggle('paused', !playing);
}

audio.addEventListener('play', () => setPlayButton(true));
audio.addEventListener('pause', () => setPlayButton(false));
audio.addEventListener('error', () => {
  if (currentIndex !== -1) setTitle(`Could not play: ${playlist[currentIndex].name}`);
});

audio.addEventListener('timeupdate', () => {
  if (isDraggingSeek) return;
  const pos = audio.currentTime || 0;
  const dur = audio.duration;
  seekSlider.value = (isFinite(dur) && dur > 0) ? (pos / dur) * 100 : 0;
  paintRange(seekSlider);
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

// Hover tooltip showing the time under the pointer
seekSlider.addEventListener('pointermove', (e) => {
  if (!isFinite(audio.duration) || audio.duration <= 0) return;
  const rect = seekSlider.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  seekTip.textContent = formatTime(frac * audio.duration);
  seekTip.style.left = `${frac * rect.width}px`;
  seekTip.hidden = false;
});
seekSlider.addEventListener('pointerleave', () => { seekTip.hidden = true; });

btnUp.addEventListener('click', () => { if (parentDirectory) loadFolder(parentDirectory); });
pathDisplay.addEventListener('click', (e) => {
  const crumb = e.target.closest('.crumb');
  if (crumb && crumb.dataset.path !== currentDirectory) loadFolder(crumb.dataset.path);
});
volIcon.addEventListener('click', () => setVolume(audio.volume > 0 ? 0 : preMuteVolume));

fileList.addEventListener('click', handleListClick);
btnPlay.addEventListener('click', togglePlayPause);
btnNext.addEventListener('click', playNext);
btnPrev.addEventListener('click', playPrev);
btnShuffle.addEventListener('click', toggleShuffle);
btnRepeat.addEventListener('click', cycleRepeat);
btnCompact.addEventListener('click', () => setCompact(!isCompact));
btnList.addEventListener('click', () => setListHidden(!listHidden));

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
  const focusable = target.closest('button, input');
  if (focusable && !target.closest('#settings-panel')) {
    setTimeout(() => focusable.blur(), 0);
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
  applyAccent(config['general.accent']);
  spectrum.configure(config);
  const savedVolume = parseFloat(config['general.volume']);
  setVolume(Number.isFinite(savedVolume) ? savedVolume : 1, { save: false });
  // Shuffle always starts off; clear a value left over from an earlier session
  setShuffle(false);
  if (config['general.shuffle'] === 'true') window.api.setConfig('general.shuffle', 'false');
  setRepeat(config['general.repeat']);
  setPlayButton(false);
  mountMini();

  await loadFolder(config['general.recentpath'] || null);
  // After the list is filled so a real row can be measured
  listHidden = config['general.list_hidden'] === 'true';
  if (config['general.compact'] === 'true') setCompact(true, { save: false });
  else applyLayout({ resize: listHidden });

  // The window stays hidden until the saved layout is applied (no expanded -> compact jump)
  requestAnimationFrame(() => requestAnimationFrame(() => window.api.appReady()));
}

initializeApp();
