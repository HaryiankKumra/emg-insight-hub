import { createServerFn } from "@tanstack/react-start";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  CHANNELS,
  CHANNEL_LABELS,
  channelArray,
  fftMagnitude,
  spectralMetrics,
  rms,
  mav,
  calculateQualityFromRaw,
  type Channel,
  type EmgDataset,
} from "./emg/signal";

export interface ChannelSummary {
  channel: string;
  label: string;
  rms_mV: number;
  mav_mV: number;
  snr_db: number;
  quality_label: string;
  mean_freq_hz: number;
  median_freq_hz: number;
  dominant_freq_hz: number;
}

export interface AnalyzeInput {
  datasetName: string;
  sampleRate: number;
  durationSec: number;
  channels: ChannelSummary[];
  predictedExerciseRules?: string;
  predictedRepsRules?: string;
  repConsensusDetails?: string;
  highEfficiencyMuscles?: string[];
}

// Simple in-memory cache for analysis results (key-based on channels)
const analysisCache = new Map<string, { text: string; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Rate limiter: track request timestamps per API
class RateLimiter {
  private timestamps: number[] = [];
  private readonly windowMs: number; // Time window in ms
  private readonly maxRequests: number; // Max requests per window

  constructor(maxRequests: number = 2, windowMs: number = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  canMakeRequest(): boolean {
    const now = Date.now();
    // Remove old timestamps outside the window
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return this.timestamps.length < this.maxRequests;
  }

  recordRequest(): void {
    this.timestamps.push(Date.now());
  }

  getRetryAfterSeconds(): number {
    if (this.timestamps.length === 0) return 0;
    const oldestTimestamp = this.timestamps[0];
    const retryAfterMs = this.windowMs - (Date.now() - oldestTimestamp);
    return Math.ceil(retryAfterMs / 1000);
  }
}

const geminiLimiter = new RateLimiter(2, 60000); // 2 requests per 60 seconds

function getCacheKey(data: AnalyzeInput): string {
  // Create a deterministic cache key from channel data
  return JSON.stringify(
    data.channels.map((c) => ({
      channel: c.channel,
      rms: c.rms_mV.toFixed(3),
      mav: c.mav_mV.toFixed(3),
      snr: c.snr_db.toFixed(1),
    })),
  );
}

// Helper: compute channel summaries from raw dataset with proper quality calculation
export function computeChannelSummaries(
  ds: EmgDataset,
  skipFirstSecs = 2,
): ChannelSummary[] {
  // Get quality from raw (unfiltered) data for accurate baseline SNR
  const rawQuality = calculateQualityFromRaw(ds, CHANNELS, skipFirstSecs);

  return CHANNELS.map((ch: Channel) => {
    const arr = channelArray(ds, ch);
    const { freq, mag } = fftMagnitude(arr, ds.sampleRate);
    const s = spectralMetrics(freq, mag);
    const q = rawQuality[ch];

    return {
      channel: ch.toUpperCase(),
      label: CHANNEL_LABELS[ch],
      rms_mV: +rms(arr).toFixed(4),
      mav_mV: +mav(arr).toFixed(4),
      snr_db: +q.snrDb.toFixed(2),
      quality_label: q.label,
      mean_freq_hz: +s.meanFreq.toFixed(1),
      median_freq_hz: +s.medianFreq.toFixed(1),
      dominant_freq_hz: +s.dominantFreq.toFixed(1),
    };
  });
}

export const analyzeEmg = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => d as AnalyzeInput)
  .handler(async ({ data }) => {
    // Check cache first
    const cacheKey = getCacheKey(data);
    const cached = analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { text: cached.text, cached: true };
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("Missing GEMINI_API_KEY. Add your Google AI Studio key (format: AIza...) in project secrets.");
    }

    const prompt = `You are a biomedical signal engineer reviewing surface EMG (sEMG) data captured from MyoWare 2.0 sensors on an ESP32 at ${data.sampleRate} Hz. Values are raw mV, baseline-centered.

Dataset: ${data.datasetName}
Duration: ${data.durationSec.toFixed(1)} s total.

Per-channel summary:
${data.channels
  .map(
    (c) =>
      `- ${c.channel} (${c.label}): RMS ${c.rms_mV.toFixed(3)} mV, MAV ${c.mav_mV.toFixed(3)} mV, SNR ${c.snr_db.toFixed(1)} dB → ${c.quality_label}. Mean f ${c.mean_freq_hz.toFixed(1)} Hz, median f ${c.median_freq_hz.toFixed(1)} Hz, dominant ${c.dominant_freq_hz.toFixed(1)} Hz.`,
  )
  .join("\n")}

${data.predictedExerciseRules ? `Local DSP Predictions:
- Predicted Exercise: ${data.predictedExerciseRules}
- Smart Rep Consensus: ${data.predictedRepsRules}
- Details: ${data.repConsensusDetails}
- High-efficiency Muscles: ${data.highEfficiencyMuscles?.join(", ") || "None"}` : ""}

Give a concise expert report in markdown with these sections:
### Signal Quality
### Muscle Activation
### Exercise & Repetition Verification
(Review the local DSP prediction of '${data.predictedExerciseRules || "Unknown"}' and rep count '${data.predictedRepsRules || "Unknown"}' against the channels' RMS ratios and frequencies. Confirm if this is correct and biomechanically physiological, providing explanation.)
### Frequency Content & Fatigue
### Issues / Recommendations

Be specific: call out the strongest and weakest channels by name, flag suspected electrode lift / motion artifact / powerline noise (50/60 Hz) if frequencies/quality suggest it, note expected sEMG band is 20–450 Hz with dominant power 50–150 Hz, and suggest concrete fixes. Keep under ~250 words.`;


    if (!geminiLimiter.canMakeRequest()) {
      const retryAfter = geminiLimiter.getRetryAfterSeconds();
      throw new Error(
        `Rate limit: wait ${retryAfter}s before retrying.`,
      );
    }

    const ai = new GoogleGenerativeAI({ apiKey: geminiKey });
    try {
      geminiLimiter.recordRequest();
      const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent({
        contents: [{
          role: "user",
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          maxOutputTokens: 800,
        },
        systemInstruction: "You are a precise biomedical signal-processing assistant.",
      });
      const text = result.response.text() ?? "(no response)";
      analysisCache.set(cacheKey, { text, timestamp: Date.now() });
      return { text, cached: false };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
        throw new Error("Gemini quota exceeded. Try again shortly.");
      }
      if (errMsg.includes("401") || errMsg.includes("UNAUTHENTICATED") || errMsg.includes("API_KEY_INVALID")) {
        throw new Error("Invalid GEMINI_API_KEY. Check your key in project secrets.");
      }
      throw new Error(`Gemini error: ${errMsg}`);
    }
  });
