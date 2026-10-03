const api = window.osuLyrics;
const presetsApi = window.osuAppearancePresets;
const $ = id => document.getElementById(id);
let state = { connected: false, song: null, positionMs: 0, sampledAt: Date.now(), playing: false };
let lyrics = { status: 'idle', lines: [], candidates: [], offsetMs: 0 };
let tosu = { status: 'disconnected', installed: false };
let settings = { scale: 100, width: 700, showTranslation: true, ...presetsApi.presetPatch('sakura') };
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
let appearanceTab = 'basic';
let candidatePage = 0;
let showCandidatesAfterSearch = false;
let measureQueued = false;
let lastReportedHeight = -1;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change', () => { if (currentLayout) applyLayout(currentLayout); });
function renderPresence() {
  document.body.hidden = !shown;
  document.body.inert = !shown;
  if (!shown) { cancelGestures(); setEditing(false); }
  else queueLyricMeasure();
  if (currentLayout) applyLayout(currentLayout);
}

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
  // Reserve the same text column in every presence state; the orb never travels.
  const reserveSpace = activeVisible;
  $('lyricBox').classList.toggle('with-toggle', reserveSpace);
  dot.style.left = `${currentLayout.lyric.x + 12}px`;
  dot.style.top = `${currentLayout.lyric.y}px`;
  dot.style.opacity = '1';
  dot.style.pointerEvents = shown ? 'auto' : 'none';
  dot.hidden = !shown;
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
  const recovery = connected && state.song && !lyrics.lines?.length
    ? status === 'error' ? 'retry' : status === 'choose' && !lyrics.candidates?.length ? 'search' : '' : '';
  $('normalView').dataset.recovery = recovery;
  $('lyricState').dataset.status = status;
  $('sourceLabel').textContent = label;
  $('translationLabel').textContent = detail;
  $('translationLabel').title = detail;
  $('normalView').classList.toggle('needs-lyrics', connected && !lyrics.lines?.length && (status === 'choose' || status === 'error'));
  const hasSong = connected && !!state.song;
  const lines = lyrics.lines || [];
  const missingTranslation = lines.some(line => line.original && !line.translation);
  const machineTranslation = ['机器翻译', '翻译暂不可用'].includes(lyrics.translationSource) &&
    lines.some(line => line.translation) &&
    (lyrics.source === 'LRCLIB' || !!lyrics.machineTranslationIndexes?.length);
  $('refreshActions').hidden = !hasSong;
  $('refreshLyricsButton').disabled = !hasSong || status === 'searching' || status === 'loading';
  $('refreshTranslationButton').disabled = !hasSong || status === 'searching' || status === 'loading' ||
    lyrics.translationSource === '正在翻译…' || (!missingTranslation && !machineTranslation);
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
  const lockLabel = locked ? '解锁位置' : '锁定位置';
  $('lockButton').title = lockLabel;
  $('lockButton').setAttribute('aria-label', lockLabel);
  $('lockButton').classList.toggle('selected', locked);
  $('lockButton').setAttribute('aria-pressed', String(locked));
  $('panelHeader').classList.toggle('drag-locked', locked);
  $('panelSurface').classList.toggle('locked', locked);
  for (const id of ['brandToggle', 'collapsedToggle']) $(id).classList.toggle('draggable', !locked);
  $('brandToggle').title = locked ? '收起 osu!lyrics' : '拖动移动位置；点击收起 osu!lyrics';
  $('brandToggle').setAttribute('aria-expanded', String(panelOpen));
  const toggleLabel = panelOpen ? '收起 osu!lyrics' : '展开 osu!lyrics';
  $('collapsedToggle').title = locked ? toggleLabel : `拖动移动位置；点击${toggleLabel}`;
  $('collapsedToggle').setAttribute('aria-label', toggleLabel);
  $('collapsedToggle').setAttribute('aria-expanded', String(panelOpen));
  $('styleButton').disabled = locked;
  if (locked && view === 'style') setView('normal');
  const box = $('lyricBox');
  box.classList.toggle('locked', locked);
  box.classList.toggle('unlocked', !locked);
  if (locked) setEditing(false);
}

