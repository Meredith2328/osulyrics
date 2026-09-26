const api = window.osuLyrics;
const $ = id => document.getElementById(id);
let state = { connected: false, song: null, positionMs: 0, sampledAt: Date.now(), playing: false };
let lyrics = { status: 'idle', lines: [], candidates: [], offsetMs: 0 };
let tosu = { status: 'disconnected', installed: false };
let settings = { scale: 100, width: 700, opacity: 0, theme: 'plain', showTranslation: true };
let locked = false;
let shown = true;
let panelOpen = true;
let panelSide = 'above';
let activeIndex = -2;
let activeVisible = false;
let editing = false;
let gesture = null;
let suppressClick = false;
let view = 'normal';
let candidatePage = 0;
let showCandidatesAfterSearch = false;
let measureQueued = false;
let lastReportedHeight = -1;

function measureLyricHeight() {
  measureQueued = false;
  const box = $('lyricBox');
  const original = $('original');
  const translation = $('translation');
  const measured = box.hidden ? 0 : Math.ceil(original.getBoundingClientRect().height +
    (translation.hidden ? 0 : translation.getBoundingClientRect().height + 2) + 6);
  if (measured === lastReportedHeight) return;
  lastReportedHeight = measured;
  api.overlayContentHeight(measured);
}

function queueLyricMeasure() {
  if (measureQueued) return;
  measureQueued = true;
  requestAnimationFrame(measureLyricHeight);
}

function timeLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function currentTimeMs() {
  return (state.positionMs || 0) + (state.playing && state.connected ? Math.max(0, Math.min(500, Date.now() - state.sampledAt)) : 0);
}

function activeAt(seconds) {
  const lines = lyrics.lines || [];
  let low = 0, high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].time <= seconds) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function displayedIndex(seconds) {
  const lines = lyrics.lines || [];
  let index = activeAt(seconds);
  if (!/^select(play|multi)$/i.test(state.state || '')) return index;
  if (index >= 0 && lines[index]?.original) return index;
  for (let next = Math.max(0, index + 1); next < lines.length; next++) if (lines[next].original) return next;
  for (let previous = index; previous >= 0; previous--) if (lines[previous].original) return previous;
  return -1;
}

function renderLyrics() {
  const index = displayedIndex((currentTimeMs() - (lyrics.offsetMs || 0)) / 1000);
  if (index === activeIndex) return;
  activeIndex = index;
  const line = lyrics.lines?.[index];
  const visible = !!(state.connected && line?.original);
  $('lyricBox').hidden = !visible;
  if (visible) {
    $('original').textContent = line.original;
    $('translation').textContent = line.translation || '';
    $('translation').hidden = !settings.showTranslation || !line.translation;
  }
  queueLyricMeasure();
  if (visible !== activeVisible) { activeVisible = visible; api.overlayVisibility(visible); }
}

function setEditing(value) {
  editing = !locked && !!value;
  $('lyricBox').classList.toggle('editing', editing);
}

function renderTrack() {
  const song = state.song;
  $('trackTitle').textContent = song?.title || '等待歌曲';
  $('trackArtist').textContent = song?.artist || '播放后自动识别';
  const phase = /^select/i.test(state.state || '') ? '选歌预览' : /^play$/i.test(state.state || '') ? '游玩中' : state.state || '等待 osu!';
  $('phaseBadge').textContent = state.connected ? phase : '等待 osu!';
  for (const id of ['searchButton', 'importButton', 'editButton', 'offsetBack', 'offsetForward']) $(id).disabled = !song;
}

