const fs = require('node:fs');
const path = require('node:path');

function loadWindowConfig(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function persistWindowConfig(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}

module.exports = { loadWindowConfig, persistWindowConfig };
