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
  isFiltered?: boolean;
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

// ========== EMG-SPECIFIC QUALITY ASSESSMENT (Rep-Window Based) ==========

// Detect contiguous activation windows (reps), not individual peaks
// A rep = one continuous period of muscle activity, regardless of multiple peaks
export function detectActivationWindows(
  signal: number[],
  sampleRate: number,
  rmsWindowMs: number = 150, // 150ms window matching the envelope smoothing
  activationThresholdPercentile: number = 75, // 75th percentile adaptive threshold
  minWindowDurationMs: number = 150, // 150ms minimum duration
  minGapBetweenRepsMs: number = 500, // 500ms minimum gap
): {
  windows: Array<{ startIdx: number; endIdx: number; peakRms: number; duration: number }>;
  threshold: number;
  details: string;
} {
  const result = countRepsBurstDetection(
    signal,
    sampleRate,
    rmsWindowMs,
    activationThresholdPercentile,
    minGapBetweenRepsMs,
    minWindowDurationMs,
    0, // Already trimmed
    false // Is raw signal
  );

  const windows = result.bursts.map(b => {
    let maxRms = 0;
    for (let i = b.startIdx; i < b.endIdx; i++) {
      if (result.envelope[i] > maxRms) maxRms = result.envelope[i];
    }
    return {
      startIdx: b.startIdx,
      endIdx: b.endIdx,
      peakRms: maxRms,
      duration: b.duration
    };
  });

  return {
    windows,
    threshold: result.threshold,
    details: `${windows.length} activation windows detected (threshold: ${result.threshold.toFixed(3)})`,
  };
}

// Assess EMG signal quality based on activation windows (reps)
// Returns: rep count (actual movement reps), window consistency, quality grade
export function assessEmgSignalQuality(
  signal: number[],
  sampleRate: number,
  minRepDistance: number = 500, // Min ms between reps (default 500ms for controlled exercises)
): {
  repCount: number;
  windowDurations: number[]; // Duration of each rep window (ms)
  repConsistency: number; // 0-100: how similar are rep durations?
  quality: string; // "EXCELLENT" | "GOOD" | "FAIR" | "POOR"
  score: number; // 0-100
  details: string;
} {
  // Detect activation windows (each window = 1 rep)
  const { windows, threshold, details: winDetails } = detectActivationWindows(
    signal,
    sampleRate,
    50, // RMS window (50ms)
    35, // Percentile threshold (35% balances weak & strong muscles)
    100, // Min window duration (100ms)
    minRepDistance, // Gap between windows = gap between reps
  );

  if (windows.length === 0) {
    return {
      repCount: 0,
      windowDurations: [],
      repConsistency: 0,
      quality: "POOR",
      score: 0,
      details: "No muscle activations detected",
    };
  }

  // Convert window durations to milliseconds
  const windowDurationsMs = windows.map((w) => (w.duration / sampleRate) * 1000);

  // Calculate consistency of window durations (how similar are the reps?)
  const durationMean = mean(windowDurationsMs);
  const durationStd = Math.sqrt(variance(windowDurationsMs));
  const repConsistency = durationStd > 0 ? Math.max(0, 100 - (durationStd / durationMean) * 100) : 100;

  // Quality grading based on rep count and consistency
  let quality: string;
  let score: number;

  // Heuristic: more reps with higher consistency = better
  const consistency = Math.max(0, repConsistency);
  const repScore = Math.min(100, windows.length * 10); // Up to 10 reps = 100%

  if (consistency > 70 && windows.length >= 8) {
    quality = "EXCELLENT";
    score = 90 + Math.floor((consistency / 100) * 10);
  } else if (consistency > 60 && windows.length >= 5) {
    quality = "GOOD";
    score = 70 + Math.floor((consistency / 100) * 20);
  } else if (consistency > 40 && windows.length >= 2) {
    quality = "FAIR";
    score = 50 + Math.floor((consistency / 100) * 20);
  } else if (windows.length >= 1) {
    quality = "FAIR";
    score = Math.floor((consistency / 100) * 50);
  } else {
    quality = "POOR";
    score = 0;
  }

  return {
    repCount: windows.length,
    windowDurations: windowDurationsMs,
    repConsistency: consistency,
    quality,
    score: Math.round(score),
    details: `${windows.length} reps | Avg duration: ${durationMean.toFixed(0)}ms | Consistency: ${consistency.toFixed(0)}%`,
  };
}

// Find local maxima (peaks = muscle activation events)
// Peaks represent motor unit activation
export function findLocalMaxima(
  signal: number[],
  minDistance: number = 50, // Minimum samples between peaks (for 1kHz: ~50ms)
  threshold: number = 0, // Minimum peak height above this value
): number[] {
  const peaks: number[] = [];
  
  if (signal.length < 3) return peaks;

  for (let i = 1; i < signal.length - 1; i++) {
    // Local maximum: current > neighbors AND above threshold
    if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1] && signal[i] > threshold) {
      // Check if far enough from last peak
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      }
    }
  }

  return peaks;
}

