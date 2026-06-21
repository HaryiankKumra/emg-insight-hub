// Web Serial API Manager for real-time ESP32 sEMG data streaming
// Reads JSON lines from ESP32 master and computes live RMS / logs data for ML analysis.

import type { EmgDataset, EmgSample } from "./signal";
import { preprocessDataset } from "./signal";

export interface SerialStats {
  rxPackets: number;
  rxErrors: number;
  bytesReceived: number;
}

export interface LiveChannelData {
  rms: number;
  mean: number;
  peak: number;
  peakToPeak: number;
  sampleRate: number;
  samples: number[];
}

export interface ESP32Packet {
  slave?: number;
  mv?: number[];
  dt_us?: number;
  t0_ms?: number;
  frame_id?: number;
}

class EmgSerialManager {
  private port: any | null = null;
  private reader: any | null = null;
  private reading = false;

  public connected = false;
  public stats: SerialStats = { rxPackets: 0, rxErrors: 0, bytesReceived: 0 };

  // Real-time channel buffers (last 500 samples)
  public channelData: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  // Authoritative hardware sample rate
  public hwSampleRate = 1000;

  // Callbacks for live updates
  private listeners: (() => void)[] = [];

  // Recording state
  private isRecording = false;
  private recordMetadata: any = {};
  private recordedSamples: { t: number; ch1: number; ch2: number; ch3: number; ch4: number }[] = [];

  // Slave ID mapping to Channels: 0 -> Quad, 1 -> Hamstring, 2 -> Calf, 3 -> TA
  private SLAVE_TO_CHANNEL: Record<number, number> = { 0: 1, 1: 2, 2: 3, 3: 4 };

  public isSupported(): boolean {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    return "serial" in navigator;
  }

  public registerListener(cb: () => void) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify() {
    for (const cb of this.listeners) cb();
  }

