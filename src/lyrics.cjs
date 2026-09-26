const LRC_LINE = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function parseLrc(source) {
  let offsetMs = 0;
  const rows = [];
  for (const raw of String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const offset = raw.match(/^\[offset:([+-]?\d+)\]/i);
    if (offset) { offsetMs = Number(offset[1]); continue; }
    const stamps = [...raw.matchAll(LRC_LINE)];
    if (!stamps.length) continue;
    const value = raw.replace(LRC_LINE, '').trim();
    for (const stamp of stamps) {
      const frac = stamp[3] ? Number(stamp[3].padEnd(3, '0')) : 0;
      const time = Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + (frac + offsetMs) / 1000);
      rows.push({ time: Math.round(time * 1000) / 1000, value, order: rows.length });
    }
  }
  rows.sort((a, b) => a.time - b.time || a.order - b.order);
  const lines = [];
  for (const row of rows) {
    const last = lines.at(-1);
    if (last && last.time === row.time && row.value) {
      if (!last.original) last.original = row.value;
      else if (!last.translation && last.original !== row.value) {
        if (/[\u3040-\u30ff]/.test(row.value) && !/[\u3040-\u30ff]/.test(last.original)) {
          last.translation = last.original;
          last.original = row.value;
        } else last.translation = row.value;
      } else if (last.translation) last.translation += ` / ${row.value}`;
    } else {
      lines.push({ time: row.time, original: row.value, translation: '' });
    }
  }
  return lines;
}

function serializeLrc(lines) {
  const stamp = seconds => {
    const cs = Math.round(Math.max(0, seconds) * 100);
    return `[${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs % 6000 / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}]`;
  };
  return lines.flatMap(line => [
    `${stamp(line.time)}${line.original || ''}`,
    ...(line.translation ? [`${stamp(line.time)}${line.translation}`] : []),
  ]).join('\n') + '\n';
}

function activeLineAt(lines, seconds) {
  let low = 0, high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].time <= seconds) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/\([^)]*(?:tv size|short ver|game ver|osu!)[^)]*\)|\[[^\]]*(?:tv size|short ver|game ver|osu!)[^\]]*\]/gi, '')
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function lyricLanguage(source) {
  const lines = parseLrc(source).filter(line => line.original).slice(0, 40);
  const japanese = lines.filter(line => /[\u3040-\u30ff]/u.test(line.original)).length;
  const latin = lines.filter(line => /[A-Za-z]{2}/u.test(line.original)).length;
  if (japanese >= 2 && japanese >= latin / 2) return 'ja';
  if (latin >= 2 && japanese < 2) return 'en';
  return 'unknown';
}

function expectedLanguage(song, candidates) {
  const metadata = [song.title, song.artist, song.romanizedTitle, song.romanizedArtist, song.difficulty].join(' ');
  if (/\b(?:english|eng(?:lish)?\s*ver(?:sion)?|e-side)\b/i.test(metadata)) return 'en';
  if (/[\u3040-\u30ff]/u.test(metadata)) return 'ja';
  const languages = new Set(candidates.map(item => lyricLanguage(item.syncedLyrics)));
  return languages.has('ja') && languages.has('en') ? 'ja' : null;
}

function candidateScore(song, item, language = null) {
  if (!item.syncedLyrics || item.instrumental) return -Infinity;
  const titles = [song.title, song.romanizedTitle].map(normalizeName).filter(Boolean);
  const artists = [song.artist, song.romanizedArtist].map(normalizeName).filter(Boolean);
  const itemTitle = normalizeName(item.trackName);
  const itemArtist = normalizeName(item.artistName);
  if (!titles.length || !itemTitle) return -Infinity;
  let score = titles.some(title => title === itemTitle) ? 70 :
    titles.some(title => title.length > 3 && (title.includes(itemTitle) || itemTitle.includes(title))) ? 30 : -80;
  score += artists.some(artist => artist === itemArtist) ? 40 :
    artists.some(artist => artist.length > 3 && itemArtist.length > 3 && (artist.includes(itemArtist) || itemArtist.includes(artist))) ? 15 : -35;
  const expectedLength = song.durationMs || song.lastObjectMs || 0;
  if (expectedLength > 0 && Number(item.duration) > 0) {
    const gap = Math.abs(item.duration * 1000 - expectedLength) / 1000;
    score += gap <= 12 ? 25 : gap <= 30 ? 5 : gap <= 45 ? -30 : -100;
  }
  const actualLanguage = lyricLanguage(item.syncedLyrics);
  if (language && actualLanguage !== 'unknown') score += actualLanguage === language ? 45 : -45;
  if (language === 'ja' && /\be[\s-]?side\b/i.test(item.albumName || '')) score -= 20;
  return score;
}

function rankLyrics(song, candidates) {
  const language = expectedLanguage(song, candidates);
  return [...candidates].map(item => ({ ...item, language: lyricLanguage(item.syncedLyrics), matchScore: candidateScore(song, item, language) }))
    .filter(item => Number.isFinite(item.matchScore))
    .sort((a, b) => b.matchScore - a.matchScore);
}

function chooseAutomaticMatch(song, candidates) {
  const ranked = rankLyrics(song, candidates);
  const first = ranked[0];
  if (!first || first.matchScore < 75) return null;
  const second = ranked[1];
  if (second && second.matchScore >= first.matchScore - 5 &&
      Math.abs(Number(second.duration || 0) - Number(first.duration || 0)) > 15) return null;
  return first;
}

module.exports = { parseLrc, serializeLrc, activeLineAt, rankLyrics, chooseAutomaticMatch, normalizeName, lyricLanguage };
