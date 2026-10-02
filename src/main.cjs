const { app, BrowserWindow, ipcMain, dialog, shell, screen, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { LyricsService, fileId } = require('./lyrics-service.cjs');
const { normalizeTosu } = require('./osu.cjs');
const { ClockSync } = require('./clock-sync.cjs');
const { DEFAULT_OVERLAY_SETTINGS, LEGACY_OVERLAY_SETTINGS, normalizeOverlaySettings, overlayDimensions, requiredLyricHeight, draggedBounds, styleBoundsAtAnchor, resizeRatioFromHandle, resizeFromHandle } = require('./overlay-settings.cjs');
const { normalizePanelSize, scaledPanelSize, panelResizedLyricBounds, choosePanelSide, fitLyricForPanel, combinedLayout, animatedLayout, iconOnlyLayout } = require('./combined-layout.cjs');
const { loadWindowConfig, persistWindowConfig } = require('./window-config.cjs');

const TOSU_URL = 'https://github.com/tosuapp/tosu/releases/download/v4.26.2/tosu-windows-v4.26.2.zip';
const TOSU_SHA256 = 'd34c2bfc495959fcc79ff01f10b7dc9aea77eb508ed23c8f0d0fb8342773faa3';
const TOSU_ENDPOINT = 'http://127.0.0.1:24050/json/v2';
const LYRICS_HOTKEY = 'Control+Alt+Shift+L';
const persistentDataDir = path.join(app.getPath('appData'), 'osu-lyrics-companion');
fs.mkdirSync(persistentDataDir, { recursive: true });
app.setPath('userData', persistentDataDir);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

let appWindow;
let tray;
let lyrics;
let current = { connected: false, state: '', song: null, positionMs: 0, sampledAt: Date.now(), playing: false };
let tosuStatus = 'disconnected';
let launchAttempted = false;
let startedAt = 0;
let stopping = false;
let pollTimer;
const clockSync = new ClockSync();
let saveTimer;
let animationTimer;
let exitRequested = false;
let hotkeyRegistered = false;
let overlaySettings = { ...DEFAULT_OVERLAY_SETTINGS };
let overlayLocked = false;
let overlayShown = true;
let overlayInteractive = false;
let panelOpen = true;
let panelSide = 'above';
let panelProgress = 0;
let panelSize;
let lyricBounds;
let dragSession;
let resizeSession;

function send(channel, data) {
  if (appWindow && !appWindow.isDestroyed()) appWindow.webContents.send(channel, data);
}

function configFile() { return path.join(app.getPath('userData'), 'windows.json'); }
function saveConfig() {
  if (!lyricBounds) return;
  persistWindowConfig(configFile(), { overlayBounds: lyricBounds, overlaySettings, panelSize, overlayLocked, overlayShown, panelOpen });
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveConfig, 350); }

function updateHitTesting() {
  if (!appWindow || appWindow.isDestroyed()) return;
  const ignore = !panelOpen && !overlayInteractive && panelProgress > 0 && !animationTimer;
  appWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
}

function presentLayout() {
  const area = screen.getDisplayMatching(lyricBounds).workArea;
  const layout = animationTimer
    ? animatedLayout(lyricBounds, overlaySettings, panelSide, panelProgress, area, panelSize)
    : combinedLayout(lyricBounds, overlaySettings, panelSide, panelProgress, area, panelSize);
  return !animationTimer && !panelOpen && panelProgress === 0 && !overlayInteractive
    ? iconOnlyLayout(layout, area) : layout;
}

function applyLayout() {
  if (!appWindow || appWindow.isDestroyed()) return;
  const layout = presentLayout();
  const bounds = appWindow.getBounds();
  if (bounds.x !== layout.window.x || bounds.y !== layout.window.y || bounds.width !== layout.window.width || bounds.height !== layout.window.height) appWindow.setBounds(layout.window);
  send('layout', layout);
  updateHitTesting();
  return layout;
}

function finishAnimation() {
  if (!animationTimer) return;
  clearInterval(animationTimer);
  animationTimer = null;
  panelProgress = panelOpen ? 1 : 0;
  applyLayout();
}