// Detect and remove anomalous peaks (outliers in peak heights)
export function filterOutlierPeaks(
  signal: number[],
  peakIndices: number[],
  zScoreThreshold: number = 2.5, // Conservative for physiological signals
): { cleanPeaks: number[]; outlierPeaks: number[] } {
  if (peakIndices.length === 0) return { cleanPeaks: [], outlierPeaks: [] };

  // Get peak heights
  const peakHeights = peakIndices.map((idx) => signal[idx]);

  // Calculate median and MAD (Modified Z-Score)
  const sorted = [...peakHeights].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mad = [...peakHeights.map((h) => Math.abs(h - median))].sort((a, b) => a - b)[
    Math.floor(peakHeights.length / 2)
  ];

  const cleanPeaks: number[] = [];
  const outlierPeaks: number[] = [];

  for (let i = 0; i < peakIndices.length; i++) {
    const modZ = mad > 0 ? Math.abs((0.6745 * (peakHeights[i] - median)) / mad) : 0;

    if (modZ <= zScoreThreshold) {
      cleanPeaks.push(peakIndices[i]);
    } else {
      outlierPeaks.push(peakIndices[i]);
    }
  }

  return { cleanPeaks, outlierPeaks };
}

// True SNR for raw sEMG: compare active window RMS to rest baseline RMS.
// Both inputs are baseline-centered mV samples.
export function snrFromBaseline(active: number[], baseline: number[]): number {
  const sigRms = rms(active);
  const noiseRms = rms(baseline);
  if (noiseRms <= 1e-9) return sigRms > 0 ? 60 : 0;
  return 20 * Math.log10(sigRms / noiseRms);
}

// Calculate quality from RAW (unfiltered) dataset using ADAPTIVE baseline detection
// For MyoWare 2.0: finds actual quiet/rest periods, not pre-decided baseline
// Uses activation WINDOWS (reps) not individual peaks - accounts for multi-phase movements
export function calculateQualityFromRaw(
  rawDs: EmgDataset,
  channels: Channel[] = CHANNELS,
  skipFirstSecs = 2.5,
): Record<
  Channel,
  {
    snrDb: number;
    label: string;
    score: number;
    repCount: number;
    repConsistency: number;
    qualityBasis: string;
    details: string;
  }
