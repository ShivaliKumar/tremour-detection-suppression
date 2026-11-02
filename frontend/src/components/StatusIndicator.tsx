import { Activity, AlertOctagon, CheckCircle2, Loader2, Unplug, type LucideIcon } from "lucide-react";
import type { SystemState } from "../types";
import { cx } from "../lib/format";

const config: Record<SystemState | "BACKEND OFFLINE", { icon: LucideIcon; ring: string; text: string; bg: string; label: string }> = {
  NORMAL: { icon: CheckCircle2, ring: "border-ok/30", text: "text-ok", bg: "bg-ok/[0.07]", label: "NORMAL" },
  "TREMOR DETECTED": { icon: Activity, ring: "border-crit/50", text: "text-crit", bg: "bg-crit/[0.10]", label: "TREMOR DETECTED" },
  "SENSOR ERROR": { icon: AlertOctagon, ring: "border-warn/40", text: "text-warn", bg: "bg-warn/[0.08]", label: "SENSOR ERROR" },
  DISCONNECTED: { icon: Unplug, ring: "border-line", text: "text-ink-2", bg: "bg-white/[0.02]", label: "DISCONNECTED" },
  INITIALIZING: { icon: Loader2, ring: "border-cyan/30", text: "text-cyan", bg: "bg-cyan/[0.06]", label: "INITIALIZING" },
  "BACKEND OFFLINE": { icon: Unplug, ring: "border-crit/30", text: "text-crit", bg: "bg-crit/[0.05]", label: "BACKEND OFFLINE" },
};

export function statusTone(state: SystemState | "BACKEND OFFLINE") {
  return config[state];
}

export function StatusIndicator({
  state,
  detail,
  size = "lg",
}: {
  state: SystemState | "BACKEND OFFLINE";
  detail?: string;
  size?: "lg" | "sm";
}) {
  const c = config[state];
  const Icon = c.icon;
  if (size === "sm") {
    return (
      <span className={cx("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold tracking-wider", c.ring, c.bg, c.text)}>
        <Icon className={cx("size-3.5", state === "INITIALIZING" && "animate-spin")} strokeWidth={2.5} />
        {c.label}
      </span>
    );
  }
  return (
    <div
      className={cx(
        "flex items-center gap-4 rounded-xl border px-5 py-4",
        c.ring,
        c.bg,
        state === "TREMOR DETECTED" && "pulse-crit",
      )}
      role="status"
      aria-live="polite"
    >
      <div className={cx("grid size-12 shrink-0 place-items-center rounded-xl border", c.ring, c.text)}>
        <Icon className={cx("size-6", state === "INITIALIZING" && "animate-spin")} strokeWidth={2.25} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">System status</div>
        <div className={cx("text-xl font-bold tracking-wide", c.text)}>{c.label}</div>
        {detail && <div className="mt-0.5 truncate text-[13px] text-ink-2">{detail}</div>}
      </div>
    </div>
  );
}
