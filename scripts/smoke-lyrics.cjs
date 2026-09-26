const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LyricsService } = require('../src/lyrics-service.cjs');

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-smoke-'));
let finished = false;
const service = new LyricsService(folder, state => {
  console.log(JSON.stringify({ status: state.status, lines: state.lines.length, source: state.source, translation: state.translationSource, candidates: state.candidates.length }));
  if (!finished && state.lines.length && state.translationSource === '机器翻译') {
    finished = true;
    service.setSong(null);
    process.exitCode = 0;
  }
});
service.setSong({ key: 'smoke', set: 1, title: 'unravel', romanizedTitle: 'unravel', artist: 'TK from Ling tosite sigure', romanizedArtist: 'TK from Ling tosite sigure', durationMs: 229000, lastObjectMs: 225000 });
setTimeout(() => {
  if (!finished) { console.error('Timed out waiting for translated lyrics'); service.setSong(null); process.exitCode = 1; }
}, 45000).unref();
