import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Upload,
  BarChart3,
  Waves,
  GitCompareArrows,
  Database,
  FileText,
  Sun,
  Moon,
  Cpu,
  Radio,
  Download,
  Trash2,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Legend,
  ReferenceLine,
} from "recharts";
import { EmgStoreProvider, useEmgStore } from "@/lib/emg/store";
import {
  CHANNELS,
  CHANNEL_COLORS,
  CHANNEL_LABELS,
  channelArray,
  downsample,
  energy,
  fftMagnitude,
  mav,
  qualityScore,
  rms,
  spectralMetrics,
  variance,
  zeroCrossings,
  type Channel,
  type EmgDataset,
} from "@/lib/emg/signal";
import { parseCsvFile } from "@/lib/emg/csv";
import { generateMockDataset } from "@/lib/emg/mock";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type View = "dashboard" | "upload" | "signal" | "frequency" | "compare" | "explorer" | "report";

const NAV: { id: View; label: string; icon: typeof Activity; code: string }[] = [
  { id: "dashboard", label: "Overview", icon: Activity, code: "F1" },
  { id: "upload", label: "Upload", icon: Upload, code: "F2" },
  { id: "signal", label: "Signal Analysis", icon: Waves, code: "F3" },
  { id: "frequency", label: "Frequency", icon: BarChart3, code: "F4" },
  { id: "compare", label: "Comparison", icon: GitCompareArrows, code: "F5" },
  { id: "explorer", label: "Datasets", icon: Database, code: "F6" },
  { id: "report", label: "Report", icon: FileText, code: "F7" },
];

export function Dashboard() {
  return (
    <EmgStoreProvider>
      <Shell />
    </EmgStoreProvider>
  );
}

function Shell() {
  const [view, setView] = useState<View>("dashboard");
  const { active, theme, toggleTheme } = useEmgStore();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopBar theme={theme} toggleTheme={toggleTheme} />
      <div className="flex flex-1 min-h-0">
        <Sidebar view={view} setView={setView} />
        <main className="flex-1 overflow-auto p-3">
          {view === "dashboard" && <OverviewView />}
          {view === "upload" && <UploadView />}
          {view === "signal" && <SignalView />}
          {view === "frequency" && <FrequencyView />}
          {view === "compare" && <CompareView />}
          {view === "explorer" && <ExplorerView />}
          {view === "report" && <ReportView />}
        </main>
      </div>
      <StatusBar active={active} view={view} />
    </div>
  );
}

/* ===================== Chrome ===================== */

function TopBar({ theme, toggleTheme }: { theme: "dark" | "light"; toggleTheme: () => void }) {
  const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
  return (
    <header className="border-b border-border bg-card/60 backdrop-blur px-3 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="size-7 rounded-sm border border-primary/60 grid place-items-center text-primary text-glow-green">
          <Radio className="size-4" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold tracking-widest text-primary text-glow-green">EMG//SCOPE</span>
          <span className="text-[10px] text-muted-foreground">v2.6.20 · MyoWare 2.0 · ESP32</span>
        </div>
      </div>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="hidden md:flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          LINK OK
        </span>
        <span className="hidden md:inline">CH:4</span>
        <span>{time} UTC</span>
        <button
          onClick={toggleTheme}
          className="size-7 grid place-items-center rounded-sm border border-border hover:border-primary/60"
          aria-label="toggle theme"
        >
          {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>
      </div>
    </header>
  );
}

function Sidebar({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <aside className="w-44 shrink-0 border-r border-border bg-sidebar/60 p-2 hidden md:flex flex-col gap-1">
      <div className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Modules</div>
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = view === n.id;
        return (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={cn(
              "group flex items-center justify-between px-2 py-1.5 rounded-sm text-[12px] border border-transparent",
              active
                ? "bg-primary/15 border-primary/40 text-primary text-glow-green"
                : "text-foreground/80 hover:bg-accent hover:border-border",
            )}
          >
            <span className="flex items-center gap-2">
              <Icon className="size-3.5" />
              {n.label}
            </span>
            <span className="text-[9px] text-muted-foreground">{n.code}</span>
          </button>
        );
      })}
      <div className="mt-auto pt-2 border-t border-border text-[10px] text-muted-foreground px-2">
        <div className="flex items-center gap-1.5"><Cpu className="size-3" /> SR · 1000 Hz</div>
        <div>FFT · 1024 · Hann</div>
      </div>
    </aside>
  );
}

