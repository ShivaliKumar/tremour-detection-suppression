import { useState } from "react";
import { Cog, HeartPulse, History, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ServoStatus } from "../types";
import { api } from "../lib/api";
import { cx, fmt, fmtAgo, fmtClock } from "../lib/format";
import { Badge, Card, Toggle } from "./ui";

export function ServoMonitor({ servo, now, compact = false }: { servo: ServoStatus | null; now: number; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setActuation = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/actuation", { enabled });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const engaged = !!servo?.engaged;
  const hb = servo?.heartbeat;
  const holdPct = servo && servo.hold_seconds ? (servo.hold_remaining / servo.hold_seconds) * 100 : 0;
  const sinceHb = hb?.seconds_since ?? null;

  return (
    <Card
      title="Servo suppression"
      subtitle="Commanded state sent to the ESP32 ('1' engage / '0' release)"
      icon={Cog}
      actions={
        <label className="flex items-center gap-2 text-xs text-ink-2">
          Auto suppression
          <Toggle checked={!!servo?.actuation_enabled} onChange={setActuation} disabled={!servo || busy} label="Automatic suppression" />
        </label>
      }
    >
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cx(
            "grid size-16 shrink-0 place-items-center rounded-2xl border-2 transition-colors",
            engaged ? "border-crit/60 bg-crit/10 text-crit" : "border-line bg-panel-2 text-ink-3",
          )}
        >
          <Cog className={cx("size-8", engaged && "animate-[spin_3s_linear_infinite]")} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">Commanded state</div>
          <div className={cx("text-2xl font-bold tracking-wide", engaged ? "text-crit" : "text-ink")}>
            {servo ? (engaged ? "ENGAGED" : "RELEASED") : "—"}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {servo && !servo.hardware_link && <Badge tone="warn">No hardware link</Badge>}
            <Badge tone="neutral" icon={null}>Position not verified</Badge>
          </div>
        </div>
      </div>

      {servo?.inhibit_reason && servo.requested && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-warn/30 bg-warn/[0.07] px-3 py-2 text-xs text-warn">
          <ShieldAlert className="size-4 shrink-0" />
          Detector requests suppression, but it is blocked: {servo.inhibit_reason}
        </div>
      )}
      {servo?.inhibit_reason && !servo.requested && servo.inhibit_reason !== "actuation disabled by operator" && (
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-3">
          <ShieldCheck className="size-4 shrink-0 text-ink-3" />
          Safety hold: {servo.inhibit_reason}. Servo kept released.
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-ink-3">Hold remaining</span>
          <span className="text-ink tabular">
            {fmt(servo?.hold_remaining ?? 0, 1)} / {fmt(servo?.hold_seconds ?? 2, 1)} s
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
          <div className="h-full rounded-full bg-crit/80 transition-[width] duration-150" style={{ width: `${holdPct}%` }} />
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <dt className="text-ink-3">Last activation</dt>
          <dd className="mt-0.5 text-ink tabular">
            {servo?.last_activation ? `${fmtClock(servo.last_activation)} · ${fmtAgo(now - servo.last_activation)}` : "None this session"}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-ink-3">
            <HeartPulse className="size-3.5" /> Heartbeat ({hb?.interval ?? 1}s)
          </dt>
          <dd className="mt-0.5 flex items-center gap-1.5">
            {hb?.ok ? <Badge tone="ok">Sending</Badge> : <Badge tone={servo?.hardware_link ? "warn" : "neutral"}>{servo?.hardware_link ? "Late" : "No link"}</Badge>}
            <span className="text-ink-2 tabular">{sinceHb !== null ? `'${hb?.last_command}' ${fmt(sinceHb, 1)}s ago` : ""}</span>
          </dd>
        </div>
        {!compact && (
          <>
            <div>
              <dt className="text-ink-3">Commands sent</dt>
              <dd className="mt-0.5 text-ink tabular">{hb?.commands_sent ?? 0}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Write errors</dt>
              <dd className={cx("mt-0.5 tabular", hb?.write_errors ? "text-warn" : "text-ink")}>
                {hb?.write_errors ?? 0}
                {hb?.last_error && <span className="ml-1 text-ink-3">({hb.last_error})</span>}
              </dd>
            </div>
          </>
        )}
      </dl>

      {!compact && (
        <div className="mt-4 border-t border-line-soft pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <History className="size-3.5" /> Activation history
          </div>
          {servo?.history.length ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto pr-1 text-xs">
              {servo.history.map((h) => (
                <li key={h.start} className="flex items-center justify-between rounded-md bg-panel-2 px-2.5 py-1.5">
                  <span className="text-ink tabular">{fmtClock(h.start)}</span>
                  <span className="text-ink-3 tabular">{h.peak_frequency !== null ? `${h.peak_frequency.toFixed(1)} Hz` : ""}</span>
                  <span className={cx("tabular", h.end ? "text-ink-2" : "font-semibold text-crit")}>
                    {h.end ? `${fmt(h.duration, 1)} s` : "active"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-ink-3">No activations yet.</div>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
        The dashboard reports what it commanded. The servo has no position feedback, and the ESP32 releases it on its own if heartbeats stop for 3 s.
      </p>
      {error && <p className="mt-2 text-xs text-crit">{error}</p>}
    </Card>
  );
}