function setPanelOpen(open, animate = true) {
  if (!appWindow) return;
  clearInterval(animationTimer);
  animationTimer = null;
  const from = panelProgress;
  if (open && from === 0) {
    const area = screen.getDisplayMatching(lyricBounds).workArea;
    panelSide = choosePanelSide(lyricBounds, area, overlaySettings, panelSize);
    lyricBounds = fitLyricForPanel(lyricBounds, area, overlaySettings, panelSide, panelSize);
  }
  panelOpen = !!open;
  send('panel-state', { open: panelOpen, side: panelSide });
  const target = panelOpen ? 1 : 0;
  if (!animate || from === target) {
    panelProgress = target;
    applyLayout();
    scheduleSave();
    return;
  }
  const started = Date.now();
  const duration = Math.max(100, 480 * Math.abs(target - from));
  const frame = () => {
    const t = Math.min(1, (Date.now() - started) / duration);
    const eased = t * t * (3 - 2 * t);
    panelProgress = from + (target - from) * eased;
    applyLayout();
    if (t >= 1) {
      clearInterval(animationTimer);
      animationTimer = null;
      panelProgress = target;
      applyLayout();
      scheduleSave();
    }
  };
  animationTimer = setInterval(frame, 16);
  frame();
}

function showControl() {
  if (!appWindow || appWindow.isDestroyed()) return;
  if (!overlayShown) setOverlayShown(true);
  appWindow.show();
  appWindow.focus();
  setPanelOpen(true);
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: overlayShown ? '隐藏osu!lyrics' : '显示osu!lyrics', click: () => setOverlayShown(!overlayShown) },
    { label: '打开设置', click: showControl },
    { label: overlayLocked ? '解锁位置' : '锁定位置', click: () => setOverlayLock(!overlayLocked) },
    { type: 'separator' },
    { label: '退出', click: () => { exitRequested = true; app.quit(); } },
  ]));
}

function setOverlayShown(value) {
  overlayShown = !!value;
  if (appWindow && !appWindow.isDestroyed()) {
    if (overlayShown) {
      appWindow.showInactive();
      send('state', current);
      if (lyrics) send('lyrics', lyrics.payload);
      applyLayout();
    } else {
      dragSession = resizeSession = null;
      appWindow.hide();
    }
  }
  send('overlay-presence', { shown: overlayShown, hotkey: LYRICS_HOTKEY, hotkeyRegistered });
  updateTrayMenu();
  scheduleSave();
  return overlayShown;
}

function setOverlayLock(value) {
  overlayLocked = !!value;
  if (overlayLocked) dragSession = resizeSession = null;
  send('overlay-settings', { locked: overlayLocked, settings: overlaySettings });
  updateTrayMenu();
  scheduleSave();
  return overlayLocked;
}

