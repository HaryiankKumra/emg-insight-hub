import { createServerFn } from "@tanstack/react-start";
import { GoogleGenAI } from "@google/genai";

export interface ChannelSummary {
  channel: string;
  label: string;
  baseline_rms_mV: number;
  active_rms_mV: number;
  active_mav_mV: number;
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
  baselineSec: number;
  activeSec: number;
  channels: ChannelSummary[];
}

export const analyzeEmg = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => d as AnalyzeInput)
  .handler(async ({ data }) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const lovableKey = process.env.LOVABLE_API_KEY;

    if (!geminiKey && !lovableKey) {
      throw new Error("Missing API Key. Set GEMINI_API_KEY or LOVABLE_API_KEY in the environment.");
    }

    const prompt = `You are a biomedical signal engineer reviewing surface EMG (sEMG) data captured from MyoWare 2.0 sensors on an ESP32 at ${data.sampleRate} Hz. Values are raw mV, baseline-centered.

Dataset: ${data.datasetName}
Duration: ${data.durationSec.toFixed(1)} s total — first ${data.baselineSec.toFixed(1)} s is REST baseline (sensor warm-up / no contraction), remaining ${data.activeSec.toFixed(1)} s is the EXERCISE window.

Per-channel summary (computed on the exercise window, baseline = rest window):
${data.channels
  .map(
    (c) =>
      `- ${c.channel} (${c.label}): baseline RMS ${c.baseline_rms_mV.toFixed(3)} mV, active RMS ${c.active_rms_mV.toFixed(3)} mV, MAV ${c.active_mav_mV.toFixed(3)} mV, SNR ${c.snr_db.toFixed(1)} dB → ${c.quality_label}. Mean f ${c.mean_freq_hz.toFixed(1)} Hz, median f ${c.median_freq_hz.toFixed(1)} Hz, dominant ${c.dominant_freq_hz.toFixed(1)} Hz.`,
  )
  .join("\n")}

Give a concise expert report in markdown with these sections:
### Signal Quality
### Muscle Activation
### Frequency Content & Fatigue
### Issues / Recommendations

Be specific: call out the strongest and weakest channels by name, flag suspected electrode lift / motion artifact / powerline noise (50/60 Hz) if frequencies/quality suggest it, note expected sEMG band is 20–450 Hz with dominant power 50–150 Hz, and suggest concrete fixes. Keep under ~250 words.`;

    if (geminiKey) {
      // Use official Google Gen AI SDK
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction: "You are a precise biomedical signal-processing assistant.",
            maxOutputTokens: 800,
          },
        });
        const text = response.text ?? "(no response)";
        return { text };
      } catch (err) {
        throw new Error(`Gemini SDK error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Fallback to Lovable gateway
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${lovableKey}`,
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
        throw new Error(`AI gateway error ${res.status}: ${t.slice(0, 200)}`);
      }
      const json = await res.json();
      const text: string = json.choices?.[0]?.message?.content ?? "(no response)";
      return { text };
    }
  });
