const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings, overlayDimensions, requiredLyricHeight, draggedBounds, styleBoundsAtAnchor, resizeFromHandle } = require('../src/overlay-settings.cjs');

test('loads sensible defaults and rejects invalid saved values', () => {
  assert.deepEqual(normalizeOverlaySettings(), DEFAULT_OVERLAY_SETTINGS);
  assert.deepEqual(normalizeOverlaySettings({ scale: 500, width: 100, opacity: -4, theme: 'unknown', showTranslation: false }), {
    scale: 160, width: 480, opacity: 0, theme: 'plain', showTranslation: false,
  });
});

test('scaling and translation visibility change the overlay window size', () => {
  assert.deepEqual(overlayDimensions(DEFAULT_OVERLAY_SETTINGS), { width: 700, height: 80 });
  assert.deepEqual(overlayDimensions({ scale: 150, width: 820, opacity: 40, theme: 'plain', showTranslation: false }), { width: 1230, height: 72 });
});

test('wrapped lyrics gain height without making short lines taller', () => {
  const small = { ...DEFAULT_OVERLAY_SETTINGS, scale: 80 };
  assert.equal(requiredLyricHeight(small, 48), 64);
  assert.equal(requiredLyricHeight(small, 78), 78);
  assert.equal(requiredLyricHeight(small, 1000), 240);
});

test('moves the lyric window by the pointer delta', () => {
  assert.deepEqual(draggedBounds({ x: 50, y: 600, width: 700, height: 126 }, { x: 400, y: 650 }, { x: 460, y: 620 }), { x: 110, y: 570 });
});

test('style resizing keeps the lyric window centered horizontally and fixed vertically', () => {
  assert.deepEqual(styleBoundsAtAnchor({ centerX: 450, topY: 600 }, { width: 900, height: 170 }), { x: 0, y: 600, width: 900, height: 170 });
  assert.deepEqual(styleBoundsAtAnchor({ centerX: 450, topY: 600 }, { width: 600, height: 100 }), { x: 150, y: 600, width: 600, height: 100 });
});

test('a right-edge handle scales width and height together while keeping the left edge fixed', () => {
  const start = { x: 100, y: 500, width: 700, height: 80 };
  const settings = { ...DEFAULT_OVERLAY_SETTINGS };
  const result = resizeFromHandle(start, settings, { x: 700, y: 560 }, { x: 770, y: 520 }, 'right');
  assert.equal(result.bounds.x, 100);
  assert.equal(result.bounds.width, 770);
  assert.equal(result.bounds.height, 88);
  assert.equal(result.bounds.y, 496);
  assert.equal(result.settings.scale, 110);
});

test('corner resize changes dimensions from the opposite anchored corner', () => {
  const start = { x: 100, y: 500, width: 700, height: 80 };
  const settings = { ...DEFAULT_OVERLAY_SETTINGS };
  const result = resizeFromHandle(start, settings, { x: 100, y: 500 }, { x: 30, y: 492 }, 'top-left');
  assert.equal(result.bounds.x + result.bounds.width, 800);
  assert.equal(result.bounds.y + result.bounds.height, 580);
  assert.equal(result.settings.width, 700);
  assert.ok(result.settings.scale > 100);
});
