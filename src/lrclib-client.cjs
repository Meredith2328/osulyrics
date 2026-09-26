const { setTimeout: wait } = require('node:timers/promises');

const USER_AGENT = 'osu-lyrics-companion/0.4 (personal desktop application)';

class HttpError extends Error {
  constructor(status, retryAfterMs = 0) {
    const message = status === 503 ? '歌词服务暂时繁忙（503），稍后可重试或导入本地 LRC。'
      : status === 429 ? `歌词服务请求受限（429），请在 ${Math.ceil(retryAfterMs / 1000)} 秒后重试。`
        : `歌词服务返回 HTTP ${status}`;
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function requestJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((ms, signal) => wait(ms, undefined, { signal }));
  const maxAttempts = options.maxAttempts || 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const timeout = AbortSignal.timeout(options.timeoutMs || 9000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, 'Lrclib-Client': USER_AGENT },
      signal,
    });
    if (response.ok) return response.json();
    const status = response.status;
    const fromHeader = retryAfterMs(response.headers?.get('retry-after'));
    const minimum = status === 503 ? 1000 * (2 ** attempt) : 1000;
    const delayMs = Math.max(fromHeader, minimum);
    if ((status !== 503 && status !== 429) || attempt === maxAttempts - 1 || delayMs > 15000) {
      throw new HttpError(status, delayMs);
    }
    await sleep(delayMs, options.signal);
  }
}

module.exports = { requestJson, HttpError, retryAfterMs };
