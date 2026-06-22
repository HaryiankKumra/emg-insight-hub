// Biquad IIR filter implementation (RBJ cookbook)
// Provides highpass, lowpass, and notch filters for EMG signal conditioning

export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }

  setParams(fs: number, type: "highpass" | "lowpass" | "notch", f0: number, Q = 0.707) {
    const w0 = (2 * Math.PI * f0) / fs;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const alpha = sin / (2 * Q);

    let b0, b1, b2, a0, a1, a2;

    if (type === "highpass") {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else if (type === "notch") {
      b0 = 1;
      b1 = -2 * cos;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
    } else {
      return;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    this.reset();
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  process(samples: number[]): number[] {
    const out = new Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      out[i] = this.step(samples[i]);
    }
    return out;
  }
}

// Single channel filter chain: highpass → lowpass → notch
export class ChannelFilter {
  private fs: number;
  public enabled = true;
  private hp: Biquad;
  private lp: Biquad;
  private notch: Biquad;

  constructor(fs = 1000) {
    this.fs = fs;
    this.hp = new Biquad();
    this.lp = new Biquad();
    this.notch = new Biquad();
    this.rebuild(fs);
  }

  private rebuild(fs: number) {
    this.fs = fs;
    // Highpass at 20 Hz — removes motion artefact / DC offset
    this.hp.setParams(fs, "highpass", 20, 0.707);
    // Lowpass: fs*0.45 keeps LP well below Nyquist; hard cap at 450 Hz covers
    // the full 20-450 Hz EMG spectrum at 1000 Hz sampling.
    this.lp.setParams(fs, "lowpass", Math.min(450, fs * 0.45), 0.707);
    // 50 Hz notch — power line interference (Q=35 for sharp notch)
    this.notch.setParams(fs, "notch", 50, 35);
  }

  reset() {
    this.hp.reset();
    this.lp.reset();
    this.notch.reset();
  }

  updateFs(fs: number) {
    if (Math.abs(fs - this.fs) / Math.max(this.fs, 1) > 0.05) {
      this.rebuild(fs);
    }
  }

  process(samples: number[]): number[] {
    if (!this.enabled || samples.length < 2) return samples;
    let x = this.hp.process(samples);
    x = this.lp.process(x);
    x = this.notch.process(x);
    return x;
  }

  static applyOffline(samples: number[], fs = 1000): number[] {
    if (samples.length < 27) return samples;
    const f = new ChannelFilter(fs);
    f.enabled = true;
    const fwd = f.process(samples);
    const rev = f.process([...samples].reverse()).reverse();
    return fwd.map((v, i) => (v + rev[i]) / 2);
  }
}

// Manages filters for all 4 channels
export class FilterBank {
  private filters: Record<number, ChannelFilter> = {
    1: new ChannelFilter(),
    2: new ChannelFilter(),
    3: new ChannelFilter(),
    4: new ChannelFilter(),
  };
  private enabled = true;

  get isEnabled(): boolean {
    return this.enabled;
  }

  set isEnabled(v: boolean) {
    this.enabled = v;
    for (const f of Object.values(this.filters)) {
      f.enabled = v;
    }
  }

  process(channelId: number, samples: number[]): number[] {
    const f = this.filters[channelId];
    return f ? f.process(samples) : samples;
  }

  resetAll() {
    for (const f of Object.values(this.filters)) {
      f.reset();
    }
  }

  updateFs(channelId: number, fs: number) {
    const f = this.filters[channelId];
    if (f) {
      f.updateFs(fs);
    }
  }
}
