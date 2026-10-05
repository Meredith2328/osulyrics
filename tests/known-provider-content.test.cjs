const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { parseLrc } = require('../src/lyrics.cjs');

// Use invented text to exercise the confirmed-content fingerprint without
// committing copyrighted provider lyrics. A private replay checks the real body.
const wrong = '[00:01.00]別の曲の架空の歌詞です\n[00:03.00]ここはテスト専用の文章です\n';
const correct = '[00:01.00]この曲の架空の歌詞です\n[00:03.00]こちらもテスト専用の文章です\n';
const fixtureHash = crypto.createHash('sha256').update(JSON.stringify(parseLrc(wrong).map(x => x.original))).digest('hex');
const filename = require.resolve('../src/lyrics-service.cjs');
const isolated = new Module(filename, module);
isolated.filename = filename;
isolated.paths = module.paths;
isolated._compile(fs.readFileSync(filename, 'utf8').replace('3c517a6581e7fec384eb05e59392bd534f8dd133a3c25b6ea422cce55285a2a6', fixtureHash), filename);
const { LyricsService, fileId } = isolated.exports;

const song = { key: 'full-map', set: 1982752, audioFile: 'full.ogg', title: 'アイドル',
  romanizedTitle: 'Idol', artist: 'YOASOBI', romanizedArtist: 'YOASOBI', durationMs: 213234 };
const candidate = (id, text) => ({ id, trackName: 'アイドル', artistName: 'YOASOBI', duration: 213, syncedLyrics: text });
function service(t, results = []) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-provider-content-'));
  const s = new LyricsService(folder, () => {}, { requestLyrics: async () => results, wait: async () => {} });
  s.waitForMetadata = async () => true;
  s.translate = async () => {};
  t.after(async () => { await s.setSong(null); fs.rmSync(folder, { recursive: true, force: true }); });
  return s;
}
function cache(s, meta) {
  fs.writeFileSync(path.join(s.folder, fileId(song) + '.lrc'), wrong);
  fs.writeFileSync(path.join(s.folder, fileId(song) + '.json'), JSON.stringify(meta));
}

test('confirmed wrong content is excluded despite matching title, artist and duration', async t => {
  const s = service(t, [candidate(37100334, wrong), candidate(3818936, correct)]);
  await s.setSong(song);
  assert.deepEqual(s.candidates.map(x => x.id), [3818936]);
  assert.equal(s.payload.lines[0].original, parseLrc(correct)[0].original);
  assert.equal(s.readMeta().selectedId, 3818936);
});

test('known wrong automatic cache is recovered while retaining its manual offset', async t => {
  const s = service(t, [candidate(3818936, correct)]);
  cache(s, { source: 'LRCLIB', selectionMode: 'auto', selectedId: 37100334, audioDurationMs: 213234, offsetMs: 1250 });
  await s.setSong(song);
  assert.equal(s.payload.lines[0].original, parseLrc(correct)[0].original);
  assert.equal(s.readMeta().offsetMs, 1250);
  assert.equal(s.readMeta().selectedId, 3818936);
});

test('an invalid source alone leaves no displayed lyrics and does not bless the invalid cache on refresh', async t => {
  const s = service(t, [candidate(37100334, wrong)]);
  cache(s, { source: 'LRCLIB', selectionMode: 'auto', selectedId: 37100334, audioDurationMs: 213234 });
  await s.setSong(song);
  assert.deepEqual(s.payload.lines, []);
  assert.deepEqual(s.payload.candidates, []);
  await s.refreshLyrics();
  assert.deepEqual(s.payload.lines, []);
  assert.equal(s.readMeta().selectionMode, 'auto');
  assert.equal(fs.readFileSync(s.paths().lrc, 'utf8'), wrong);
});

test('direct selection of confirmed wrong content cannot write or change the current selection', async t => {
  const s = service(t);
  s.song = song;
  s.importText(correct);
  const previous = fs.readFileSync(s.paths().meta, 'utf8');
  s.candidates = [candidate(37100334, wrong)];
  assert.equal(await s.select(37100334), false);
  assert.equal(fs.readFileSync(s.paths().meta, 'utf8'), previous);
  assert.equal(fs.readFileSync(s.paths().lrc, 'utf8'), correct);
});

test('a corrected provider body remains usable under the same ID and replaces an invalid in-memory body', async t => {
  const s = service(t);
  s.song = song;
  cache(s, { source: 'LRCLIB', selectionMode: 'auto', selectedId: 37100334 });
  s.payload.lines = parseLrc(wrong);
  s.candidates = [candidate(37100334, correct)];
  assert.equal(await s.select(37100334, s.generation, 'auto'), true);
  assert.equal(s.payload.lines[0].original, parseLrc(correct)[0].original);
  assert.equal(fs.readFileSync(s.paths().lrc, 'utf8'), correct);
});

test('explicitly imported or manually edited text is preserved', async t => {
  const s = service(t);
  cache(s, { source: '本地 LRC', selectionMode: 'manual', offsetMs: -250 });
  await s.setSong(song);
  assert.equal(s.payload.lines[0].original, parseLrc(wrong)[0].original);
  assert.equal(s.readMeta().offsetMs, -250);
});

test('the same content is allowed for the song it actually belongs to', async t => {
  const item = { ...candidate(1, wrong), trackName: 'Mesmerizer', artistName: '32ki', duration: 213 };
  const s = service(t, [item]);
  await s.setSong({ ...song, title: 'Mesmerizer', romanizedTitle: 'Mesmerizer', artist: '32ki', romanizedArtist: '32ki' });
  assert.equal(s.readMeta().selectedId, 1);
  assert.equal(s.payload.lines[0].original, parseLrc(wrong)[0].original);
});

test('a page of bad native-title clones does not stop the existing search before another variant', async t => {
  const s = service(t);
  const calls = [];
  s.requestLyrics = async url => {
    calls.push(url.searchParams.get('track_name'));
    return calls.length === 1 ? Array.from({ length: 20 }, (_, i) => candidate(100 + i, wrong)) : [candidate(3818936, correct)];
  };
  await s.setSong(song);
  assert.ok(calls.length >= 2);
  assert.equal(s.readMeta().selectedId, 3818936);
});

test('confirmed source corruption tries the documented alternate route before choosing a different language', async t => {
  const s = service(t);
  const english = { ...candidate(2, '[00:01.00]Invented English test line\n[00:03.00]Another invented test line'), trackName: 'Idol' };
  let alternateQuery;
  s.requestLyrics = async url => {
    if (url.searchParams.has('q')) { alternateQuery = url.searchParams.get('q'); return [candidate(3818936, correct)]; }
    return url.searchParams.get('track_name') === 'Idol' ? [english] : [candidate(37100334, wrong)];
  };
  await s.setSong(song);
  assert.equal(alternateQuery, 'YOASOBI Idol');
  assert.equal(s.readMeta().selectedId, 3818936);
});
