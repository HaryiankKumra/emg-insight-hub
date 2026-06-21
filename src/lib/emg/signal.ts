// Lightweight DSP utilities for sEMG signals. Pure JS, runs in the browser.

export type Channel = "ch1" | "ch2" | "ch3" | "ch4";
export const CHANNELS: Channel[] = ["ch1", "ch2", "ch3", "ch4"];
export const CHANNEL_LABELS: Record<Channel, string> = {
  ch1: "Rectus Femoris (Quad)",
  ch2: "Biceps Femoris (Hamstring)",
  ch3: "Gastrocnemius Lateralis (Calf)",
  ch4: "Tibialis Anterior (TA)",
};
export const CHANNEL_COLORS: Record<Channel, string> = {
  ch1: "var(--neon-green)",
  ch2: "var(--neon-cyan)",
  ch3: "var(--neon-amber)",
  ch4: "var(--neon-magenta)",
};

export interface EmgSample {
  t: number; // seconds
  ch1: number;
  ch2: number;
  ch3: number;
  ch4: number;
}

export interface EmgDataset {
  id: string;
  name: string;
  sampleRate: number; // Hz
  samples: EmgSample[];
  uploadedAt: number;
  source: "mock" | "csv";
}

export function mean(a: number[]): number {
  if (!a.length) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}
export function rms(a: number[]): number {
  if (!a.length) return 0;
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s / a.length);
}
export function mav(a: number[]): number {
  if (!a.length) return 0;
  let s = 0;
  for (const v of a) s += Math.abs(v);
  return s / a.length;
}
export function energy(a: number[]): number {
  let s = 0;
  for (const v of a) s += v * v;
  return s;
}
export function zeroCrossings(a: number[], thresh = 0.01): number {
  let n = 0;
  for (let i = 1; i < a.length; i++) {
    if ((a[i - 1] > thresh && a[i] < -thresh) || (a[i - 1] < -thresh && a[i] > thresh)) n++;
  }
  return n;
}
export function variance(a: number[]): number {
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return s / Math.max(1, a.length);
}
export function snr(a: number[]): number {
  // crude: signal power / noise power estimated from high-pass residual
  const m = mean(a);
  const sig = variance(a);
  let noise = 0;
  for (let i = 1; i < a.length; i++) noise += (a[i] - a[i - 1]) ** 2;
  noise = noise / Math.max(1, a.length - 1);
  if (noise === 0) return 0;
  const r = sig / noise;
  return 10 * Math.log10(Math.max(1e-9, r));
}

// True SNR for raw sEMG: compare active window RMS to rest baseline RMS.
// Both inputs are baseline-centered mV samples.
export function snrFromBaseline(active: number[], baseline: number[]): number {
  const sigRms = rms(active);
  const noiseRms = rms(baseline);
  if (noiseRms <= 1e-9) return sigRms > 0 ? 60 : 0;
  return 20 * Math.log10(sigRms / noiseRms);
}

// Sliding-window RMS envelope (window in samples).
export function rmsEnvelope(a: number[], window: number): number[] {
  const N = a.length;
  const w = Math.max(2, Math.floor(window));
  const out = new Array<number>(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += a[i] * a[i];
    if (i >= w) acc -= a[i - w] * a[i - w];
    const denom = Math.min(i + 1, w);
    out[i] = Math.sqrt(acc / denom);
  }
  return out;
}

export function sliceByTime(ds: EmgDataset, t0: number, t1: number): EmgSample[] {
  return ds.samples.filter((s) => s.t >= t0 && s.t < t1);
}

// Quality grade for raw EMG using rest-vs-active SNR (dB).
export function qualityFromSnr(snrDb: number): {
  score: number;
  label: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  snrDb: number;
} {
  // Map 0..30 dB → 0..100. Typical good sEMG sits at 15–25 dB above rest.
  const clamped = Math.max(0, Math.min(30, snrDb));
  const score = Math.round((clamped / 30) * 100);
  const label = score >= 75 ? "EXCELLENT" : score >= 50 ? "GOOD" : score >= 25 ? "FAIR" : "POOR";
  return { score, label, snrDb };
}

// ---------- FFT (iterative radix-2 Cooley-Tukey) ----------
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function fftMagnitude(
  input: number[],
  sampleRate: number,
): { freq: number[]; mag: number[] } {
  const N = nextPow2(input.length);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  // Hann window + zero-pad
  for (let i = 0; i < input.length; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (input.length - 1 || 1)));
    re[i] = input[i] * w;
  }
  // bit reversal
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * wRe - im[i + k + half] * wIm;
        const vIm = re[i + k + half] * wIm + im[i + k + half] * wRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nRe;
      }
    }
  }
  const half = N >> 1;
  const freq: number[] = new Array(half);
  const mag: number[] = new Array(half);
  for (let i = 0; i < half; i++) {
    freq[i] = (i * sampleRate) / N;
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / N;
  }
  return { freq, mag };
}

export function spectralMetrics(freq: number[], mag: number[]) {
  let total = 0;
  let weighted = 0;
  let dominant = 0;
  let dominantMag = 0;
  for (let i = 0; i < freq.length; i++) {
    const p = mag[i] * mag[i];
    total += p;
    weighted += freq[i] * p;
    if (mag[i] > dominantMag) {
      dominantMag = mag[i];
      dominant = freq[i];
    }
  }
  const meanFreq = total > 0 ? weighted / total : 0;
  // median frequency
  let cum = 0;
  let median = 0;
  const half = total / 2;
  for (let i = 0; i < freq.length; i++) {
    cum += mag[i] * mag[i];
    if (cum >= half) {
      median = freq[i];
      break;
    }
  }
  return { meanFreq, medianFreq: median, dominantFreq: dominant };
}

