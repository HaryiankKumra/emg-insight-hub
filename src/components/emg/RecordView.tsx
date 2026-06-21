import { useEffect, useRef, useState } from "react";
import { Radio, Play, Square, Cpu, HardDriveDownload } from "lucide-react";
import { serialManager } from "@/lib/emg/serial";
import { useEmgStore } from "@/lib/emg/store";
import { CHANNEL_LABELS, CHANNEL_COLORS } from "@/lib/emg/signal";

export function RecordView() {
  const { addDataset } = useEmgStore();
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState(serialManager.stats);
  const [isRecording, setIsRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [recordDuration, setRecordDuration] = useState(0);

  // Channels live RMS readouts
  const [rmsVals, setRmsVals] = useState({ 1: 0, 2: 0, 3: 0, 4: 0 });

  // Participant Form state
  const [meta, setMeta] = useState({
    participant: "P002",
    sex: "male",
    age: 22,
    weight_kg: 52,
    height_cm: 171,
    exercise: "calf_raises",
    trial_no: 1,
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Monitor Serial Manager updates
  useEffect(() => {
    const unsubscribe = serialManager.registerListener(() => {
      setConnected(serialManager.connected);
      setStats({ ...serialManager.stats });
      setIsRecording(serialManager.getIsRecording());
      setSampleCount(serialManager.getRecordSampleCount());

      // Update channel RMS readouts
      setRmsVals({
        1: serialManager.getLiveChannelSnapshot(1).rms,
        2: serialManager.getLiveChannelSnapshot(2).rms,
        3: serialManager.getLiveChannelSnapshot(3).rms,
        4: serialManager.getLiveChannelSnapshot(4).rms,
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Recording Timer
  useEffect(() => {
    if (isRecording) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setRecordDuration((Date.now() - start) / 1000);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecordDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // Scrolling Oscilloscope Canvas Rendering Loop (60 FPS)
  useEffect(() => {
    let animFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // Handle high-DPI sizing
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.resetTransform();
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, w, h);

      // Draw grid lines
      ctx.strokeStyle = "rgba(0, 229, 200, 0.03)";
      ctx.lineWidth = 1;
      const grid = 40;
      for (let x = 0; x < w; x += grid) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += grid) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Draw center horizontal lines for the 4 split channels
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.setLineDash([4, 4]);
      for (let i = 1; i <= 4; i++) {
        const centerY = (h / 4) * (i - 0.5);
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Draw channel waveforms
      for (let ch = 1; ch <= 4; ch++) {
        const channelObj = serialManager.getLiveChannelSnapshot(ch);
        const data = channelObj.samples;
        if (data.length < 2) continue;

        ctx.strokeStyle = CHANNEL_COLORS[`ch${ch}` as any] || "#ffffff";
        ctx.lineWidth = 1.4;

        ctx.beginPath();
        const step = w / 500; // Map 500 samples to width
        const centerY = (h / 4) * (ch - 0.5);
        const heightScale = (h / 4 / 3300) * 2; // Scale 3300 mV amplitude

        for (let i = 0; i < data.length; i++) {
          const x = i * step;
          // Baseline center around the middle of each channel block
          const y = centerY - (data[i] - 1650) * heightScale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      animFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [connected]);

  const handleConnect = async () => {
    try {
      if (connected) {
        await serialManager.disconnect();
      } else {
        await serialManager.connect();
      }
    } catch (err: any) {
      alert(err.message || "Failed to establish Web Serial connection.");
    }
  };

  const handleStartRecord = () => {
    if (!connected) {
      alert("Please connect your ESP32 board before recording.");
      return;
    }
    serialManager.startRecording(meta);
  };

  const handleStopRecord = () => {
    const dataset = serialManager.stopRecording(true); // Automatically pre-process with HPF/LPF/Notch
    if (dataset) {
      addDataset(dataset);
      alert(
        `Recording successfully saved!\nDataset: "${dataset.name}" has been added to your explorer.`,
      );
    } else {
      alert("No data was recorded. Please check connection.");
    }
  };

  return (
    <div className="grid grid-cols-12 gap-3 auto-rows-min">
      {/* Header controls card */}
      <section className="panel col-span-12 flex flex-col md:flex-row items-center justify-between gap-3 p-3 bg-card/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <div
            className={`size-8 rounded-sm border grid place-items-center ${connected ? "border-primary text-primary text-glow-green" : "border-border text-muted-foreground"}`}
          >
            <Radio className={`size-4 ${connected ? "animate-pulse" : ""}`} />
          </div>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-glow-green text-primary">
              Web Serial Acquisition
            </h2>
            <p className="text-[10px] text-muted-foreground">
              MyoWare 2.0 × ESP32 Wireless 4-Channel Lower Limb Receiver
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Stats indicators */}
          {connected && (
            <div className="flex items-center gap-4 text-[10px] tracking-wider bg-background/40 border border-border px-3 py-1.5 rounded-sm font-mono text-muted-foreground">
              <span>
                RX: <span className="text-primary">{stats.rxPackets.toLocaleString()} pkts</span>
              </span>
              <span>
                ERR:{" "}
                <span className={stats.rxErrors > 0 ? "text-destructive" : "text-muted-foreground"}>
                  {stats.rxErrors}
                </span>
              </span>
              <span>
                RATE:{" "}
                <span className="text-glow-cyan text-[var(--neon-cyan)]">
                  {serialManager.hwSampleRate} Hz
                </span>
              </span>
            </div>
          )}

          <button
            onClick={handleConnect}
            className={`px-4 py-1.5 rounded-sm border text-xs font-bold uppercase tracking-wider transition-all ${
              connected
                ? "bg-destructive/15 border-destructive/50 text-destructive hover:bg-destructive/25"
                : "bg-primary/15 border-primary/50 text-primary hover:bg-primary/25 text-glow-green"
            }`}
          >
            {connected ? "Disconnect Port" : "Connect ESP32 Master"}
          </button>
        </div>
      </section>

      {/* Form configuration card */}
      <section className="panel col-span-12 lg:col-span-4 flex flex-col min-h-0">
        <header className="panel-header uppercase tracking-wider">Acquisition Settings</header>
        <div className="p-3 space-y-3 flex-1 overflow-auto">
          <div className="space-y-1">
            <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
              Participant ID
            </label>
            <input
              type="text"
              value={meta.participant}
              onChange={(e) => setMeta({ ...meta, participant: e.target.value })}
              className="w-full bg-background border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Sex
              </label>
              <select
                value={meta.sex}
                onChange={(e) => setMeta({ ...meta, sex: e.target.value })}
                className="w-full bg-background border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Age
              </label>
              <input
                type="number"
                value={meta.age}
                onChange={(e) => setMeta({ ...meta, age: parseInt(e.target.value) || 0 })}
                className="w-full bg-background border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Weight (kg)
              </label>
              <input
                type="number"
                value={meta.weight_kg}
                onChange={(e) => setMeta({ ...meta, weight_kg: parseFloat(e.target.value) || 0 })}
                className="w-full bg-background border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Height (cm)
              </label>
              <input
                type="number"
                value={meta.height_cm}
                onChange={(e) => setMeta({ ...meta, height_cm: parseFloat(e.target.value) || 0 })}
                className="w-full bg-background border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Exercise Protocol
              </label>
              <select
                value={meta.exercise}
                onChange={(e) => setMeta({ ...meta, exercise: e.target.value })}
                className="w-full bg-background border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
              >
                <option value="calf_raises">Calf Raises</option>
                <option value="squats">Squats</option>
                <option value="jumping">Jumping</option>
                <option value="walking">Walking</option>
                <option value="stair_ascent">Stair Ascent</option>
                <option value="stair_descent">Stair Descent</option>
                <option value="leg_press">Leg Press</option>
                <option value="lunges">Lunges</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Trial Number
              </label>
              <input
                type="number"
                value={meta.trial_no}
                onChange={(e) => setMeta({ ...meta, trial_no: parseInt(e.target.value) || 1 })}
                className="w-full bg-background border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50"
              />
            </div>
          </div>

          {/* Record Actions Card */}
          <div className="border border-border/80 rounded-sm p-3 bg-background/40 space-y-3 mt-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                Recorder Panel
              </span>
              {isRecording && (
                <span className="flex items-center gap-1.5 text-[10px] text-destructive animate-pulse font-mono font-bold">
                  <span className="size-2 rounded-full bg-destructive" />
                  REC · {recordDuration.toFixed(1)}s
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleStartRecord}
                disabled={!connected || isRecording}
                className="w-full flex items-center justify-center gap-2 py-2 bg-primary/20 border border-primary/50 hover:bg-primary/30 text-primary text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40 text-glow-green"
              >
                <Play className="size-3.5 fill-primary" /> Start
              </button>
              <button
                onClick={handleStopRecord}
                disabled={!isRecording}
                className="w-full flex items-center justify-center gap-2 py-2 bg-destructive/20 border border-destructive/50 hover:bg-destructive/30 text-destructive text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40"
              >
                <Square className="size-3.5 fill-destructive" /> Stop & Save
              </button>
            </div>

            <div className="text-[9px] text-muted-foreground text-center font-mono">
              Recorded Samples:{" "}
              <span className="text-foreground">{sampleCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live scrolling oscilloscope canvas card */}
      <section className="panel col-span-12 lg:col-span-8 flex flex-col h-[400px]">
        <header className="panel-header flex items-center justify-between uppercase tracking-wider">
          <span>Live Oscilloscope Waveforms (raw mV)</span>
          <span className="text-[10px] lowercase text-muted-foreground">
            Teal=RF | Orange=BF | Purple=Calf | Magenta=TA
          </span>
        </header>
        <div className="flex-1 bg-background/60 p-2 relative min-h-0">
          {!connected && (
            <div className="absolute inset-0 grid place-items-center bg-background/80 text-muted-foreground text-xs uppercase tracking-widest text-center">
              <div>
                <Cpu className="size-10 text-muted-foreground/30 mx-auto mb-3" />
                Connect Serial Port to Begin Signal Stream
              </div>
            </div>
          )}
          <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
      </section>

      {/* Real-time channel meters card */}
      <section className="panel col-span-12">
        <header className="panel-header uppercase tracking-wider">
          Real-time Muscle Activity Metrics
        </header>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-2">
          {[1, 2, 3, 4].map((ch) => {
            const muscleName = CHANNEL_LABELS[`ch${ch}` as any];
            const color = CHANNEL_COLORS[`ch${ch}` as any];
            const rms = rmsVals[ch as 1 | 2 | 3 | 4];

            return (
              <div key={ch} className="border border-border rounded-sm p-3 bg-background/40">
                <div className="flex items-center gap-2 text-[10px] font-bold">
                  <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
                  <span>
                    CH{ch} · {muscleName.toUpperCase()}
                  </span>
                </div>

                {/* Visual contraction intensity progress bar */}
                <div className="mt-3 flex items-baseline justify-between">
                  <span
                    className="text-2xl font-mono font-bold tracking-tight"
                    style={{ color: color }}
                  >
                    {rms} <span className="text-[10px] text-muted-foreground">mV</span>
                  </span>
                </div>

                <div className="mt-2 h-1.5 bg-border rounded-sm overflow-hidden">
                  <div
                    className="h-full transition-all duration-75"
                    style={{
                      width: `${Math.min((rms / 300) * 100, 100)}%`,
                      backgroundColor: color,
                      boxShadow: `0 0 8px ${color}`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
