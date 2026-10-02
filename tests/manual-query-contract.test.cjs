const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {LyricsService} = require('../src/lyrics-service.cjs');

const song = {key: 'recording-A', title: 'Song', artist: 'Artist', durationMs: 213000};
const item = id => ({id, trackName: 'Song', artistName: 'Artist', duration: 213, syncedLyrics: '[00:00.61]First lyric\n[00:03.32]Second lyric'});
function fixture(t, requestLyrics) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-manual-query-'));
  const service = new LyricsService(dir, () => {}, {requestLyrics, wait: async () => {}});
  service.song = {...song};
  t.after(() => {
    const target = path.resolve(dir), parent = path.resolve(os.tmpdir());
    if (path.dirname(target) !== parent || !path.basename(target).startsWith('osu-manual-query-')) throw new Error('Unsafe fixture cleanup target');
    fs.rmSync(target, {recursive: true, force: true});
  });
  return {service, dir};
}

test('manual search uses the provider q contract and preserves Unicode query text', async t => {
  const requests = [];
  const query = 'YOASOBI \u30a2\u30a4\u30c9\u30eb & live';
  const {service, dir} = fixture(t, async url => {
    requests.push(String(url));
    // Actual provider observation: unsupported query yields [], supported q yields candidates.
    return new URL(url).searchParams.has('q') ? [item(101)] : [];
  });
  await service.search(query);
  assert.equal(requests.length, 1);
  const params = new URL(requests[0]).searchParams;
  assert.equal(params.get('q'), query);
  assert.equal(params.has('query'), false);
  assert.equal(params.has('track_name'), false);
  assert.equal(service.payload.status, 'choose');
  assert.equal(service.candidates[0].id, 101);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('manual search exposes candidates without replacing saved lyrics or offset', async t => {
  const {service, dir} = fixture(t, async url => new URL(url).searchParams.has('q') ? [item(102)] : []);
  const lines = [{time: 1, original: 'Saved lyric', translation: ''}];
  service.payload = {...service.payload, status: 'ready', lines, offsetMs: 300, source: 'local', selectionMode: 'manual'};
  await service.search('Song');
  assert.equal(service.candidates[0].id, 102);
  assert.equal(service.payload.status, 'ready');
  assert.equal(service.payload.lines, lines);
  assert.equal(service.payload.offsetMs, 300);
  assert.equal(service.payload.source, 'local');
  assert.equal(service.payload.selectionMode, 'manual');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('automatic metadata search and selection keep their original parameters', async t => {
  const requests = [], selections = [];
  const {service} = fixture(t, async url => {requests.push(new URL(url)); return [item(103)];});
  service.select = async (...args) => {selections.push(args); return true;};
  await service.search('');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('track_name'), 'Song');
  assert.equal(requests[0].searchParams.get('artist_name'), 'Artist');
  assert.equal(requests[0].searchParams.has('q'), false);
  assert.deepEqual(selections, [[103, 0, 'auto']]);
});

test('a late first manual search cannot replace the second manual search results', async t => {
  let resolveFirst;
  const firstResponse = new Promise(resolve => {resolveFirst = resolve;});
  const {service} = fixture(t, async url => {
    const params = new URL(url).searchParams;
    const query = params.get('q') || params.get('query');
    return query === 'first' ? firstResponse : [item(202)];
  });
  const first = service.search('first');
  await service.search('second');
  resolveFirst([item(201)]);
  await first;
  assert.equal(service.candidates[0].id, 202);
  assert.equal(service.payload.candidates[0].id, 202);
});
