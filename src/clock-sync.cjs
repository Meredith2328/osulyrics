// 把 tosu 报告的播放位置校正成“最新鲜”的估计。
// tosu 的 time.live 有延迟：它自己每 POLL_RATE 毫秒才读一次游戏内存，HTTP/JSON 也要时间，
// 而且这个延迟会随负载变化——之前直接把 live 当成“收到时刻”的位置，用久了就会整首歌落后一个固定量。
// 做法：在正常播放时，(live - rate × 收到时刻) 理论上是常数；延迟只会让它变小，
// 所以取最近一段时间里的最大值（上包络），就能去掉延迟而又不会提前。
const WINDOW_MS = 3000;   // 上包络窗口
const JUMP_MS = 250;      // 超过这个差值视为跳转/重开/循环，重置

class ClockSync {
  constructor() { this.reset(); }

  reset() {
    this.key = null;
    this.rate = 1;
    this.samples = [];
    this.envelope = null;
  }

  // sample: { positionMs, sampledAt, rate, playing, key }
  update(sample) {
    const rate = Number(sample.rate) > 0 ? Number(sample.rate) : 1;
    const t = Number(sample.sampledAt);
    const pos = Number(sample.positionMs) || 0;
    if (!sample.playing || !Number.isFinite(t) || sample.key !== this.key || rate !== this.rate) {
      this.reset();
      this.key = sample.key;
      this.rate = rate;
      if (!sample.playing) return pos;
    }
    const offset = pos - rate * t;
    if (this.envelope === null || Math.abs(offset - this.envelope) > JUMP_MS) {
      this.samples = [];
    }
    this.samples.push({ t, offset });
    while (this.samples.length && t - this.samples[0].t > WINDOW_MS) this.samples.shift();
    this.envelope = Math.max(...this.samples.map(s => s.offset));
    return this.envelope + rate * t;
  }
}

module.exports = { ClockSync, WINDOW_MS, JUMP_MS };
