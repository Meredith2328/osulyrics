const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeTosu } = require('../src/osu.cjs');
const { LyricsService, fileId, legacyFileId } = require('../src/lyrics-service.cjs');

function song(audio = 'a\\ab\\abc') {
  return normalizeTosu({
    beatmap: { checksum: 'map-a', set: 123, artist: 'Artist', title: 'Song', version: 'Hard', time: { mp3Length: 194000 } },
    folders: { beatmap: '.' }, files: { audio },
  }).song;
}

function service(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-legacy-cache-'));
  const s = new LyricsService(folder, () => {}, { requestLyrics: async () => [], wait: async () => {} });
  s.waitForMetadata = async () => true;
  s.translate = async () => {};
  t.after(async () => { await s.setSong(null); fs.rmSync(folder, { recursive: true, force: true }); });
  return { s, folder };
}

test('lyrics and offset saved under the 0.4.12 cache name are adopted', async t => {
  const { s, folder } = service(t);
  const old = legacyFileId(song());
  assert.notEqual(old, fileId(song()));
  fs.writeFileSync(path.join(folder, `${old}.lrc`), '[00:01.00]Imported earlier\n');
  fs.writeFileSync(path.join(folder, `${old}.json`), JSON.stringify({ source: '本地 LRC', selectionMode: 'manual', offsetMs: 1500 }));
  await s.setSong(song());
  assert.equal(s.payload.offsetMs, 1500);
  assert.deepEqual(s.payload.lines.map(l => l.original), ['Imported earlier']);
  assert.ok(fs.existsSync(path.join(folder, `${old}.lrc`)), 'legacy file kept');
});

test('an existing cache under the new name is never overwritten', async t => {
  const { s, folder } = service(t);
  const old = legacyFileId(song()), now = fileId(song());
  fs.writeFileSync(path.join(folder, `${old}.lrc`), '[00:01.00]Old\n');
  fs.writeFileSync(path.join(folder, `${now}.lrc`), '[00:01.00]New\n');
  await s.setSong(song());
  assert.deepEqual(s.payload.lines.map(l => l.original), ['New']);
});

test('each recording in the same package inherits the shared legacy cache once', async t => {
  const { s, folder } = service(t);
  const old = legacyFileId(song());
  fs.writeFileSync(path.join(folder, `${old}.lrc`), '[00:01.00]Shared\n');
  await s.setSong(song('a\\ab\\full'));
  s.importText('[00:01.00]Edited full');
  await s.setSong(song('b\\bc\\short'));
  assert.deepEqual(s.payload.lines.map(l => l.original), ['Shared']);
  await s.setSong(song('a\\ab\\full'));
  assert.deepEqual(s.payload.lines.map(l => l.original), ['Edited full']);
});
