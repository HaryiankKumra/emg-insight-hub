import Papa from "papaparse";
import type { EmgDataset, EmgSample } from "./signal";

// Accepts CSVs with columns: time/t/timestamp + ch1..ch4 (case-insensitive).
// If time missing, infers from row index and provided/assumed sample rate.
export async function parseCsvFile(file: File, fallbackSampleRate = 1000): Promise<EmgDataset> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data as Record<string, unknown>[];
          if (!rows.length) throw new Error("CSV is empty");
          const headers = Object.keys(rows[0]).map((h) => h.trim());
          const lower = headers.map((h) => h.toLowerCase());
          const find = (...names: string[]) => {
            for (const n of names) {
              const i = lower.indexOf(n);
              if (i >= 0) return headers[i];
            }
            return undefined;
          };
          const tKey = find("time", "t", "timestamp", "time_s", "time_ms");
          const c1 = find("ch1", "channel1", "biceps", "a0", "emg1") ?? headers[tKey ? 1 : 0];
          const c2 = find("ch2", "channel2", "triceps", "a1", "emg2") ?? headers[tKey ? 2 : 1];
          const c3 = find("ch3", "channel3", "forearm", "a2", "emg3") ?? headers[tKey ? 3 : 2];
          const c4 = find("ch4", "channel4", "deltoid", "a3", "emg4") ?? headers[tKey ? 4 : 3];

          const samples: EmgSample[] = [];
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const tRaw = tKey ? Number(r[tKey]) : i / fallbackSampleRate;
            const t = tKey === "time_ms" ? tRaw / 1000 : tRaw;
            samples.push({
              t: Number.isFinite(t) ? t : i / fallbackSampleRate,
              ch1: Number(r[c1]) || 0,
              ch2: Number(r[c2]) || 0,
              ch3: Number(r[c3]) || 0,
              ch4: Number(r[c4]) || 0,
            });
          }
          // estimate sample rate from time deltas
          let sr = fallbackSampleRate;
          if (samples.length > 2) {
            const dt = samples[1].t - samples[0].t;
            if (dt > 0) sr = Math.round(1 / dt);
          }
          resolve({
            id: `csv-${Date.now()}`,
            name: file.name,
            sampleRate: sr,
            samples,
            uploadedAt: Date.now(),
            source: "csv",
          });
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}
