import { Link } from "react-router-dom";
import { Activity, ArrowRight, BarChart3, Cog, Cpu, Database, Gauge, Radio, ScrollText, Usb, Waves, Zap } from "lucide-react";
import { useWebSocket, useWindow } from "../hooks/useWebSocket";
import { useSessions } from "../hooks/useSessions";
import { StatusIndicator } from "../components/StatusIndicator";
import { MetricCard } from "../components/MetricCard";
import { SessionTable } from "../components/SessionTable";
import { SensorChart, SERIES, toRows, type Row } from "../components/SensorChart";
import { Badge, Button, Card, EmptyState, type Tone } from "../components/ui";
import { cx, fmt, fmtClock, fmtDuration, fmtInt, isNoisePeak } from "../lib/format";
import type { SensorState } from "../types";

const sensorTone: Record<SensorState, Tone> = { ok: "ok", warning: "warn", error: "crit", no_data: "neutral" };
const sensorText: Record<SensorState, string> = { ok: "Online", warning: "Warning", error: "Error", no_data: "No data" };

function HealthRow({ icon: Icon, name, tone, state, detail }: { icon: typeof Usb; name: string; tone: Tone; state: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-panel-2">
        <Icon className="size-4 text-ink-2" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-ink">{name}</div>
        <div className="truncate text-xs text-ink-3">{detail}</div>
      </div>
      <Badge tone={tone}>{state}</Badge>
    </div>
  );
}

