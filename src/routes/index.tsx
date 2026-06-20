import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/emg/Dashboard";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EMG//SCOPE · Signal Analysis Dashboard" },
      { name: "description", content: "Bloomberg-terminal style sEMG analysis for MyoWare 2.0 + ESP32 recordings. Upload CSV, inspect waveforms, FFT, and signal quality." },
      { property: "og:title", content: "EMG//SCOPE · Signal Analysis Dashboard" },
      { property: "og:description", content: "Realtime-style oscilloscope dashboard for 4-channel sEMG data." },
    ],
  }),
  component: Page,
});

function Page() {
  return <Dashboard />;
}