> {
  const fs = rawDs.sampleRate;
  const skipSamples = Math.floor(skipFirstSecs * fs);
  const usableSamples = rawDs.samples.filter((_, idx) => idx >= skipSamples);

  if (usableSamples.length === 0) {
    const emptyResult = {
      snrDb: 0,
      label: "POOR",
      score: 0,
      repCount: 0,
      repConsistency: 0,
      qualityBasis: "No data",
      details: "Insufficient samples",
    };
    return {
      ch1: emptyResult,
      ch2: emptyResult,
      ch3: emptyResult,
      ch4: emptyResult,
    };
  }

  // Create temporary dataset from usable samples for activity detection
  const tempDs: EmgDataset = {
    ...rawDs,
    samples: usableSamples,
  };

  // ADAPTIVE: Detect actual quiet periods (baseline) using RMS envelope
  let baselineIndices: number[] = [];
  let activeIndices: number[] = [];

  try {
    const { quietPeriods, activePeriods } = detectActivityPeriods(tempDs, channels, 100, 25);

    // If quiet periods found, use first one for baseline
    if (quietPeriods.length > 0 && quietPeriods[0].indices.length > 10) {
      baselineIndices = quietPeriods[0].indices;
    }

    // If active periods found, use all of them
    if (activePeriods.length > 0) {
      for (const period of activePeriods) {
        activeIndices.push(...period.indices);
      }
    }
  } catch (err) {
    // Fallback if activity detection fails
    console.warn("Activity detection failed, using fallback baseline");
  }

  // Fallback to first-1/3 / last-2/3 if activity detection didn't work
  if (baselineIndices.length === 0) {
    baselineIndices = usableSamples.map((_, i) => i).slice(0, Math.ceil(usableSamples.length / 3));
  }
  if (activeIndices.length === 0) {
    const start = Math.ceil(usableSamples.length / 3);
    activeIndices = usableSamples.map((_, i) => i).slice(start);
  }

  // Ensure we have data
  if (baselineIndices.length === 0 || activeIndices.length === 0) {
    const emptyResult = {
      snrDb: 0,
      label: "POOR",
      score: 0,
      repCount: 0,
      repConsistency: 0,
      qualityBasis: "Failed detection",
      details: "Could not segment baseline/active",
    };
    return {
      ch1: emptyResult,
      ch2: emptyResult,
      ch3: emptyResult,
      ch4: emptyResult,
    };
  }

  const result: Record<
    Channel,
    {
      snrDb: number;
      label: string;
      score: number;
      repCount: number;
      repConsistency: number;
      qualityBasis: string;
      details: string;
    }
  > = {
    ch1: {
      snrDb: 0,
      label: "POOR",
      score: 0,
      repCount: 0,
      repConsistency: 0,
      qualityBasis: "N/A",
      details: "Not calculated",
    },
    ch2: {
      snrDb: 0,
      label: "POOR",
      score: 0,
      repCount: 0,
      repConsistency: 0,
      qualityBasis: "N/A",
      details: "Not calculated",
    },
    ch3: {
      snrDb: 0,
      label: "POOR",
      score: 0,
      repCount: 0,
      repConsistency: 0,
      qualityBasis: "N/A",
      details: "Not calculated",
    },
    ch4: {
      snrDb: 0,
      label: "POOR",
      score: 0,
      repCount: 0,
      repConsistency: 0,
      qualityBasis: "N/A",
      details: "Not calculated",
    },
  };

  for (const ch of channels) {
    const baselineValues = baselineIndices.map((i) => usableSamples[i][ch]);
    const activeValues = activeIndices.map((i) => usableSamples[i][ch]);

    // Metric 1: SNR (from baseline vs active)
    const snrDb = snrFromBaseline(activeValues, baselineValues);
    const snrGrade = qualityFromSnr(snrDb);

    // Metric 2: Rep-window based quality (counts actual reps, not peaks)
    const repQuality = assessEmgSignalQuality(activeValues, fs, 500);

    // COMBINED ASSESSMENT: Use rep-window assessment (more physiologically accurate)
    let finalLabel: string = repQuality.quality;
    let finalScore: number = repQuality.score;

    // If reps detected, trust the rep count and consistency
    if (repQuality.repCount > 0) {
      finalLabel = repQuality.quality;
      finalScore = repQuality.score;
    } else {
      // No reps detected = use SNR-based assessment as fallback
      finalLabel = snrGrade.label;
      finalScore = snrGrade.score;
    }

    result[ch] = {
      snrDb,
      label: finalLabel,
      score: finalScore,
      repCount: repQuality.repCount,
      repConsistency: Math.round(repQuality.repConsistency),
      qualityBasis: repQuality.repCount > 0 ? "REP-WINDOW" : "SNR-based",
      details: repQuality.details,
    };
  }

  return result;
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

// Remove statistical outliers using Modified Z-Score method (robust to non-normal distributions)
// Returns indices of outliers for potential removal
export function detectOutliers(
  samples: EmgSample[],
  channels: Channel[] = CHANNELS,
  threshold = 3.5,
): number[] {
  const outlierIndices = new Set<number>();

  for (const ch of channels) {
    const values = samples.map((s) => s[ch]);
    const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const mad = [...values.map((v) => Math.abs(v - median))].sort((a, b) => a - b)[
      Math.floor(values.length / 2)
    ];
    const c = 1.4826; // constant for normal distribution

    for (let i = 0; i < samples.length; i++) {
      const modZ = Math.abs((0.6745 * (values[i] - median)) / (mad + 1e-9));
      if (modZ > threshold) {
        outlierIndices.add(i);
      }
    }
  }

  return Array.from(outlierIndices).sort((a, b) => a - b);
}

// Detect activity periods for MyoWare EMG - finds quiet (rest) vs active windows
// Uses RMS envelope to identify actual baseline periods (not pre-decided)
export function detectActivityPeriods(
  ds: EmgDataset,
  channels: Channel[] = CHANNELS,
  windowMs = 100, // RMS window in milliseconds
  quietThresholdPercentile = 25, // Bottom 25% = "quiet"
): {
  quietPeriods: Array<{ start: number; end: number; indices: number[] }>;
  activePeriods: Array<{ start: number; end: number; indices: number[] }>;
} {
  const fs = ds.sampleRate;
  const windowSamples = Math.max(1, Math.floor((windowMs / 1000) * fs));

  // Compute RMS envelope across all channels
  const rmsPerSample: number[] = [];
  for (const sample of ds.samples) {
    let sumSq = 0;
    for (const ch of channels) {
      sumSq += sample[ch] * sample[ch];
    }
    rmsPerSample.push(Math.sqrt(sumSq / channels.length));
  }

  // Smooth RMS with sliding window
  const smoothedRms: number[] = [];
  for (let i = 0; i < rmsPerSample.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSamples); j <= Math.min(rmsPerSample.length - 1, i + windowSamples); j++) {
      sum += rmsPerSample[j];
      count++;
    }
    smoothedRms.push(sum / count);
  }

  // Find quiet threshold (bottom percentile)
  const sorted = [...smoothedRms].sort((a, b) => a - b);
  const quietThresh = sorted[Math.floor(sorted.length * (quietThresholdPercentile / 100))];

  // Segment into quiet vs active
  const quietPeriods: Array<{ start: number; end: number; indices: number[] }> = [];
  const activePeriods: Array<{ start: number; end: number; indices: number[] }> = [];

  let inQuiet = smoothedRms[0] <= quietThresh;
  let periodStart = 0;
  const currentIndices: number[] = [0];

  for (let i = 1; i < smoothedRms.length; i++) {
    const isQuiet = smoothedRms[i] <= quietThresh;
    if (isQuiet !== inQuiet) {
      // Transition
      const periodEnd = i;
      const period = {
        start: ds.samples[periodStart].t,
        end: ds.samples[periodEnd - 1].t,
        indices: currentIndices.slice(),
      };
      if (inQuiet) quietPeriods.push(period);
      else activePeriods.push(period);

      periodStart = i;
      currentIndices.length = 0;
      inQuiet = isQuiet;
    }
    currentIndices.push(i);
  }
  // Final period
  if (currentIndices.length > 0) {
    const period = {
      start: ds.samples[periodStart].t,
      end: ds.samples[ds.samples.length - 1].t,
      indices: currentIndices,
    };
    if (inQuiet) quietPeriods.push(period);
    else activePeriods.push(period);
  }

  return { quietPeriods, activePeriods };
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
// Options: skipFirstSecs = skip first N seconds (default 2 for filter warm-up + startup transients)
export function preprocessDataset(ds: EmgDataset, skipFirstSecs = 2.5): EmgDataset {
  const fs = ds.sampleRate;
  const skipSamples = Math.floor(skipFirstSecs * fs);

  // Extract signals for each channel
  const chNames: Channel[] = ["ch1", "ch2", "ch3", "ch4"];
  const rawSignals: Record<Channel, number[]> = {
    ch1: ds.samples.map(s => s.ch1),
    ch2: ds.samples.map(s => s.ch2),
    ch3: ds.samples.map(s => s.ch3),
    ch4: ds.samples.map(s => s.ch4),
  };

  const processedSignals: Record<Channel, number[]> = {} as any;

  // Process each channel
  for (const ch of chNames) {
    let sig = rawSignals[ch];

    // 1. DC Removal
    sig = dcRemoval(sig);

    // 2. Spike clipping at ±3σ
    sig = spikeClipping(sig);

    // 3. Filtering (skip if already filtered)
    if (ds.isFiltered) {
      processedSignals[ch] = sig;
    } else {
      // Create filter pipeline
      const hp = createHighPass(20, fs);
      const lp = createLowPass(Math.min(450, fs * 0.45), fs);
      const notch50 = createNotch(50, fs, 30); // Q = 30 for 50Hz
      const notch60 = createNotch(60, fs, 30); // Q = 30 for 60Hz

      // Warm up filters
      const warmupSamples = Math.max(1, Math.floor(fs * 0.5));
      for (let i = 0; i < warmupSamples && i < sig.length; i++) {
        let v = sig[i];
        v = hp.process(v);
        v = notch50.process(v);
        v = notch60.process(v);
        v = lp.process(v);
      }

      // Filter the signal
      processedSignals[ch] = sig.map(v => {
        let out = v;
        out = hp.process(out);
        out = notch50.process(out);
        out = notch60.process(out);
        out = lp.process(out);
        return out;
      });
    }
  }

  // Construct processed samples
  const processedSamples = ds.samples
    .map((s, idx) => {
      return {
        t: s.t,
        ch1: processedSignals.ch1[idx],
        ch2: processedSignals.ch2[idx],
        ch3: processedSignals.ch3[idx],
        ch4: processedSignals.ch4[idx],
        _originalIdx: idx,
      };
    })
    .filter((s) => s._originalIdx >= skipSamples)
    .map(({ _originalIdx, ...s }) => s as EmgSample);

  return {
    ...ds,
    samples: processedSamples,
  };
}

