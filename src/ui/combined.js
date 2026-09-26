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
let currentLayout = null;
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
  return window.osuPlaybackClock.advancePosition(state, Date.now());
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

function renderLyrics() {
  const elapsed = currentTimeMs();
  const index = activeAt((elapsed - (lyrics.offsetMs || 0)) / 1000);
  const line = lyrics.lines?.[index];
  const visible = !!(line?.original && window.osuPlaybackClock.shouldDisplayLyrics(state, elapsed));
  if (index === activeIndex && visible === activeVisible) return;
  activeIndex = index;
  $('lyricBox').hidden = !visible;
  if (visible) {
    $('original').textContent = line.original;
    $('translation').textContent = line.translation || '';
    $('translation').hidden = !settings.showTranslation || !line.translation;
  }
  queueLyricMeasure();
  if (visible !== activeVisible) { activeVisible = visible; api.overlayVisibility(visible); }
  renderCollapsedToggle();
}

function renderCollapsedToggle() {
  if (!currentLayout) return;
  const dot = $('collapsedToggle');
  const animation = currentLayout.animation;
  const position = animation?.dot || { x: currentLayout.lyric.x + 16, y: currentLayout.lyric.y + 3 };
  dot.style.left = `${position.x}px`;
  dot.style.top = `${position.y}px`;
  dot.style.opacity = String(animation ? 1 - animation.panelScale : 1);
  dot.style.pointerEvents = animation?.panelScale > .95 ? 'none' : 'auto';
  dot.hidden = !activeVisible || (!animation && currentLayout.progress > 0);
}

function setEditing(value) {
  editing = !locked && !!value;
  $('lyricBox').classList.toggle('editing', editing);
}

function renderTrack() {
  const song = state.song;
  $('trackTitle').textContent = song?.title || '等待歌曲';
  $('trackTitle').title = song?.title || '';
  $('trackArtist').textContent = song?.artist || '播放后自动识别';
  $('trackArtist').title = song?.artist || '';
  const phase = /^select/i.test(state.state || '') ? '选歌预览' : /^play$/i.test(state.state || '') ? '游玩中' : state.state || '等待 osu!';
  $('phaseBadge').textContent = state.connected ? phase : '等待 osu!';
  for (const id of ['searchButton', 'importButton', 'editButton', 'offsetBack', 'offsetForward']) $(id).disabled = !song;
}

function renderStatus() {
  $('offsetValue').textContent = `${((lyrics.offsetMs || 0) / 1000).toFixed(1)}s`;
  const connected = tosu.status === 'connected' && state.connected;
  let status = lyrics.status || 'idle';
  let label = '等待歌曲';
  let detail = '在 osu! 中选择歌曲后自动查找歌词';
  if (!connected) {
    status = 'idle';
    label = '等待 osu! 连接';
    detail = tosu.message || '连接后读取歌曲与播放时间';
  } else if (state.song) {
    if (status === 'ready') {
      label = '歌词已就绪';
      detail = [lyrics.source, lyrics.translationSource].filter(Boolean).join(' · ') || '同步歌词已加载';
    } else if (status === 'searching' || status === 'loading') {
      label = lyrics.lines?.length ? '正在搜索其他歌词版本' : '正在查找同步歌词';
      detail = lyrics.lines?.length ? '当前歌词继续显示' : '按曲名、歌手和时长匹配';
    } else if (status === 'choose') {
      label = lyrics.candidates?.length ? '请选择歌词版本' : '未找到同步歌词';
      detail = lyrics.message || '可重搜或导入本地 LRC';
    } else if (status === 'error') {
      label = '歌词获取失败';
      detail = lyrics.message || '可重试搜索或导入本地 LRC';
    }
  }
  $('lyricState').dataset.status = status;
  $('sourceLabel').textContent = label;
  $('translationLabel').textContent = detail;
  $('translationLabel').title = detail;
  $('normalView').classList.toggle('needs-lyrics', connected && !lyrics.lines?.length && (status === 'choose' || status === 'error'));
  $('setupPanel').hidden = connected;
  if (!connected) {
    $('searchRow').hidden = true;
    $('actionRow').hidden = true;
  } else if ($('searchRow').hidden) $('actionRow').hidden = false;
  $('setupDescription').textContent = tosu.status === 'waiting-osu' ? '打开 osu!lazer 后自动连接' : '需要本机 tosu 读取歌曲';
  const setupButton = $('setupButton');
  if (tosu.status === 'waiting-osu') { setupButton.textContent = '已启动'; setupButton.disabled = true; }
  else if (tosu.status === 'installing' || tosu.status === 'starting') { setupButton.textContent = '连接中'; setupButton.disabled = true; }
  else { setupButton.textContent = tosu.installed ? '启动' : '安装'; setupButton.disabled = false; }
}