function renderStyle() {
  const root = document.documentElement.style;
  root.setProperty('--lyric-scale', String(settings.scale / 100));
  root.setProperty('--opacity', String(settings.opacity / 100));
  const originalColor = settings.originalColor || '#ffffff';
  const translationColor = settings.translationColor || (settings.theme === 'glass' ? '#ffddee' : '#ffffff');
  const backgroundColor = settings.backgroundColor || (settings.theme === 'contrast' ? '#000000' : '#1f1b28');
  root.setProperty('--original-color', originalColor);
  root.setProperty('--translation-color', translationColor);
  root.setProperty('--background-rgb', [1, 3, 5].map(index => parseInt(backgroundColor.slice(index, index + 2), 16)).join(', '));
  const fonts = {
    osu: '"Torus", "Nunito Sans", "Microsoft YaHei UI", "Segoe UI", sans-serif',
    clean: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
    serif: 'Georgia, "Yu Mincho", SimSun, serif',
  };
  root.setProperty('--lyric-font', fonts[settings.fontStyle] || fonts.osu);
  const effects = {
    auto: settings.theme === 'plain' ? 'none' : '0 1px 2px #0009',
    none: 'none',
    outline: '1px 0 0 #000b, -1px 0 0 #000b, 0 1px 0 #000b, 0 -1px 0 #000b',
    shadow: '0 2px 5px #000c',
  };
  root.setProperty('--lyric-shadow', effects[settings.textEffect] || effects.auto);
  const box = $('lyricBox');
  box.classList.remove('theme-plain', 'theme-glass', 'theme-contrast', 'align-left', 'align-right');
  box.classList.add(`theme-${settings.theme}`);
  if (settings.alignment !== 'center') box.classList.add(`align-${settings.alignment}`);
  $('translation').hidden = !settings.showTranslation || !$('translation').textContent;
  $('scaleValue').textContent = `${settings.scale}%`;
  const transparency = 100 - settings.opacity;
  $('opacityRange').value = transparency;
  $('opacityRange').style.setProperty('--fill', `${(transparency - 5) / 95 * 100}%`);
  $('opacityValue').textContent = `${transparency}%`;
  $('opacityRange').disabled = settings.theme === 'plain';
  $('opacityHint').hidden = settings.theme !== 'plain';
  $('translationState').textContent = settings.showTranslation ? '开启' : '关闭';
  $('themeSelect').value = settings.theme;
  $('translationToggle').checked = settings.showTranslation;
  for (const [name, fallback] of [['originalColor', originalColor], ['translationColor', translationColor], ['backgroundColor', backgroundColor]]) {
    $(name).value = settings[name] || fallback;
    $(`${name}Value`).textContent = settings[name] ? settings[name].toUpperCase() : '默认';
    $(`${name}Default`).disabled = !settings[name];
  }
  $('backgroundColor').disabled = settings.theme === 'plain';
  $('fontStyleSelect').value = settings.fontStyle;
  $('textEffectSelect').value = settings.textEffect;
  $('alignmentSelect').value = settings.alignment;
  renderPresetSelection();
  queueLyricMeasure();
}

function setView(next) {
  view = next;
  $('styleButton').hidden = next !== 'normal';
  $('backButton').hidden = next === 'normal';
  $('normalView').hidden = next !== 'normal';
  $('styleView').hidden = next !== 'style';
  $('candidateView').hidden = next !== 'candidates';
}

function setAppearanceTab(next) {
  appearanceTab = next;
  for (const name of ['basic', 'colors', 'typography']) {
    $(`${name}Tab`).setAttribute('aria-selected', String(name === next));
    $(`${name}Settings`).hidden = name !== next;
  }
}