function renderStatus() {
  $('sourceLabel').textContent = `歌词来源：${lyrics.source || (state.song ? '查找中' : '等待歌曲')}`;
  $('translationLabel').textContent = lyrics.translationSource || '';
  $('offsetValue').textContent = `${((lyrics.offsetMs || 0) / 1000).toFixed(1)}s`;
  const message = (tosu.status !== 'connected' && tosu.message) || (lyrics.message?.startsWith('歌词搜索失败') ? lyrics.message : '');
  $('notice').hidden = !message;
  $('notice').textContent = message;
  $('setupPanel').hidden = tosu.status === 'connected';
  $('setupDescription').textContent = tosu.status === 'waiting-osu' ? '打开 osu!lazer 后自动连接' : '需要本机 tosu 读取歌曲';
  const setupButton = $('setupButton');
  if (tosu.status === 'waiting-osu') { setupButton.textContent = '已启动'; setupButton.disabled = true; }
  else if (tosu.status === 'installing' || tosu.status === 'starting') { setupButton.textContent = '连接中'; setupButton.disabled = true; }
  else { setupButton.textContent = tosu.installed ? '启动' : '安装'; setupButton.disabled = false; }
}

function renderControls() {
  $('lockButton').textContent = locked ? '解锁调整' : '锁定歌词';
  $('lockButton').classList.toggle('selected', locked);
  $('styleButton').disabled = locked;
  $('visibilityButton').textContent = shown ? '隐藏歌词' : '显示歌词';
  if (locked && view === 'style') setView('normal');
  const box = $('lyricBox');
  box.classList.toggle('locked', locked);
  box.classList.toggle('unlocked', !locked);
  if (locked) setEditing(false);
}

function renderStyle() {
  document.documentElement.style.setProperty('--lyric-scale', String(settings.scale / 100));
  document.documentElement.style.setProperty('--opacity', String(settings.opacity / 100));
  $('lyricBox').classList.remove('theme-plain', 'theme-glass', 'theme-contrast');
  $('lyricBox').classList.add(`theme-${settings.theme}`);
  $('translation').hidden = !settings.showTranslation || !$('translation').textContent;
  $('scaleValue').textContent = `${settings.scale}%`;
  $('opacityRange').value = settings.opacity;
  $('opacityValue').textContent = `${settings.opacity}%`;
  $('opacityRange').disabled = settings.theme === 'plain';
  $('themeSelect').value = settings.theme;
  $('translationToggle').checked = settings.showTranslation;
  queueLyricMeasure();
}

function setView(next) {
  view = next;
  $('normalView').hidden = next !== 'normal';
  $('styleView').hidden = next !== 'style';
  $('candidateView').hidden = next !== 'candidates';
}

function renderCandidates() {
  const candidates = lyrics.candidates || [];
  const pageCount = Math.max(1, Math.ceil(candidates.length / 4));
  candidatePage = Math.max(0, Math.min(candidatePage, pageCount - 1));
  $('pageLabel').textContent = `${candidatePage + 1} / ${pageCount}`;
  $('previousPage').disabled = candidatePage === 0;
  $('nextPage').disabled = candidatePage >= pageCount - 1;
  const list = $('candidateList');
  list.replaceChildren();
  for (const candidate of candidates.slice(candidatePage * 4, candidatePage * 4 + 4)) {
    const button = document.createElement('button');
    button.className = 'candidate';
    const name = document.createElement('strong');
    name.textContent = `${candidate.title} · ${candidate.language === 'ja' ? '日文' : candidate.language === 'en' ? '英文' : '语言待确认'} · ${timeLabel(candidate.duration * 1000)}`;
    const artist = document.createElement('small');
    artist.textContent = candidate.artist;
    button.append(name, artist);
    button.addEventListener('click', async () => { await api.chooseLyrics(candidate.id); setView('normal'); });
    list.appendChild(button);
  }
}