function tosuFolder() { return path.join(app.getPath('userData'), 'tosu'); }
function findTosu(folder, depth = 0) {
  if (depth > 3 || !fs.existsSync(folder)) return null;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'tosu.exe') return full;
    if (entry.isDirectory()) {
      const found = findTosu(full, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function startTosu() {
  const executable = findTosu(tosuFolder());
  if (!executable) return false;
  launchAttempted = true;
  startedAt = Date.now();
  const child = spawn(executable, [], { cwd: path.dirname(executable), detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', error => {
    tosuStatus = 'error';
    send('tosu', { status: tosuStatus, message: `启动 tosu 失败：${error.message}` });
  });
  child.unref();
  tosuStatus = 'starting';
  send('tosu', { status: tosuStatus, message: '' });
  return true;
}

async function installTosu() {
  if (findTosu(tosuFolder())) return startTosu();
  tosuStatus = 'installing';
  send('tosu', { status: tosuStatus, message: '正在下载 tosu…' });
  const folder = tosuFolder();
  fs.mkdirSync(folder, { recursive: true });
  const zip = path.join(folder, 'tosu-v4.26.2.zip');
  try {
    const response = await fetch(TOSU_URL, { signal: AbortSignal.timeout(120000) });
    if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(zip));
    const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    if (hash !== TOSU_SHA256) throw new Error('下载文件校验失败');
    send('tosu', { status: 'installing', message: '正在解压 tosu…' });
    await new Promise((resolve, reject) => execFile('tar.exe', ['-xf', zip, '-C', folder], { windowsHide: true }, error => error ? reject(error) : resolve()));
    fs.unlinkSync(zip);
    if (!findTosu(folder)) throw new Error('压缩包内未找到 tosu.exe');
    return startTosu();
  } catch (error) {
    tosuStatus = 'error';
    send('tosu', { status: tosuStatus, message: error.message });
    return false;
  }
}

async function pollTosu() {
  try {
    const response = await fetch(TOSU_ENDPOINT, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) {
      if (response.status === 500) {
        if (tosuStatus !== 'waiting-osu') {
          tosuStatus = 'waiting-osu';
          send('tosu', { status: tosuStatus, message: '' });
        }
        if (current.connected) {
          clockSync.reset();
          current = { ...current, connected: false, playing: false, song: null };
          send('state', current);
          lyrics.setSong(null);
        }
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    const receivedAt = Date.now();
    current = normalizeTosu(await response.json(), receivedAt);
    if (current.song) current.song.recordingKey = fileId(current.song);
    current.positionMs = clockSync.update({ ...current, key: `${current.song ? fileId(current.song) : ''}|${current.song?.key || ''}|${current.state}` });
    if (current.song?.id === null && current.song.title === 'circles!' && current.song.artist === 'nekodex') current.song = null;
    if (tosuStatus !== 'connected') {
      tosuStatus = 'connected';
      send('tosu', { status: tosuStatus, message: '' });
    }
    send('state', current);
    lyrics.setSong(current.song).catch(error => send('lyrics', { status: 'error', message: error.message, lines: [] }));
  } catch {
    if (tosuStatus === 'starting' && Date.now() - startedAt > 5000) {
      tosuStatus = 'error';
      send('tosu', { status: tosuStatus, message: 'tosu 未响应，请重试启动。' });
    }
    if (!['disconnected', 'installing', 'starting', 'error'].includes(tosuStatus)) {
      tosuStatus = 'disconnected';
      send('tosu', { status: tosuStatus });
    }
    if (current.connected) {
      clockSync.reset();
      current = { ...current, connected: false, playing: false, song: null };
      send('state', current);
      lyrics.setSong(null);
    }
    if (!launchAttempted && findTosu(tosuFolder())) startTosu();
  } finally {
    if (!stopping) pollTimer = setTimeout(pollTosu, 100);
  }
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const config = loadWindowConfig(configFile());
  overlaySettings = normalizeOverlaySettings(config.overlaySettings ? { ...LEGACY_OVERLAY_SETTINGS, ...config.overlaySettings } : undefined);
  panelSize = normalizePanelSize(config.panelSize, overlaySettings);
  overlayLocked = config.overlayLocked === true;
  overlayShown = config.overlayShown !== false;
  panelOpen = config.panelOpen !== false;
  const dimensions = overlayDimensions(overlaySettings);
  const saved = config.overlayBounds;
  const savedVisible = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some(display => {
    const work = display.workArea;
    return Math.min(saved.x + dimensions.width, work.x + work.width) - Math.max(saved.x, work.x) >= 100 &&
      Math.min(saved.y + dimensions.height, work.y + work.height) - Math.max(saved.y, work.y) >= 35;
  });
  const centerX = savedVisible ? saved.x + (saved.width || dimensions.width) / 2 : area.x + area.width / 2;
  lyricBounds = {
    x: Math.round(centerX - dimensions.width / 2),
    y: savedVisible ? saved.y : Math.round(area.y + area.height - dimensions.height - 42),
    ...dimensions,
  };
  panelSide = choosePanelSide(lyricBounds, screen.getDisplayMatching(lyricBounds).workArea, overlaySettings, panelSize);
  const initial = presentLayout();
  appWindow = new BrowserWindow({
    ...initial.window,
    title: 'osu!lyrics',
    show: overlayShown,
    resizable: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', 'assets', 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  appWindow.setAlwaysOnTop(true, 'screen-saver');
  appWindow.setIgnoreMouseEvents(true, { forward: true });
  appWindow.loadFile(path.join(__dirname, 'ui', 'combined.html'));
  appWindow.webContents.once('did-finish-load', () => {
    send('layout', initial);
    send('panel-state', { open: panelOpen, side: panelSide });
    if (panelOpen) {
      const shouldOpen = panelOpen;
      panelOpen = false;
      setPanelOpen(shouldOpen);
    } else updateHitTesting();
  });
  appWindow.on('close', event => {
    if (!exitRequested) { event.preventDefault(); appWindow.hide(); }
  });
  appWindow.on('closed', () => { appWindow = null; });
}

app.on('second-instance', showControl);

if (singleInstance) app.whenReady().then(() => {
  app.setAppUserModelId('local.osu-lyrics-companion');
  lyrics = new LyricsService(path.join(app.getPath('userData'), 'lyrics'), payload => send('lyrics', payload));
  createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')));
  tray.setToolTip('osu!lyrics');
  tray.on('click', showControl);
  hotkeyRegistered = globalShortcut.register(LYRICS_HOTKEY, () => setOverlayShown(!overlayShown));
  updateTrayMenu();
  pollTosu();
});

app.on('before-quit', () => {
  exitRequested = true;
  stopping = true;
  clearTimeout(pollTimer);
  clearTimeout(saveTimer);
  finishAnimation();
  saveConfig();
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
app.on('window-all-closed', () => app.quit());

ipcMain.handle('initial', () => ({
  state: current,
  lyrics: lyrics.payload,
  tosu: { status: tosuStatus, installed: !!findTosu(tosuFolder()) },
  overlay: { locked: overlayLocked, settings: overlaySettings, shown: overlayShown, hotkey: LYRICS_HOTKEY, hotkeyRegistered },
  panel: { open: panelOpen, side: panelSide },
  layout: presentLayout(),
}));
ipcMain.handle('install-tosu', installTosu);
ipcMain.handle('start-tosu', () => startTosu());
ipcMain.handle('search-lyrics', (_event, query) => lyrics.search(String(query || '').slice(0, 120)));
ipcMain.handle('refresh-lyrics', () => lyrics.refreshLyrics());
ipcMain.handle('refresh-translation', () => lyrics.refreshTranslation());
ipcMain.handle('choose-lyrics', (_event, id) => lyrics.select(id));
ipcMain.handle('offset', (_event, delta) => lyrics.setOffset(Number(delta) || 0));
ipcMain.handle('edit-lyrics', async () => {
  const file = lyrics.ensureEditableFile();
  if (file) await shell.openPath(file);
  return !!file;
});
ipcMain.handle('import-lyrics', async () => {
  if (!lyrics.song) return false;
  const generation = lyrics.generation;
  const recordingKey = fileId(lyrics.song);
  const result = await dialog.showOpenDialog(appWindow, { properties: ['openFile'], filters: [{ name: 'LRC 歌词', extensions: ['lrc', 'txt'] }] });
  if (result.canceled || !result.filePaths[0]) return false;
  if (!lyrics.song || lyrics.generation !== generation || fileId(lyrics.song) !== recordingKey) return false;
  return lyrics.importText(fs.readFileSync(result.filePaths[0], 'utf8'));
});
ipcMain.handle('window-action', (_event, action) => {
  if (action === 'close') { exitRequested = true; app.quit(); }
  if (action === 'hide') setPanelOpen(false);
  if (action === 'show') showControl();
  return true;
});
ipcMain.handle('panel-toggle', (_event, open) => { setPanelOpen(!!open); return panelOpen; });
ipcMain.handle('overlay-lock', (_event, locked) => setOverlayLock(locked));
ipcMain.handle('overlay-show', (_event, shown) => setOverlayShown(shown));
ipcMain.handle('overlay-settings-update', (_event, patch) => {
  if (overlayLocked) return overlaySettings;
  finishAnimation();
  const previous = overlaySettings;
  overlaySettings = normalizeOverlaySettings({ ...overlaySettings, ...(patch && typeof patch === 'object' ? patch : {}) });
  if (patch?.resetLayout === true) panelSize = normalizePanelSize(null, overlaySettings);
  else if (previous.scale !== overlaySettings.scale || previous.width !== overlaySettings.width) {
    panelSize = scaledPanelSize(panelSize, overlayDimensions(overlaySettings).width / overlayDimensions(previous).width);
  }
  if (previous.scale !== overlaySettings.scale || previous.width !== overlaySettings.width || previous.showTranslation !== overlaySettings.showTranslation) {
    const anchor = { centerX: lyricBounds.x + lyricBounds.width / 2, topY: lyricBounds.y };
    lyricBounds = styleBoundsAtAnchor(anchor, overlayDimensions(overlaySettings));
    if (panelOpen) lyricBounds = fitLyricForPanel(lyricBounds, screen.getDisplayMatching(lyricBounds).workArea, overlaySettings, panelSide, panelSize);
    applyLayout();
  } else if (patch?.resetLayout === true) applyLayout();
  send('overlay-settings', { locked: overlayLocked, settings: overlaySettings });
  scheduleSave();
  return overlaySettings;
});
ipcMain.on('overlay-visibility', (event, visible) => {
  if (!appWindow || event.sender !== appWindow.webContents) return;
  overlayInteractive = !!visible;
  if (!overlayInteractive) dragSession = resizeSession = null;
  applyLayout();
});
ipcMain.on('overlay-content-height', (event, measuredHeight) => {
  if (!appWindow || event.sender !== appWindow.webContents || dragSession || resizeSession) return;
  const measured = Number(measuredHeight);
  if (!Number.isFinite(measured) || measured < 0) return;
  const height = requiredLyricHeight(overlaySettings, measured);
  if (height === lyricBounds.height) return;
  lyricBounds = { ...lyricBounds, height };
  if (panelOpen && panelSide === 'below') {
    lyricBounds = fitLyricForPanel(lyricBounds, screen.getDisplayMatching(lyricBounds).workArea, overlaySettings, panelSide, panelSize);
  }
  applyLayout();
  scheduleSave();
});
ipcMain.handle('overlay-drag-start', (event, pointer) => {
  const icon = pointer?.source === 'icon';
  if (!appWindow || event.sender !== appWindow.webContents || overlayLocked || (!overlayInteractive && !panelOpen && !icon) || resizeSession || animationTimer) return false;
  const x = Number(pointer?.x), y = Number(pointer?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const layout = icon && !panelOpen && !overlayInteractive ? presentLayout() : null;
  const lyric = layout?.iconOnly
    ? { ...lyricBounds, x: layout.window.x + layout.lyric.x, y: layout.window.y + layout.lyric.y }
    : { ...lyricBounds };
  dragSession = { lyric, pointer: { x, y } };
  return true;
});
ipcMain.on('overlay-drag-move', (event, pointer) => {
  if (!appWindow || event.sender !== appWindow.webContents || !dragSession || overlayLocked) return;
  const x = Number(pointer?.x), y = Number(pointer?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  lyricBounds = { ...dragSession.lyric, ...draggedBounds(dragSession.lyric, dragSession.pointer, { x, y }) };
  applyLayout();
});
ipcMain.on('overlay-drag-end', event => {
  if (appWindow && event.sender === appWindow.webContents) { dragSession = null; scheduleSave(); }
});
ipcMain.handle('overlay-resize-start', (event, payload) => {
  const source = payload?.source === 'panel' ? 'panel' : 'lyric';
  if (!appWindow || event.sender !== appWindow.webContents || overlayLocked || (source === 'panel' ? !panelOpen : !overlayInteractive) || dragSession || animationTimer) return false;
  const handle = String(payload?.handle || '');
  if (!['left','right','top','bottom','top-left','top-right','bottom-left','bottom-right'].includes(handle)) return false;
  const x = Number(payload?.x), y = Number(payload?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  resizeSession = { lyric: { ...lyricBounds }, panel: { ...panelSize }, settings: overlaySettings, pointer: { x, y }, handle, source };
  return true;
});
ipcMain.on('overlay-resize-move', (event, pointer) => {
  if (!appWindow || event.sender !== appWindow.webContents || !resizeSession || overlayLocked) return;
  const x = Number(pointer?.x), y = Number(pointer?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  let result;
  if (resizeSession.source === 'panel') {
    const ratio = resizeRatioFromHandle(resizeSession.panel, resizeSession.pointer, { x, y }, resizeSession.handle);
    const settings = normalizeOverlaySettings({ ...resizeSession.settings, scale: resizeSession.settings.scale * (1 + ratio) });
    const nextPanel = scaledPanelSize(resizeSession.panel, settings.scale / resizeSession.settings.scale);
    result = {
      settings,
      bounds: panelResizedLyricBounds(resizeSession.lyric, resizeSession.panel, overlayDimensions(settings), nextPanel, resizeSession.handle, panelSide),
    };
  } else {
    result = resizeFromHandle(resizeSession.lyric, resizeSession.settings, resizeSession.pointer, { x, y }, resizeSession.handle);
  }
  lyricBounds = result.bounds;
  overlaySettings = result.settings;
  panelSize = scaledPanelSize(resizeSession.panel, overlaySettings.scale / resizeSession.settings.scale);
  if (panelOpen) lyricBounds = fitLyricForPanel(lyricBounds, screen.getDisplayMatching(lyricBounds).workArea, overlaySettings, panelSide, panelSize);
  applyLayout();
  send('overlay-settings', { locked: overlayLocked, settings: overlaySettings });
});
ipcMain.on('overlay-resize-end', event => {
  if (appWindow && event.sender === appWindow.webContents) { resizeSession = null; scheduleSave(); }
});
