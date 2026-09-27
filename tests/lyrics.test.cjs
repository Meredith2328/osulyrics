const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseLrc, serializeLrc, rankLyrics, chooseAutomaticMatch, activeLineAt } = require('../src/lyrics.cjs');
const { LyricsService, stripVersionSuffix } = require('../src/lyrics-service.cjs');
const { HttpError } = require('../src/lrclib-client.cjs');

test('pairs Japanese and Chinese at the same timestamp and preserves repeated timestamps', () => {
  const lines = parseLrc('[00:01.20][00:03.50]教えて\n[00:01.20]告诉我\n[00:04.00]その仕組みを');
  assert.deepEqual(lines, [
    { time: 1.2, original: '教えて', translation: '告诉我' },
    { time: 3.5, original: '教えて', translation: '' },
    { time: 4, original: 'その仕組みを', translation: '' },
  ]);
  assert.equal(activeLineAt(lines, 3.7), 1);
  assert.equal(activeLineAt(lines, 0), -1);
});

test('supports offset metadata and a bilingual LRC round trip', () => {
  const text = '[offset:500]\n[00:02.25]夢を見た\n[00:02.25]做了一个梦';
  const lines = parseLrc(text);
  assert.equal(lines[0].time, 2.75);
  assert.deepEqual(parseLrc(serializeLrc(lines)), lines);
});

test('rejects a different length version during automatic matching', () => {
  const song = { title: 'unravel', artist: 'TK from Ling tosite sigure', lastObjectMs: 90000 };
  const candidates = [
    { id: 1, trackName: 'unravel', artistName: 'TK from Ling tosite sigure', duration: 229, syncedLyrics: '[00:01.00]A' },
    { id: 2, trackName: 'unravel', artistName: 'TK from Ling tosite sigure', duration: 95, syncedLyrics: '[00:01.00]B' },
  ];
  assert.equal(rankLyrics(song, candidates)[0].id, 2);
  assert.equal(chooseAutomaticMatch(song, candidates).id, 2);
});

test('does not silently choose an ambiguous title-only match', () => {
  const song = { title: 'Blue', artist: 'Some Artist', lastObjectMs: 0 };
  const candidates = [{ id: 5, trackName: 'Blue', artistName: 'Other Artist', duration: 200, syncedLyrics: '[00:01.00]x' }];
  assert.equal(chooseAutomaticMatch(song, candidates), null);
});

test('matches romanized metadata when osu displays Unicode metadata', () => {
  const song = { title: '曲', romanizedTitle: 'Song', artist: '歌手', romanizedArtist: 'Artist', lastObjectMs: 0 };
  const item = { id: 3, trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:01.00]x' };
  assert.equal(chooseAutomaticMatch(song, [item]).id, 3);
});

test('uses audio length instead of the final hit object for lyric version selection', () => {
  const song = { title: 'Song', artist: 'Artist', durationMs: 200000, lastObjectMs: 90000 };
  const candidates = [
    { id: 1, trackName: 'Song', artistName: 'Artist', duration: 90, syncedLyrics: '[00:01.00]x' },
    { id: 2, trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:01.00]x' },
  ];
  assert.equal(chooseAutomaticMatch(song, candidates).id, 2);
});

test('uses the corrected osu audio length when tosu updates it after the song identity', async () => {
  const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-switch-clock-')), () => {}, {
    requestLyrics: async () => [
      { id: 1, trackName: 'Song', artistName: 'Artist', duration: 150, syncedLyrics: '[00:01.00]古い歌\n[00:01.00]旧歌' },
      { id: 2, trackName: 'Song', artistName: 'Artist', duration: 100, syncedLyrics: '[00:01.00]新しい歌\n[00:01.00]新歌' },
    ],
    wait: async () => {},
  });
  const first = { key: 'new-checksum', set: 42, title: 'Song', artist: 'Artist', durationMs: 150000 };
  const loading = service.setSong(first);
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    await service.setSong({ ...first, durationMs: 100000 });
    await loading;
    assert.equal(service.song.durationMs, 100000);
    assert.equal(service.readMeta().selectedId, 2);
    assert.equal(service.payload.lines[0].original, '新しい歌');
  } finally {
    if (service.watchedFile) fs.unwatchFile(service.watchedFile, service.watchHandler);
  }
});

