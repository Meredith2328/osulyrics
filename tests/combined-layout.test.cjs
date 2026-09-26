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

test('large lyrics keep the panel at a readable size without scaling its controls', () => {
  const lyric = { x: 400, y: 650, width: 1260, height: 112 };
  const scaled = { ...settings, scale: 140, width: 900 };
  const layout = combinedLayout(lyric, scaled, 'above', 1);
  assert.equal(layout.window.y + layout.lyric.y, lyric.y);
  assert.equal(layout.panel.width, 720);
  assert.equal(layout.panel.height, 420);
  assert.equal(layout.panel.contentScale, 1);
});

test('at small lyric sizes the control stays full width with readable minimum scale', () => {
  const small = { ...settings, scale: 80 };
  const lyric = { x: 100, y: 600, width: 560, height: 64 };
  const panel = panelDimensions(small);
  assert.equal(panel.width, lyric.width);
  assert.equal(panel.height, 420);
  assert.equal(panel.contentScale, 1);
  const layout = combinedLayout(lyric, small, 'above', 1);
  assert.equal(layout.window.width, lyric.width);
  assert.equal(layout.panel.width, layout.lyric.width);
});

test('very small lyrics keep a minimum readable panel width and centered anchor', () => {
  const small = { ...settings, scale: 70, width: 480 };
  const lyric = { x: 100, y: 600, width: 336, height: 56 };
  const layout = combinedLayout(lyric, small, 'above', 1);
  assert.equal(layout.panel.width, 560);
  assert.equal(layout.window.x + layout.lyric.x, lyric.x);
  assert.equal(layout.window.x + layout.panel.x + layout.panel.width / 2, lyric.x + lyric.width / 2);
});

test('a wider panel stays on screen near the display edge without moving lyrics', () => {
  const small = { ...settings, scale: 70, width: 480 };
  const lyric = { x: 20, y: 600, width: 336, height: 56 };
  const layout = combinedLayout(lyric, small, 'above', 1, screen);
  assert.equal(layout.window.x, 0);
  assert.equal(layout.window.x + layout.lyric.x, lyric.x);
  assert.equal(layout.window.x + layout.window.width <= screen.width, true);
});
