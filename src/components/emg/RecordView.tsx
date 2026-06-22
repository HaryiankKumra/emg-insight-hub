import { useEffect, useRef, useState } from "react";
import { Radio, Play, Square, Cpu, Download, Sparkles } from "lucide-react";
import { serialManager } from "@/lib/emg/serial";
import { useEmgStore } from "@/lib/emg/store";
import { CHANNEL_LABELS, CHANNEL_COLORS, rms, mean, zeroCrossings, type Channel, type EmgDataset } from "@/lib/emg/signal";
import { Button } from "@/components/ui/button";

const CH_COLORS = {
  1: { line: "#00e5a0", fill: "rgba(0,229,160,0.06)" },
  2: { line: "#4d9fff", fill: "rgba(77,159,255,0.06)" },
  3: { line: "#a56bff", fill: "rgba(165,107,255,0.06)" },
  4: { line: "#ffb84d", fill: "rgba(255,184,77,0.06)" },
};

export function RecordView({ onSwitchView }: { onSwitchView?: (view: any) => void }) {
  const { addDataset, dspEnabled, setDspEnabled, theme } = useEmgStore();
  const isDark = theme === "dark";
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState(serialManager.stats);
  const [isRecording, setIsRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [recordDuration, setRecordDuration] = useState(0);
  const [hasRecordedData, setHasRecordedData] = useState(false);
  const [lastRecordedDataset, setLastRecordedDataset] = useState<EmgDataset | null>(null);

  // Auto-scaling state per channel
  const [autoScale, setAutoScale] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
  });

  // Alignment statistics modal state
  const [showAlignModal, setShowAlignModal] = useState(false);

  // Channels live readouts state
  const [metrics, setMetrics] = useState<Record<number, { rms: number; peak: number; mean: number; pp: number; rate: number }>>({
    1: { rms: 0, peak: 0, mean: 0, pp: 0, rate: 0 },
    2: { rms: 0, peak: 0, mean: 0, pp: 0, rate: 0 },
    3: { rms: 0, peak: 0, mean: 0, pp: 0, rate: 0 },
    4: { rms: 0, peak: 0, mean: 0, pp: 0, rate: 0 },
  });

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

  const canvasRef1 = useRef<HTMLCanvasElement | null>(null);
  const canvasRef2 = useRef<HTMLCanvasElement | null>(null);
  const canvasRef3 = useRef<HTMLCanvasElement | null>(null);
  const canvasRef4 = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Monitor Serial Manager updates
  useEffect(() => {
    const unsubscribe = serialManager.registerListener(() => {
      setConnected(serialManager.connected);
      setStats({ ...serialManager.stats });
      setIsRecording(serialManager.getIsRecording());
      setSampleCount(serialManager.getRecordSampleCount());

      // Update channel metrics readouts
      const newMetrics: typeof metrics = {};
      for (let ch = 1; ch <= 4; ch++) {
        const snap = serialManager.getLiveChannelSnapshot(ch);
        const data = snap.samples;
        let p2p = 0;
        if (data.length > 0) {
          const max = Math.max(...data);
          const min = Math.min(...data);
          p2p = max - min;
        }
        newMetrics[ch] = {
          rms: snap.rms,
          peak: snap.peak,
          mean: snap.mean,
          pp: Math.round(p2p * 10) / 10,
          rate: serialManager.hwSampleRate,
        };
      }
      setMetrics(newMetrics);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Recording Duration Timer
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

  // Loading cached session metadata on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem("emg_session_meta");
      if (cached) {
        const m = JSON.parse(cached);
        setMeta((prev) => ({
          ...prev,
          participant: m.participant || "P002",
          sex: m.sex || "male",
          age: parseInt(m.age) || 22,
          weight_kg: parseFloat(m.weight_kg) || 52,
          height_cm: parseFloat(m.height_cm) || 171,
          exercise: m.exercise || "calf_raises",
          trial_no: parseInt(m.trial_no) || 1,
        }));
      }
    } catch (e) {}
  }, []);

  // Save session metadata updates
  const saveMetaCache = (updated: typeof meta) => {
    try {
      localStorage.setItem("emg_session_meta", JSON.stringify(updated));
    } catch (e) {}
  };

  // Rendering Loop for the 4 separate scrolling canvases with axis labels
  useEffect(() => {
    let animFrameId: number;

    const draw = () => {
      const refs = [canvasRef1, canvasRef2, canvasRef3, canvasRef4];
      
      refs.forEach((ref, idx) => {
        const canvas = ref.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Dynamic width: expand for long recordings (> 30 seconds)
        let displayWidth = canvas.clientWidth;
        if (recordDuration > 30) {
          // Scale canvas to fit more data: 1 pixel per sample point roughly
          displayWidth = Math.max(canvas.clientWidth, recordDuration * 10); // 10px per second
        }

        const h = canvas.clientHeight;

        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== displayWidth * dpr || canvas.height !== h * dpr) {
          canvas.width = displayWidth * dpr;
          canvas.height = h * dpr;
        }
        ctx.resetTransform();
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, displayWidth, h);

        const chId = idx + 1;
        const snap = serialManager.getLiveChannelSnapshot(chId);
        const data = snap.samples; // Max 500 samples
        if (data.length < 2) return;

        const color = CH_COLORS[chId as 1 | 2 | 3 | 4];

        // Determine Y Range
        let yMin = 0;
        let yMax = 3300;

        if (autoScale[chId]) {
          const max = Math.max(...data);
          const min = Math.min(...data);
          const range = max - min || 10;
          const pad = range * 0.15;
          yMin = Math.max(0, min - pad);
          yMax = Math.min(3300, max + pad);
        }

        // Calculate nice axis steps
        const yRange = yMax - yMin;
        let yStep = 100; // Default step
        if (yRange > 2000) yStep = 500;
        else if (yRange > 1000) yStep = 200;
        else if (yRange > 500) yStep = 100;
        else yStep = 50;

        // Reserve space for axes
        const leftMargin = 50;
        const bottomMargin = 30;
        const plotW = displayWidth - leftMargin;
        const plotH = h - bottomMargin;

        // Draw horizontal grid lines and Y-axis labels
        ctx.font = "11px monospace";
        const isDark = theme === "dark";
        ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.6)";
        ctx.textAlign = "right";
        ctx.strokeStyle = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.1)";
        ctx.lineWidth = 1;

        for (let yVal = Math.ceil(yMin / yStep) * yStep; yVal <= yMax; yVal += yStep) {
          const yPx = plotH - ((yVal - yMin) / (yMax - yMin || 1)) * plotH;
          
          // Draw grid line
          ctx.beginPath();
          ctx.moveTo(leftMargin, yPx);
          ctx.lineTo(displayWidth, yPx);
          ctx.stroke();
          
          // Draw label
          ctx.fillText(`${Math.round(yVal)}mV`, leftMargin - 5, yPx + 4);
        }

        // Draw Y-axis
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(leftMargin, 0);
        ctx.lineTo(leftMargin, plotH);
        ctx.stroke();

        // Draw X-axis
        ctx.beginPath();
        ctx.moveTo(leftMargin, plotH);
        ctx.lineTo(displayWidth, plotH);
        ctx.stroke();

        // Draw time axis labels at bottom
        ctx.font = "10px monospace";
        ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.4)" : "rgba(0, 0, 0, 0.6)";
        ctx.textAlign = "center";
        const timeStep = Math.ceil(snap.samples.length / 5); // Show ~5 time labels
        const sampleRate = snap.sampleRate || 1000;
        
        for (let i = 0; i < snap.samples.length; i += timeStep) {
          const px = leftMargin + (i / 500) * plotW;
          const timeMs = (i / sampleRate) * 1000;
          ctx.fillText(`${timeMs.toFixed(0)}ms`, px, plotH + 20);
        }

        // Draw signal
        const stepX = plotW / 500;

        ctx.strokeStyle = color.line;
        ctx.lineWidth = 1.6;
        ctx.beginPath();

        for (let i = 0; i < data.length; i++) {
          const px = leftMargin + (i * stepX);
          const py = plotH - ((data[i] - yMin) / (yMax - yMin || 1)) * plotH;

          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Draw gradient fill below path
        ctx.lineTo(leftMargin + (data.length - 1) * stepX, plotH);
        ctx.lineTo(leftMargin, plotH);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, plotH);
        fillGrad.addColorStop(0, color.fill);
        fillGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = fillGrad;
        ctx.fill();
      });

      animFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [autoScale, connected, recordDuration]);

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
    setHasRecordedData(false);
    setLastRecordedDataset(null);
  };

  const handleStopRecord = () => {
    const dataset = serialManager.stopRecording(true);
    if (dataset) {
      addDataset(dataset);
      setLastRecordedDataset(dataset);
      setHasRecordedData(true);
      alert(`Recording successfully saved!\nDataset: "${dataset.name}" added.`);
    } else {
      alert("No data was recorded. Please check connection.");
    }
  };

  // Download & Analyze csv files, opens modal alignment analyzer
  const handleDownloadAllAndAnalyze = () => {
    if (!lastRecordedDataset) {
      alert("No data available to download. Please record a trial first.");
      return;
    }

    const downloadCSV = (filtered: boolean) => {
      const ds = filtered ? lastRecordedDataset : serialManager.stopRecording(false);
      if (!ds) return;
      const head = "t,ch1,ch2,ch3,ch4\n";
      const rows = ds.samples
        .map(
          (s) =>
            `${s.t.toFixed(4)},${s.ch1.toFixed(3)},${s.ch2.toFixed(3)},${s.ch3.toFixed(3)},${s.ch4.toFixed(3)}`
        )
        .join("\n");
      const blob = new Blob([head + rows], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meta.participant}_trial${meta.trial_no}_${meta.exercise}_${filtered ? "filtered" : "raw"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    // Download both raw and filtered CSV files
    downloadCSV(true);
    downloadCSV(false);

    // Open alignment analysis modal
    setShowAlignModal(true);
  };

  const toggleAutoScale = (chId: number) => {
    setAutoScale((prev) => ({
      ...prev,
      [chId]: !prev[chId],
    }));
  };

  return (
    <div className="relative min-h-full flex flex-col bg-background text-foreground select-none">
      
      {/* ═════════════════ TOP NAVIGATION BAR ═════════════════ */}
      <nav className="border-b border-border bg-card/60 backdrop-blur-md px-4 py-2.5 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-primary text-glow-green text-lg">
            🧠
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-widest text-primary text-glow-green uppercase">
              EMG Monitor
            </h1>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">
              Real-Time Acquisition System
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onSwitchView && (
            <button
              onClick={() => onSwitchView("game")}
              className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500/10 to-purple-500/10 hover:from-emerald-500/20 hover:to-purple-500/20 border border-primary/30 rounded-full text-[10px] font-mono tracking-widest font-black text-primary text-glow-green uppercase transition-all"
            >
              🎮 Muscle Rush
            </button>
          )}

          <div className={`px-2.5 py-1 rounded-sm text-[9px] font-bold border transition-colors ${
            dspEnabled 
              ? "border-primary/30 bg-primary/5 text-primary text-glow-green" 
              : "border-border text-muted-foreground"
          }`}>
            🔧 FILT
          </div>

          <div className={`px-2.5 py-1 rounded-sm text-[9px] font-bold border transition-colors ${
            isRecording 
              ? "border-destructive/30 bg-destructive/5 text-destructive animate-pulse" 
              : "border-border text-muted-foreground"
          }`}>
            🔴 REC — {isRecording ? `${recordDuration.toFixed(1)}s` : "IDLE"}
          </div>

          <div className={`px-2.5 py-1 rounded-sm text-[9px] font-bold border flex items-center gap-1.5 transition-colors ${
            connected 
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-glow-green" 
              : "border-border text-muted-foreground"
          }`}>
            <span className={`size-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            {connected ? "CONNECTED" : "OFFLINE"}
          </div>
        </div>
      </nav>

      {/* ═════════════════ MAIN CONTENT CONTAINER ═════════════════ */}
      <main className="flex-1 p-3 overflow-auto space-y-3">
        
        {/* Connection & Record Metadata Panel */}
        <section className="panel p-3 bg-card/40 grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          
          {/* USB Serial Connector settings */}
          <div className="lg:col-span-4 grid grid-cols-2 gap-2 items-end">
            <div className="space-y-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Baud Rate</label>
              <select className={`w-full border border-border rounded-sm p-2 text-xs text-foreground focus:border-primary/50 ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`}>
                <option value="9600">9600</option>
                <option value="115200">115200</option>
                <option value="921600">921600</option>
              </select>
            </div>
            
            <div className="flex gap-2">
              <Button 
                onClick={handleConnect}
                className={`flex-1 uppercase font-bold tracking-wider text-[10px] py-4 rounded-sm border ${
                  connected 
                    ? "bg-destructive/15 border-destructive/50 text-destructive hover:bg-destructive/25" 
                    : "bg-primary/10 border-primary/40 text-primary hover:bg-primary/20 text-glow-green"
                }`}
              >
                {connected ? "Disconnect" : "Connect"}
              </Button>

              <button
                onClick={() => setDspEnabled(!dspEnabled)}
                className={`px-2.5 border rounded-sm text-[10px] font-bold transition-all ${
                  dspEnabled
                    ? "bg-primary/20 border-primary text-primary"
                    : "bg-background/40 border-border text-muted-foreground hover:border-primary/30"
                }`}
              >
                🔧 {dspEnabled ? "Filter ON" : "Filter OFF"}
              </button>
            </div>
          </div>

          {/* Research Metadata form fields */}
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-7 gap-2 items-end">
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Participant</label>
              <input 
                type="text" 
                value={meta.participant} 
                onChange={(e) => { setMeta(prev => { const n = { ...prev, participant: e.target.value }; saveMetaCache(n); return n; }); }}
                className={`w-full border border-border rounded-sm p-1.5 text-xs text-foreground focus:border-primary/50 text-center ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`}
              />
            </div>
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Sex</label>
              <select 
                value={meta.sex} 
                onChange={(e) => { setMeta(prev => { const n = { ...prev, sex: e.target.value }; saveMetaCache(n); return n; }); }}
                className={`w-full border border-border rounded-sm p-1.5 text-xs text-foreground focus:border-primary/50 ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Age</label>
              <input 
                type="number" 
                value={meta.age} 
                onChange={(e) => { setMeta(prev => { const n = { ...prev, age: parseInt(e.target.value) || 0 }; saveMetaCache(n); return n; }); }}
                className={`w-full border border-border rounded-sm p-1.5 text-xs text-foreground focus:border-primary/50 text-center ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`}
              />
            </div>
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Weight (kg)</label>
              <input 
                type="number" 
                value={meta.weight_kg} 
                onChange={(e) => { setMeta(prev => { const n = { ...prev, weight_kg: parseFloat(e.target.value) || 0 }; saveMetaCache(n); return n; }); }}
                className={`w-full border border-border rounded-sm p-1.5 text-xs text-foreground focus:border-primary/50 text-center ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`}
              />
            </div>
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Height (cm)</label>
              <input 
                type="number" 
                value={meta.height_cm} 
                onChange={(e) => { setMeta(prev => { const n = { ...prev, height_cm: parseFloat(e.target.value) || 0 }; saveMetaCache(n); return n; }); }}
                className={`w-full border border-border rounded-sm p-1.5 text-xs text-foreground focus:border-primary/50 text-center ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`}
              />
            </div>
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Exercise</label>
              <select 
                value={meta.exercise} 
                onChange={(e) => { setMeta(prev => { const n = { ...prev, exercise: e.target.value }; saveMetaCache(n); return n; }); }}
                className={`w-full border border-border rounded-sm p-1.5 text-xs text-foreground focus:border-primary/50 ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`
              >
                <option value="walking">Walking</option>
                <option value="stair_ascent">Stair Ascent</option>
                <option value="stair_descent">Stair Descent</option>
                <option value="calf_raises">Calf Raises</option>
                <option value="lunges">Lunges</option>
                <option value="leg_press">Leg Press</option>
                <option value="squats">Squats</option>
                <option value="jumping">Jumping</option>
                <option value="cycling">Cycling</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-1">
              <label className="text-[9px] uppercase tracking-widest text-muted-foreground">Trial</label>
              <select 
                value={meta.trial_no} 
                onChange={(e) => { setMeta(prev => { const n = { ...prev, trial_no: parseInt(e.target.value) || 1 }; saveMetaCache(n); return n; }); }}
                className={`w-full border border-border rounded-sm p-1.5 text-xs text-foreground focus:border-primary/50 ${isDark ? 'bg-[#090d16]' : 'bg-slate-100'}`
              >
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          {/* Record command actions */}
          <div className="lg:col-span-12 grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-border/40">
            <Button
              onClick={handleStartRecord}
              disabled={!connected || isRecording}
              className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold uppercase tracking-widest text-xs py-4 rounded-sm"
            >
              ⏺ Record
            </Button>
            <Button
              onClick={handleStopRecord}
              disabled={!isRecording}
              className="w-full bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/30 font-bold uppercase tracking-widest text-xs py-4 rounded-sm"
            >
              ⏹ Stop
            </Button>
            <Button
              onClick={handleDownloadAllAndAnalyze}
              disabled={!hasRecordedData}
              className="w-full bg-[#00d4e8]/10 hover:bg-[#00d4e8]/20 text-[#00d4e8] border border-[#00d4e8]/30 font-bold uppercase tracking-widest text-xs py-4 rounded-sm"
            >
              📥 Download & Analyze
            </Button>
          </div>

        </section>

        {/* System Diagnostics stats Row */}
        <section className="grid grid-cols-2 md:grid-cols-6 gap-2 text-center font-mono select-none">
          <div className="border border-border bg-[#090d16]/30 p-2.5 rounded-sm">
            <span className="block text-[8px] text-muted-foreground tracking-widest uppercase">Packets Received</span>
            <span className="block text-base font-bold text-emerald-400 text-glow-green mt-1">{stats.rxPackets.toLocaleString()}</span>
            <span className="block text-[7px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">total rx</span>
          </div>
          <div className="border border-border bg-[#090d16]/30 p-2.5 rounded-sm">
            <span className="block text-[8px] text-muted-foreground tracking-widest uppercase">Parse Errors</span>
            <span className={`block text-base font-bold mt-1 ${stats.rxErrors > 0 ? "text-destructive" : "text-muted-foreground"}`}>{stats.rxErrors}</span>
            <span className="block text-[7px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">malformed</span>
          </div>
          <div className="border border-border bg-[#090d16]/30 p-2.5 rounded-sm">
            <span className="block text-[8px] text-muted-foreground tracking-widest uppercase">Data Received</span>
            <span className="block text-base font-bold text-[var(--neon-cyan)] text-glow-cyan mt-1">
              {stats.bytesReceived < 1024 ? `${stats.bytesReceived} B` : (stats.bytesReceived < 1024 * 1024 ? `${(stats.bytesReceived / 1024).toFixed(1)} KB` : `${(stats.bytesReceived / (1024 * 1024)).toFixed(2)} MB`)}
            </span>
            <span className="block text-[7px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">bytes size</span>
          </div>
          <div className="border border-border bg-[#090d16]/30 p-2.5 rounded-sm">
            <span className="block text-[8px] text-muted-foreground tracking-widest uppercase">Sample Rate</span>
            <span className="block text-base font-bold text-primary text-glow-green mt-1">
              {connected ? `${serialManager.hwSampleRate} Hz` : "—"}
            </span>
            <span className="block text-[7px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">master dt</span>
          </div>
          <div className="border border-border bg-[#090d16]/30 p-2.5 rounded-sm">
            <span className="block text-[8px] text-muted-foreground tracking-widest uppercase">Data Link</span>
            <span className="block text-base font-bold text-slate-200 mt-1">{connected ? "Live" : "—"}</span>
            <span className="block text-[7px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">Web serial</span>
          </div>
          <div className="border border-border bg-[#090d16]/30 p-2.5 rounded-sm">
            <span className="block text-[8px] text-muted-foreground tracking-widest uppercase">Recording</span>
            <span className={`block text-base font-bold mt-1 ${isRecording ? "text-destructive animate-pulse" : "text-muted-foreground"}`}>
              {isRecording ? "Active" : "Idle"}
            </span>
            <span className="block text-[7px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">status state</span>
          </div>
        </section>

        {/* 2x2 Channels Waveforms grid */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((chId) => {
            const label = CHANNEL_LABELS[`ch${chId}` as Channel] || `CH${chId}`;
            const color = CH_COLORS[chId as 1 | 2 | 3 | 4].line;
            const ref = [canvasRef1, canvasRef2, canvasRef3, canvasRef4][chId - 1];
            const chMetrics = metrics[chId];

            return (
              <article key={chId} className="panel p-3 bg-card/50 flex flex-col gap-2 border-border/80">
                <header className="flex justify-between items-center border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2">
                    <span 
                      className="size-5 rounded-sm grid place-items-center text-[10px] font-bold text-black"
                      style={{ backgroundColor: color }}
                    >
                      {chId}
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-foreground leading-none uppercase">
                        {label.split(" (")[0]}
                      </h4>
                      <span className="text-[7.5px] font-mono text-muted-foreground uppercase mt-0.5 block">
                        slave {chId - 1} · {label.split(" (")[1]?.replace(")", "") || "TA"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <div className="font-mono">
                      <span className="block text-[7.5px] text-muted-foreground uppercase leading-none">RMS (mV)</span>
                      <span className="text-base font-bold" style={{ color: color }}>
                        {connected ? chMetrics.rms : "—"}
                      </span>
                    </div>
                    <div className="font-mono">
                      <span className="block text-[7.5px] text-muted-foreground uppercase leading-none">Peak (mV)</span>
                      <span className="text-base font-bold" style={{ color: color }}>
                        {connected ? chMetrics.peak : "—"}
                      </span>
                    </div>
                    
                    <button
                      onClick={() => toggleAutoScale(chId)}
                      className={`px-2 py-1 text-[8px] font-mono tracking-wider border rounded-sm uppercase transition-all ${
                        autoScale[chId] 
                          ? "bg-primary/10 border-primary text-primary" 
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {autoScale[chId] ? "⤢ Auto" : "⤢ Fixed"}
                    </button>
                  </div>
                </header>

                {/* Oscilloscope scrolling waveform trace with optional horizontal scroll for long recordings */}
                <div className={`h-[140px] bg-black/40 border border-border/40 rounded-sm relative ${recordDuration > 30 ? 'overflow-x-auto overflow-y-hidden' : 'overflow-hidden'}`}>
                  <div className={recordDuration > 30 ? 'min-w-full' : 'w-full'}>
                    <canvas ref={ref} className={`${recordDuration > 30 ? 'w-full min-w-max' : 'w-full'} h-full block`} />
                  </div>
                  {!connected && (
                    <div className="absolute inset-0 grid place-items-center text-[9px] font-mono uppercase tracking-widest text-muted-foreground/30">
                      Channel Stream Idle
                    </div>
                  )}
                </div>

                {/* Channel diagnostics values footers */}
                <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-[9px] bg-[#090d16]/30 border border-border/30 p-2.5 rounded-sm mt-1">
                  <div>
                    <span className="block text-muted-foreground uppercase">Mean (mV)</span>
                    <strong className="block text-[11px] text-foreground mt-0.5">{connected ? chMetrics.mean : "—"}</strong>
                  </div>
                  <div>
                    <span className="block text-muted-foreground uppercase">Peak-Peak (mV)</span>
                    <strong className="block text-[11px] text-foreground mt-0.5">{connected ? chMetrics.pp : "—"}</strong>
                  </div>
                  <div>
                    <span className="block text-muted-foreground uppercase">RMS (mV)</span>
                    <strong className="block text-[11px] text-foreground mt-0.5">{connected ? chMetrics.rms : "—"}</strong>
                  </div>
                  <div>
                    <span className="block text-muted-foreground uppercase">Rate</span>
                    <strong className="block text-[11px] text-foreground mt-0.5">{connected ? `${chMetrics.rate} Hz` : "—"}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

      </main>

      {/* ═════════════════ DATA ALIGNMENT MODAL OVERLAY ═════════════════ */}
      {showAlignModal && lastRecordedDataset && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="panel max-w-sm w-full p-5 bg-[#0b1120] border-border relative flex flex-col gap-4 font-mono text-xs text-foreground">
            <header className="flex justify-between items-center border-b border-border/60 pb-2">
              <h3 className="font-bold text-sm text-[#00d4e8] text-glow-cyan uppercase tracking-wider">📊 Alignment Analysis</h3>
              <button 
                onClick={() => setShowAlignModal(false)}
                className="text-muted-foreground hover:text-foreground text-lg font-bold leading-none cursor-pointer"
              >
                &times;
              </button>
            </header>

            {(() => {
              const active = [1, 2, 3, 4].filter(c => lastRecordedDataset.samples.some(s => !isNaN(s[`ch${c}` as keyof typeof s] as number)));
              const totalFrames = lastRecordedDataset.samples.length;
              
              let alignedFrames = 0;
              lastRecordedDataset.samples.forEach(s => {
                const isAllValid = active.every(c => !isNaN(s[`ch${c}` as keyof typeof s] as number));
                if (isAllValid) alignedFrames++;
              });

              const alignedPct = Math.round((alignedFrames / Math.max(1, totalFrames)) * 1000) / 10;
              const durationS = Math.round(totalFrames / lastRecordedDataset.sampleRate * 10) / 10;
              const verdict = alignedPct >= 95 ? "Excellent Sync (Stable)" : (alignedPct >= 80 ? "Good Sync (Acceptable)" : "Poor / Bad Sync");
              const valueColor = alignedPct >= 95 ? "text-emerald-400" : (alignedPct >= 80 ? "text-amber-400" : "text-destructive");

              return (
                <>
                  <div className="text-center py-2 space-y-1">
                    <div className={`text-4xl font-extrabold ${valueColor}`}>
                      {alignedPct}% Aligned
                    </div>
                    <div className={`text-[10px] font-bold uppercase tracking-wider ${valueColor}`}>
                      {verdict}
                    </div>
                  </div>

                  <div className="bg-[#090d16]/60 border border-border/40 rounded-sm p-3 space-y-1.5 leading-relaxed text-slate-300">
                    <div className="flex justify-between">
                      <span>Total Time Frames:</span>
                      <strong className="text-slate-100">{totalFrames}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Aligned Frames:</span>
                      <strong className="text-slate-100">{alignedFrames}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Session Duration:</span>
                      <strong className="text-slate-100">{durationS} s</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Channels Active:</span>
                      <strong className="text-slate-100">{active.join(", ")}</strong>
                    </div>
                  </div>

                  <div className="space-y-2 mt-1">
                    <div className="font-bold text-[10px] uppercase text-slate-300">Channel Coverage Details:</div>
                    {active.map(chId => {
                      const col = ["#00e5c8", "#ffb300", "#9d4edd", "#ff357a"][chId - 1] || "#00d4e8";
                      return (
                        <div key={chId} className="space-y-1">
                          <div className="flex justify-between text-[9px] text-muted-foreground">
                            <span>CH {chId} Coverage</span>
                            <span>{alignedPct}%</span>
                          </div>
                          <div className="h-1.5 bg-[#090d16] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${alignedPct}%`, backgroundColor: col }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            <Button 
              onClick={() => setShowAlignModal(false)}
              className="uppercase font-bold tracking-wider text-[10px] size-8 border border-border mt-2"
            >
              Close
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}