function buildPresetSwatches() {
  const strip = $('presetStrip');
  for (const preset of presetsApi.PRESETS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-swatch';
    button.dataset.preset = preset.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${preset.name}：${preset.hint}`);
    button.title = `${preset.name} · ${preset.hint}`;
    const sample = document.createElement('span');
    sample.className = 'preset-sample';
    sample.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = preset.id === 'clear' ? '清爽' : preset.name;
    button.append(sample, name);
    button.classList.toggle('plain', !!preset.preview.plain);
    button.style.setProperty('--preset-original', preset.preview.original);
    button.style.setProperty('--preset-translation', preset.preview.translation);
    button.style.setProperty('--preset-background', preset.preview.background);
    button.addEventListener('click', () => api.updateOverlaySettings(presetsApi.presetPatch(preset.id)));
    strip.appendChild(button);
  }
}

function renderPresetSelection() {
  const selected = presetsApi.matchingPreset(settings);
  for (const button of $('presetStrip').children) {
    const active = button.dataset.preset === selected;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
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
  const opacity = reducedMotion.matches ? (panelOpen && (layout.animation || layout.progress > 0) ? 1 : 0) : (layout.animation?.opacity ?? layout.progress);
  clip.hidden = opacity <= 0;
  clip.style.opacity = String(opacity);
  clip.inert = !shown || !panelOpen || opacity <= 0;
  clip.style.pointerEvents = clip.inert ? 'none' : 'auto';
  clip.style.left = `${panel.x}px`;
  clip.style.top = `${panel.y}px`;
  clip.style.width = `${panel.width}px`;
  clip.style.height = `${panel.height}px`;
  $('panelSurface').style.top = '0px';
  $('panelSurface').style.width = `${panel.width / panel.contentScale}px`;
  $('panelSurface').style.height = `${panel.height / panel.contentScale}px`;
  $('panelSurface').classList.toggle('compact', panel.height < 410);
  document.documentElement.style.setProperty('--panel-scale', String(panel.contentScale));
  const box = $('lyricBox');
  const widthChanged = box.style.width !== `${layout.lyric.width}px`;
  box.style.left = `${layout.lyric.x}px`;
  box.style.top = `${layout.lyric.y}px`;
  box.style.width = `${layout.lyric.width}px`;
  box.style.height = `${layout.lyric.height}px`;
  renderCollapsedToggle();
  if (widthChanged) queueLyricMeasure();
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

const gestureGate = window.osuGestureGate.create(api, () => {
  // The host ignores measurements during gestures; resend after cleanup.
  // A hidden document has no measurable content; defer that resend until show.
  lastReportedHeight = -1;
  if (shown) queueLyricMeasure();
});
const iconGestureFinishes = [];
let lyricLease = null, panelDragLease = null, panelResizeLease = null;
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
  panelDragLease?.cancel();
  panelDragLease = null;
  panelDragActive = false;
  panelGestureOrigin = null;
  panelMoved = false;
  header.classList.remove('dragging');
}

$('panelHeader').addEventListener('pointerdown', async event => {
  if (!shown || locked || event.button !== 0 || event.target.closest('button')) return;
  const lease = gestureGate.reserve('drag');
  if (!lease) return;
  panelDragLease = lease;
  event.preventDefault();
  panelPointerId = event.pointerId;
  panelGestureOrigin = { x: event.screenX, y: event.screenY };
  panelMoved = false;
  const header = $('panelHeader');
  header.setPointerCapture(panelPointerId);
  const started = await lease.start(panelGestureOrigin);
  if (panelDragLease !== lease) return;
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
  panelResizeLease?.cancel();
  panelResizeLease = null;
  panelResizeOrigin = null;
  panelResizeTarget = null;
  panelResizeActive = false;
  panelResizeMoved = false;
}

$('panelResizeHandles').addEventListener('pointerdown', async event => {
  const handle = event.target.closest('.panel-resize-handle')?.dataset.handle;
  if (!handle || !shown || locked || event.button !== 0) return;
  const lease = gestureGate.reserve('resize');
  if (!lease) return;
  panelResizeLease = lease;
  event.preventDefault();
  panelResizePointerId = event.pointerId;
  panelResizeOrigin = { x: event.screenX, y: event.screenY };
  panelResizeTarget = event.target;
  panelResizeMoved = false;
  panelResizeTarget.setPointerCapture(panelResizePointerId);
  const started = await lease.start({ handle, source: 'panel', ...panelResizeOrigin });
  if (panelResizeLease !== lease) return;
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
  lyricLease?.cancel();
  lyricLease = null;
  gestureMode = null;
  gestureOrigin = null;
}

$('lyricBox').addEventListener('pointerdown', async event => {
  if (!shown || locked || event.button !== 0) return;
  const handle = event.target.closest('.resize-handle')?.dataset.handle;
  const lease = gestureGate.reserve(handle ? 'resize' : 'drag');
  if (!lease) return;
  lyricLease = lease;
  event.preventDefault();
  pointerId = event.pointerId;
  gestureOrigin = { x: event.screenX, y: event.screenY };
  moved = false;
  $('lyricBox').setPointerCapture(pointerId);
  const started = await lease.start(handle ? { handle, ...gestureOrigin } : gestureOrigin);
  if (lyricLease !== lease) return;
  if (pointerId !== event.pointerId || !started) { finishGesture(); return; }
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

function bindIconDrag(id, opensPanel) {
  const button = $(id);
  let pointerId = null, origin = null, active = false, moved = false, suppressClick = false, iconLease = null;
  function finish() {
    if (pointerId === null) return;
    const captured = pointerId;
    pointerId = null;
    if (button.hasPointerCapture(captured)) button.releasePointerCapture(captured);
    iconLease?.cancel();
    iconLease = null;
    if (moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 250);
    }
    origin = null;
    active = moved = false;
    button.classList.remove('dragging');
  }
  iconGestureFinishes.push(finish);
  button.addEventListener('pointerdown', async event => {
    if (!shown || locked || event.button !== 0) return;
    const lease = gestureGate.reserve('drag');
    if (!lease) return;
    iconLease = lease;
    event.preventDefault();
    pointerId = event.pointerId;
    origin = { x: event.screenX, y: event.screenY };
    button.setPointerCapture(pointerId);
    const started = await lease.start({ ...origin, source: 'icon' });
    if (iconLease !== lease) return;
    if (pointerId !== event.pointerId || !started) { finish(); return; }
    active = true;
  });
  button.addEventListener('pointermove', event => {
    if (pointerId !== event.pointerId || !active) return;
    if (Math.abs(event.screenX - origin.x) + Math.abs(event.screenY - origin.y) > 5) moved = true;
    if (!moved) return;
    button.classList.add('dragging');
    api.overlayDragMove({ x: event.screenX, y: event.screenY });
  });
  button.addEventListener('pointerup', event => { if (pointerId === event.pointerId) finish(); });
  button.addEventListener('pointercancel', event => { if (pointerId === event.pointerId) finish(); });
  button.addEventListener('lostpointercapture', event => { if (pointerId === event.pointerId) finish(); });
  button.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    api.panelToggle(opensPanel === null ? !panelOpen : opensPanel);
  });
}
function cancelGestures() {
  finishPanelDrag();
  finishPanelResize();
  finishGesture();
  for (const finish of iconGestureFinishes) finish();
}
window.addEventListener('blur', cancelGestures);
bindIconDrag('brandToggle', false);
bindIconDrag('collapsedToggle', null);
$('lockButton').addEventListener('click', () => api.overlayLock(!locked));
$('settingsButton').addEventListener('click', () => {
  cancelGestures();
  const bounds = $('settingsButton').getBoundingClientRect();
  api.settingsMenu({ x: bounds.left, y: bounds.bottom });
});
$('styleButton').addEventListener('click', () => setView('style'));
$('backButton').addEventListener('click', () => setView('normal'));
$('resetStyle').addEventListener('click', () => api.updateOverlaySettings({ scale: 100, width: 700, showTranslation: true, ...presetsApi.presetPatch('sakura'), resetLayout: true }));
$('basicTab').addEventListener('click', () => setAppearanceTab('basic'));
$('colorsTab').addEventListener('click', () => setAppearanceTab('colors'));
$('typographyTab').addEventListener('click', () => setAppearanceTab('typography'));
for (const name of ['originalColor', 'translationColor', 'backgroundColor']) {
  $(name).addEventListener('input', event => api.updateOverlaySettings({ [name]: event.target.value }));
  $(`${name}Default`).addEventListener('click', () => api.updateOverlaySettings({ [name]: null }));
}
$('fontStyleSelect').addEventListener('change', event => api.updateOverlaySettings({ fontStyle: event.target.value }));
$('textEffectSelect').addEventListener('change', event => api.updateOverlaySettings({ textEffect: event.target.value }));
$('alignmentSelect').addEventListener('change', event => api.updateOverlaySettings({ alignment: event.target.value }));
$('scaleBack').addEventListener('click', () => api.updateOverlaySettings({ scale: settings.scale - 5 }));
$('scaleForward').addEventListener('click', () => api.updateOverlaySettings({ scale: settings.scale + 5 }));
$('opacityRange').addEventListener('input', event => api.updateOverlaySettings({ opacity: 100 - Number(event.target.value) }));
$('themeSelect').addEventListener('change', event => api.updateOverlaySettings({ theme: event.target.value }));
$('translationToggle').addEventListener('change', event => api.updateOverlaySettings({ showTranslation: event.target.checked }));
$('offsetBack').addEventListener('click', () => api.offset(-500));
$('offsetForward').addEventListener('click', () => api.offset(500));
$('importButton').addEventListener('click', () => api.importLyrics());
$('editButton').addEventListener('click', () => api.editLyrics());
$('refreshLyricsButton').addEventListener('click', async () => {
  const result = await api.refreshLyrics();
  if (result?.started && result.manualReview && result.candidates?.length) {
    lyrics = { ...lyrics, candidates: result.candidates };
    candidatePage = 0;
    renderCandidates();
    setView('candidates');
  }
});
$('refreshTranslationButton').addEventListener('click', () => api.refreshTranslation());
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
$('previousPage').addEventListener('click', () => { candidatePage--; renderCandidates(); });
$('nextPage').addEventListener('click', () => { candidatePage++; renderCandidates(); });
$('setupButton').addEventListener('click', async () => {
  if (tosu.installed) await api.startTosu();
  else if (await api.installTosu()) tosu.installed = true;
  renderStatus();
});

api.onState(next => {
  const changedSong = state.song?.key !== next.song?.key || state.song?.recordingKey !== next.song?.recordingKey;
  const changedPhase = state.state !== next.state || state.connected !== next.connected;
  const changedMetadata = state.song?.title !== next.song?.title || state.song?.artist !== next.song?.artist;
  if (changedSong || changedPhase) activeIndex = -2;
  if (changedSong) {
    lyrics = { ...lyrics, lines: [] };
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
  else if (['ready', 'choose', 'error'].includes(next.status) && !next.candidates?.length) showCandidatesAfterSearch = false;
});
api.onTosu(next => { tosu = { ...tosu, ...next }; renderStatus(); });
api.onOverlaySettings(next => { locked = next.locked; if (locked) cancelGestures(); settings = next.settings; lastReportedHeight = -1; renderControls(); renderStyle(); });
api.onOverlayPresence(next => { shown = next.shown; renderPresence(); renderControls(); renderCollapsedToggle(); });
api.onPanelState(next => { panelOpen = next.open; panelSide = next.side; if (!panelOpen) { cancelGestures(); setView('normal'); setEditing(false); } renderControls(); renderCollapsedToggle(); if (currentLayout) applyLayout(currentLayout); });
api.onLayout(applyLayout);

buildPresetSwatches();
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
  setAppearanceTab(appearanceTab);
  renderPresence(); renderStyle(); renderControls(); renderTrack(); renderStatus(); renderCandidates(); renderLyrics(); tick();
});
document.fonts.ready.then(queueLyricMeasure);
