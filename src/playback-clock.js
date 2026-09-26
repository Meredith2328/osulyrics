const MAX_PREDICTION_MS = 180;

function advancePosition(state, now = Date.now()) {
  const position = Math.max(0, Number(state?.positionMs) || 0);
  if (!state?.connected || !state?.playing) return position;
  const sampledAt = Number(state.sampledAt);
  if (!Number.isFinite(sampledAt)) return position;
  const rate = Number(state.rate);
  const clockRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const elapsed = Math.max(0, Math.min(MAX_PREDICTION_MS, now - sampledAt));
  return position + elapsed * clockRate;
}

function shouldDisplayLyrics(state, positionMs) {
  if (!state?.connected || !state.song) return false;
  if (!/^(play|playing|selectplay|selectmulti|songselect|menu)$/i.test(state.state || '')) return false;
  const duration = Number(state.song.durationMs);
  return !(Number.isFinite(duration) && duration > 0 && positionMs >= duration);
}

if (typeof module !== 'undefined') module.exports = { advancePosition, shouldDisplayLyrics, MAX_PREDICTION_MS };
if (typeof window !== 'undefined') window.osuPlaybackClock = { advancePosition, shouldDisplayLyrics };
