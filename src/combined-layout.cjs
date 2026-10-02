const { overlayDimensions, boundsAtDimensions } = require('./overlay-settings.cjs');

function normalizePanelSize(size, settings) {
  const fallbackWidth = Math.max(560, Math.min(720, overlayDimensions(settings).width));
  const width = Number(size?.width);
  const height = Number(size?.height);
  return {
    width: Number.isFinite(width) ? Math.round(Math.max(500, Math.min(1200, width))) : fallbackWidth,
    height: Number.isFinite(height) ? Math.round(Math.max(370, Math.min(600, height))) : 420,
  };
}

function scaledPanelSize(size, ratio) {
  return {
    width: Math.round(Math.max(500, Math.min(1200, size.width * ratio))),
    height: Math.round(Math.max(370, Math.min(600, size.height * ratio))),
  };
}

function panelResizedLyricBounds(lyric, panel, dimensions, nextPanel, handle, side) {
  const bounds = boundsAtDimensions(lyric, dimensions, handle);
  if (!handle.includes('top') && !handle.includes('bottom')) return bounds;
  const gap = 8;
  if (side === 'above') {
    bounds.y = handle.includes('top') ? lyric.y : lyric.y - panel.height + nextPanel.height;
  } else {
    const oldTop = lyric.y + lyric.height + gap;
    const oldBottom = oldTop + panel.height;
    bounds.y = handle.includes('top')
      ? oldBottom - nextPanel.height - dimensions.height - gap
      : oldTop - dimensions.height - gap;
  }
  return bounds;
}

function panelDimensions(settings, size) {
  const dimensions = normalizePanelSize(size, settings);
  return {
    ...dimensions,
    gap: 8,
    contentScale: 1,
  };
}

function choosePanelSide(lyric, area, settings, size) {
  const panel = panelDimensions(settings, size);
  const above = lyric.y - area.y;
  const below = area.y + area.height - lyric.y - lyric.height;
  const needed = panel.height + panel.gap;
  if (above >= needed && below < needed) return 'above';
  if (below >= needed && above < needed) return 'below';
  return above >= below ? 'above' : 'below';
}

function fitLyricForPanel(lyric, area, settings, side, size) {
  const panel = panelDimensions(settings, size);
  const needed = panel.height + panel.gap;
  let y = lyric.y;
  if (side === 'above') y = Math.max(y, area.y + needed);
  else y = Math.min(y, area.y + area.height - lyric.height - needed);
  return { ...lyric, y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - lyric.height))) };
}

function combinedLayout(lyric, settings, side, progress, area = null, size = null) {
  const panel = panelDimensions(settings, size);
  const amount = Math.max(0, Math.min(1, progress));
  const visiblePanelHeight = Math.round(panel.height * amount);
  const gap = Math.round(panel.gap * amount);
  const width = Math.max(lyric.width, panel.width);
  const preferredX = Math.round(lyric.x);
  const windowX = area && width <= area.width
    ? Math.max(area.x, Math.min(preferredX, area.x + area.width - width))
    : preferredX;
  const lyricX = lyric.x - windowX;
  const panelX = panel.width >= lyric.width ? 0 : lyricX;
  const above = side === 'above';
  const lyricY = above ? visiblePanelHeight + gap : 0;
  return {
    window: {
      x: windowX,
      y: above ? lyric.y - visiblePanelHeight - gap : lyric.y,
      width,
      height: lyric.height + visiblePanelHeight + gap,
    },
    lyric: { x: lyricX, y: lyricY, width: lyric.width, height: lyric.height },
    panel: {
      x: panelX,
      y: above ? 0 : lyric.height + gap,
      width: panel.width,
      height: panel.height,
      visibleHeight: visiblePanelHeight,
      gap,
      contentScale: panel.contentScale,
    },
    side,
    progress: amount,
  };
}

function iconOnlyLayout(layout, area) {
  const width = 56, height = 56;
  const dotX = layout.window.x + layout.lyric.x + 12;
  const dotY = layout.window.y + layout.lyric.y;
  const x = Math.round(Math.max(area.x, Math.min(dotX - 6, area.x + area.width - width)));
  const y = Math.round(Math.max(area.y, Math.min(dotY - 6, area.y + area.height - height)));
  return {
    ...layout,
    window: { x, y, width, height },
    lyric: { ...layout.lyric, x: -6, y: 6 },
    iconOnly: true,
  };
}

function animatedLayout(lyric, settings, side, progress, area = null, size = null) {
  const layout = combinedLayout(lyric, settings, side, 1, area, size);
  const amount = Math.max(0, Math.min(1, progress));
  return {
    ...layout,
    animation: {
      progress: amount,
      opacity: amount,
      dot: { x: layout.lyric.x + 12, y: layout.lyric.y },
    },
  };
}

module.exports = { normalizePanelSize, scaledPanelSize, panelResizedLyricBounds, panelDimensions, choosePanelSide, fitLyricForPanel, combinedLayout, animatedLayout, iconOnlyLayout };
