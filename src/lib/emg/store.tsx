import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { EmgDataset } from "./signal";
import { preprocessDataset } from "./signal";
import { generateMockDataset } from "./mock";

interface StoreCtx {
  datasets: EmgDataset[];
  activeId: string | null;
  active: EmgDataset | null;
  rawActive: EmgDataset | null; // Raw dataset without DSP filtering (for quality metrics)
  addDataset: (d: EmgDataset) => void;
  removeDataset: (id: string) => void;
  setActive: (id: string) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  baselineSec: number;
  setBaselineSec: (s: number) => void;
  dspEnabled: boolean;
  setDspEnabled: (b: boolean) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function EmgStoreProvider({ children }: { children: ReactNode }) {
  // Initialize store with a default mock leg dataset to showcase Leg EMG waveforms on first load
  const [datasets, setDatasets] = useState<EmgDataset[]>(() => {
    const demo = generateMockDataset({ seconds: 20 });
    demo.name = "Leg EMG Wireless Data - Quad/Hamstring/Calf/TA";
    return [demo];
  });
  const [activeId, setActiveId] = useState<string | null>(() => datasets[0]?.id ?? null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [baselineSec, setBaselineSec] = useState<number>(5);
  const [dspEnabled, setDspEnabled] = useState<boolean>(true);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Compute active dataset (preprocessed or raw depending on toggle)
  const rawActive = useMemo(
    () => datasets.find((d) => d.id === activeId) ?? null,
    [datasets, activeId],
  );

  const active = useMemo(() => {
    if (!rawActive) return null;
    if (!dspEnabled) return rawActive;
    return preprocessDataset(rawActive);
  }, [rawActive, dspEnabled]);

  const value: StoreCtx = {
    datasets,
    activeId,
    active,
    rawActive, // Exposed for quality metrics
    addDataset: (d) => {
      setDatasets((prev) => [...prev, d]);
      setActiveId(d.id);
    },
    removeDataset: (id) =>
      setDatasets((prev) => {
        const next = prev.filter((d) => d.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      }),
    setActive: setActiveId,
    theme,
    toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    baselineSec,
    setBaselineSec,
    dspEnabled,
    setDspEnabled,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEmgStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEmgStore must be inside EmgStoreProvider");
  return v;
}
