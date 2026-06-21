import { createServerFn } from "@tanstack/react-start";
import { GoogleGenAI } from "@google/genai";

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
    const lovableKey = process.env.LOVABLE_API_KEY;

    // Determine which API to use
    // If GEMINI_API_KEY starts with 'AIza', it's a real Google key; if it starts with 'AQ.', it's a Lovable key
    const isLovableKey = geminiKey?.startsWith("AQ.");
    const actualGeminiKey = !isLovableKey ? geminiKey : undefined;
    const actualLovableKey = isLovableKey ? geminiKey : lovableKey;

    if (!actualGeminiKey && !actualLovableKey) {
      throw new Error(
        "Missing API Key. Set GEMINI_API_KEY (format: AIza...) or LOVABLE_API_KEY in the environment.",
      );
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

Give a concise expert report in markdown with these sections:
### Signal Quality
### Muscle Activation
### Frequency Content & Fatigue
### Issues / Recommendations

Be specific: call out the strongest and weakest channels by name, flag suspected electrode lift / motion artifact / powerline noise (50/60 Hz) if frequencies/quality suggest it, note expected sEMG band is 20–450 Hz with dominant power 50–150 Hz, and suggest concrete fixes. Keep under ~250 words.`;

    if (actualGeminiKey) {
      // Use official Google Gen AI SDK with rate limiting
      if (!geminiLimiter.canMakeRequest()) {
        const retryAfter = geminiLimiter.getRetryAfterSeconds();
        throw new Error(
          `API rate limit exceeded. Please wait ${retryAfter} second${retryAfter !== 1 ? "s" : ""} before trying again.`,
        );
      }

      const ai = new GoogleGenAI({ apiKey: actualGeminiKey });
      try {
        geminiLimiter.recordRequest();
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction: "You are a precise biomedical signal-processing assistant.",
            maxOutputTokens: 800,
          },
        });
        const text = response.text ?? "(no response)";

        // Cache the successful result
        analysisCache.set(cacheKey, { text, timestamp: Date.now() });

        return { text, cached: false };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        // Handle specific API errors
        if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
          throw new Error(
            "API quota exceeded. The Gemini API has reached its rate limit. Please try again in a few moments or upgrade your quota at https://cloud.google.com/docs/quotas/help/request_increase",
          );
        }
        if (errMsg.includes("401") || errMsg.includes("UNAUTHENTICATED")) {
          throw new Error("Invalid Gemini API key. Please check your GEMINI_API_KEY environment variable.");
        }

        throw new Error(`Gemini SDK error: ${errMsg}`);
      }
    } else {
      // Use Lovable gateway
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${actualLovableKey}`,
        },
        body: JSON.stringify({
          model: "google/gemini-3.5-flash",
          messages: [
            {
              role: "system",
              content: "You are a precise biomedical signal-processing assistant.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const t = await res.text();
        if (res.status === 429) throw new Error("AI rate limit — try again in a moment.");
        if (res.status === 402)
          throw new Error("AI credits exhausted — add credits in workspace billing.");
        if (res.status === 401) throw new Error("Invalid Lovable API key. Check your GEMINI_API_KEY or LOVABLE_API_KEY.");
        throw new Error(`AI gateway error ${res.status}: ${t.slice(0, 200)}`);
      }
      const json = await res.json();
      const text: string = json.choices?.[0]?.message?.content ?? "(no response)";

      // Cache the successful result
      analysisCache.set(cacheKey, { text, timestamp: Date.now() });

      return { text, cached: false };
    }
  });