  public async connect(baudRate = 921600): Promise<void> {
    if (!this.isSupported()) {
      throw new Error(
        "Web Serial API is not supported in this browser. Please use Chrome/Edge on Desktop.",
      );
    }

    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });

      // Clear DTR/RTS signals to prevent ESP32 from resetting
      try {
        await this.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      } catch (e) {
        // Not all platforms support setting signal states
      }

      this.connected = true;
      this.stats = { rxPackets: 0, rxErrors: 0, bytesReceived: 0 };
      this.channelData = { 1: [], 2: [], 3: [], 4: [] };
      this.notify();

      // Start asynchronous reading loop
      void this.startReadLoop();
    } catch (err) {
      this.disconnect();
      throw err;
    }
  }

  public async disconnect(): Promise<void> {
    this.reading = false;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (e) {}
      try {
        this.reader.releaseLock();
      } catch (e) {}
      this.reader = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch (e) {}
      this.port = null;
    }

    this.connected = false;
    this.notify();
  }

  // Real-time analysis metrics
  public getLiveChannelSnapshot(chId: number): LiveChannelData {
    const rawSamples = this.channelData[chId] ?? [];
    const len = rawSamples.length;

    if (len === 0) {
      return {
        rms: 0,
        mean: 0,
        peak: 0,
        peakToPeak: 0,
        sampleRate: this.hwSampleRate,
        samples: [],
      };
    }

    let sum = 0;
    let sumSq = 0;
    let min = Infinity;
    let max = -Infinity;

    for (const val of rawSamples) {
      sum += val;
      sumSq += val * val;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    const meanVal = sum / len;
    const rmsVal = Math.sqrt(sumSq / len);

    return {
      rms: Math.round(rmsVal * 10) / 10,
      mean: Math.round(meanVal * 10) / 10,
      peak: Math.round(max * 10) / 10,
      peakToPeak: Math.round((max - min) * 10) / 10,
      sampleRate: this.hwSampleRate,
      samples: rawSamples,
    };
  }

  // Ingests raw parsed packets
  private handlePacket(packet: ESP32Packet) {
    const slave = packet.slave ?? -1;
    const ch = this.SLAVE_TO_CHANNEL[slave];
    if (ch == null) return;

    const mv = packet.mv;
    if (!Array.isArray(mv) || !mv.length) return;

    const dt_us = packet.dt_us ?? 1000;
    this.hwSampleRate = dt_us > 0 ? Math.round(1_000_000 / dt_us) : 1000;

    // Convert raw values (12-bit ADC -> mV)
    const mvValues = mv.map((v) => Math.round((Number(v) / 4095) * 3300 * 10) / 10);

    // Buffer updates (keep last 500 samples for rolling scope)
    const buffer = this.channelData[ch] ?? [];
    for (const v of mvValues) {
      buffer.push(v);
      if (buffer.length > 500) buffer.shift();
    }
    this.channelData[ch] = buffer;

    // Recording updates
    if (this.isRecording) {
      const nowMs = Date.now();
      const originMs = this.recordMetadata.originMs || nowMs;
      const t = (nowMs - originMs) / 1000;

      // ESP32 sends batched samples. We estimate individual sample timestamps
      const dtMs = dt_us / 1000;
      for (let i = 0; i < mvValues.length; i++) {
        const offsetT = t - (mvValues.length - 1 - i) * (dtMs / 1000);

        // Save raw values to aligned rows
        // Since ESP32 sends async packets per channel, we store them and we'll align them on stop()
        this.recordedSamples.push({
          t: offsetT,
          ch1: ch === 1 ? mvValues[i] : NaN,
          ch2: ch === 2 ? mvValues[i] : NaN,
          ch3: ch === 3 ? mvValues[i] : NaN,
          ch4: ch === 4 ? mvValues[i] : NaN,
        });
      }
    }

    this.notify();
  }

  // Recording triggers
  public startRecording(meta: {
    participant: string;
    sex: string;
    age: number;
    weight_kg: number;
    height_cm: number;
    exercise: string;
    trial_no: number;
  }) {
    this.recordedSamples = [];
    this.recordMetadata = {
      ...meta,
      originMs: Date.now(),
      timestamp: new Date().toISOString(),
    };
    this.isRecording = true;
  }

  public stopRecording(applyDsp = true): EmgDataset | null {
    if (!this.isRecording) return null;
    this.isRecording = false;

    if (this.recordedSamples.length === 0) return null;

    // Align the raw recorded packets (which come asynchronously per channel) by timestamp bins
    const binSizeSec = 1 / this.hwSampleRate;
    const alignedMap = new Map<
      number,
      { ch1: number[]; ch2: number[]; ch3: number[]; ch4: number[] }
    >();

    for (const s of this.recordedSamples) {
      const bin = Math.round(s.t / binSizeSec);
      if (!alignedMap.has(bin)) {
        alignedMap.set(bin, { ch1: [], ch2: [], ch3: [], ch4: [] });
      }
      const data = alignedMap.get(bin)!;
      if (!isNaN(s.ch1)) data.ch1.push(s.ch1);
      if (!isNaN(s.ch2)) data.ch2.push(s.ch2);
      if (!isNaN(s.ch3)) data.ch3.push(s.ch3);
      if (!isNaN(s.ch4)) data.ch4.push(s.ch4);
    }

    // Sort bins to create sequential aligned samples
    const sortedBins = Array.from(alignedMap.keys()).sort((a, b) => a - b);
    const originBin = sortedBins[0] ?? 0;

    const finalSamples: EmgSample[] = [];

    // Fill gaps by carrying forward previous values
    let lastCh1 = 0;
    let lastCh2 = 0;
    let lastCh3 = 0;
    let lastCh4 = 0;

    for (const bin of sortedBins) {
      const data = alignedMap.get(bin)!;
      const t = (bin - originBin) * binSizeSec;

      const ch1 = data.ch1.length ? data.ch1[0] : lastCh1;
      const ch2 = data.ch2.length ? data.ch2[0] : lastCh2;
      const ch3 = data.ch3.length ? data.ch3[0] : lastCh3;
      const ch4 = data.ch4.length ? data.ch4[0] : lastCh4;

      finalSamples.push({
        t: Math.round(t * 1000) / 1000,
        ch1,
        ch2,
        ch3,
        ch4,
      });

      lastCh1 = ch1;
      lastCh2 = ch2;
      lastCh3 = ch3;
      lastCh4 = ch4;
    }

    // Mean-center the raw values
    const sums = [0, 0, 0, 0];
    for (const s of finalSamples) {
      sums[0] += s.ch1;
      sums[1] += s.ch2;
      sums[2] += s.ch3;
      sums[3] += s.ch4;
    }
    const means = sums.map((s) => s / finalSamples.length);
    const centeredSamples = finalSamples.map((s) => ({
      t: s.t,
      ch1: s.ch1 - means[0],
      ch2: s.ch2 - means[1],
      ch3: s.ch3 - means[2],
      ch4: s.ch4 - means[3],
    }));

    const dataset: EmgDataset = {
      id: `record-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Acquisition: ${this.recordMetadata.participant}_trial${this.recordMetadata.trial_no}_${this.recordMetadata.exercise}`,
      sampleRate: this.hwSampleRate,
      samples: centeredSamples,
      uploadedAt: Date.now(),
      source: "csv", // Allow standard CSV operations
    };

    return applyDsp ? preprocessDataset(dataset) : dataset;
  }

  public getRecordSampleCount(): number {
    return this.recordedSamples.length;
  }

  public getIsRecording(): boolean {
    return this.isRecording;
  }

  // Serial reading loop
  private async startReadLoop() {
    if (!this.port?.readable) return;

    this.reading = true;
    this.reader = this.port.readable.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (this.reading) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;

        this.stats.bytesReceived += value.length;
        buffer += decoder.decode(value, { stream: true });

        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;

          try {
            const packet = JSON.parse(line);
            this.stats.rxPackets++;
            this.handlePacket(packet);
          } catch (e) {
            this.stats.rxErrors++;
          }
        }
      }
    } catch (err) {
      // Handle read errors
    } finally {
      if (this.reader) {
        try {
          this.reader.releaseLock();
        } catch (e) {}
        this.reader = null;
      }
      this.connected = false;
      this.notify();
    }
  }
}

export const serialManager = new EmgSerialManager();
