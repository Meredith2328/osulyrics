const DEFAULT_OVERLAY_SETTINGS = Object.freeze({
  scale: 100,
  width: 700,
  opacity: 0,
  theme: 'plain',
  showTranslation: true,
});

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}

function normalizeOverlaySettings(input = {}) {
  return {
    scale: clampNumber(input.scale, DEFAULT_OVERLAY_SETTINGS.scale, 70, 160),
    width: clampNumber(input.width, DEFAULT_OVERLAY_SETTINGS.width, 480, 1100),
    opacity: clampNumber(input.opacity, DEFAULT_OVERLAY_SETTINGS.opacity, 0, 95),
    theme: ['glass', 'plain', 'contrast'].includes(input.theme) ? input.theme : DEFAULT_OVERLAY_SETTINGS.theme,
    showTranslation: input.showTranslation === false ? false : true,
  };
}

function overlayDimensions(settings) {
  return {
    width: Math.round(settings.width * settings.scale / 100),
    height: Math.round((settings.showTranslation ? 80 : 48) * settings.scale / 100),
  };
}

function requiredLyricHeight(settings, measuredHeight) {
  const base = overlayDimensions(settings).height;
  return Math.max(base, Math.min(240, Math.ceil(Number(measuredHeight) || 0)));
}

function draggedBounds(bounds, startPointer, pointer) {
  return {
    x: Math.round(bounds.x + pointer.x - startPointer.x),
    y: Math.round(bounds.y + pointer.y - startPointer.y),
  };
}

function styleBoundsAtAnchor(anchor, dimensions) {
  return {
    x: Math.round(anchor.centerX - dimensions.width / 2),
    y: Math.round(anchor.topY),
    width: dimensions.width,
    height: dimensions.height,
  };
}

function resizeRatioFromHandle(bounds, startPointer, pointer, handle) {
  const dx = pointer.x - startPointer.x;
  const dy = pointer.y - startPointer.y;
  const left = handle.includes('left');
  const right = handle.includes('right');
  const top = handle.includes('top');
  const bottom = handle.includes('bottom');
  const horizontalDelta = left ? -dx / bounds.width : right ? dx / bounds.width : 0;
  const verticalDelta = top ? -dy / bounds.height : bottom ? dy / bounds.height : 0;
  return Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta;
}

function boundsAtDimensions(bounds, dimensions, handle) {
  const left = handle.includes('left');
  const right = handle.includes('right');
  const top = handle.includes('top');
  const bottom = handle.includes('bottom');
  const width = dimensions.width;
  const height = dimensions.height;
  return {
    x: left ? bounds.x + bounds.width - width : right ? bounds.x : Math.round(bounds.x + (bounds.width - width) / 2),
    y: top ? bounds.y + bounds.height - height : bottom ? bounds.y : Math.round(bounds.y + (bounds.height - height) / 2),
    width,
    height,
  };
}

function resizeFromHandle(bounds, settings, startPointer, pointer, handle) {
  const ratio = resizeRatioFromHandle(bounds, startPointer, pointer, handle);
  const next = normalizeOverlaySettings({
    ...settings,
    scale: settings.scale * (1 + ratio),
  });
  const dimensions = overlayDimensions(next);
  return {
    settings: next,
    bounds: boundsAtDimensions(bounds, dimensions, handle),
  };
}

module.exports = { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings, overlayDimensions, requiredLyricHeight, draggedBounds, styleBoundsAtAnchor, resizeRatioFromHandle, boundsAtDimensions, resizeFromHandle };