test('does not select lyrics using audio metadata that changed during the online request', async () => {
  let changed = false;
  const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-search-race-')), () => {}, {
    requestLyrics: async () => {
      if (!changed) {
        changed = true;
        service.song = { ...service.song, durationMs: 100000 };
        service.metadataRevision++;
      }
      return [
        { id: 1, trackName: 'Song', artistName: 'Artist', duration: 150, syncedLyrics: '[00:01.00]古い歌\n[00:01.00]旧歌' },
        { id: 2, trackName: 'Song', artistName: 'Artist', duration: 100, syncedLyrics: '[00:01.00]新しい歌\n[00:01.00]新歌' },
      ];
    },
    wait: async () => {},
  });
  service.song = { key: 'new-checksum', set: 42, title: 'Song', artist: 'Artist', durationMs: 150000 };
  await service.search();
  assert.equal(service.readMeta().selectedId, 2);
});

test('rechecks an automatic cache when a same-set song later reports a different audio length', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-cache-length-'));
  const service = new LyricsService(folder, () => {}, {
    requestLyrics: async () => [
      { id: 1, trackName: 'Song', artistName: 'Artist', duration: 150, syncedLyrics: '[00:01.00]古い歌\n[00:01.00]旧歌' },
      { id: 2, trackName: 'Song', artistName: 'Artist', duration: 100, syncedLyrics: '[00:01.00]新しい歌\n[00:01.00]新歌' },
    ],
    wait: async () => {},
  });
  const first = { key: 'same-map', set: 42, title: 'Song', artist: 'Artist', durationMs: 150000 };
  service.song = first;
  fs.writeFileSync(service.paths().lrc, '[00:01.00]古い歌\n[00:01.00]旧歌\n');
  fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectionMode: 'auto', selectedId: 1, audioDurationMs: 150000 }));
  service.song = null;
  try {
    await service.setSong(first);
    assert.equal(service.readMeta().selectedId, 1);
    await service.setSong({ ...first, durationMs: 100000 });
    assert.equal(service.readMeta().selectedId, 2);
    assert.equal(service.payload.lines[0].original, '新しい歌');
  } finally {
    if (service.watchedFile) fs.unwatchFile(service.watchedFile, service.watchHandler);
  }
});

test('a temporarily stale tosu length does not refetch an already correct lyric cache', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-cache-settle-'));
  let searches = 0;
  const service = new LyricsService(folder, () => {}, {
    requestLyrics: async () => { searches++; return []; },
    wait: async () => {},
  });
  const first = { key: 'new-checksum', set: 42, title: 'Song', artist: 'Artist', durationMs: 150000 };
  service.song = first;
  fs.writeFileSync(service.paths().lrc, '[00:01.00]正しい歌\n[00:01.00]正确的歌\n');
  fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectionMode: 'auto', selectedId: 2, audioDurationMs: 100000 }));
  service.song = null;
  const loading = service.setSong(first);
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    await service.setSong({ ...first, durationMs: 100000 });
    await loading;
    assert.equal(searches, 0);
    assert.equal(service.payload.lines[0].original, '正しい歌');
  } finally {
    if (service.watchedFile) fs.unwatchFile(service.watchedFile, service.watchHandler);
  }
});

test('a complete legacy lyric cache is reused without another search or translation', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-complete-cache-'));
  let searches = 0, translations = 0;
  const service = new LyricsService(folder, () => {}, {
    requestLyrics: async () => { searches++; return []; },
    wait: async () => {},
  });
  service.translate = async () => { translations++; };
  const song = { key: 'complete', set: 42, title: 'Song', artist: 'Artist', durationMs: 100000 };
  service.song = song;
  fs.writeFileSync(service.paths().lrc, '[00:01.00]あの歌\n[00:01.00]那首歌\n[00:20.00]次の歌\n[00:20.00]下一首歌\n');
  fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectionMode: 'auto', selectedId: 2, translationSource: '机器翻译' }));
  service.song = null;
  try {
    await service.setSong(song);
    assert.equal(searches, 0);
    assert.equal(translations, 0);
    assert.equal(service.payload.lines[0].translation, '那首歌');
  } finally {
    if (service.watchedFile) fs.unwatchFile(service.watchedFile, service.watchHandler);
  }
});