export function estimateSnr(samples: number[], sampleRate = 1000): number {
  if (samples.length < sampleRate * 0.5) return 0; // too short

  // Slide a 200ms window to find RMS values
  const winLen = Math.max(5, Math.floor(sampleRate * 0.2)); // 200ms
  const step = Math.max(2, Math.floor(sampleRate * 0.05)); // 50ms step
  const rmsVals: number[] = [];

  for (let i = 0; i <= samples.length - winLen; i += step) {
    let sumSq = 0;
    for (let j = 0; j < winLen; j++) {
      const v = samples[i + j];
      sumSq += v * v;
    }
    rmsVals.push(Math.sqrt(sumSq / winLen));
  }

  if (!rmsVals.length) return 0;

  rmsVals.sort((a, b) => a - b);

  // Noise floor is estimated as the 10th percentile of RMS (minimum noise during rest periods)
  const noiseFloor = rmsVals[Math.floor(rmsVals.length * 0.1)] ?? 1e-6;

  // Active signal is estimated as the 90th percentile of RMS (maximum contraction amplitude)
  const activeLevel = rmsVals[Math.floor(rmsVals.length * 0.9)] ?? 1e-6;

  if (noiseFloor <= 1e-9) return activeLevel > 0 ? 60 : 0;

  const ratio = activeLevel / noiseFloor;
  return 20 * Math.log10(Math.max(1, ratio));
}

export function qualityScore(
  samples: number[],
  sampleRate = 1000,
): {
  score: number;
  label: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  snrDb: number;
} {
  if (!samples.length) return { score: 0, label: "POOR", snrDb: 0 };
  const s = estimateSnr(samples, sampleRate);
  const clamped = Math.max(0, Math.min(30, s));
  const score = Math.round((clamped / 30) * 100);
  const label = score >= 75 ? "EXCELLENT" : score >= 50 ? "GOOD" : score >= 25 ? "FAIR" : "POOR";
  return { score, label, snrDb: s };
}

export function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

export function channelArray(ds: EmgDataset, ch: Channel): number[] {
  return ds.samples.map((s) => s[ch]);
}

// Biquad filter implementation for sEMG DSP processing
export class BiquadFilter {
  a1 = 0;
  a2 = 0;
  b0 = 1;
  b1 = 0;
  b2 = 0;

  // State variables
  x1 = 0;
  x2 = 0;
  y1 = 0;
  y2 = 0;

  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

// High-pass filter coefficients (2nd order Butterworth)
export function createHighPass(fc: number, fs: number): BiquadFilter {
  const tan = Math.tan((Math.PI * fc) / fs);
  const c = tan * tan;
  const sqrt2 = Math.sqrt(2);
  const denom = 1 + sqrt2 * tan + c;

  const b0 = 1 / denom;
  const b1 = -2 / denom;
  const b2 = 1 / denom;
  const a1 = (2 * (c - 1)) / denom;
  const a2 = (1 - sqrt2 * tan + c) / denom;

  return new BiquadFilter(b0, b1, b2, a1, a2);
}

// Low-pass filter coefficients (2nd order Butterworth)
export function createLowPass(fc: number, fs: number): BiquadFilter {
  const tan = Math.tan((Math.PI * fc) / fs);
  const c = tan * tan;
  const sqrt2 = Math.sqrt(2);
  const denom = 1 + sqrt2 * tan + c;

  const b0 = c / denom;
  const b1 = (2 * c) / denom;
  const b2 = c / denom;
  const a1 = (2 * (c - 1)) / denom;
  const a2 = (1 - sqrt2 * tan + c) / denom;

  return new BiquadFilter(b0, b1, b2, a1, a2);
}

// Notch filter coefficients (removes specific frequency band like 50/60 Hz)
export function createNotch(f0: number, fs: number, q = 10): BiquadFilter {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);

  const b0 = 1;
  const b1 = -2 * cosw0;
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  return new BiquadFilter(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

// Processes a complete dataset through the filter pipeline
export function preprocessDataset(ds: EmgDataset): EmgDataset {
  const fs = ds.sampleRate;

  // Create unique filter pipelines for each channel
  const createPipeline = () => {
    const hp = createHighPass(20, fs);
    const lp = createLowPass(Math.min(450, fs * 0.45), fs);
    const notch50 = createNotch(50, fs, 8);
    const notch60 = createNotch(60, fs, 8);
    return { hp, lp, notch50, notch60 };
  };

  const pipelines = {
    ch1: createPipeline(),
    ch2: createPipeline(),
    ch3: createPipeline(),
    ch4: createPipeline(),
  };

  const processedSamples = ds.samples.map((s) => {
    const processCh = (val: number, pipe: ReturnType<typeof createPipeline>) => {
      let v = val;
      v = pipe.hp.process(v);
      v = pipe.notch50.process(v);
      v = pipe.notch60.process(v);
      v = pipe.lp.process(v);
      return v;
    };

    return {
      t: s.t,
      ch1: processCh(s.ch1, pipelines.ch1),
      ch2: processCh(s.ch2, pipelines.ch2),
      ch3: processCh(s.ch3, pipelines.ch3),
      ch4: processCh(s.ch4, pipelines.ch4),
    };
  });

  return {
    ...ds,
    samples: processedSamples,
  };
}