export default function Overview() {
  const t = useWebSocket();
  const s = t.status;
  const fs = t.settings?.fs ?? 100;
  const win = useWindow(10, 400);
  const { sessions } = useSessions();

  const state = t.link === "closed" ? "BACKEND OFFLINE" : s?.system.state ?? "DISCONNECTED";
  const detail = t.link === "closed" ? "Start the FastAPI backend: uvicorn main:app --port 8000" : s?.system.detail;
  const p = s?.processing;
  const set = t.settings;
  const inBand = p?.peak_frequency != null && set && p.peak_frequency >= set.lowcut && p.peak_frequency <= set.highcut;
  const live = s?.source.state === "connected" && !!s.source.sample_rate;
  const noise = isNoisePeak(p?.rms, set?.min_movement_rms);

  const timeline = toRows(win, fs, (x) => ({
    emg: x.processing.emg_avg,
    tremor: x.detection.tremor_detected ? 1 : 0,
  }));

  const srcState = s?.source.state;
  const linkTone: Tone = srcState === "connected" ? (s?.source.simulated ? "warn" : "ok") : srcState === "connecting" ? "warn" : "neutral";

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <StatusIndicator state={state} detail={detail} />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="EMG activity"
              icon={Zap}
              value={live ? fmtInt(p?.emg_avg) : "—"}
              unit="ADC"
              footer={
                <span>
                  Moving avg (10) · gate{" "}
                  <span className={s?.detection.emg_active ? "font-semibold text-teal" : ""}>{s?.detection.emg_active ? "ACTIVE" : "inactive"}</span>
                </span>
              }
            >
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.05]">
                <div className="h-full rounded-full bg-s1" style={{ width: `${Math.min(100, ((p?.emg_avg ?? 0) / 4095) * 100)}%` }} />
              </div>
            </MetricCard>
            <MetricCard
              label="Tremor frequency"
              icon={Waves}
              value={live && !noise ? fmt(p?.peak_frequency, 1) : "—"}
              unit="Hz"
              footer={
                !live
                  ? "Dominant FFT frequency"
                  : noise
                    ? `No significant movement (RMS ${fmt(p?.rms, 3)} ≤ ${set?.min_movement_rms ?? 0.02} g)`
                    : inBand
                      ? `Inside ${set?.lowcut}–${set?.highcut} Hz tremor band`
                      : "Outside tremor band"
              }
            />
            <MetricCard
              label="Movement RMS"
              icon={Activity}
              value={live ? fmt(p?.rms, 3) : "—"}
              unit="g"
              footer={`Filtered Z · threshold ${set?.min_movement_rms ?? 0.02} g`}
            />
            <MetricCard
              label="Servo status"
              icon={Cog}
              value={<span className={s?.servo.engaged ? "text-crit" : ""}>{s ? (s.servo.engaged ? "ENGAGED" : "RELEASED") : "—"}</span>}
              accent={!!s?.servo.engaged}
              footer={s?.servo.last_activation ? `Last activation ${fmtClock(s.servo.last_activation)}` : "Commanded state · no activations yet"}
            />
          </div>
        </div>

        <Card title="Connections" icon={Usb} bodyClassName="py-1.5">
          <div className="divide-y divide-line-soft">
            <HealthRow
              icon={Usb}
              name={s?.source.simulated ? "Data source · Simulator" : "Serial link · ESP32"}
              tone={linkTone}
              state={srcState === "connected" ? (s?.source.simulated ? "Simulated" : "Connected") : srcState === "connecting" ? "Retrying" : "Offline"}
              detail={
                srcState === "connected"
                  ? `${s?.source.info} · ${fmt(s?.source.sample_rate, 1)} Hz`
                  : s?.source.error ?? (t.link === "closed" ? "Backend offline" : "Not connected")
              }
            />
            <HealthRow
              icon={Cpu}
              name="MPU6050"
              tone={sensorTone[s?.sensors.mpu.state ?? "no_data"]}
              state={sensorText[s?.sensors.mpu.state ?? "no_data"]}
              detail={`${s?.sensors.mpu.detail ?? "—"}${s?.source.gyro_available ? " · gyro on" : " · accel only"}`}
            />
            <HealthRow
              icon={Zap}
              name="sEMG sensor"
              tone={sensorTone[s?.sensors.emg.state ?? "no_data"]}
              state={sensorText[s?.sensors.emg.state ?? "no_data"]}
              detail={s?.sensors.emg.detail ?? "—"}
            />
            <HealthRow
              icon={Cog}
              name="Servo"
              tone={s?.servo.hardware_link ? (s.servo.heartbeat.ok ? "ok" : "warn") : "neutral"}
              state={s?.servo.hardware_link ? (s.servo.engaged ? "Engaged" : "Released") : "No link"}
              detail={
                s?.servo.hardware_link
                  ? `Heartbeat ${s.servo.heartbeat.ok ? "OK" : "late"} · ${s.servo.actuation_enabled ? "auto suppression on" : "auto suppression OFF"}`
                  : "Commands are not reaching hardware"
              }
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          title="Last 10 seconds"
          subtitle="EMG moving average with the high and low thresholds; shaded bars show combined tremor detection"
          icon={BarChart3}
          className="xl:col-span-2"
          actions={
            <Link to="/live">
              <Button size="sm" variant="primary" icon={ArrowRight}>
                Live monitoring
              </Button>
            </Link>
          }
        >
          <SensorChart
            rows={timeline}
            series={[{ key: "emg", label: "EMG moving avg", color: SERIES.s1, width: 2 }]}
            refLines={[
              { y: set?.emg_threshold_high ?? 1500, label: `High ${set?.emg_threshold_high ?? 1500}` },
              { y: set?.emg_threshold_low ?? 500, label: `Low ${set?.emg_threshold_low ?? 500}` },
            ]}
            yDomain={[0, 4095]}
            windowSeconds={10}
            height={250}
            format={(v) => v.toFixed(0)}
          />
          <DetectionStrip rows={timeline} windowSeconds={10} />
        </Card>

        <div className="space-y-6">
          <Card title="Data acquisition" icon={Database}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Total recorded samples</div>
                <div className="mt-1 text-2xl font-semibold text-ink tabular">{fmtInt(s?.recording.total_samples ?? 0)}</div>
                <div className="mt-0.5 text-xs text-ink-3">{sessions?.length ?? 0} saved sessions</div>
              </div>
              {s?.recording.state && s.recording.state !== "idle" ? (
                <Badge tone={s.recording.state === "recording" ? "crit" : "warn"} icon={Radio}>
                  {s.recording.state === "recording" ? "Recording" : "Paused"} {fmtDuration(s.recording.duration)}
                </Badge>
              ) : (
                <Badge tone="neutral">Not recording</Badge>
              )}
            </div>
            <Link to="/acquisition" className="mt-4 block">
              <Button className="w-full" icon={Database}>
                Open data acquisition
              </Button>
            </Link>
          </Card>

          <Card title="System events" icon={ScrollText} bodyClassName="py-2">
            {s?.events.length ? (
              <ul className="max-h-44 space-y-0.5 overflow-y-auto pr-1 text-xs">
                {s.events.slice(0, 12).map((e, i) => (
                  <li key={i} className="flex gap-2 py-1">
                    <span className="shrink-0 text-ink-3 tabular">{fmtClock(e.time)}</span>
                    <span
                      className={cx(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        e.level === "error" ? "bg-crit" : e.level === "warning" ? "bg-warn" : e.level === "ok" ? "bg-ok" : "bg-ink-3",
                      )}
                    />
                    <span className="text-ink-2">{e.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-3 text-xs text-ink-3">No events yet.</div>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Recent sessions"
        icon={Gauge}
        actions={
          <Link to="/sessions" className="text-xs text-ink-2 hover:text-ink">
            View all →
          </Link>
        }
        bodyClassName="py-1"
      >
        {sessions?.length ? (
          <SessionTable sessions={sessions.slice(0, 5)} compact />
        ) : (
          <EmptyState icon={Database} title="No recordings yet">
            Recorded sessions will appear here. Start one from Data Acquisition.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}

/** Thin strip under the chart: one cell per sample, marked when combined tremor was detected. */
function DetectionStrip({ rows, windowSeconds }: { rows: Row[]; windowSeconds: number }) {
  // merge consecutive detected samples into runs positioned on the same -window..0 axis as the chart
  const runs: { from: number; to: number }[] = [];
  for (const r of rows) {
    if (r.tremor !== 1) continue;
    const last = runs[runs.length - 1];
    if (last && r.x - last.to < 0.05) last.to = r.x;
    else runs.push({ from: r.x, to: r.x });
  }
  const pct = (x: number) => ((x + windowSeconds) / windowSeconds) * 100;
  return (
    <div className="mt-2 pl-12 pr-2">
      <div className="relative h-3 overflow-hidden rounded-sm bg-ink/[0.03]" aria-label="Combined tremor detection over the last 10 seconds">
        {runs.map((r) => (
          <div
            key={r.from}
            className="absolute inset-y-0 bg-crit/80"
            style={{ left: `${pct(r.from)}%`, width: `max(2px, ${pct(r.to) - pct(r.from)}%)` }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span className="inline-block size-2 rounded-sm bg-crit/80" /> Combined tremor detected
      </div>
    </div>
  );
}
