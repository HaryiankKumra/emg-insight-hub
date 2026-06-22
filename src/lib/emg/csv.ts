import Papa from "papaparse";
import type { EmgDataset, EmgSample } from "./signal";
import { interpolateChannel, mean } from "./signal";

// Parses EMG CSVs of the form:
//   # participant=... | ...
//   # exercise=... | ...
//   datetime_local,muscle1_raw_mV,muscle2_raw_mV,muscle3_raw_mV,muscle4_raw_mV
//   2026-06-21 00:40:55.234,,,,1427.2
// Also accepts generic time/ch1..ch4 layouts.
export async function parseCsvFile(file: File, fallbackSampleRate = 1000): Promise<EmgDataset> {
  const text = await file.text();
  const isFiltered = /filter/i.test(file.name) || /filter/i.test(text.substring(0, 1000));

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      comments: "#",
      complete: (results) => {
        try {
          const rows = results.data;
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
          const tKey = find(
            "datetime_local",
            "datetime",
            "time",
            "t",
            "timestamp",
            "time_s",
            "time_ms",
          );
          const cKeys = [
            find("muscle1_raw_mv", "muscle1", "ch1", "channel1", "biceps", "emg1", "a0"),
            find("muscle2_raw_mv", "muscle2", "ch2", "channel2", "triceps", "emg2", "a1"),
            find("muscle3_raw_mv", "muscle3", "ch3", "channel3", "forearm", "emg3", "a2"),
            find("muscle4_raw_mv", "muscle4", "ch4", "channel4", "deltoid", "emg4", "a3"),
          ];
          // fallback to positional
          for (let i = 0; i < 4; i++) {
            if (!cKeys[i]) {
              const offset = tKey ? 1 : 0;
              cKeys[i] = headers[offset + i];
            }
          }

          const parseT = (raw: unknown, i: number): number => {
            if (raw == null || raw === "") return i / fallbackSampleRate;
            const s = String(raw).trim();
            const num = Number(s);
            if (Number.isFinite(num) && !s.includes("-") && !s.includes(":")) {
              return tKey === "time_ms" ? num / 1000 : num;
            }
            // datetime
            const ms = Date.parse(s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z"));
            return Number.isFinite(ms) ? ms / 1000 : i / fallbackSampleRate;
          };

          // Extract raw numeric values (preserving nulls) for all rows
          const getRawVal = (r: Record<string, unknown>, colKey: string | undefined): number | null => {
            if (!colKey) return null;
            const raw = r[colKey];
            if (raw === "" || raw == null) return null;
            const s = String(raw).trim();
            if (s === "") return null;
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
          };

          const rawChannels: (number | null)[][] = [[], [], [], []];
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            for (let c = 0; c < 4; c++) {
              rawChannels[c].push(getRawVal(r, cKeys[c]));
            }
          }

          // Interpolate missing channel values
          const interpolatedChannels = rawChannels.map((ch) => interpolateChannel(ch));
          const channelMeans = interpolatedChannels.map((ch) => mean(ch));

          const samples: EmgSample[] = [];
          let t0: number | null = null;
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const tAbs = parseT(r[tKey ?? ""], i);
            if (t0 === null) t0 = tAbs;
            const t = tAbs - t0;
            samples.push({
              t: Number.isFinite(t) ? t : i / fallbackSampleRate,
              ch1: interpolatedChannels[0][i] - channelMeans[0],
              ch2: interpolatedChannels[1][i] - channelMeans[1],
              ch3: interpolatedChannels[2][i] - channelMeans[2],
              ch4: interpolatedChannels[3][i] - channelMeans[3],
            });
          }

          // Estimate sample rate from median dt over a window.
          let sr = fallbackSampleRate;
          if (samples.length > 10) {
            const dts: number[] = [];
            for (let i = 1; i < Math.min(samples.length, 500); i++) {
              const d = samples[i].t - samples[i - 1].t;
              if (d > 0) dts.push(d);
            }
            if (dts.length) {
              dts.sort((a, b) => a - b);
              const med = dts[Math.floor(dts.length / 2)];
              if (med > 0) sr = Math.round(1 / med);
            }
          }

          resolve({
            id: `csv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            sampleRate: sr,
            samples,
            uploadedAt: Date.now(),
            source: "csv",
            isFiltered,
          });
        } catch (e) {
          reject(e);
        }
      },
      error: (err: Error) => reject(err),
    });
  });
}

