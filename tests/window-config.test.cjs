const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWindowConfig, persistWindowConfig } = require('../src/window-config.cjs');

test('saves appearance, position and lock state for the next launch', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-window-config-'));
  const file = path.join(folder, 'settings', 'windows.json');
  const config = {
    overlayBounds: { x: 120, y: 460, width: 700, height: 126 },
    overlaySettings: { scale: 135, width: 820, opacity: 40, theme: 'contrast', showTranslation: false, originalColor: '#ffaacc', translationColor: '#00ccff', backgroundColor: '#1f1b28', fontStyle: 'serif', textEffect: 'outline', alignment: 'left' },
    panelSize: { width: 812, height: 487 },
    overlayLocked: true,
    overlayShown: false,
    panelOpen: true,
  };
  persistWindowConfig(file, config);
  assert.deepEqual(loadWindowConfig(file), config);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  persistWindowConfig(file, { ...config, overlayLocked: false });
  assert.equal(loadWindowConfig(file).overlayLocked, false);
  assert.equal(loadWindowConfig(file).overlayShown, false);
  assert.equal(loadWindowConfig(file).panelOpen, true);
  assert.deepEqual(loadWindowConfig(file).panelSize, { width: 812, height: 487 });
  assert.equal(loadWindowConfig(file).overlaySettings.translationColor, '#00ccff');
});

test('a missing or corrupt config falls back safely', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-window-config-'));
  const file = path.join(folder, 'windows.json');
  assert.deepEqual(loadWindowConfig(file), {});
  fs.writeFileSync(file, '{broken', 'utf8');
  assert.deepEqual(loadWindowConfig(file), {});
});