// ========== ENHANCED PREPROCESSING PIPELINE (from IEEE research spec) ==========
// These functions implement the exact DSP pipeline from the research paper

/**
 * Step 1: DC Removal
 * Subtract mean to remove DC offset
 */
export function dcRemoval(signal: number[]): number[] {
  if (!signal.length) return [];
  const m = mean(signal);
  return signal.map(v => v - m);
}

/**
 * Step 2: Spike Clipping
 * Remove outliers by clipping at ±3σ (3 standard deviations)
 * Prevents saturation from muscle cramps or electrode artifacts
 */
export function spikeClipping(signal: number[]): number[] {
  if (!signal.length) return [];
  const std = Math.sqrt(variance(signal));
  const threshold = 3 * std;
  return signal.map(v => Math.max(-threshold, Math.min(threshold, v)));
}

/**
 * Step 3: Full-Wave Rectification
 * Take absolute value to get envelope
 */
export function fullWaveRectification(signal: number[]): number[] {
  return signal.map(v => Math.abs(v));
}

/**
 * Helper: Moving Average for smoothing
 * Used for RMS envelope and peak detection
 */
export function movingAverage(signal: number[], windowSamples: number): number[] {
  if (!signal.length) return [];
  const halfW = Math.floor(windowSamples / 2);
  return signal.map((_, i) => {
    const start = Math.max(0, i - halfW);
    const end = Math.min(signal.length, i + halfW + 1);
    const slice = signal.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/**
 * Step 4 & 5: RMS Envelope Computation (Advanced version with explicit parameters)
 * Compute RMS in sliding window (typically 200ms)
 * This gives the envelope of muscle activity
 */
export function rmsEnvelopeAdvanced(signal: number[], windowMs: number = 200, sampleRate: number = 1000): number[] {
  if (!signal.length) return [];
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const halfW = Math.floor(windowSamples / 2);
  
  return signal.map((_, i) => {
    const start = Math.max(0, i - halfW);
    const end = Math.min(signal.length, i + halfW + 1);
    let sumSq = 0;
    for (let j = start; j < end; j++) {
      sumSq += signal[j] * signal[j];
    }
    return Math.sqrt(sumSq / (end - start));
  });
}

/**
 * Peak Detection for Rep Counting (Enhanced with Prominence Filtering)
 * Finds local maxima in smoothed envelope that meet prominence criteria
 * Prominence = height above background noise, prevents noise spikes from counting
 * Returns peak indices and metadata
 */
/**
 * Core rep counter based on the GymEMG-Net 12-step/11-step pipeline.
 * Implements: demean + rectify + smooth + percentile threshold + burst detection + merge + min length filter.
 */
export function countRepsBurstDetection(
  signalOrEnvelope: number[],
  sampleRate: number = 1000,
  smoothMs: number = 150,
  thresholdPercentile: number = 75,
  minGapMs: number = 500,
  minBurstDurationMs: number = 150,
  skipFirstSecs: number = 2.5,
  isEnvelopeAlready: boolean = false
): {
  count: number;
  bursts: Array<{ startIdx: number; endIdx: number; duration: number }>;
  envelope: number[];
  threshold: number;
} {
  let sig = [...signalOrEnvelope];

  // 3. Trim Start
  if (!isEnvelopeAlready && skipFirstSecs > 0) {
    const trimSamples = Math.floor(skipFirstSecs * sampleRate);
    sig = sig.slice(trimSamples);
  }

  if (sig.length === 0) {
    return { count: 0, bursts: [], envelope: [], threshold: 0 };
  }

  let envelope: number[];

  if (isEnvelopeAlready) {
    envelope = sig;
  } else {
    // 5. Demean & 6. Rectify
    const nonNanVal = sig.filter(v => v !== null && v !== undefined && !Number.isNaN(v));
    if (nonNanVal.length === 0) {
      return { count: 0, bursts: [], envelope: [], threshold: 0 };
    }
    const sorted = [...nonNanVal].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const rectified = sig.map(v => Math.abs(v - median));

    // 7. Smooth (Envelope) via moving average (150ms window)
    const w = Math.max(1, Math.floor((smoothMs / 1000) * sampleRate));
    envelope = movingAverage(rectified, w);
  }

  // 8. Threshold (75th percentile of the envelope)
  const nonNanEnv = envelope.filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  if (nonNanEnv.length === 0) {
    return { count: 0, bursts: [], envelope: [], threshold: 0 };
  }
  const sortedEnv = [...nonNanEnv].sort((a, b) => a - b);
  const threshold = sortedEnv[Math.floor(sortedEnv.length * (thresholdPercentile / 100))];

  // 9. Burst Detection (envelope > threshold)
  const active = envelope.map(v => v > threshold);
  const minGap = Math.floor((minGapMs / 1000) * sampleRate);
  const minLen = Math.floor((minBurstDurationMs / 1000) * sampleRate);

  const rawBursts: Array<{ startIdx: number; endIdx: number; duration: number }> = [];
  let inBurst = false;
  let start = 0;

  for (let i = 0; i < active.length; i++) {
    if (active[i] && !inBurst) {
      inBurst = true;
      start = i;
    } else if (!active[i] && inBurst) {
      inBurst = false;
      rawBursts.push({ startIdx: start, endIdx: i, duration: i - start });
    }
  }
  if (inBurst) {
    rawBursts.push({ startIdx: start, endIdx: active.length, duration: active.length - start });
  }

  // 10. Merge Gaps (< 500ms)
  const mergedBursts: Array<{ startIdx: number; endIdx: number; duration: number }> = [];
  for (const b of rawBursts) {
    if (mergedBursts.length > 0 && (b.startIdx - mergedBursts[mergedBursts.length - 1].endIdx) < minGap) {
      mergedBursts[mergedBursts.length - 1].endIdx = b.endIdx;
      mergedBursts[mergedBursts.length - 1].duration = b.endIdx - mergedBursts[mergedBursts.length - 1].startIdx;
    } else {
      mergedBursts.push({ ...b });
    }
  }

  // 11. Filter Short (< 150ms)
  const filteredBursts = mergedBursts.filter(b => b.duration >= minLen);

  return {
    count: filteredBursts.length,
    bursts: filteredBursts,
    envelope,
    threshold
  };
}

export function detectReps(
  envelope: number[],
  sampleRate: number = 1000,
  minRepGapMs: number = 1500,
  thresholdPercentile: number = 70
): {
  count: number;
  peaks: number[];
  smooth: number[];
  threshold: number;
  prominenceThreshold?: number;
} {
  const result = countRepsBurstDetection(
    envelope,
    sampleRate,
    150,
    thresholdPercentile,
    minRepGapMs,
    150,
    0,
    true
  );

  return {
    count: result.count,
    peaks: result.bursts.map(b => Math.round((b.startIdx + b.endIdx) / 2)),
    smooth: result.envelope,
    threshold: result.threshold,
    prominenceThreshold: 0
  };
}

/**
 * Complete Channel Preprocessing Pipeline
 * Combines all steps: DC removal → spike clipping → filtering → rectification → RMS envelope
 * This matches the IEEE research paper preprocessing exactly
 */
export function preprocessChannelAdvanced(
  signal: number[],
  sampleRate: number = 1000
): {
  original: number[];
  dcRemoved: number[];
  clipped: number[];
  rectified: number[];
  envelope: number[];
} {
  // Store intermediate results for debugging/visualization
  const original = [...signal];
  
  // Step 1: DC removal
  const dcRemoved = dcRemoval(signal);
  
  // Step 2: Spike clipping at ±3σ
  const clipped = spikeClipping(dcRemoved);
  
  // Note: Bandpass and notch filtering is already done in preprocessDataset()
  // using Butterworth/biquad filters. Here we assume the signal is pre-filtered.
  
  // Step 3: Full-wave rectification
  const rectified = fullWaveRectification(clipped);
  
  // Step 4: RMS envelope
  const envelope = rmsEnvelopeAdvanced(rectified, 200, sampleRate);
  
  return {
    original,
    dcRemoved,
    clipped,
    rectified,
    envelope
  };
}

/**
 * Exercise-Specific Rep Detection Configuration
 * Different exercises have different rep speeds and muscle dominance patterns
 * Tuned from ground-truth video labels
 */
export const EXERCISE_CONFIG = {
  walking: {
    primaryChannels: ['ch3', 'ch4'] as Channel[],
    minRepGapMs: 800,
    thresholdPct: 70,
    channelWeights: { ch1: 0.0, ch2: 0.0, ch3: 0.5, ch4: 0.5 }
  },
  stair_ascent: {
    primaryChannels: ['ch1', 'ch3'] as Channel[],
    minRepGapMs: 1000,
    thresholdPct: 70,
    channelWeights: { ch1: 0.6, ch2: 0.0, ch3: 0.4, ch4: 0.0 }
  },
  stair_descent: {
    primaryChannels: ['ch1', 'ch2'] as Channel[],
    minRepGapMs: 1000,
    thresholdPct: 70,
    channelWeights: { ch1: 0.7, ch2: 0.3, ch3: 0.0, ch4: 0.0 }
  },
  calf_raises: {
    primaryChannels: ['ch3', 'ch4'] as Channel[],
    minRepGapMs: 1500,
    thresholdPct: 65,
    channelWeights: { ch1: 0.0, ch2: 0.0, ch3: 0.7, ch4: 0.3 }
  },
  lunges: {
    primaryChannels: ['ch1', 'ch2'] as Channel[],
    minRepGapMs: 1500,
    thresholdPct: 70,
    channelWeights: { ch1: 0.5, ch2: 0.5, ch3: 0.0, ch4: 0.0 }
  },
  leg_press: {
    primaryChannels: ['ch1', 'ch3'] as Channel[],
    minRepGapMs: 1800,
    thresholdPct: 70,
    channelWeights: { ch1: 0.6, ch2: 0.0, ch3: 0.4, ch4: 0.0 }
  },
  squats: {
    primaryChannels: ['ch1', 'ch2'] as Channel[],
    minRepGapMs: 2000,
    thresholdPct: 70,
    channelWeights: { ch1: 0.6, ch2: 0.4, ch3: 0.0, ch4: 0.0 }
  },
  squat: {
    primaryChannels: ['ch1', 'ch2'] as Channel[],
    minRepGapMs: 2000,
    thresholdPct: 70,
    channelWeights: { ch1: 0.6, ch2: 0.4, ch3: 0.0, ch4: 0.0 }
  },
  jumping: {
    primaryChannels: ['ch1', 'ch3'] as Channel[],
    minRepGapMs: 1000,
    thresholdPct: 70,
    channelWeights: { ch1: 0.5, ch2: 0.0, ch3: 0.5, ch4: 0.0 }
  },
  cycling: {
    primaryChannels: ['ch1', 'ch2', 'ch3'] as Channel[],
    minRepGapMs: 900,
    thresholdPct: 70,
    channelWeights: { ch1: 0.5, ch2: 0.3, ch3: 0.2, ch4: 0.0 }
  }
};

/**
 * Smart Rep Detection using Multiple Channels with Channel Weighting
 * Combines evidence from primary muscle channels weighted by exercise-specific dominance
 * Returns consensus rep count with confidence metric
 */
export function detectRepsMultiChannel(
  signal: number[],
  channels: Channel[],
  exercise: string = "lunges",
  sampleRate: number = 1000
): {
  count: number;
  confidence: number; // 0-1
  details: string;
  dominantChannel?: Channel;
} {
  const config = EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG] || EXERCISE_CONFIG.lunges;
  
  if (!signal.length) {
    return { count: 0, confidence: 0, details: "No signal data" };
  }
  
  // Detect reps on each primary channel with their weights
  const weightedResults: Array<{
    channel: Channel;
    weight: number;
    repCount: number;
    rmsLevel: number;
  }> = [];
  
  config.primaryChannels.forEach(ch => {
    if (!channels.includes(ch)) return;
    const weight = config.channelWeights?.[ch] || 0.5;
    if (weight === 0) return; // Skip channels with 0 weight
    
    const repResult = detectReps(signal, sampleRate, config.minRepGapMs, config.thresholdPct);
    const rmsLevel = rms(signal); // Use actual RMS as indicator of signal strength
    
    weightedResults.push({
      channel: ch,
      weight,
      repCount: repResult.count,
      rmsLevel
    });
  });
  
  if (!weightedResults.length) {
    return { count: 0, confidence: 0, details: "No primary channels found" };
  }
  
  // Weighted consensus: favor channels with higher weights AND higher RMS (stronger signal)
  const totalWeight = weightedResults.reduce((sum, r) => sum + r.weight, 0);
  const normalizedResults = weightedResults.map(r => ({
    ...r,
    normalizedWeight: r.weight / totalWeight
  }));
  
  // Find dominant channel (highest weight * RMS)
  let dominantChannel = normalizedResults[0].channel;
  let maxScore = 0;
  normalizedResults.forEach(r => {
    const score = r.normalizedWeight * (r.rmsLevel / Math.max(...normalizedResults.map(x => x.rmsLevel)));
    if (score > maxScore) {
      maxScore = score;
      dominantChannel = r.channel;
    }
  });
  
  // Weighted rep count: average of rep counts, weighted by channel importance
  const weightedCount = normalizedResults.reduce((sum, r) => sum + r.repCount * r.normalizedWeight, 0);
  const finalCount = Math.round(weightedCount);
  
  // Confidence: based on agreement and signal strength
  const counts = normalizedResults.map(r => r.repCount);
  const countVariance = Math.max(...counts) - Math.min(...counts);
  const avgRmsLevel = normalizedResults.reduce((sum, r) => sum + r.rmsLevel, 0) / normalizedResults.length;
  
  // Higher confidence if: low variance in counts AND strong RMS signals
  const countAgreement = Math.max(0, 1 - (countVariance / Math.max(1, finalCount)));
  const signalStrength = Math.min(1, avgRmsLevel / 100); // Assume 100mV is "good"
  const confidence = (countAgreement * 0.7 + signalStrength * 0.3);
  
  return {
    count: finalCount,
    confidence,
    details: `Weighted consensus: ${normalizedResults.map(r => `${r.channel}=${r.repCount}(${(r.normalizedWeight * 100).toFixed(0)}%)`).join(', ')}`,
    dominantChannel
  };
}

// ========== DATA CLEANING & EXPORT ==========

/**
 * Interpolate null/missing values in a channel using linear interpolation
 * with forward/backward fill boundaries (limit_direction='both').
 * Operates in single-pass O(N) time and space complexity.
 */
export function interpolateChannel(arr: (number | null | undefined)[]): number[] {
  const n = arr.length;
  if (n === 0) return [];
  
  const result = new Array<number>(n);
  
  // Find first valid (non-null and finite) index
  let firstValidIdx = -1;
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v !== null && v !== undefined && !Number.isNaN(v) && Number.isFinite(v)) {
      firstValidIdx = i;
      break;
    }
  }
  
  // If no valid elements, fill with 0
  if (firstValidIdx === -1) {
    result.fill(0);
    return result;
  }
  
  // Backward fill the beginning
  const firstVal = arr[firstValidIdx] as number;
  for (let i = 0; i < firstValidIdx; i++) {
    result[i] = firstVal;
  }
  result[firstValidIdx] = firstVal;
  
  let lastValidIdx = firstValidIdx;
  let lastValidVal = firstVal;
  
  for (let i = firstValidIdx + 1; i < n; i++) {
    const v = arr[i];
    if (v !== null && v !== undefined && !Number.isNaN(v) && Number.isFinite(v)) {
      // Linear interpolate between lastValidIdx and i
      const currentVal = v;
      const gap = i - lastValidIdx;
      for (let j = lastValidIdx + 1; j < i; j++) {
        const t = (j - lastValidIdx) / gap;
        result[j] = lastValidVal + t * (currentVal - lastValidVal);
      }
      result[i] = currentVal;
      lastValidIdx = i;
      lastValidVal = currentVal;
    }
  }
  
  // Forward fill the end
  for (let i = lastValidIdx + 1; i < n; i++) {
    result[i] = lastValidVal;
  }
  
  return result;
}