function StatusBar({ active, view }: { active: EmgDataset | null; view: View }) {
  return (
    <footer className="border-t border-border bg-card/60 px-3 py-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      <div className="flex items-center gap-4">
        <span className="text-primary">● REC</span>
        <span>view: {view}</span>
        <span className="hidden sm:inline">dataset: {active?.name ?? "—"}</span>
      </div>
      <div className="flex items-center gap-4">
        <span>{active ? `${active.samples.length.toLocaleString()} samples` : "0 samples"}</span>
        <span>{active ? `${active.sampleRate} Hz` : "— Hz"}</span>
        <span className="blink">READY</span>
      </div>
    </footer>
  );
}

/* ===================== Reusable bits ===================== */

function Panel({
  title,
  right,
  children,
  className,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel flex flex-col min-h-0", className)}>
      <header className="panel-header">
        <span>{title}</span>
        <span className="flex items-center gap-2">{right}</span>
      </header>
      <div className="flex-1 min-h-0 p-2">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  tone = "green",
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "green" | "cyan" | "amber" | "magenta";
}) {
  const toneCls =
    tone === "cyan" ? "text-[var(--neon-cyan)] text-glow-cyan"
    : tone === "amber" ? "text-[var(--neon-amber)] text-glow-amber"
    : tone === "magenta" ? "text-[var(--neon-magenta)] text-glow-magenta"
    : "text-primary text-glow-green";
  return (
    <div className="border border-border rounded-sm p-2 bg-background/40">
      <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-bold tabular-nums leading-tight", toneCls)}>
        {value}
        {unit && <span className="text-[10px] ml-1 text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="h-full grid place-items-center text-muted-foreground text-xs uppercase tracking-widest">
      {msg}
    </div>
  );
}

/* ===================== Charts ===================== */

function ScopeChart({
  ds,
  channels = CHANNELS,
  maxPoints = 1200,
  height = 240,
}: {
  ds: EmgDataset;
  channels?: Channel[];
  maxPoints?: number;
  height?: number;
}) {
  const data = useMemo(() => downsample(ds.samples, maxPoints), [ds, maxPoints]);
  return (
    <div className="relative scope-grid rounded-sm border border-border overflow-hidden" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
          <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => `${v.toFixed(1)}s`}
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 10 }}
          />
          <YAxis
            stroke="var(--color-muted-foreground)"
            tick={{ fontSize: 10 }}
            width={36}
            tickFormatter={(v) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-popover)",
              border: "1px solid var(--color-border)",
              fontSize: 11,
              borderRadius: 4,
            }}
            labelFormatter={(l) => `t = ${Number(l).toFixed(3)}s`}
          />
          {channels.map((ch) => (
            <Line
              key={ch}
              type="monotone"
              dataKey={ch}
              stroke={CHANNEL_COLORS[ch]}
              dot={false}
              strokeWidth={1.2}
              isAnimationActive={false}
              name={CHANNEL_LABELS[ch]}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ===================== Views ===================== */

function OverviewView() {
  const { active } = useEmgStore();
  if (!active) return <EmptyState msg="No dataset loaded" />;

  const metrics = CHANNELS.map((ch) => {
    const arr = channelArray(active, ch);
    return {
      ch,
      rms: rms(arr),
      mav: mav(arr),
      var: variance(arr),
      energy: energy(arr),
      zc: zeroCrossings(arr),
      q: qualityScore(arr),
    };
  });

  const totalSec = active.samples.length / active.sampleRate;
  const avgQ = Math.round(metrics.reduce((s, m) => s + m.q.score, 0) / metrics.length);

  return (
    <div className="grid grid-cols-12 gap-3 auto-rows-min">
      <div className="col-span-12 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <Stat label="Channels" value="4" />
        <Stat label="Sample Rate" value={active.sampleRate} unit="Hz" tone="cyan" />
        <Stat label="Duration" value={totalSec.toFixed(2)} unit="s" tone="amber" />
        <Stat label="Samples" value={active.samples.length.toLocaleString()} tone="cyan" />
        <Stat label="Avg Quality" value={`${avgQ}%`} tone={avgQ >= 70 ? "green" : avgQ >= 40 ? "amber" : "magenta"} />
        <Stat label="Source" value={active.source.toUpperCase()} tone="magenta" />
      </div>

      <Panel title="Live Multi-Channel Scope" className="col-span-12 lg:col-span-8" right={<span className="text-primary">● {active.name}</span>}>
        <ScopeChart ds={active} height={300} />
      </Panel>

      <Panel title="Channel Quality" className="col-span-12 lg:col-span-4">
        <div className="grid grid-cols-1 gap-2">
          {metrics.map((m) => (
            <div key={m.ch} className="border border-border rounded-sm p-2 bg-background/40">
              <div className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: CHANNEL_COLORS[m.ch] }} />
                  <span className="font-bold">{m.ch.toUpperCase()}</span>
                  <span className="text-muted-foreground">{CHANNEL_LABELS[m.ch]}</span>
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded-sm border text-[9px] tracking-widest",
                    m.q.label === "EXCELLENT" && "border-primary/60 text-primary",
                    m.q.label === "GOOD" && "border-[var(--neon-cyan)]/50 text-[var(--neon-cyan)]",
                    m.q.label === "FAIR" && "border-[var(--neon-amber)]/50 text-[var(--neon-amber)]",
                    m.q.label === "POOR" && "border-destructive/60 text-destructive",
                  )}
                >
                  {m.q.label} · {m.q.score}%
                </span>
              </div>
              <div className="mt-1.5 h-1 bg-border rounded-sm overflow-hidden">
                <div
                  className="h-full"
                  style={{ width: `${m.q.score}%`, background: CHANNEL_COLORS[m.ch] }}
                />
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground tabular-nums">
                <span>RMS {m.rms.toFixed(3)}</span>
                <span>MAV {m.mav.toFixed(3)}</span>
                <span>SNR {m.q.snrDb.toFixed(1)}dB</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="RMS · MAV · Energy · Zero-Crossings" className="col-span-12">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left p-2">Channel</th>
                <th className="text-right p-2">RMS</th>
                <th className="text-right p-2">MAV</th>
                <th className="text-right p-2">Variance</th>
                <th className="text-right p-2">Energy</th>
                <th className="text-right p-2">Zero Cross</th>
                <th className="text-right p-2">SNR (dB)</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.ch} className="border-b border-border/50 hover:bg-accent/30">
                  <td className="p-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: CHANNEL_COLORS[m.ch] }} />
                      {m.ch.toUpperCase()} · {CHANNEL_LABELS[m.ch]}
                    </span>
                  </td>
                  <td className="text-right p-2">{m.rms.toFixed(4)}</td>
                  <td className="text-right p-2">{m.mav.toFixed(4)}</td>
                  <td className="text-right p-2">{m.var.toFixed(4)}</td>
                  <td className="text-right p-2">{m.energy.toFixed(2)}</td>
                  <td className="text-right p-2">{m.zc}</td>
                  <td className="text-right p-2">{m.q.snrDb.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function UploadView() {
  const { addDataset } = useEmgStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(files)) {
        const ds = await parseCsvFile(f);
        addDataset(ds);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to parse CSV");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-3">
      <Panel title="CSV Ingest" className="col-span-12 lg:col-span-8">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFile(e.dataTransfer.files);
          }}
          className="border-2 border-dashed border-border rounded-sm p-10 grid place-items-center text-center bg-background/30 hover:border-primary/50 transition-colors"
        >
          <Upload className="size-10 text-primary text-glow-green" />
          <p className="mt-3 text-sm">Drop CSV files here, or click to browse</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Expected columns: <code>time, ch1, ch2, ch3, ch4</code> (case-insensitive aliases supported)
          </p>
          <Button
            className="mt-4"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Parsing…" : "Select files"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            onChange={(e) => void onFile(e.target.files)}
          />
          {err && <p className="mt-3 text-destructive text-xs">{err}</p>}
        </div>
      </Panel>

      <Panel title="Quick Actions" className="col-span-12 lg:col-span-4">
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => addDataset(generateMockDataset({ seed: Date.now() & 0xffff }))}>
            Generate synthetic dataset
          </Button>
          <Button
            variant="secondary"
            onClick={() => addDataset(generateMockDataset({ seconds: 30, seed: 17 }))}
          >
            Generate long recording (30s)
          </Button>
          <div className="text-[10px] text-muted-foreground border-t border-border pt-2 mt-2">
            All processing runs locally in your browser. No data is uploaded.
          </div>
        </div>
      </Panel>
    </div>
  );
}

