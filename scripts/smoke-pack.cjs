const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeTosu } = require('../src/osu.cjs');
const { LyricsService } = require('../src/lyrics-service.cjs');

const song = normalizeTosu({ beatmap: {
  id: 1001, set: 765055, checksum: 'pack-smoke', artist: 'Various Artists',
  title: 'osu!mania 6k Starter Pack Vol.1', version: "Choucho - Ashita no Kimi sae Ireba Ii (_IceRain's 9)",
  time: { live: 1000, mp3Length: 303000 },
} }).song;
let finished = false;
const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-pack-smoke-')), data => {
  console.log(JSON.stringify({ status: data.status, source: data.source, lines: data.lines.length, candidates: data.candidates.length }));
  if (finished) return;
  if (data.status === 'ready' && data.lines.length) {
    finished = true;
    service.setSong(null);
    process.exitCode = 0;
  }
  if (data.status === 'error') {
    finished = true;
    service.setSong(null);
    process.exitCode = 1;
  }
});
service.setSong(song);
setTimeout(() => {
  if (!finished) { console.error('Timed out waiting for pack lyrics'); service.setSong(null); process.exitCode = 1; }
}, 65000).unref();