function renderControls() {
  $('lockButton').textContent = locked ? '解锁位置' : '锁定位置';
  $('lockButton').classList.toggle('selected', locked);
  $('lockButton').setAttribute('aria-pressed', String(locked));
  $('panelHeader').classList.toggle('drag-locked', locked);
  $('panelSurface').classList.toggle('locked', locked);
  $('styleButton').disabled = locked;
  $('visibilityButton').textContent = shown ? '隐藏osu!lyrics' : '显示osu!lyrics';
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
  const transparency = 100 - settings.opacity;
  $('opacityRange').value = transparency;
  $('opacityRange').style.setProperty('--fill', `${(transparency - 5) / 95 * 100}%`);
  $('opacityValue').textContent = `${transparency}%`;
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
  currentLayout = layout;
  panelSide = layout.side;
  const clip = $('panelClip');
  const panel = layout.panel;
  clip.hidden = !layout.animation && panel.visibleHeight < 1;
  clip.style.left = `${panel.x}px`;
  clip.style.top = `${panel.y}px`;
  clip.style.width = `${panel.width}px`;
  clip.style.height = `${layout.animation ? panel.height : panel.visibleHeight}px`;
  $('panelSurface').style.top = layout.animation ? '0px' : layout.side === 'above' ? `${panel.visibleHeight - panel.height}px` : '0px';
  $('panelSurface').style.width = `${panel.width / panel.contentScale}px`;
  $('panelSurface').style.height = `${panel.height / panel.contentScale}px`;
  $('panelSurface').classList.toggle('compact', panel.height < 410);
  document.documentElement.style.setProperty('--panel-scale', String(panel.contentScale * (layout.animation?.panelScale ?? 1)));
  const box = $('lyricBox');
  const widthChanged = box.style.width !== `${layout.lyric.width}px`;
  box.style.left = `${layout.lyric.x}px`;
  box.style.top = `${layout.lyric.y}px`;
  box.style.width = `${layout.lyric.width}px`;
  box.style.height = `${layout.lyric.height}px`;
  renderCollapsedToggle();
  if (widthChanged) queueLyricMeasure();
  $('collapseButton').textContent = layout.side === 'above' ? '⌃' : '⌄';
}