function SignalView() {
  const { active } = useEmgStore();
  const [selected, setSelected] = useState<Channel[]>([...CHANNELS]);
  if (!active) return <EmptyState msg="No dataset loaded" />;

  const toggle = (ch: Channel) =>
    setSelected((s) => (s.includes(ch) ? s.filter((c) => c !== ch) : [...s, ch]));

  return (
    <div className="grid grid-cols-12 gap-3">
      <Panel title="Channel Select" className="col-span-12">
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map((ch) => (
            <button
              key={ch}
              onClick={() => toggle(ch)}
              className={cn(
                "px-2 py-1 text-[11px] rounded-sm border tracking-wider",
                selected.includes(ch) ? "border-primary/60" : "border-border opacity-50",
              )}
              style={selected.includes(ch) ? { color: CHANNEL_COLORS[ch], boxShadow: `0 0 8px ${CHANNEL_COLORS[ch]}` } : {}}
            >
              ● {ch.toUpperCase()} · {CHANNEL_LABELS[ch]}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Overlay Scope" className="col-span-12">
        <ScopeChart ds={active} channels={selected} height={360} maxPoints={2000} />
      </Panel>

      {selected.map((ch) => (
        <Panel key={ch} title={`${ch.toUpperCase()} · ${CHANNEL_LABELS[ch]}`} className="col-span-12 md:col-span-6">
          <ScopeChart ds={active} channels={[ch]} height={180} maxPoints={1200} />
        </Panel>
      ))}
    </div>
  );
}

function FrequencyView() {
  const { active } = useEmgStore();
  if (!active) return <EmptyState msg="No dataset loaded" />;

  const perCh = CHANNELS.map((ch) => {
    const arr = channelArray(active, ch);
    const { freq, mag } = fftMagnitude(arr, active.sampleRate);
    const cutoff = Math.min(freq.length, Math.floor(freq.length * 0.5));
    const data = downsample(
      freq.slice(0, cutoff).map((f, i) => ({ f, mag: mag[i] })),
      512,
    );
    return { ch, data, metrics: spectralMetrics(freq, mag) };
  });

  return (
    <div className="grid grid-cols-12 gap-3">
      <Panel title="Spectral Metrics" className="col-span-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          {perCh.map((p) => (
            <div key={p.ch} className="border border-border rounded-sm p-2 bg-background/40">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="size-2 rounded-full" style={{ background: CHANNEL_COLORS[p.ch] }} />
                <span className="font-bold">{p.ch.toUpperCase()}</span>
                <span className="text-muted-foreground">{CHANNEL_LABELS[p.ch]}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] tabular-nums">
                <div><div className="text-muted-foreground">MEAN</div><div className="text-primary">{p.metrics.meanFreq.toFixed(1)}Hz</div></div>
                <div><div className="text-muted-foreground">MED</div><div className="text-[var(--neon-cyan)]">{p.metrics.medianFreq.toFixed(1)}Hz</div></div>
                <div><div className="text-muted-foreground">DOM</div><div className="text-[var(--neon-amber)]">{p.metrics.dominantFreq.toFixed(1)}Hz</div></div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      {perCh.map((p) => (
        <Panel key={p.ch} title={`FFT · ${p.ch.toUpperCase()}`} className="col-span-12 md:col-span-6">
          <div style={{ height: 220 }}>
            <ResponsiveContainer>
              <AreaChart data={p.data} margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                <defs>
                  <linearGradient id={`g-${p.ch}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHANNEL_COLORS[p.ch]} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={CHANNEL_COLORS[p.ch]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" />
                <XAxis dataKey="f" tickFormatter={(v) => `${Math.round(v)}`} stroke="var(--color-muted-foreground)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 10 }} width={36} />
                <Tooltip
                  contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 11, borderRadius: 4 }}
                  labelFormatter={(l) => `${Number(l).toFixed(1)} Hz`}
                />
                <ReferenceLine x={p.metrics.meanFreq} stroke="var(--neon-green)" strokeDasharray="3 3" />
                <ReferenceLine x={p.metrics.medianFreq} stroke="var(--neon-cyan)" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="mag" stroke={CHANNEL_COLORS[p.ch]} fill={`url(#g-${p.ch})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function CompareView() {
  const { datasets } = useEmgStore();
  const [aId, setAId] = useState(datasets[0]?.id);
  const [bId, setBId] = useState(datasets[1]?.id ?? datasets[0]?.id);

  const a = datasets.find((d) => d.id === aId);
  const b = datasets.find((d) => d.id === bId);

  const summary = (ds?: EmgDataset) =>
    ds
      ? CHANNELS.map((ch) => {
          const arr = channelArray(ds, ch);
          return { ch: ch.toUpperCase(), rms: rms(arr), mav: mav(arr), energy: energy(arr) };
        })
      : [];

  const merged = useMemo(() => {
    if (!a || !b) return [];
    return CHANNELS.map((ch) => {
      const aa = channelArray(a, ch);
      const bb = channelArray(b, ch);
      return { ch: ch.toUpperCase(), A: rms(aa), B: rms(bb) };
    });
  }, [a, b]);

  return (
    <div className="grid grid-cols-12 gap-3">
      <Panel title="Compare Datasets" className="col-span-12">
        <div className="flex flex-wrap gap-3 items-center">
          <DatasetPicker label="A" value={aId} onChange={setAId} />
          <DatasetPicker label="B" value={bId} onChange={setBId} />
        </div>
      </Panel>
      <Panel title={`A · ${a?.name ?? "—"}`} className="col-span-12 md:col-span-6">
        {a ? <ScopeChart ds={a} height={220} /> : <EmptyState msg="select dataset" />}
      </Panel>
      <Panel title={`B · ${b?.name ?? "—"}`} className="col-span-12 md:col-span-6">
        {b ? <ScopeChart ds={b} height={220} /> : <EmptyState msg="select dataset" />}
      </Panel>
      <Panel title="RMS Comparison" className="col-span-12">
        <div style={{ height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={merged}>
              <CartesianGrid stroke="var(--color-grid)" strokeDasharray="2 4" />
              <XAxis dataKey="ch" stroke="var(--color-muted-foreground)" tick={{ fontSize: 10 }} />
              <YAxis stroke="var(--color-muted-foreground)" tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="A" fill="var(--neon-green)" />
              <Bar dataKey="B" fill="var(--neon-magenta)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="Per-Channel Summary" className="col-span-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] tabular-nums">
          {[{ d: a, name: "A" }, { d: b, name: "B" }].map(({ d, name }) => (
            <div key={name} className="border border-border rounded-sm p-2">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{name} · {d?.name}</div>
              <table className="w-full">
                <thead className="text-[10px] text-muted-foreground"><tr><th className="text-left">CH</th><th className="text-right">RMS</th><th className="text-right">MAV</th><th className="text-right">Energy</th></tr></thead>
                <tbody>
                  {summary(d).map((r) => (
                    <tr key={r.ch} className="border-t border-border/50">
                      <td>{r.ch}</td>
                      <td className="text-right">{r.rms.toFixed(4)}</td>
                      <td className="text-right">{r.mav.toFixed(4)}</td>
                      <td className="text-right">{r.energy.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function DatasetPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const { datasets } = useEmgStore();
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="text-muted-foreground uppercase tracking-widest">{label}</span>
      <select
        className="bg-input border border-border rounded-sm px-2 py-1 text-[11px]"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </label>
  );
}

function ExplorerView() {
  const { datasets, activeId, setActive, removeDataset } = useEmgStore();
  return (
    <Panel title="Dataset Explorer">
      <table className="w-full text-[11px] tabular-nums">
        <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
          <tr className="border-b border-border">
            <th className="text-left p-2">Name</th>
            <th className="text-left p-2">Source</th>
            <th className="text-right p-2">Samples</th>
            <th className="text-right p-2">SR (Hz)</th>
            <th className="text-right p-2">Duration</th>
            <th className="text-left p-2">Uploaded</th>
            <th className="p-2"></th>
          </tr>
        </thead>
        <tbody>
          {datasets.map((d) => (
            <tr
              key={d.id}
              className={cn(
                "border-b border-border/40 hover:bg-accent/30",
                d.id === activeId && "bg-primary/10",
              )}
            >
              <td className="p-2">
                <button onClick={() => setActive(d.id)} className="text-left hover:text-primary">
                  {d.id === activeId && <span className="text-primary mr-1">▶</span>}
                  {d.name}
                </button>
              </td>
              <td className="p-2">{d.source.toUpperCase()}</td>
              <td className="text-right p-2">{d.samples.length.toLocaleString()}</td>
              <td className="text-right p-2">{d.sampleRate}</td>
              <td className="text-right p-2">{(d.samples.length / d.sampleRate).toFixed(2)}s</td>
              <td className="p-2 text-muted-foreground">{new Date(d.uploadedAt).toLocaleString()}</td>
              <td className="p-2 text-right">
                <button
                  onClick={() => removeDataset(d.id)}
                  className="p-1 hover:text-destructive"
                  aria-label="remove"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
          {!datasets.length && (
            <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No datasets</td></tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}

function ReportView() {
  const { active } = useEmgStore();
  const reportRef = useRef<HTMLDivElement>(null);
  if (!active) return <EmptyState msg="No dataset loaded" />;
  const ds = active;


  const metrics = CHANNELS.map((ch) => {
    const arr = channelArray(active, ch);
    const { freq, mag } = fftMagnitude(arr, active.sampleRate);
    return { ch, rms: rms(arr), mav: mav(arr), energy: energy(arr), q: qualityScore(arr), s: spectralMetrics(freq, mag) };
  });

  async function exportPdf() {
    const el = reportRef.current;
    if (!el) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const canvas = await html2canvas(el, { backgroundColor: "#0d121b", scale: 2 });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(img, "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save(`emg-report-${active.id}.pdf`);
  }

  function exportCsv() {
    const head = "channel,rms,mav,energy,quality_score,quality_label,snr_db,mean_freq_hz,median_freq_hz,dominant_freq_hz\n";
    const rows = metrics
      .map((m) =>
        [m.ch, m.rms, m.mav, m.energy, m.q.score, m.q.label, m.q.snrDb, m.s.meanFreq, m.s.medianFreq, m.s.dominantFreq]
          .map((v) => (typeof v === "number" ? v.toFixed(4) : v))
          .join(","),
      )
      .join("\n");
    const blob = new Blob([head + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emg-report-${active.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid grid-cols-12 gap-3">
      <Panel
        title="Report Export"
        className="col-span-12"
        right={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={exportCsv}><Download className="size-3.5 mr-1" /> CSV</Button>
            <Button size="sm" onClick={exportPdf}><Download className="size-3.5 mr-1" /> PDF</Button>
          </div>
        }
      >
        <div ref={reportRef} className="p-4 bg-background border border-border rounded-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold text-primary text-glow-green">EMG ANALYSIS REPORT</div>
              <div className="text-[11px] text-muted-foreground">{active.name} · generated {new Date().toLocaleString()}</div>
            </div>
            <div className="text-[10px] text-muted-foreground text-right">
              MyoWare 2.0 · ESP32<br />
              4 channels · {active.sampleRate} Hz · {(active.samples.length / active.sampleRate).toFixed(2)} s
            </div>
          </div>
          <ScopeChart ds={active} height={220} />
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left p-2">Channel</th>
                <th className="text-right p-2">RMS</th>
                <th className="text-right p-2">MAV</th>
                <th className="text-right p-2">Energy</th>
                <th className="text-right p-2">Quality</th>
                <th className="text-right p-2">Mean Hz</th>
                <th className="text-right p-2">Median Hz</th>
                <th className="text-right p-2">Dominant Hz</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.ch} className="border-b border-border/40">
                  <td className="p-2">{m.ch.toUpperCase()} · {CHANNEL_LABELS[m.ch]}</td>
                  <td className="text-right p-2">{m.rms.toFixed(4)}</td>
                  <td className="text-right p-2">{m.mav.toFixed(4)}</td>
                  <td className="text-right p-2">{m.energy.toFixed(2)}</td>
                  <td className="text-right p-2">{m.q.label} · {m.q.score}%</td>
                  <td className="text-right p-2">{m.s.meanFreq.toFixed(1)}</td>
                  <td className="text-right p-2">{m.s.medianFreq.toFixed(1)}</td>
                  <td className="text-right p-2">{m.s.dominantFreq.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