test('rechecking the same LRCLIB version keeps its saved Chinese translation', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-same-version-'));
  let searches = 0, translations = 0;
  const service = new LyricsService(folder, () => {}, {
    requestLyrics: async () => {
      searches++;
      return [{ id: 2, trackName: 'Song', artistName: 'Artist', duration: 100, syncedLyrics: '[00:01.00]あの歌\n[00:20.00]次の歌' }];
    },
    wait: async () => {},
  });
  service.translate = async () => { translations++; };
  const song = { key: 'same-version', set: 42, title: 'Song', artist: 'Artist', durationMs: 100000 };
  service.song = song;
  fs.writeFileSync(service.paths().lrc, '[00:01.00]あの歌\n[00:01.00]那首歌\n[00:20.00]次の歌\n[00:20.00]下一首歌\n');
  fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectionMode: 'auto', selectedId: 2, audioDurationMs: 150000, translationSource: '机器翻译' }));
  service.song = null;
  try {
    await service.setSong(song);
    assert.ok(searches > 0);
    assert.equal(translations, 0);
    assert.equal(service.payload.lines[0].translation, '那首歌');
    assert.equal(service.readMeta().audioDurationMs, 100000);
  } finally {
    if (service.watchedFile) fs.unwatchFile(service.watchedFile, service.watchHandler);
  }
});

test('a reviewed legacy English cache does not search again on the next visit', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-reviewed-english-'));
  let searches = 0;
  const service = new LyricsService(folder, () => {}, {
    requestLyrics: async () => {
      searches++;
      return [{ id: 2, trackName: 'Song', artistName: 'Artist', duration: 100,
        syncedLyrics: '[00:01.00]First line\n[00:20.00]Second line' }];
    },
    wait: async () => {},
  });
  const song = { key: 'english', set: 42, title: 'Song', artist: 'Artist', durationMs: 100000 };
  service.song = song;
  fs.writeFileSync(service.paths().lrc, '[00:01.00]First line\n[00:01.00]第一句\n[00:20.00]Second line\n[00:20.00]第二句\n');
  fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectedId: 2, translationSource: '机器翻译' }));
  service.song = null;
  try {
    await service.setSong(song);
    const reviewedSearches = searches;
    assert.ok(reviewedSearches > 0);
    assert.equal(service.readMeta().selectionMode, 'auto');
    await service.setSong(null);
    await service.setSong(song);
    assert.equal(searches, reviewedSearches);
    assert.equal(service.payload.lines[0].translation, '第一句');
  } finally {
    if (service.watchedFile) fs.unwatchFile(service.watchedFile, service.watchHandler);
  }
});

test('losing the current song clears lyrics even when the old metadata lacks a checksum', async () => {
  const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-clear-song-')), () => {});
  service.song = { title: 'Song', artist: 'Artist' };
  service.payload = { status: 'ready', lines: [{ time: 1, original: '歌' }] };
  await service.setSong(null);
  assert.equal(service.song, null);
  assert.equal(service.payload.status, 'idle');
  assert.deepEqual(service.payload.lines, []);
});