/**
 * Combine channel envelopes based on exercise type.
 * Pulls channel weights dynamically from EXERCISE_CONFIG.
 */
export function combineChannelsPerExercise(
  envelopes: Record<Channel, number[]>,
  exercise: string = "lunges"
): number[] {
  const normEx = exercise.toLowerCase();
  const config = EXERCISE_CONFIG[normEx as keyof typeof EXERCISE_CONFIG] || EXERCISE_CONFIG.lunges;
  const weights = config.channelWeights;
  
  const length = Math.max(
    envelopes.ch1?.length || 0,
    envelopes.ch2?.length || 0,
    envelopes.ch3?.length || 0,
    envelopes.ch4?.length || 0
  );
  
  const combined = new Array<number>(length).fill(0);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const ch of CHANNELS) {
      if (envelopes[ch] && envelopes[ch][i] != null) {
        sum += envelopes[ch][i] * weights[ch];
      }
    }
    combined[i] = sum;
  }
  
  return combined;
}

/**
 * Improved rep detection with prominence filtering
 * Matches scipy.signal.find_peaks behavior
 */
export function improvedDetectReps(
  envelope: number[],
  sampleRate: number = 1000,
  minRepGapMs: number = 1500,
  thresholdPercentile: number = 70,
  prominenceThresholdFactor: number = 0.25
): {
  count: number;
  peaks: number[];
  smooth: number[];
  threshold: number;
  details: string;
} {
  const result = countRepsBurstDetection(
    envelope,
    sampleRate,
    150, // smoothMs
    thresholdPercentile,
    minRepGapMs,
    150, // minBurstDurationMs
    0, // skipFirstSecs (already trimmed)
    true // isEnvelopeAlready
  );

  return {
    count: result.count,
    peaks: result.bursts.map(b => Math.round((b.startIdx + b.endIdx) / 2)),
    smooth: result.envelope,
    threshold: result.threshold,
    details: `${result.count} reps detected (threshold=${result.threshold.toFixed(2)}mV, bursts merged and filtered)`
  };
}

