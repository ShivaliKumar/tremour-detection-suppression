import { NavLink } from "react-router-dom";
import { Activity, BrainCircuit, Database, History, LayoutDashboard, Settings, Waves, X } from "lucide-react";
import { useWebSocket } from "../hooks/useWebSocket";
import { cx } from "../lib/format";
import { StatusIndicator } from "./StatusIndicator";

export const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/live", label: "Live Monitoring", icon: Activity },
  { to: "/acquisition", label: "Data Acquisition", icon: Database },
  { to: "/analysis", label: "Signal Analysis", icon: Waves },
  { to: "/ml", label: "ML Analytics", icon: BrainCircuit },
  { to: "/sessions", label: "Session History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#c6613f" />
      <path d="M5 17h5l3-8 4 15 4-11 2 4h4" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useWebSocket();
  const rec = t.status?.recording;
  return (
    <>
      <div
        className={cx("fixed inset-0 z-30 bg-ink/30 lg:hidden", open ? "block" : "hidden")}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-panel-2 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-6">
          <Logo />
          <div className="min-w-0">
            <div className="font-serif text-[19px] font-medium tracking-tight text-ink">TremorGuard</div>
            <div className="text-[11px] text-ink-3">Tremor monitoring</div>
          </div>
          <button className="ml-auto rounded p-1 text-ink-3 hover:text-ink lg:hidden" onClick={onClose} aria-label="Close menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                cx(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
                  isActive ? "bg-teal/10 text-ink" : "text-ink-2 hover:bg-ink/[0.03] hover:text-ink",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cx("size-4.5", isActive ? "text-teal" : "text-ink-3 group-hover:text-ink-2")} />
                  {label}
                  {to === "/acquisition" && rec && rec.state !== "idle" && (
                    <span className={cx("ml-auto size-2 rounded-full", rec.state === "recording" ? "animate-pulse bg-crit" : "bg-warn")} />
                  )}
                  {to === "/ml" && <span className="ml-auto text-[9px] font-bold tracking-wider text-ink-3">{t.status?.ml.available ? "" : "DEV"}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 rounded-2xl border border-line bg-panel p-3">
          <div className="mb-2 text-[12px] font-medium text-ink-3">Detector</div>
          <StatusIndicator size="sm" state={t.link === "closed" ? "BACKEND OFFLINE" : t.status?.system.state ?? "DISCONNECTED"} />
          <div className="mt-2 text-[11px] text-ink-3">Combined EMG ∧ MPU · v1.0</div>
        </div>
      </aside>
    </>
  );
}