test('rechecks an overlong legacy automatic cache without replacing a manually chosen version', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-cache-legacy-'));
  let searches = 0;
  const service = new LyricsService(folder, () => {}, {
    requestLyrics: async () => {
      searches++;
      return [{ id: 2, trackName: 'Song', artistName: 'Artist', duration: 100, syncedLyrics: '[00:01.00]新しい歌\n[00:01.00]新歌' }];
    },
    wait: async () => {},
  });
  const song = { key: 'same-map', set: 42, title: 'Song', artist: 'Artist', durationMs: 100000 };
  service.song = song;
  fs.writeFileSync(service.paths().lrc, '[02:10.00]古い歌\n[02:10.00]旧歌\n');
  fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectionMode: 'auto', selectedId: 1 }));
  service.song = null;
  try {
    await service.setSong(song);
    assert.equal(service.readMeta().selectedId, 2);
    assert.ok(searches > 0);
    fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectionMode: 'manual', selectedId: 1 }));
    fs.writeFileSync(service.paths().lrc, '[00:01.00]手动歌词\n');
    await service.setSong(null);
    await service.setSong(song);
    assert.equal(service.readMeta().selectedId, 1);
    assert.equal(service.payload.lines[0].original, '手动歌词');
  } finally {
    if (service.watchedFile) fs.unwatchFile(service.watchedFile, service.watchHandler);
  }
});

test('TV Size titles search the unsuffixed Japanese name and choose the short recording', async () => {
  const requests = [];
  const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-tv-')), () => {}, {
    requestLyrics: async url => {
      const title = url.searchParams.get('track_name');
      requests.push(title);
      if (title === 'Gurenge') return [{ id: 1, trackName: 'Gurenge', artistName: 'LiSA', duration: 238, syncedLyrics: '[00:01.00]Full song' }];
      if (title === '紅蓮華') return [{ id: 2, trackName: '紅蓮華', artistName: 'LiSA', duration: 89, syncedLyrics: '[00:01.00]強くなれる理由を知った\n[00:03.00]僕を連れて進め' }];
      return [];
    },
    wait: async () => {},
  });
  service.translate = async () => {};
  service.song = { key: 'tv', title: '紅蓮華 (TV Size)', romanizedTitle: 'Gurenge (TV Size)', artist: 'LiSA', romanizedArtist: 'LiSA', durationMs: 90000 };
  await service.search();
  assert.ok(requests.includes('紅蓮華'));
  assert.equal(service.payload.status, 'ready');
  assert.equal(service.readMeta().selectedId, 2);
  assert.equal(service.payload.lines[0].original, '強くなれる理由を知った');
  assert.equal(stripVersionSuffix('Love Letter (English Version)'), 'Love Letter (English Version)');
});

test('prefers Japanese Love Letter lyrics over the same artist English edition', () => {
  const song = { title: 'Love Letter', artist: 'YOASOBI', durationMs: 211000 };
  const candidates = [
    { id: 1, trackName: 'Love Letter', artistName: 'YOASOBI', albumName: 'E-SIDE 2', duration: 211, syncedLyrics: '[00:01.00]I feel delighted\n[00:03.00]I say true thoughts\n[00:05.00]Somehow I need you' },
    { id: 2, trackName: 'Love Letter', artistName: 'YOASOBI', albumName: 'THE BOOK 2', duration: 211, syncedLyrics: '[00:01.00]ああ音楽へ\n[00:03.00]ずっと考えてたこと\n[00:05.00]どうか聞いてほしくって' },
  ];
  assert.equal(chooseAutomaticMatch(song, candidates)?.id, 2);
  assert.equal(chooseAutomaticMatch({ ...song, difficulty: 'English Ver.' }, candidates)?.id, 1);
});

test('an old cached English LRCLIB match is reconsidered and upgraded', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-language-'));
  const song = { key: 'love-letter', title: 'Love Letter', romanizedTitle: 'Love Letter', artist: 'YOASOBI', romanizedArtist: 'YOASOBI', durationMs: 211000 };
  const service = new LyricsService(folder, () => {}, {
    requestLyrics: async () => [{ id: 2, trackName: 'Love Letter', artistName: 'YOASOBI', albumName: 'THE BOOK 2', duration: 211, syncedLyrics: '[00:01.00]ああ音楽へ\n[00:01.00]致音乐\n[00:03.00]ずっと考えてたこと\n[00:05.00]どうか聞いてほしくって' }],
    wait: async () => {},
  });
  service.song = song;
  fs.writeFileSync(service.paths().lrc, '[00:01.00]I feel delighted\n[00:03.00]I say true thoughts\n[00:05.00]Somehow I need you\n');
  fs.writeFileSync(service.paths().meta, JSON.stringify({ source: 'LRCLIB', selectedId: 1 }));
  service.song = null;
  service.translate = async () => {};
  await service.setSong(song);
  assert.equal(service.payload.lines[0].original, 'ああ音楽へ');
  assert.equal(service.readMeta().selectionMode, 'auto');
  fs.unwatchFile(service.watchedFile, service.watchHandler);
});

