const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { parseLrc, serializeLrc, rankLyrics, chooseAutomaticMatch, lyricLanguage } = require('./lyrics.cjs');
const { requestJson, HttpError } = require('./lrclib-client.cjs');

const CLIENT = 'osu!lyrics/0.4.11 (https://github.com/Meredith2328/osulyrics)';

function stripVersionSuffix(value) {
  return String(value || '').normalize('NFKC').trim()
    .replace(/\s*[([]\s*(?:tv\s*size|short\s*(?:ver(?:sion)?|edit)|game\s*ver(?:sion)?)\s*[)\]]\s*$/i, '').trim();
}

function automaticSearches(song) {
  const variants = [
    [song.romanizedTitle || song.title, song.romanizedArtist || song.artist],
    [song.title, song.artist || song.romanizedArtist],
    [stripVersionSuffix(song.title), song.artist || song.romanizedArtist],
    [stripVersionSuffix(song.romanizedTitle || song.title), song.romanizedArtist || song.artist],
  ];
  const seen = new Set();
  const searches = [];
  for (const [title, artist] of variants) {
    if (!title) continue;
    const key = `${title.toLowerCase()}\0${String(artist || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    searches.push({ track_name: title, artist_name: artist });
  }
  searches.push({ track_name: stripVersionSuffix(song.title) || stripVersionSuffix(song.romanizedTitle) });
  return searches;
}

async function getJson(url, timeoutMs = 10000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': CLIENT, 'Lrclib-Client': CLIENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function fileId(song) {
  const identity = song.compilation ? `track:${song.artist}:${song.title}` :
    Number(song.set) > 0 ? `set:${song.set}` : `${song.artist}:${song.title}`;
  const stableIdentity = identity.normalize('NFKC');
  return crypto.createHash('sha1').update(song.compilation ? stableIdentity.toLowerCase() : stableIdentity).digest('hex').slice(0, 16);
}

class LyricsService {
  constructor(folder, onUpdate, options = {}) {
    this.folder = folder;
    this.onUpdate = onUpdate;
    this.lrclibBase = new URL((options.lrclibBase || 'https://lrclib.net/api').replace(/\/?$/, '/'));
    this.requestLyrics = options.requestLyrics || requestJson;
    this.wait = options.wait || wait;
    this.song = null;
    this.generation = 0;
    this.searchRun = 0;
    this.selectionToken = 0;
    this.metadataRevision = 0;
    this.metadataChangedAt = 0;
    this.pendingInitialSearch = false;
    this.candidates = [];
    this.payload = { status: 'idle', lines: [], candidates: [], offsetMs: 0 };
    fs.mkdirSync(folder, { recursive: true });
  }

  paths() {
    const id = fileId(this.song);
    return { lrc: path.join(this.folder, `${id}.lrc`), meta: path.join(this.folder, `${id}.json`) };
  }

  emit(patch) {
    this.payload = { ...this.payload, ...patch };
    this.onUpdate(this.payload);
  }

  readMeta() {
    try { return JSON.parse(fs.readFileSync(this.paths().meta, 'utf8')); }
    catch { return {}; }
  }

  writeMeta(patch) {
    const file = this.paths().meta;
    fs.writeFileSync(file, JSON.stringify({ ...this.readMeta(), ...patch }, null, 2), 'utf8');
  }

  async waitForMetadata(generation, revision = null) {
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      if (generation !== this.generation || (revision !== null && revision !== this.metadataRevision)) return false;
      const remaining = 450 - (Date.now() - this.metadataChangedAt);
      if (remaining <= 0) return true;
      await new Promise(resolve => setTimeout(resolve, Math.min(remaining, deadline - Date.now())));
    }
    return generation === this.generation && (revision === null || revision === this.metadataRevision);
  }

  automaticLyricsMayChange(meta) {
    return meta.selectionMode !== 'manual' && (!meta.source || meta.source === 'LRCLIB');
  }

  cachedAutoNeedsReview(meta, song, lines) {
    if (meta.source !== 'LRCLIB' || !this.automaticLyricsMayChange(meta)) return false;
    const knownDuration = Number(meta.audioDurationMs);
    const currentDuration = Number(song?.durationMs);
    const durationMismatch = !Number.isFinite(knownDuration) || knownDuration <= 0 ||
      (currentDuration > 0 && Math.abs(knownDuration - currentDuration) > 5000);
    const oldEnglish = !meta.selectionMode &&
      lyricLanguage(serializeLrc(lines || [])) === 'en' &&
      !/\b(?:english|eng(?:lish)?\s*ver(?:sion)?|e-side)\b/i.test([song?.title, song?.difficulty].join(' '));
    return durationMismatch || oldEnglish;
  }

  async setSong(song) {
    const sameSong = (!this.song && !song) ||
      (this.song && song && this.song.key === song.key && fileId(this.song) === fileId(song));
    if (sameSong) {
      if (song && this.song) {
        const previous = this.song;
        this.song = song;
        const identityChanged = ['title', 'artist', 'romanizedTitle', 'romanizedArtist', 'difficulty']
          .some(field => previous[field] !== song[field]);
        const changed = identityChanged || ['durationMs', 'lastObjectMs']
          .some(field => previous[field] !== song[field]);
        if (changed) {
          this.metadataChangedAt = Date.now();
          const revision = ++this.metadataRevision;
          if (!this.pendingInitialSearch && this.automaticLyricsMayChange(this.readMeta()) &&
              await this.waitForMetadata(this.generation, revision)) {
            const meta = this.readMeta();
            if (this.automaticLyricsMayChange(meta) &&
                (!meta.source || identityChanged || this.cachedAutoNeedsReview(meta, this.song, this.payload.lines))) {
              await this.search('', this.generation);
            }
          }
        }
      }
      return;
    }
    this.generation++;
    this.searchAbort?.abort();
    this.searchRun++;
    this.selectionToken++;
    this.metadataRevision++;
    this.metadataChangedAt = Date.now();
    this.pendingInitialSearch = false;
    if (this.watchedFile) fs.unwatchFile(this.watchedFile, this.watchHandler);
    this.watchedFile = null;
    this.song = song;
    this.lastWritten = null;
    this.candidates = [];
    if (!song) {
      this.emit({ status: 'idle', lines: [], candidates: [], offsetMs: 0, source: '', translationSource: '', message: '' });
      return;
    }
    const generation = this.generation;
    const paths = this.paths();
    const meta = this.readMeta();
    this.emit({ status: 'loading', lines: [], candidates: [], offsetMs: Number(meta.offsetMs) || 0, source: '', translationSource: '', message: '' });
    this.watchedFile = paths.lrc;
    this.watchHandler = () => {
      if (generation !== this.generation) return;
      this.loadLocal(true);
    };
    fs.watchFile(paths.lrc, { interval: 800 }, this.watchHandler);
    if (this.loadLocal(false)) {
      if (meta.source === 'LRCLIB' && !this.payload.lines.some(line => line.translation)) {
        this.emit({ translationSource: '正在翻译…' });
        this.translate(this.payload.lines, generation, ++this.selectionToken);
      }
      if (this.cachedAutoNeedsReview(meta, this.song, this.payload.lines)) {
        this.pendingInitialSearch = true;
        try {
          if (await this.waitForMetadata(generation) &&
              this.cachedAutoNeedsReview(this.readMeta(), this.song, this.payload.lines)) {
            await this.search('', generation);
          }
        } finally {
          if (generation === this.generation) this.pendingInitialSearch = false;
        }
      }
      return;
    }
    // tosu can report the new checksum before its audio length and live time catch up.
    this.pendingInitialSearch = true;
    try {
      if (await this.waitForMetadata(generation)) await this.search('', generation);
    } finally {
      if (generation === this.generation) this.pendingInitialSearch = false;
    }
  }

  loadLocal(edited) {
    if (!this.song) return false;
    let contents;
    try { contents = fs.readFileSync(this.paths().lrc, 'utf8'); }
    catch { return false; }
    if (contents === this.lastWritten) return true;
    const lines = parseLrc(contents);
    if (!lines.length) return false;
    if (edited) { this.searchRun++; this.selectionToken++; }
    this.lastWritten = contents;
    const meta = this.readMeta();
    if (edited) this.writeMeta({ source: '本地编辑' });
    this.emit({ status: 'ready', lines, source: edited ? '本地编辑' : meta.source || '本地 LRC', translationSource: lines.some(l => l.translation) ? (meta.translationSource || '歌词自带') : '' });
    return true;
  }

  async search(query = '', generation = this.generation) {
    if (!this.song) return;
    this.searchAbort?.abort();
    const abort = new AbortController();
    this.searchAbort = abort;
    const song = this.song;
    const metadataRevision = this.metadataRevision;
    const searchRun = ++this.searchRun;
    const existingLines = this.payload.lines || [];
    this.emit({ status: 'searching', message: '正在搜索带时间戳的歌词…', candidates: [] });
    try {
      const searches = query ? [{ query }] : automaticSearches(song);
      const unicodeBase = stripVersionSuffix(song.title);
      const mustTryUnicodeBase = !query && /[\u3040-\u30ff\u3400-\u9fff]/u.test(song.title || '') &&
        unicodeBase.toLowerCase() !== stripVersionSuffix(song.romanizedTitle).toLowerCase();
      const all = new Map();
      let lastError = null;
      let attemptedTitleOnly = false;
      let triedUnicodeBase = false;
      for (const params of searches) {
        if (generation !== this.generation || searchRun !== this.searchRun) return;
        if (params.track_name && !params.artist_name) attemptedTitleOnly = true;
        if (params.artist_name && params.track_name === unicodeBase) triedUnicodeBase = true;
        try {
          const url = new URL('search', this.lrclibBase);
          for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
          const found = await this.requestLyrics(url, { signal: abort.signal });
          for (const item of Array.isArray(found) ? found : []) all.set(item.id, item);
          if ((!mustTryUnicodeBase || triedUnicodeBase) &&
              (all.size >= 8 || chooseAutomaticMatch(song, [...all.values()]))) break;
          await this.wait(350, undefined, { signal: abort.signal });
        } catch (error) {
          lastError = error;
          if (error instanceof HttpError && (error.status === 503 || error.status === 429)) break;
        }
      }
      if (generation !== this.generation || searchRun !== this.searchRun) return;
      if (!all.size && !query && !attemptedTitleOnly && lastError instanceof HttpError && lastError.status === 503) {
        // A title-only query may be cached even while artist-filtered search is overloaded.
        await this.wait(1000, undefined, { signal: abort.signal });
        const titleOnly = new URL('search', this.lrclibBase);
        titleOnly.searchParams.set('track_name', stripVersionSuffix(song.title) || stripVersionSuffix(song.romanizedTitle));
        try {
          const found = await this.requestLyrics(titleOnly, { signal: abort.signal, maxAttempts: 2 });
          for (const item of Array.isArray(found) ? found : []) all.set(item.id, item);
        } catch (error) { lastError = error; }
      }
      if (generation !== this.generation || searchRun !== this.searchRun) return;
      if (!all.size && !query && lastError instanceof HttpError && lastError.status === 503) {
        // Metadata lookups use a separate cache and may succeed while search is overloaded.
        const exact = new URL('get', this.lrclibBase);
        exact.searchParams.set('track_name', stripVersionSuffix(song.title) || stripVersionSuffix(song.romanizedTitle));
        exact.searchParams.set('artist_name', song.romanizedArtist || song.artist);
        try {
          const item = await this.requestLyrics(exact, { signal: abort.signal, maxAttempts: 2 });
          if (item?.id) all.set(item.id, item);
        } catch (error) { if (!(error instanceof HttpError && error.status === 404)) lastError = error; }
      }
      if (generation !== this.generation || searchRun !== this.searchRun) return;
      if (metadataRevision !== this.metadataRevision) return this.search(query, generation);
      if (!all.size && lastError) throw lastError;
      this.candidates = rankLyrics(song, [...all.values()]);
      const summary = this.candidates.slice(0, 12).map(item => ({ id: item.id, title: item.trackName, artist: item.artistName, duration: item.duration, score: item.matchScore, language: item.language }));
      this.emit({ candidates: summary });
      const best = query ? null : chooseAutomaticMatch(song, this.candidates);
      if (best) await this.select(best.id, generation, 'auto');
      else this.emit({ status: existingLines.length ? 'ready' : 'choose', lines: existingLines, message: summary.length ? '请选择匹配的歌词版本' : '没有找到带时间戳的歌词。可以导入或编辑本地 LRC。' });
    } catch (error) {
      if (generation === this.generation && searchRun === this.searchRun &&
          metadataRevision !== this.metadataRevision) return this.search(query, generation);
      if (generation === this.generation && searchRun === this.searchRun) this.emit({ status: existingLines.length ? 'ready' : 'error', lines: existingLines, message: `歌词搜索失败：${error.message}` });
    }
  }

  async select(id, generation = this.generation, selectionMode = 'manual') {
    const item = this.candidates.find(candidate => candidate.id === Number(id));
    if (!item || generation !== this.generation) return false;
    this.searchRun++;
    const selectionToken = ++this.selectionToken;
    const lines = parseLrc(item.syncedLyrics);
    if (!lines.length) return false;
    this.lastWritten = serializeLrc(lines);
    fs.writeFileSync(this.paths().lrc, this.lastWritten, 'utf8');
    this.writeMeta({ source: 'LRCLIB', selectedId: item.id, selectionMode,
      audioDurationMs: Number(this.song.durationMs) || 0, lyricsDurationMs: Math.round(Number(item.duration) * 1000) || 0,
      translationSource: lines.some(l => l.translation) ? '歌词自带' : '' });
    this.emit({ status: 'ready', lines, source: 'LRCLIB', translationSource: lines.some(l => l.translation) ? '歌词自带' : '正在翻译…', message: '' });
    if (!lines.some(l => l.translation)) this.translate(lines, generation, selectionToken);
    return true;
  }

  async translate(lines, generation, selectionToken) {
    try {
      const translated = lines.map(line => ({ ...line }));
      const indexes = translated.map((line, index) => line.original && !line.translation ? index : -1).filter(index => index >= 0);
      for (let i = 0; i < indexes.length; i += 8) {
        if (generation !== this.generation || selectionToken !== this.selectionToken) return;
        const batch = indexes.slice(i, i + 8);
        const source = batch.map(index => translated[index].original);
        const url = new URL('https://translate.googleapis.com/translate_a/single');
        Object.entries({ client: 'gtx', sl: 'auto', tl: 'zh-CN', dt: 't', q: source.join('\n') }).forEach(([key, value]) => url.searchParams.set(key, value));
        const data = await getJson(url, 12000);
        const text = Array.isArray(data?.[0]) ? data[0].map(part => part[0] || '').join('') : '';
        let output = text.trimEnd().split('\n');
        if (output.length !== batch.length) {
          output = [];
          for (const line of source) {
            const single = new URL('https://translate.googleapis.com/translate_a/single');
            Object.entries({ client: 'gtx', sl: 'auto', tl: 'zh-CN', dt: 't', q: line }).forEach(([key, value]) => single.searchParams.set(key, value));
            const result = await getJson(single, 12000);
            output.push(Array.isArray(result?.[0]) ? result[0].map(part => part[0] || '').join('') : '');
          }
        }
        batch.forEach((index, offset) => { translated[index].translation = output[offset]?.trim() || ''; });
      }
      if (generation !== this.generation || selectionToken !== this.selectionToken) return;
      // Editing the local file during translation takes precedence over the fetched text.
      const current = fs.readFileSync(this.paths().lrc, 'utf8');
      if (current !== this.lastWritten) { this.loadLocal(true); return; }
      this.lastWritten = serializeLrc(translated);
      fs.writeFileSync(this.paths().lrc, this.lastWritten, 'utf8');
      this.writeMeta({ translationSource: '机器翻译' });
      this.emit({ lines: translated, translationSource: '机器翻译' });
    } catch {
      if (generation === this.generation && selectionToken === this.selectionToken) this.emit({ translationSource: '翻译暂不可用' });
    }
  }

  setOffset(delta) {
    if (!this.song) return;
    const offsetMs = Math.max(-30000, Math.min(30000, (this.payload.offsetMs || 0) + delta));
    this.writeMeta({ offsetMs });
    this.emit({ offsetMs });
  }

  importText(text) {
    if (!this.song) return false;
    const lines = parseLrc(text);
    if (!lines.length) return false;
    this.searchRun++;
    this.selectionToken++;
    this.lastWritten = serializeLrc(lines);
    fs.writeFileSync(this.paths().lrc, this.lastWritten, 'utf8');
    this.writeMeta({ source: '导入的 LRC', translationSource: lines.some(l => l.translation) ? '歌词自带' : '' });
    this.emit({ status: 'ready', lines, source: '导入的 LRC', translationSource: lines.some(l => l.translation) ? '歌词自带' : '', message: '' });
    return true;
  }

  ensureEditableFile() {
    if (!this.song) return null;
    const file = this.paths().lrc;
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[00:00.00]在此填写原文\n[00:00.00]在此填写中文翻译\n', 'utf8');
    return file;
  }
}

module.exports = { LyricsService, fileId, stripVersionSuffix };
