const test = require('node:test');
const assert = require('node:assert/strict');
const { panelDimensions, scaledPanelSize, panelResizedLyricBounds, choosePanelSide, fitLyricForPanel, combinedLayout, animatedLayout, iconOnlyLayout } = require('../src/combined-layout.cjs');

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

test('very small lyrics keep a minimum readable panel width with aligned left edges', () => {
  const small = { ...settings, scale: 70, width: 480 };
  const lyric = { x: 100, y: 600, width: 336, height: 56 };
  const layout = combinedLayout(lyric, small, 'above', 1);
  assert.equal(layout.panel.width, 560);
  assert.equal(layout.window.x + layout.lyric.x, lyric.x);
  assert.equal(layout.window.x + layout.panel.x, lyric.x);
});

test('a wider panel stays on screen near the display edge without moving lyrics', () => {
  const small = { ...settings, scale: 70, width: 480 };
  const lyric = { x: 20, y: 600, width: 336, height: 56 };
  const layout = combinedLayout(lyric, small, 'above', 1, screen);
  assert.equal(layout.window.x, 20);
  assert.equal(layout.window.x + layout.lyric.x, lyric.x);
  assert.equal(layout.window.x + layout.window.width <= screen.width, true);
});

test('panel border resizing changes both panel dimensions while retaining readable limits', () => {
  assert.deepEqual(scaledPanelSize({ width: 560, height: 420 }, 1.1), { width: 616, height: 462 });
  assert.deepEqual(scaledPanelSize({ width: 560, height: 420 }, .5), { width: 500, height: 370 });
  const custom = { width: 616, height: 462 };
  const layout = combinedLayout({ x: 400, y: 650, width: 616, height: 88 }, settings, 'above', 1, screen, custom);
  assert.equal(layout.panel.width, 616);
  assert.equal(layout.panel.height, 462);
  assert.equal(layout.window.y + layout.lyric.y, 650);
});

test('top and bottom panel borders keep the opposite panel edge fixed', () => {
  const lyric = { x: 20, y: 695, width: 560, height: 64 };
  const panel = { width: 560, height: 420 };
  const enlarged = { width: 616, height: 462 };
  const dimensions = { width: 616, height: 70 };
  const oldTop = lyric.y - panel.height - 8;
  const oldBottom = lyric.y - 8;
  const fromTop = panelResizedLyricBounds(lyric, panel, dimensions, enlarged, 'top', 'above');
  const fromBottom = panelResizedLyricBounds(lyric, panel, dimensions, enlarged, 'bottom', 'above');
  assert.equal(fromTop.y - 8, oldBottom);
  assert.equal(fromBottom.y - enlarged.height - 8, oldTop);
  const below = { ...lyric, y: 40 };
  const belowTop = below.y + below.height + 8;
  const belowBottom = belowTop + panel.height;
  const fromBelowTop = panelResizedLyricBounds(below, panel, dimensions, enlarged, 'top', 'below');
  const fromBelowBottom = panelResizedLyricBounds(below, panel, dimensions, enlarged, 'bottom', 'below');
  assert.equal(fromBelowTop.y + fromBelowTop.height + 8 + enlarged.height, belowBottom);
  assert.equal(fromBelowBottom.y + fromBelowBottom.height + 8, belowTop);
});

for (const side of ['above', 'below']) test(`v2 ${side} opacity frames retain panel, lyric and orb geometry`, () => {
  const lyric = { x: 400, y: side === 'above' ? 650 : 40, width: 700, height: 80 };
  const frames = [0, 83/167, 1, .251, 0].map(progress => animatedLayout(lyric, settings, side, progress, screen));
  for (const frame of frames) {
    assert.deepEqual(frame.window, frames[0].window);
    assert.deepEqual(frame.panel, frames[0].panel);
    assert.deepEqual(frame.lyric, frames[0].lyric);
    assert.deepEqual(frame.animation.dot, frames[0].animation.dot);
    assert.equal(frame.window.x + frame.animation.dot.x + 22, lyric.x + 34);
    assert.equal(frame.window.y + frame.animation.dot.y + 22, lyric.y + 22);
    assert.equal(frame.window.y + frame.lyric.y, lyric.y);
    assert.equal(frame.animation.panelScale, undefined);
  }
  assert.equal(frames[1].animation.opacity, 83/167);
  assert.equal(frames[2].animation.opacity, 1);
});

test('with no lyric and a collapsed panel, only the note icon occupies the window', () => {
  const lyric = { x: 400, y: 650, width: 700, height: 80 };
  const normal = combinedLayout(lyric, settings, 'above', 0, screen);
  const compact = iconOnlyLayout(normal, screen);
  assert.deepEqual(compact.window, { x: 406, y: 644, width: 56, height: 56 });
  assert.equal(compact.window.x + compact.lyric.x + 12, lyric.x + 12);
  assert.equal(compact.window.y + compact.lyric.y , lyric.y);
  assert.equal(compact.iconOnly, true);
});

test('an offscreen saved lyric position cannot hide the collapsed note icon', () => {
  const lyric = { x: -580, y: 650, width: 700, height: 80 };
  const compact = iconOnlyLayout(combinedLayout(lyric, settings, 'above', 0, screen), screen);
  assert.ok(compact.window.x >= screen.x);
  assert.ok(compact.window.x + compact.window.width <= screen.x + screen.width);
});