/**
 * Generate clean CSV export with interpolated channels
 * Format: t,ch1,ch2,ch3,ch4
 */
export function generateCleanCsv(ds: EmgDataset, preprocessed = true): string {
  const dataset = preprocessed ? preprocessDataset(ds) : ds;
  const header = "t,ch1,ch2,ch3,ch4\n";
  const rows = dataset.samples
    .map(s => 
      `${s.t.toFixed(4)},${s.ch1.toFixed(4)},${s.ch2.toFixed(4)},${s.ch3.toFixed(4)},${s.ch4.toFixed(4)}`
    )
    .join("\n");
  return header + rows;
}

/**
 * Generate report data with rep detection and channel analysis
 * For display in Dashboard and export to PDF
 */
export function generateReportData(
  ds: EmgDataset,
  exercise: string = "lunges",
  preprocessed = true
): {
  csvData: string;
  repCount: number;
  confidence: number;
  channelSummary: Record<Channel, {
    rms: number;
    mav: number;
    peaks: number;
  }>;
  combinedRepCount: number;
  combinedConfidence: number;
} {
  const dataset = preprocessed ? preprocessDataset(ds) : ds;
  
  // Export clean CSV
  const csvData = generateCleanCsv(ds, preprocessed);
  
  // Per-channel analysis
  const channelSummary: Record<Channel, any> = {} as any;
  const envelopes: Record<Channel, number[]> = {} as any;
  
  for (const ch of CHANNELS) {
    const signal = channelArray(dataset, ch);
    
    // Preprocess individual channel
    const cleaned = dcRemoval(signal);
    const clipped = spikeClipping(cleaned);
    const rectified = fullWaveRectification(clipped);
    const envelope = rmsEnvelopeAdvanced(rectified, 200, dataset.sampleRate);
    
    envelopes[ch] = envelope;
    
    const repResult = improvedDetectReps(envelope, dataset.sampleRate, 
      EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG]?.minRepGapMs || 1500,
      EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG]?.thresholdPct || 70
    );
    
    channelSummary[ch] = {
      rms: rms(signal),
      mav: mav(signal),
      peaks: repResult.count
    };
  }
  
  // Combined channel detection per exercise
  const combined = combineChannelsPerExercise(envelopes, exercise);
  const combinedRepResult = improvedDetectReps(combined, dataset.sampleRate,
    EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG]?.minRepGapMs || 1500,
    EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG]?.thresholdPct || 70
  );
  
  // Single-channel rep detection (for comparison)
  const primaryCh = EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG]?.primaryChannels[0] || 'ch1';
  const primaryEnvelope = envelopes[primaryCh];
  const primaryRepResult = improvedDetectReps(primaryEnvelope, dataset.sampleRate,
    EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG]?.minRepGapMs || 1500,
    EXERCISE_CONFIG[exercise as keyof typeof EXERCISE_CONFIG]?.thresholdPct || 70
  );

  // Step 12: Pick Channel in range [4, 20] with the most reps in that range.
  // Fallback is primaryRepResult.count if none fall in range [4, 20].
  let consensusCount = primaryRepResult.count;
  let bestCh: Channel = primaryCh;
  let maxRepsInRange = -1;

  for (const ch of CHANNELS) {
    const count = channelSummary[ch].peaks;
    if (count >= 4 && count <= 20) {
      if (count > maxRepsInRange) {
        maxRepsInRange = count;
        bestCh = ch;
        consensusCount = count;
      }
    }
  }

  // Consensus confidence based on agreement among channels that fall in [4, 20]
  const qualifyingCounts = CHANNELS.map(ch => channelSummary[ch].peaks).filter(c => c >= 4 && c <= 20);
  let confidence = 0.85;
  if (qualifyingCounts.length > 1) {
    const minCount = Math.min(...qualifyingCounts);
    const maxCount = Math.max(...qualifyingCounts);
    const diff = maxCount - minCount;
    confidence = Math.max(0.5, 1 - diff / maxCount);
  } else if (qualifyingCounts.length === 1) {
    confidence = 0.80;
  } else {
    confidence = 0.50; // no channels in range [4, 20]
  }

  return {
    csvData,
    repCount: consensusCount,
    confidence: Math.round(confidence * 100) / 100,
    channelSummary,
    combinedRepCount: combinedRepResult.count,
    combinedConfidence: 0.90 // Placeholder
  };
}