function applyLayout(layout) {
  if (!layout) return;
  panelSide = layout.side;
  const clip = $('panelClip');
  const panel = layout.panel;
  clip.hidden = panel.visibleHeight < 1;
  clip.style.left = `${panel.x}px`;
  clip.style.top = `${panel.y}px`;
  clip.style.width = `${panel.width}px`;
  clip.style.height = `${panel.visibleHeight}px`;
  $('panelSurface').style.top = layout.side === 'above' ? `${panel.visibleHeight - panel.height}px` : '0px';
  $('panelSurface').style.width = `${panel.width / panel.contentScale}px`;
  document.documentElement.style.setProperty('--panel-scale', String(panel.contentScale));
  const box = $('lyricBox');
  const widthChanged = box.style.width !== `${layout.lyric.width}px`;
  box.style.left = `${layout.lyric.x}px`;
  box.style.top = `${layout.lyric.y}px`;
  box.style.width = `${layout.lyric.width}px`;
  box.style.height = `${layout.lyric.height}px`;
  if (widthChanged) queueLyricMeasure();
  $('collapseButton').textContent = layout.side === 'above' ? '⌃' : '⌄';
}

function tick() {
  const elapsed = currentTimeMs();
  const duration = state.song?.durationMs || state.song?.lastObjectMs || 0;
  $('elapsed').textContent = timeLabel(elapsed);
  $('duration').textContent = duration > 0 ? timeLabel(duration) : '--:--';
  $('progress').style.width = duration > 0 ? `${Math.min(100, elapsed / duration * 100)}%` : '0%';
  renderLyrics();
  requestAnimationFrame(tick);
}

let pointerId = null;
let gestureMode = null;
let gestureOrigin = null;
let moved = false;

function finishGesture() {
  const id = pointerId;
  pointerId = null;
  if (moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 250); }
  moved = false;
  if (id !== null && $('lyricBox').hasPointerCapture(id)) $('lyricBox').releasePointerCapture(id);
  if (gestureMode === 'resize') api.overlayResizeEnd();
  else if (gestureMode === 'drag') api.overlayDragEnd();
  if (gestureMode === 'resize') {
    lastReportedHeight = -1;
    queueLyricMeasure();
  }
  gestureMode = null;
  gestureOrigin = null;
}

$('lyricBox').addEventListener('pointerdown', async event => {
  if (locked || event.button !== 0) return;
  event.preventDefault();
  const handle = event.target.closest('.resize-handle')?.dataset.handle;
  pointerId = event.pointerId;
  gestureOrigin = { x: event.screenX, y: event.screenY };
  moved = false;
  $('lyricBox').setPointerCapture(pointerId);
  const started = handle ? await api.overlayResizeStart({ handle, ...gestureOrigin }) : await api.overlayDragStart(gestureOrigin);
  if (pointerId !== event.pointerId || !started) { api.overlayDragEnd(); api.overlayResizeEnd(); return; }
  gestureMode = handle ? 'resize' : 'drag';
});
$('lyricBox').addEventListener('pointermove', event => {
  if (pointerId !== event.pointerId || !gestureMode) return;
  if (Math.abs(event.screenX - gestureOrigin.x) + Math.abs(event.screenY - gestureOrigin.y) > 5) { moved = true; setEditing(true); }
  if (!moved) return;
  const pointer = { x: event.screenX, y: event.screenY };
  if (gestureMode === 'resize') api.overlayResizeMove(pointer);
  else api.overlayDragMove(pointer);
});
$('lyricBox').addEventListener('pointerup', event => { if (pointerId === event.pointerId) finishGesture(); });
$('lyricBox').addEventListener('pointercancel', event => { if (pointerId === event.pointerId) finishGesture(); });
$('lyricBox').addEventListener('lostpointercapture', event => { if (pointerId === event.pointerId) finishGesture(); });
$('lyricBox').addEventListener('click', event => {
  if (suppressClick) { suppressClick = false; return; }
  if (event.target.closest('.resize-handle')) return;
  if (!locked) setEditing(!editing);
  api.panelToggle(true);
});
$('lyricBox').addEventListener('contextmenu', event => event.preventDefault());
$('lyricBox').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); api.panelToggle(true); }
});

