const test = require('node:test');
const assert = require('node:assert/strict');
const { requestJson, HttpError } = require('../src/lrclib-client.cjs');

function reply(status, value, retryAfter) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    json: async () => value,
  };
}

test('retries LRCLIB 503 using Retry-After, then returns the result', async () => {
  const responses = [reply(503, null, '1'), reply(200, [{ id: 7 }], null)];
  const waits = [];
  const value = await requestJson('https://lrclib.net/api/search?q=test', {
    fetchImpl: async () => responses.shift(),
    sleep: async ms => waits.push(ms),
  });
  assert.deepEqual(value, [{ id: 7 }]);
  assert.deepEqual(waits, [1000]);
});

test('does not retry an ordinary 404', async () => {
  let count = 0;
  await assert.rejects(() => requestJson('https://lrclib.net/api/get', {
    fetchImpl: async () => { count++; return reply(404); },
    sleep: async () => {},
  }), error => error instanceof HttpError && error.status === 404);
  assert.equal(count, 1);
});

test('stops after bounded 503 retries without flooding the server', async () => {
  let count = 0;
  const waits = [];
  await assert.rejects(() => requestJson('https://lrclib.net/api/search', {
    fetchImpl: async () => { count++; return reply(503, null, '1'); },
    sleep: async ms => waits.push(ms),
    maxAttempts: 3,
  }), error => error instanceof HttpError && error.status === 503);
  assert.equal(count, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('honors long 429 Retry-After by returning a wait instruction', async () => {
  let count = 0;
  await assert.rejects(() => requestJson('https://lrclib.net/api/search', {
    fetchImpl: async () => { count++; return reply(429, null, '60'); },
    sleep: async () => { throw new Error('must not retry early'); },
  }), error => error instanceof HttpError && error.status === 429 && error.retryAfterMs === 60000);
  assert.equal(count, 1);
});
