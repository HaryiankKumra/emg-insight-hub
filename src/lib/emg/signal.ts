// Lightweight DSP utilities for sEMG signals. Pure JS, runs in the browser.

export type Channel = "ch1" | "ch2" | "ch3" | "ch4";
export const CHANNELS: Channel[] = ["ch1", "ch2", "ch3", "ch4"];
export const CHANNEL_LABELS: Record<Channel, string> = {
  ch1: "MUSCLE 1",
  ch2: "MUSCLE 2",
  ch3: "MUSCLE 3",
  ch4: "MUSCLE 4",
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

export function fftMagnitude(input: number[], sampleRate: number): { freq: number[]; mag: number[] } {
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

export function qualityScore(samples: number[]): {
  score: number;
  label: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  snrDb: number;
} {
  if (!samples.length) return { score: 0, label: "POOR", snrDb: 0 };
  const s = snr(samples);
  const cleaned = Math.max(0, Math.min(40, s));
  const score = Math.round((cleaned / 40) * 100);
  const label = score >= 80 ? "EXCELLENT" : score >= 60 ? "GOOD" : score >= 35 ? "FAIR" : "POOR";
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