$('collapseButton').addEventListener('click', () => api.panelToggle(false));
$('closeButton').addEventListener('click', () => api.windowAction('close'));
$('lockButton').addEventListener('click', () => api.overlayLock(!locked));
$('visibilityButton').addEventListener('click', () => api.overlayShow(false));
$('styleButton').addEventListener('click', () => setView('style'));
$('backStyle').addEventListener('click', () => setView('normal'));
$('resetStyle').addEventListener('click', () => api.updateOverlaySettings({ scale: 100, width: 700, opacity: 0, theme: 'plain', showTranslation: true }));
$('scaleBack').addEventListener('click', () => api.updateOverlaySettings({ scale: settings.scale - 5 }));
$('scaleForward').addEventListener('click', () => api.updateOverlaySettings({ scale: settings.scale + 5 }));
$('opacityRange').addEventListener('input', event => api.updateOverlaySettings({ opacity: Number(event.target.value) }));
$('themeSelect').addEventListener('change', event => api.updateOverlaySettings({ theme: event.target.value }));
$('translationToggle').addEventListener('change', event => api.updateOverlaySettings({ showTranslation: event.target.checked }));
$('offsetBack').addEventListener('click', () => api.offset(-500));
$('offsetForward').addEventListener('click', () => api.offset(500));
$('importButton').addEventListener('click', () => api.importLyrics());
$('editButton').addEventListener('click', () => api.editLyrics());
$('searchButton').addEventListener('click', () => {
  $('searchRow').hidden = !$('searchRow').hidden;
  $('normalView').classList.toggle('search-open', !$('searchRow').hidden);
  if (!$('searchRow').hidden) $('searchInput').focus();
});
function submitSearch() { showCandidatesAfterSearch = true; api.searchLyrics($('searchInput').value.trim()); }
$('submitSearch').addEventListener('click', submitSearch);
$('searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') submitSearch(); });
$('backCandidates').addEventListener('click', () => setView('normal'));
$('previousPage').addEventListener('click', () => { candidatePage--; renderCandidates(); });
$('nextPage').addEventListener('click', () => { candidatePage++; renderCandidates(); });
$('setupButton').addEventListener('click', async () => {
  if (tosu.installed) await api.startTosu();
  else if (await api.installTosu()) tosu.installed = true;
  renderStatus();
});

api.onState(next => {
  if (state.song?.key !== next.song?.key || state.state !== next.state || state.connected !== next.connected) activeIndex = -2;
  state = next;
  renderTrack();
  renderLyrics();
});
api.onLyrics(next => {
  lyrics = next;
  activeIndex = -2;
  renderLyrics();
  renderStatus();
  renderCandidates();
  if ((next.status === 'choose' || showCandidatesAfterSearch) && next.candidates?.length) { candidatePage = 0; setView('candidates'); showCandidatesAfterSearch = false; }
});
api.onTosu(next => { tosu = { ...tosu, ...next }; renderStatus(); });
api.onOverlaySettings(next => { locked = next.locked; settings = next.settings; lastReportedHeight = -1; renderControls(); renderStyle(); });
api.onOverlayPresence(next => { shown = next.shown; if (!shown) setEditing(false); renderControls(); });
api.onPanelState(next => { panelOpen = next.open; panelSide = next.side; if (!panelOpen) setView('normal'); });
api.onLayout(applyLayout);

api.initial().then(initial => {
  state = initial.state;
  lyrics = initial.lyrics;
  tosu = initial.tosu;
  locked = initial.overlay.locked;
  shown = initial.overlay.shown;
  settings = initial.overlay.settings;
  panelOpen = initial.panel.open;
  panelSide = initial.panel.side;
  applyLayout(initial.layout);
  renderStyle(); renderControls(); renderTrack(); renderStatus(); renderCandidates(); renderLyrics(); tick();
});
document.fonts.ready.then(queueLyricMeasure);
