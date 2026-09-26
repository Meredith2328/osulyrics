const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTosu, advancePosition, shouldDisplayLyrics } = require('../src/osu.cjs');
const { fileId } = require('../src/lyrics-service.cjs');
const { LyricsService } = require('../src/lyrics-service.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('reads the current lazer beatmap and playback position from tosu v2', () => {
  const state = normalizeTosu({
    state: { name: 'Play' },
    beatmap: { id: 123, set: 456, checksum: 'abc', artist: 'A', artistUnicode: '歌手', title: 'Song', titleUnicode: '曲', version: 'Hard', time: { live: 43210, lastObject: 95000, mp3Length: 104000 } },
    play: { mods: { name: 'DT' } },
  }, 1000);
  assert.equal(state.song.title, '曲');
  assert.equal(state.song.artist, '歌手');
  assert.equal(state.positionMs, 43210);
  assert.equal(state.song.lastObjectMs, 95000);
  assert.equal(state.song.durationMs, 104000);
  assert.equal(state.song.key, 'abc');
});

test('does not advance paused playback and resets on retry', () => {
  const paused = normalizeTosu({ state: { name: 'play' }, game: { paused: true }, beatmap: { artist: 'A', title: 'Song', time: { live: 42000 } } }, 1000);
  assert.equal(paused.playing, false);
  assert.equal(advancePosition(paused, 1500), 42000);
  assert.equal(advancePosition({ positionMs: 1000, sampledAt: 1000, connected: true, playing: true, rate: 1 }, 1100), 1100);
  assert.equal(advancePosition({ positionMs: 1000, sampledAt: 1000, connected: true, playing: true, rate: 1 }, 3000), 1180);
});

test('interpolates only briefly and uses the active gameplay clock rate', () => {
  const state = normalizeTosu({
    state: { name: 'play' }, game: { paused: false },
    beatmap: { artist: 'A', title: 'Song', time: { live: 30000 } },
    play: { mods: { rate: 1.5 } },
  }, 1000);
  assert.equal(state.rate, 1.5);
  assert.equal(advancePosition(state, 1120), 30180);
  assert.equal(advancePosition({ ...state, positionMs: 12000, sampledAt: 2000 }, 2100), 12150);
});

test('holds lyrics on pause but clears them at the audio end or results screen', () => {
  const song = { durationMs: 90000 };
  assert.equal(shouldDisplayLyrics({ connected: true, state: 'play', song, playing: false }, 42000), true);
  assert.equal(shouldDisplayLyrics({ connected: true, state: 'play', song }, 89999), true);
  assert.equal(shouldDisplayLyrics({ connected: true, state: 'play', song }, 90000), false);
  assert.equal(shouldDisplayLyrics({ connected: true, state: 'selectPlay', song }, 90000), false);
  assert.equal(shouldDisplayLyrics({ connected: true, state: 'resultsScreen', song }, 42000), false);
});

test('treats song selection as timed audio playback', () => {
  const state = normalizeTosu({
    state: { name: 'selectPlay' },
    beatmap: { id: 7, checksum: 'preview', artist: 'A', title: 'Song', version: 'Hard', time: { live: 35500, mp3Length: 120000 } },
  }, 1000);
  assert.equal(state.playing, true);
  assert.equal(state.positionMs, 35500);
  assert.equal(state.rate, 1);
  assert.equal(advancePosition(state, 1100), 35600);
});

test('uses a pack difficulty as the real song metadata', () => {
  const data = {
    state: { name: 'Play' },
    beatmap: { id: 1001, set: 765055, checksum: 'map-one', artist: 'Various Artists', title: 'osu!mania 6k Starter Pack Vol.1', version: "Choucho - Ashita no Kimi sae Ireba Ii (_IceRain's 9)", time: { live: 10000, mp3Length: 96000 } },
  };
  const state = normalizeTosu(data);
  assert.equal(state.song.artist, 'Choucho');
  assert.equal(state.song.title, 'Ashita no Kimi sae Ireba Ii');
  assert.equal(state.song.compilation, true);
  assert.equal(state.song.difficulty, '');
  const second = normalizeTosu({ ...data, beatmap: { ...data.beatmap, checksum: 'map-two', version: 'fripSide - LEVEL5 Judgelight (Arkman\'s 10)' } });
  assert.notEqual(fileId(state.song), fileId(second.song));
});

test('does not treat ordinary difficulty names as song metadata', () => {
  const state = normalizeTosu({ beatmap: { artist: 'ChouCho', title: 'Ashita no Kimi sae Ireba Ii.', version: 'Hard', time: { live: 1 } } });
  assert.equal(state.song.artist, 'ChouCho');
  assert.equal(state.song.title, 'Ashita no Kimi sae Ireba Ii.');
  assert.equal(state.song.compilation, false);
});

test('searches the parsed track instead of the compilation title', async () => {
  const song = normalizeTosu({ beatmap: {
    id: 1001, set: 765055, checksum: 'pack-map', artist: 'Various Artists',
    title: 'osu!mania 6k Starter Pack Vol.1', version: "Choucho - Ashita no Kimi sae Ireba Ii (_IceRain's 9)",
    time: { live: 1000, mp3Length: 96000 },
  } }).song;
  const queries = [];
  const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-pack-search-')), () => {}, {
    requestLyrics: async url => {
      queries.push(url.searchParams);
      return [{ id: 3, trackName: 'Ashita no Kimi sae Ireba Ii', artistName: 'Choucho', duration: 96, syncedLyrics: '[00:01.00]歌う\n[00:01.00]歌唱' }];
    },
    wait: async () => {},
  });
  service.song = song;
  await service.search();
  assert.equal(queries[0].get('track_name'), 'Ashita no Kimi sae Ireba Ii');
  assert.equal(queries[0].get('artist_name'), 'Choucho');
  assert.equal(service.payload.status, 'ready');
});