test('keeps existing lyrics when a manual online search fails', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  try {
    const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-test-')), () => {});
    service.song = { key: 'test', title: 'Song', artist: 'Artist' };
    service.payload = { status: 'ready', lines: [{ time: 1, original: '歌', translation: '歌' }], candidates: [], offsetMs: 0 };
    await service.search('Song');
    assert.equal(service.payload.status, 'ready');
    assert.equal(service.payload.lines[0].original, '歌');
  } finally { global.fetch = oldFetch; }
});

test('a late translation cannot overwrite a newer lyric selection', async () => {
  const oldFetch = global.fetch;
  const complete = [];
  global.fetch = () => new Promise(resolve => complete.push(resolve));
  try {
    const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-race-')), () => {});
    service.song = { key: 'test', title: 'Song', artist: 'Artist' };
    service.candidates = [
      { id: 1, syncedLyrics: '[00:01.00]第一版' },
      { id: 2, syncedLyrics: '[00:01.00]第二版' },
    ];
    await service.select(1);
    await service.select(2);
    const response = word => ({ ok: true, json: async () => [[[word]]] });
    complete[1](response('新翻译'));
    await new Promise(resolve => setImmediate(resolve));
    complete[0](response('旧翻译'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.payload.lines[0].original, '第二版');
    assert.equal(service.payload.lines[0].translation, '新翻译');
  } finally { global.fetch = oldFetch; }
});

test('falls back to metadata lookup when LRCLIB search stays at 503', async () => {
  const routes = [];
  const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-503-')), () => {}, {
    requestLyrics: async url => {
      routes.push(url.pathname);
      if (url.pathname.endsWith('/search')) throw new HttpError(503, 1000);
      return { id: 42, trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:01.00]歌う\n[00:01.00]歌唱' };
    },
    wait: async () => {},
  });
  service.song = { key: 'test', title: 'Song', romanizedTitle: 'Song', artist: 'Artist', romanizedArtist: 'Artist', durationMs: 200000 };
  await service.search();
  assert.deepEqual(routes, ['/api/search', '/api/search', '/api/get']);
  assert.equal(service.payload.status, 'ready');
  assert.equal(service.payload.lines[0].translation, '歌唱');
});

test('tries a title-only cached search after an artist search returns 503', async () => {
  const routes = [];
  const service = new LyricsService(fs.mkdtempSync(path.join(os.tmpdir(), 'osu-lyrics-title-fallback-')), () => {}, {
    requestLyrics: async url => {
      routes.push(`${url.pathname}?${url.searchParams}`);
      if (url.searchParams.has('artist_name')) throw new HttpError(503, 1000);
      return [{ id: 9, trackName: 'Ashita no Kimi sae Ireba ii.', artistName: 'ChouCho', duration: 303, syncedLyrics: '[00:01.00]歌う\n[00:01.00]歌唱' }];
    },
    wait: async () => {},
  });
  service.song = { key: 'pack', title: 'Ashita no Kimi sae Ireba Ii', romanizedTitle: 'Ashita no Kimi sae Ireba Ii', artist: 'Choucho', romanizedArtist: 'Choucho', durationMs: 303000 };
  await service.search();
  assert.equal(routes.length, 2);
  assert.ok(routes[1].includes('/api/search?track_name='));
  assert.equal(service.payload.status, 'ready');
  assert.equal(service.payload.lines[0].original, '歌う');
});
