import type { EmgDataset, EmgSample } from "./signal";

// Synthesizes a realistic-looking sEMG burst pattern for 4 channels.
export function generateMockDataset(opts?: {
  seconds?: number;
  sampleRate?: number;
  seed?: number;
}): EmgDataset {
  const seconds = opts?.seconds ?? 10;
  const sampleRate = opts?.sampleRate ?? 1000;
  const n = seconds * sampleRate;
  const seed = opts?.seed ?? 42;
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const samples: EmgSample[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // bursts: gaussian envelopes centered at different times
    const env = (center: number, width: number, amp: number) =>
      amp * Math.exp(-((t - center) ** 2) / (2 * width * width));
    const e1 = env(2, 0.5, 0.8) + env(6, 0.4, 0.6);
    const e2 = env(3, 0.45, 0.7) + env(7.5, 0.5, 0.9);
    const e3 = env(1.5, 0.3, 0.5) + env(5, 0.6, 0.75) + env(8.5, 0.3, 0.6);
    const e4 = env(4, 0.7, 0.65) + env(9, 0.35, 0.55);
    const noise = () => (rand() - 0.5) * 2;
    // high-frequency content shaped by env
    const ch1 = e1 * noise() + 0.04 * noise();
    const ch2 = e2 * noise() + 0.05 * noise();
    const ch3 = e3 * noise() + 0.04 * noise();
    const ch4 = e4 * noise() + 0.06 * noise();
    samples[i] = { t, ch1, ch2, ch3, ch4 };
  }
  return {
    id: "mock-leg-dataset-demo",
    name: "Synthetic Demo — 4ch × 10s",
    sampleRate,
    samples,
    uploadedAt: 1718928000000,
    source: "mock",
  };
}
