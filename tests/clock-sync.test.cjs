const test = require('node:test');
const assert = require('node:assert/strict');
const { ClockSync } = require('../src/clock-sync.cjs');

test('removes variable tosu latency using the upper envelope', () => {
  const c = new ClockSync();
  // 真实位置 = 10000 + (t - 0)；tosu 报告的值延迟 0~180ms 不等
  const lags = [120, 40, 170, 0, 90, 150, 60, 10, 130];
  let last;
  lags.forEach((lag, i) => {
    const t = 1000 + i * 100;
    last = c.update({ positionMs: 10000 + (t - 1000) - lag, sampledAt: t, rate: 1, playing: true, key: 'a' });
  });
  const truth = 10000 + 800;
  assert.ok(Math.abs(last - truth) <= 10, `got ${last}, want ~${truth}`);
});

test('never runs ahead of the reported clock by more than the observed best sample', () => {
  const c = new ClockSync();
  for (let i = 0; i < 20; i++) {
    const t = i * 100;
    const v = c.update({ positionMs: 5000 + t - 80, sampledAt: t, rate: 1, playing: true, key: 'a' });
    assert.ok(v <= 5000 + t - 80 + 1);
  }
});

test('resets on seek, song change, pause and rate change', () => {
  const c = new ClockSync();
  c.update({ positionMs: 1000, sampledAt: 0, rate: 1, playing: true, key: 'a' });
  c.update({ positionMs: 1100, sampledAt: 100, rate: 1, playing: true, key: 'a' });
  // 往回跳（选歌预览循环）
  assert.equal(c.update({ positionMs: 300, sampledAt: 200, rate: 1, playing: true, key: 'a' }), 300);
  // 换歌
  assert.equal(c.update({ positionMs: 50, sampledAt: 300, rate: 1, playing: true, key: 'b' }), 50);
  // 暂停时原样返回
  assert.equal(c.update({ positionMs: 777, sampledAt: 400, rate: 1, playing: false, key: 'b' }), 777);
  // 改速：按 1.5 倍推进
  c.update({ positionMs: 2000, sampledAt: 1000, rate: 1.5, playing: true, key: 'b' });
  assert.equal(c.update({ positionMs: 2150 - 60, sampledAt: 1100, rate: 1.5, playing: true, key: 'b' }), 2150);
});

test('a stale envelope expires so a genuine small backwards correction is followed', () => {
  const c = new ClockSync();
  for (let i = 0; i <= 10; i++) c.update({ positionMs: 1000 + i * 100, sampledAt: i * 100, rate: 1, playing: true, key: 'a' });
  // 时钟被游戏校正后整体回退 100ms（小于跳转阈值）
  let v;
  for (let i = 11; i <= 50; i++) v = c.update({ positionMs: 900 + i * 100, sampledAt: i * 100, rate: 1, playing: true, key: 'a' });
  assert.equal(v, 900 + 50 * 100);
});
