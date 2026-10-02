const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeTosu } = require('../src/osu.cjs');
const { LyricsService, fileId } = require('../src/lyrics-service.cjs');

function song({ folder = 'Pack A', audio = 'full.mp3', checksum = 'map-a', set = -1, compilation = false } = {}) {
  return normalizeTosu({
    beatmap: { checksum, set, artist: compilation ? 'Various Artists' : 'Artist',
      title: compilation ? 'Compilation Pack' : 'Same Song', version: compilation ? 'Artist - Same Song' : 'Hard',
      time: { mp3Length: 194000 } },
    folders: { beatmap: folder }, files: { audio },
  }).song;
}

function service(t, options = {}) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-song-identity-'));
  const s = new LyricsService(folder, () => {}, { requestLyrics: async () => [], wait: async () => {}, ...options });
  s.waitForMetadata = async () => true;
  s.translate = async () => {};
  t.after(async () => { await s.setSong(null); fs.rmSync(folder, { recursive: true, force: true }); });
  return s;
}

test('same-name imports in different packages isolate lyrics and manual offsets', async t => {
  const s = service(t);
  const a = song();
  const b = song({ folder: 'Pack B', audio: 'short.mp3', checksum: 'map-b' });
  await s.setSong(a);
  s.importText('[00:01.00]Full recording');
  s.setOffset(2000);
  const savedPath = s.paths().lrc;
  await s.setSong(b);
  assert.notEqual(s.paths().lrc, savedPath);
  assert.equal(s.payload.offsetMs, 0);
  assert.deepEqual(s.payload.lines, []);
  s.importText('[00:01.00]Short recording');
  s.setOffset(-500);
  await s.setSong(a);
  assert.equal(s.payload.lines[0].original, 'Full recording');
  assert.equal(s.payload.offsetMs, 2000);
  await s.setSong(b);
  assert.equal(s.payload.lines[0].original, 'Short recording');
  assert.equal(s.payload.offsetMs, -500);
});

test('same-package same-audio difficulties share a cache but different audio does not', () => {
  assert.equal(fileId(song()), fileId(song({ checksum: 'other-difficulty' })));
  assert.notEqual(fileId(song()), fileId(song({ audio: 'short.mp3' })));
  assert.notEqual(fileId(song({ set: 42 })), fileId(song({ set: 42, audio: 'short.mp3' })));
  assert.notEqual(fileId(song({ compilation: true })), fileId(song({ compilation: true, folder: 'Pack B' })));
});

test('lazer content-addressed audio shares within a set but isolates different sets', () => {
  const a = song({ folder: '.', audio: 'a/ab/abc-audio-hash', set: 42 });
  assert.equal(fileId(a), fileId(song({ folder: '.', audio: 'a/ab/abc-audio-hash', set: 42, checksum: 'other-difficulty' })));
  assert.notEqual(fileId(a), fileId(song({ folder: '.', audio: 'a/ab/abc-audio-hash', set: 43 })));
});

test('missing audio/package identity falls back to the map instead of title or set', () => {
  const a = song({ folder: '.', audio: '.', set: 42 });
  assert.notEqual(fileId(a), fileId(song({ folder: '.', audio: '.', set: 42, checksum: 'map-b' })));
  assert.notEqual(fileId(song({ folder: '.', audio: 'a/ab/hash' })), fileId(song({ folder: '.', audio: 'a/ab/hash', checksum: 'map-b' })));
});

test('a late same-name search cannot overwrite the newly selected package', async t => {
  let finishOld;
  const s = service(t, { requestLyrics: () => new Promise(resolve => { finishOld = resolve; }) });
  const a = song();
  const b = song({ folder: 'Pack B', audio: 'short.mp3', checksum: 'map-a' });
  s.song = a;
  const searching = s.search();
  const oldGeneration = s.generation;
  s.requestLyrics = async () => [];
  await s.setSong(b);
  assert.ok(s.generation > oldGeneration);
  s.importText('[00:01.00]New package lyrics');
  finishOld([{ id: 1, trackName: 'Same Song', artistName: 'Artist', duration: 194,
    syncedLyrics: '[00:01.00]Old package lyrics' }]);
  await searching;
  assert.equal(s.payload.lines[0].original, 'New package lyrics');
  assert.equal(fs.readFileSync(s.paths().lrc, 'utf8'), '[00:01.00]New package lyrics\n');
});
