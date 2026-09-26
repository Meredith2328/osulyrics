(() => {
  const VISUAL_KEYS = ['theme', 'opacity', 'originalColor', 'translationColor', 'backgroundColor', 'fontStyle', 'textEffect', 'alignment'];
  const PRESETS = Object.freeze([
    {
      id: 'clear', name: 'osu! 清爽', hint: '纯文字',
      visual: { theme: 'plain', opacity: 0, originalColor: null, translationColor: null, backgroundColor: null, fontStyle: 'osu', textEffect: 'auto', alignment: 'center' },
      preview: { original: '#ffffff', translation: '#ffffff', background: '#302a38', plain: true },
    },
    {
      id: 'sakura', name: '夜樱', hint: '柔雾 · 粉紫',
      visual: { theme: 'glass', opacity: 54, originalColor: '#fff2fa', translationColor: '#ffabd4', backgroundColor: '#2b1b37', fontStyle: 'osu', textEffect: 'shadow', alignment: 'center' },
      preview: { original: '#fff2fa', translation: '#ffabd4', background: '#2b1b37' },
    },
    {
      id: 'aqua', name: '冰蓝', hint: '柔雾 · 青蓝',
      visual: { theme: 'glass', opacity: 48, originalColor: '#f4ffff', translationColor: '#84e5ff', backgroundColor: '#112c3d', fontStyle: 'clean', textEffect: 'shadow', alignment: 'center' },
      preview: { original: '#f4ffff', translation: '#84e5ff', background: '#112c3d' },
    },
    {
      id: 'focus', name: '聚焦', hint: '高对比',
      visual: { theme: 'contrast', opacity: 75, originalColor: '#ffffff', translationColor: '#ffdb88', backgroundColor: '#080810', fontStyle: 'clean', textEffect: 'outline', alignment: 'center' },
      preview: { original: '#ffffff', translation: '#ffdb88', background: '#080810' },
    },
  ]);

  function presetPatch(id) {
    const preset = PRESETS.find(item => item.id === id);
    return preset ? { ...preset.visual } : null;
  }

  function matchingPreset(settings) {
    return PRESETS.find(preset => VISUAL_KEYS.every(key => settings?.[key] === preset.visual[key]))?.id || null;
  }

  const api = { PRESETS, presetPatch, matchingPreset };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.osuAppearancePresets = api;
})();
