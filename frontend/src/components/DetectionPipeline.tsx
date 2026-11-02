import { ArrowRight, Cog, Waves, Zap } from "lucide-react";
import type { Settings, Status } from "../types";
import { cx, fmt, isNoisePeak } from "../lib/format";
import { CounterBar } from "./ui";

function Gate({
  title,
  icon: Icon,
  active,
  activeLabel,
  idleLabel,
  children,
  tone = "teal",
}: {
  title: string;
  icon: typeof Zap;
  active: boolean;
  activeLabel: string;
  idleLabel: string;
  children?: React.ReactNode;
  tone?: "teal" | "crit";
}) {
  const on = tone === "crit" ? "border-crit/50 bg-crit/[0.08]" : "border-teal/45 bg-teal/[0.07]";
  const onText = tone === "crit" ? "text-crit" : "text-teal";
  return (
    <div className={cx("flex min-w-0 flex-col rounded-xl border p-4 transition-colors", active ? on : "border-line bg-panel")}>
      <div className="flex flex-col items-start gap-1">
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">
          <Icon className="size-3.5" /> {title}
        </span>
        <span className={cx("text-[11px] font-bold tracking-wider", active ? onText : "text-ink-3")}>
          {active ? activeLabel : idleLabel}
        </span>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function Connector({ label }: { label?: string }) {
  return (
    <div className="hidden shrink-0 flex-col items-center justify-center px-1 text-ink-3 lg:flex">
      {label && <span className="mb-0.5 text-[10px] font-bold tracking-widest">{label}</span>}
      <ArrowRight className="size-4" />
    </div>
  );
}

/** EMG gate AND MPU gate -> combined detection -> servo. Mirrors tremor_detector.py. */
export function DetectionPipeline({ status, settings }: { status: Status | null; settings: Settings | null }) {
  const d = status?.detection;
  const p = status?.processing;
  const s = settings;
  const engaged = !!status?.servo.engaged;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,0.8fr)_auto_minmax(0,0.8fr)]">
      <Gate title="sEMG gate" icon={Zap} active={!!d?.emg_active} activeLabel="ACTIVE" idleLabel="INACTIVE">
        <div className="mb-2 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-3">Counter</span>
          <span className="tabular whitespace-nowrap text-ink-3">
            <span className="text-base font-semibold text-ink">{d?.emg_counter ?? 0}</span> / {s?.emg_counter_max ?? 10}
          </span>
        </div>
        <CounterBar value={d?.emg_counter ?? 0} max={s?.emg_counter_max ?? 10} threshold={s?.emg_confirmation ?? 2} active={!!d?.emg_active} />
        <div className="mt-2.5 space-y-0.5 text-xs text-ink-3">
          <div>Confirms at ≥ {s?.emg_confirmation ?? 2}</div>
          <div>
          Avg (last {s?.emg_avg_samples ?? 10}) <span className="text-ink tabular">{fmt(p?.emg_avg, 0)}</span>
          <span className="mx-1.5">·</span>↑ &gt;{s?.emg_threshold_high ?? 1500} ↓ &lt;{s?.emg_threshold_low ?? 500}
          </div>
        </div>
      </Gate>
      <Connector label="AND" />
      <Gate title="MPU gate" icon={Waves} active={!!d?.mpu_active} activeLabel="ACTIVE" idleLabel="INACTIVE">
        <div className="mb-2 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-ink-3">Counter</span>
          <span className="tabular whitespace-nowrap text-ink-3">
            <span className="text-base font-semibold text-ink">{d?.tremor_counter ?? 0}</span> / {s?.mpu_counter_max ?? 10}
          </span>
        </div>
        <CounterBar
          value={d?.tremor_counter ?? 0}
          max={s?.mpu_counter_max ?? 10}
          threshold={s?.confirmation_threshold ?? 2}
          active={!!d?.mpu_active}
        />
        <div className="mt-2.5 text-xs text-ink-3">
        <div className="mb-0.5">Confirms at ≥ {s?.confirmation_threshold ?? 2}</div>
        <div className="flex flex-wrap gap-x-3">
          <Cond ok={(p?.rms ?? 0) > (s?.min_movement_rms ?? 0.02)} label={`RMS ${fmt(p?.rms, 3)}`} />
          {isNoisePeak(p?.rms, s?.min_movement_rms) ? (
            <span className="text-ink-3" title="RMS is below the movement threshold, so the FFT peak is sensor noise">
              · freq: noise
            </span>
          ) : (
            <Cond
              ok={p?.peak_frequency != null && p.peak_frequency >= (s?.lowcut ?? 4) && p.peak_frequency <= (s?.highcut ?? 12)}
              label={`${fmt(p?.peak_frequency, 1)} Hz`}
            />
          )}
          <Cond ok={(p?.peak_power ?? 0) > (s?.min_peak_power ?? 0.5)} label={`Power ${fmt(p?.peak_power, 2)}`} />
        </div>
        </div>
      </Gate>
      <Connector />
      <Gate title="Combined" icon={Waves} active={!!d?.tremor_detected} activeLabel="DETECTED" idleLabel="NORMAL" tone="crit">
        <div className="text-xs text-ink-3">
          Tremor = EMG counter ≥ {s?.emg_confirmation ?? 2} <b className="text-ink-2">AND</b> MPU counter ≥ {s?.confirmation_threshold ?? 2}
        </div>
      </Gate>
      <Connector />
      <Gate title="Servo" icon={Cog} active={engaged} activeLabel="ENGAGED" idleLabel="RELEASED" tone="crit">
        <div className="text-xs text-ink-3">
          {engaged
            ? `Holding ${fmt(status?.servo.hold_remaining, 1)} s after last detection`
            : status?.servo.inhibit_reason
              ? `Blocked: ${status.servo.inhibit_reason}`
              : `Engages on detection, holds ${s?.hold_seconds ?? 2} s`}
        </div>
      </Gate>
    </div>
  );
}

function Cond({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cx("tabular", ok ? "text-teal" : "text-ink-3")}>
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}
