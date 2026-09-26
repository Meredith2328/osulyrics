const { overlayDimensions } = require('./overlay-settings.cjs');

function panelDimensions(settings) {
  return {
    width: Math.max(560, Math.min(720, overlayDimensions(settings).width)),
    height: 420,
    gap: 8,
    contentScale: 1,
  };
}

function choosePanelSide(lyric, area, settings) {
  const panel = panelDimensions(settings);
  const above = lyric.y - area.y;
  const below = area.y + area.height - lyric.y - lyric.height;
  const needed = panel.height + panel.gap;
  if (above >= needed && below < needed) return 'above';
  if (below >= needed && above < needed) return 'below';
  return above >= below ? 'above' : 'below';
}

function fitLyricForPanel(lyric, area, settings, side) {
  const panel = panelDimensions(settings);
  const needed = panel.height + panel.gap;
  let y = lyric.y;
  if (side === 'above') y = Math.max(y, area.y + needed);
  else y = Math.min(y, area.y + area.height - lyric.height - needed);
  return { ...lyric, y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - lyric.height))) };
}

function combinedLayout(lyric, settings, side, progress, area = null) {
  const panel = panelDimensions(settings);
  const amount = Math.max(0, Math.min(1, progress));
  const visiblePanelHeight = Math.round(panel.height * amount);
  const gap = Math.round(panel.gap * amount);
  const width = Math.max(lyric.width, panel.width);
  const centeredX = Math.round(lyric.x + lyric.width / 2 - width / 2);
  const windowX = area && width <= area.width
    ? Math.max(area.x, Math.min(centeredX, area.x + area.width - width))
    : centeredX;
  const lyricX = lyric.x - windowX;
  const panelX = Math.round((width - panel.width) / 2);
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

module.exports = { panelDimensions, choosePanelSide, fitLyricForPanel, combinedLayout };