function tick() {
  const duration = state.song?.durationMs || state.song?.lastObjectMs || 0;
  const elapsed = Math.min(currentTimeMs(), duration > 0 ? duration : Infinity);
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
let panelPointerId = null;
let panelGestureOrigin = null;
let panelDragActive = false;
let panelMoved = false;
let panelResizePointerId = null;
let panelResizeOrigin = null;
let panelResizeTarget = null;
let panelResizeActive = false;
let panelResizeMoved = false;

function finishPanelDrag() {
  const header = $('panelHeader');
  const id = panelPointerId;
  panelPointerId = null;
  if (id !== null && header.hasPointerCapture(id)) header.releasePointerCapture(id);
  if (panelDragActive) api.overlayDragEnd();
  panelDragActive = false;
  panelGestureOrigin = null;
  panelMoved = false;
  header.classList.remove('dragging');
}

$('panelHeader').addEventListener('pointerdown', async event => {
  if (locked || event.button !== 0 || event.target.closest('button')) return;
  event.preventDefault();
  panelPointerId = event.pointerId;
  panelGestureOrigin = { x: event.screenX, y: event.screenY };
  panelMoved = false;
  const header = $('panelHeader');
  header.setPointerCapture(panelPointerId);
  const started = await api.overlayDragStart(panelGestureOrigin);
  if (panelPointerId !== event.pointerId || !started) { finishPanelDrag(); return; }
  panelDragActive = true;
  header.classList.add('dragging');
});
$('panelHeader').addEventListener('pointermove', event => {
  if (panelPointerId !== event.pointerId || !panelDragActive) return;
  if (Math.abs(event.screenX - panelGestureOrigin.x) + Math.abs(event.screenY - panelGestureOrigin.y) > 5) panelMoved = true;
  if (panelMoved) api.overlayDragMove({ x: event.screenX, y: event.screenY });
});
$('panelHeader').addEventListener('pointerup', event => { if (panelPointerId === event.pointerId) finishPanelDrag(); });
$('panelHeader').addEventListener('pointercancel', event => { if (panelPointerId === event.pointerId) finishPanelDrag(); });
$('panelHeader').addEventListener('lostpointercapture', event => { if (panelPointerId === event.pointerId) finishPanelDrag(); });

function finishPanelResize() {
  const id = panelResizePointerId;
  panelResizePointerId = null;
  if (id !== null && panelResizeTarget?.hasPointerCapture(id)) panelResizeTarget.releasePointerCapture(id);
  if (panelResizeActive) api.overlayResizeEnd();
  panelResizeOrigin = null;
  panelResizeTarget = null;
  panelResizeActive = false;
  panelResizeMoved = false;
}

$('panelResizeHandles').addEventListener('pointerdown', async event => {
  const handle = event.target.closest('.panel-resize-handle')?.dataset.handle;
  if (!handle || locked || event.button !== 0) return;
  event.preventDefault();
  panelResizePointerId = event.pointerId;
  panelResizeOrigin = { x: event.screenX, y: event.screenY };
  panelResizeTarget = event.target;
  panelResizeMoved = false;
  panelResizeTarget.setPointerCapture(panelResizePointerId);
  const started = await api.overlayResizeStart({ handle, source: 'panel', ...panelResizeOrigin });
  if (panelResizePointerId !== event.pointerId || !started) { finishPanelResize(); return; }
  panelResizeActive = true;
});
$('panelResizeHandles').addEventListener('pointermove', event => {
  if (panelResizePointerId !== event.pointerId || !panelResizeActive) return;
  if (Math.abs(event.screenX - panelResizeOrigin.x) + Math.abs(event.screenY - panelResizeOrigin.y) > 4) panelResizeMoved = true;
  if (panelResizeMoved) api.overlayResizeMove({ x: event.screenX, y: event.screenY });
});
$('panelResizeHandles').addEventListener('pointerup', event => { if (panelResizePointerId === event.pointerId) finishPanelResize(); });
$('panelResizeHandles').addEventListener('pointercancel', event => { if (panelResizePointerId === event.pointerId) finishPanelResize(); });
$('panelResizeHandles').addEventListener('lostpointercapture', event => { if (panelResizePointerId === event.pointerId) finishPanelResize(); });

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
$('brandToggle').addEventListener('click', () => api.panelToggle(false));
$('collapsedToggle').addEventListener('click', () => api.panelToggle(true));
$('closeButton').addEventListener('click', () => api.windowAction('close'));
$('lockButton').addEventListener('click', () => api.overlayLock(!locked));
$('visibilityButton').addEventListener('click', () => api.overlayShow(false));
$('styleButton').addEventListener('click', () => setView('style'));
$('backStyle').addEventListener('click', () => setView('normal'));
$('resetStyle').addEventListener('click', () => api.updateOverlaySettings({ scale: 100, width: 700, opacity: 0, theme: 'plain', showTranslation: true, resetLayout: true }));
$('scaleBack').addEventListener('click', () => api.updateOverlaySettings({ scale: settings.scale - 5 }));
$('scaleForward').addEventListener('click', () => api.updateOverlaySettings({ scale: settings.scale + 5 }));
$('opacityRange').addEventListener('input', event => api.updateOverlaySettings({ opacity: 100 - Number(event.target.value) }));
$('themeSelect').addEventListener('change', event => api.updateOverlaySettings({ theme: event.target.value }));
$('translationToggle').addEventListener('change', event => api.updateOverlaySettings({ showTranslation: event.target.checked }));
$('offsetBack').addEventListener('click', () => api.offset(-500));
$('offsetForward').addEventListener('click', () => api.offset(500));
$('importButton').addEventListener('click', () => api.importLyrics());
$('editButton').addEventListener('click', () => api.editLyrics());
$('searchButton').addEventListener('click', () => {
  $('actionRow').hidden = true;
  $('searchRow').hidden = false;
  $('searchInput').focus();
});
function closeSearch() { $('searchRow').hidden = true; $('actionRow').hidden = false; }
$('cancelSearch').addEventListener('click', closeSearch);
function submitSearch() { showCandidatesAfterSearch = true; closeSearch(); api.searchLyrics($('searchInput').value.trim()); }
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
  const changedSong = state.song?.key !== next.song?.key;
  const changedPhase = state.state !== next.state || state.connected !== next.connected;
  const changedMetadata = state.song?.title !== next.song?.title || state.song?.artist !== next.song?.artist;
  if (changedSong || changedPhase) activeIndex = -2;
  if (changedSong) {
    setView('normal');
    closeSearch();
    candidatePage = 0;
    showCandidatesAfterSearch = false;
  }
  state = next;
  if (changedSong || changedPhase || changedMetadata) { renderTrack(); renderStatus(); }
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
api.onPanelState(next => { panelOpen = next.open; panelSide = next.side; if (!panelOpen) { setView('normal'); setEditing(false); } renderCollapsedToggle(); });
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
