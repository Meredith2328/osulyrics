const { advancePosition, shouldDisplayLyrics } = require('./playback-clock.js');

function parseCompilationDifficulty(artist, title, version) {
  if (!/^(?:various artists|various|v\.?a\.?|multiple artists)$/i.test(String(artist || '').trim())) return null;
  if (!/(?:\bpack\b|\bcompilation\b|\bcollection\b|\bstarter\b|\bbeginner\b|合集|曲包)/i.test(String(title || ''))) return null;
  const cleaned = String(version || '').trim().replace(/^\[\d{1,2}k?\]\s*/i, '')
    .replace(/\s*\([^)]*'s\s*\d+\)\s*$/i, '').trim();
  const match = cleaned.match(/^(.{2,}?)\s+[-–—]\s+(.{3,})$/);
  if (!match) return null;
  const parsedArtist = match[1].trim();
  const parsedTitle = match[2].trim();
  if (/^(?:easy|normal|hard|insane|expert|\d+k?)$/i.test(parsedArtist)) return null;
  return { artist: parsedArtist, title: parsedTitle };
}

function normalizeTosu(data, sampledAt = Date.now()) {
  const map = data?.beatmap || {};
  const setTitle = map.titleUnicode || map.title || '';
  const setArtist = map.artistUnicode || map.artist || '';
  const compiled = parseCompilationDifficulty(map.artist || setArtist, map.title || setTitle, map.version);
  const title = compiled?.title || setTitle;
  const artist = compiled?.artist || setArtist;
  const state = data?.state?.name || '';
  const usablePath = value => typeof value === 'string' && value.trim() && !/^\.\.?$/.test(value.trim()) ? value : '';
  const beatmapFolder = usablePath(data?.folders?.beatmap) || usablePath(data?.directPath?.beatmapFolder);
  const audioFile = usablePath(data?.files?.audio) || usablePath(data?.directPath?.beatmapAudio);
  const song = title && artist ? {
    key: map.checksum || JSON.stringify([map.set || map.id || '', artist, title, map.version || '', beatmapFolder, audioFile]),
    id: map.id || null,
    set: map.set || null,
    beatmapFolder,
    audioFile,
    title,
    artist,
    romanizedTitle: compiled?.title || map.title || title,
    romanizedArtist: compiled?.artist || map.artist || artist,
    difficulty: compiled ? '' : map.version || '',
    compilation: !!compiled,
    collectionTitle: compiled ? setTitle : '',
    lastObjectMs: Number(map.time?.lastObject) || 0,
    durationMs: Number(map.time?.mp3Length) || Number(map.time?.lastObject) || 0,
  } : null;
  return {
    connected: true,
    state,
    song,
    positionMs: Math.max(0, Number(map.time?.live) || 0),
    sampledAt,
    playing: /^(play|playing|selectplay|selectmulti|songselect|menu)$/i.test(state) && data?.game?.paused !== true,
    rate: /^play(?:ing)?$/i.test(state) && Number(data?.play?.mods?.rate) > 0 ? Number(data.play.mods.rate) : 1,
  };
}

module.exports = { normalizeTosu, advancePosition, shouldDisplayLyrics };
