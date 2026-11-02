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
      <rect width="32" height="32" rx="8" fill="#14b8a6" fillOpacity="0.12" stroke="#14b8a6" strokeOpacity="0.4" />
      <path d="M5 17h5l3-8 4 15 4-11 2 4h4" fill="none" stroke="#14b8a6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useWebSocket();
  const rec = t.status?.recording;
  return (
    <>
      <div
        className={cx("fixed inset-0 z-30 bg-black/50 lg:hidden", open ? "block" : "hidden")}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-[#0a1120] transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-6">
          <Logo />
          <div className="min-w-0">
            <div className="text-[15px] font-bold tracking-[0.08em] text-ink">TREMORGUARD</div>
            <div className="text-[10px] font-medium tracking-[0.2em] text-ink-3">MONITORING PLATFORM</div>
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
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
                  isActive ? "bg-teal/10 text-ink" : "text-ink-2 hover:bg-white/[0.03] hover:text-ink",
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
        <div className="m-3 rounded-xl border border-line bg-panel p-3">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">Detector</div>
          <StatusIndicator size="sm" state={t.link === "closed" ? "BACKEND OFFLINE" : t.status?.system.state ?? "DISCONNECTED"} />
          <div className="mt-2 text-[11px] text-ink-3">Combined EMG ∧ MPU · v1.0</div>
        </div>
      </aside>
    </>
  );
}
