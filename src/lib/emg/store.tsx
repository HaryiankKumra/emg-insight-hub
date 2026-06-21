import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { EmgDataset } from "./signal";

interface StoreCtx {
  datasets: EmgDataset[];
  activeId: string | null;
  active: EmgDataset | null;
  addDataset: (d: EmgDataset) => void;
  removeDataset: (id: string) => void;
  setActive: (id: string) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  baselineSec: number;
  setBaselineSec: (s: number) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function EmgStoreProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<EmgDataset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [baselineSec, setBaselineSec] = useState<number>(30);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const active = useMemo(() => datasets.find((d) => d.id === activeId) ?? null, [datasets, activeId]);

  const value: StoreCtx = {
    datasets,
    activeId,
    active,
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
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEmgStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEmgStore must be inside EmgStoreProvider");
  return v;
}
