const test = require('node:test');
const assert = require('node:assert/strict');
const { panelDimensions, choosePanelSide, fitLyricForPanel, combinedLayout } = require('../src/combined-layout.cjs');

const settings = { scale: 100, width: 700, opacity: 0, theme: 'plain', showTranslation: true };
const screen = { x: 0, y: 0, width: 1920, height: 900 };

test('chooses the side with room and keeps the lyric in the same screen position while opening', () => {
  const lyric = { x: 400, y: 650, width: 700, height: 126 };
  assert.equal(choosePanelSide(lyric, screen, settings), 'above');
  const closed = combinedLayout(lyric, settings, 'above', 0);
  const halfway = combinedLayout(lyric, settings, 'above', .5);
  const opened = combinedLayout(lyric, settings, 'above', 1);
  assert.deepEqual(closed.window, lyric);
  assert.equal(halfway.window.y + halfway.lyric.y, lyric.y);
  assert.equal(opened.window.y + opened.lyric.y, lyric.y);
  assert.equal(opened.window.x + opened.lyric.x, lyric.x);
  assert.equal(opened.panel.height, panelDimensions(settings).height);
});

test('opens below when the lyric is near the top', () => {
  const lyric = { x: 400, y: 40, width: 700, height: 126 };
  assert.equal(choosePanelSide(lyric, screen, settings), 'below');
  const opened = combinedLayout(lyric, settings, 'below', 1);
  assert.equal(opened.window.y, lyric.y);
  assert.equal(opened.lyric.y, 0);
});

test('moves the lyric only as far as needed when neither side fits', () => {
  const lyric = { x: 400, y: 250, width: 700, height: 126 };
  const area = { x: 0, y: 0, width: 1200, height: 650 };
  const side = choosePanelSide(lyric, area, settings);
  const fitted = fitLyricForPanel(lyric, area, settings, side);
  const layout = combinedLayout(fitted, settings, side, 1);
  assert.ok(layout.window.y >= area.y);
  assert.ok(layout.window.y + layout.window.height <= area.y + area.height);
  assert.ok(Math.abs(fitted.y - lyric.y) <= panelDimensions(settings).height + 8);
});

test('control panel and lyric scale together without changing the lyric anchor', () => {
  const lyric = { x: 400, y: 650, width: 1260, height: 112 };
  const scaled = { ...settings, scale: 140, width: 900 };
  const layout = combinedLayout(lyric, scaled, 'above', 1);
  assert.equal(layout.window.y + layout.lyric.y, lyric.y);
  assert.equal(layout.panel.width, lyric.width);
  assert.equal(layout.panel.height, Math.round(260 * 1.4));
});

test('at small lyric sizes the control stays full width with readable minimum scale', () => {
  const small = { ...settings, scale: 80 };
  const lyric = { x: 100, y: 600, width: 560, height: 64 };
  const panel = panelDimensions(small);
  assert.equal(panel.width, lyric.width);
  assert.equal(panel.height, 260);
  assert.equal(panel.contentScale, 1);
  const layout = combinedLayout(lyric, small, 'above', 1);
  assert.equal(layout.window.width, lyric.width);
  assert.equal(layout.panel.width, layout.lyric.width);
});
