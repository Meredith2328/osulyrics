const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings } = require('../src/overlay-settings.cjs');
const { PRESETS, presetPatch, matchingPreset } = require('../src/appearance-presets.js');

test('presets offer distinct complete visual choices and preserve song controls', () => {
  assert.equal(PRESETS.length, 4);
  assert.equal(new Set(PRESETS.map(preset => preset.id)).size, PRESETS.length);
  const unchanged = { ...DEFAULT_OVERLAY_SETTINGS, scale: 80, width: 900, showTranslation: false };
  for (const preset of PRESETS) {
    const patch = presetPatch(preset.id);
    assert.deepEqual(Object.keys(patch).sort(), ['alignment', 'backgroundColor', 'fontStyle', 'opacity', 'originalColor', 'textEffect', 'theme', 'translationColor'].sort());
    const next = normalizeOverlaySettings({ ...unchanged, ...patch });
    assert.equal(next.scale, 80);
    assert.equal(next.width, 900);
    assert.equal(next.showTranslation, false);
    assert.equal(matchingPreset(next), preset.id);
  }
});

test('the current custom appearance is not mislabeled as a preset', () => {
  assert.equal(matchingPreset(normalizeOverlaySettings()), 'clear');
  const custom = normalizeOverlaySettings({ ...DEFAULT_OVERLAY_SETTINGS, originalColor: '#ffcc22' });
  assert.equal(matchingPreset(custom), null);
  assert.equal(presetPatch('not-a-preset'), null);
});
