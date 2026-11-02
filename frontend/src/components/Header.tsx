import { useState } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, Menu, Radio, Usb, Wifi, WifiOff } from "lucide-react";
import { useNow, useWebSocket } from "../hooks/useWebSocket";
import { api } from "../lib/api";
import { cx, fmt, fmtDuration } from "../lib/format";
import { Badge } from "./ui";

export function Header({ title, subtitle, onMenu }: { title: string; subtitle: string; onMenu: () => void }) {
  const t = useWebSocket();
  const now = useNow();
  const src = t.status?.source;
  const rec = t.status?.recording;

  const link =
    t.link === "open" ? (
      <Badge tone="ok" icon={Wifi}>Live</Badge>
    ) : t.link === "stalled" ? (
      <Badge tone="warn" icon={WifiOff}>Stalled</Badge>
    ) : t.link === "connecting" ? (
      <Badge tone="info" icon={Wifi}>Connecting</Badge>
    ) : (
      <Badge tone="crit" icon={WifiOff}>Backend offline</Badge>
    );

  let source = null;
  if (src) {
    if (src.simulated) source = <Badge tone="warn" icon={FlaskConical}>Simulated</Badge>;
    else if (src.state === "connected") source = <Badge tone="teal" icon={Usb}>{src.info}</Badge>;
    else if (src.state === "connecting") source = <Badge tone="warn" icon={Usb}>{src.info || "Serial"} · retrying</Badge>;
    else source = <Badge tone="neutral" icon={Usb}>Disconnected</Badge>;
  }

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <div className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
        <button className="-ml-1 rounded-lg p-1.5 text-ink-2 hover:bg-white/5 lg:hidden" onClick={onMenu} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink">{title}</h1>
          <p className="truncate text-xs text-ink-3">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rec && rec.state !== "idle" && (
            <Link to="/acquisition">
              <Badge tone={rec.state === "recording" ? "crit" : "warn"} icon={Radio} className={rec.state === "recording" ? "animate-pulse" : ""}>
                {rec.state === "recording" ? "REC" : "PAUSED"} {fmtDuration(rec.duration)} · {rec.samples?.toLocaleString()}
              </Badge>
            </Link>
          )}
          {source}
          {src?.state === "connected" && (
            <span className="tabular hidden text-xs text-ink-3 sm:inline">{fmt(src.sample_rate, 1)} Hz</span>
          )}
          {link}
          <span className="tabular hidden text-xs text-ink-3 md:inline">
            {new Date(now * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </div>
      </div>
    </header>
  );
}

const SCENARIOS = [
  { id: "cycle", label: "Auto cycle" },
  { id: "rest", label: "Rest" },
  { id: "voluntary", label: "Voluntary" },
  { id: "tremor", label: "Tremor" },
];

export function SimulatedBanner() {
  const t = useWebSocket();
  const src = t.status?.source;
  const [pending, setPending] = useState<string | null>(null);
  if (!src?.simulated) return null;
  const choose = async (id: string) => {
    setPending(id);
    try {
      await api.post("/api/simulator/scenario", { scenario: id });
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warn/30 bg-warn/[0.08] px-4 py-2 text-xs sm:px-6 lg:px-8">
      <span className="flex items-center gap-2 font-semibold text-warn">
        <FlaskConical className="size-4" />
        SIMULATED DATA. Not from the wearable. No servo commands reach hardware.
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-ink-3">Scenario</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            onClick={() => choose(s.id)}
            disabled={pending !== null}
            className={cx(
              "rounded-md border px-2 py-0.5 font-medium transition-colors",
              src.scenario === s.id ? "border-warn/50 bg-warn/20 text-warn" : "border-line text-ink-2 hover:text-ink",
            )}
          >
            {s.label}
          </button>
        ))}
        {src.scenario === "cycle" && src.active_scenario && <span className="ml-2 text-ink-3">now: {src.active_scenario}</span>}
      </span>
      <Link to="/settings" className="ml-auto text-ink-2 underline-offset-2 hover:text-ink hover:underline">
        Switch to hardware
      </Link>
    </div>
  );
}
