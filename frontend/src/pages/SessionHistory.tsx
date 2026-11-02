import { useEffect, useMemo, useState } from "react";
import { Download, FlaskConical, History, Loader2, Search, X } from "lucide-react";
import { useSessions } from "../hooks/useSessions";
import { api } from "../lib/api";
import { fmt, fmtDate, fmtDuration } from "../lib/format";
import type { Session, SessionDetail } from "../types";
import { LabelChip, SessionTable } from "../components/SessionTable";
import { SensorChart, SERIES, type Row } from "../components/SensorChart";
import { Badge, Button, Card, EmptyState } from "../components/ui";

export default function SessionHistory() {
  const { sessions, refresh, error } = useSessions();
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [open, setOpen] = useState<Session | null>(null);

  const labels = useMemo(() => [...new Set((sessions ?? []).flatMap((s) => s.labels))].sort(), [sessions]);
  const filtered = (sessions ?? []).filter(
    (s) =>
      (!labelFilter || s.labels.includes(labelFilter)) &&
      (!query || `${s.id} ${s.description} ${s.file}`.toLowerCase().includes(query.toLowerCase())),
  );

  const remove = async (s: Session) => {
    await api.del(`/api/sessions/${s.id}`);
    if (open?.id === s.id) setOpen(null);
    await refresh();
  };

  return (
    <div className="space-y-6">
      <Card
        title="Recorded sessions"
        subtitle={sessions ? `${sessions.length} sessions · ${sessions.reduce((a, s) => a + s.samples, 0).toLocaleString()} samples` : "Loading…"}
        icon={History}
        bodyClassName="py-2"
        actions={
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ID or description"
                className="h-9 w-56 rounded-lg border border-line bg-panel-2 pr-3 pl-8 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-teal/60"
              />
            </div>
            <select
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="h-9 rounded-lg border border-line bg-panel-2 px-2.5 text-[13px] text-ink outline-none focus:border-teal/60"
              aria-label="Filter by label"
            >
              <option value="">All labels</option>
              {labels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </div>
        }
      >
        {error && <p className="py-2 text-xs text-crit">{error}</p>}
        {filtered.length ? (
          <SessionTable sessions={filtered} onOpen={setOpen} onDelete={remove} selectedId={open?.id} />
        ) : (
          <EmptyState icon={History} title={sessions?.length ? "No sessions match the filter" : "No sessions recorded yet"}>
            {sessions?.length ? "Clear the search or label filter." : "Recordings from Data Acquisition are listed here."}
          </EmptyState>
        )}
      </Card>

      {open && <SessionReview session={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SessionReview({ session, onClose }: { session: Session; onClose: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    api
      .get<SessionDetail>(`/api/sessions/${session.id}?points=3000`)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }, [session.id]);

  const rows: Row[] = useMemo(() => {
    if (!detail) return [];
    const sr = detail.series;
    const end = sr.t[sr.t.length - 1] ?? 0;
    return sr.t.map((t, i) => ({
      x: (t as number) - (end as number),
      emg: sr.emg[i],
      avg: sr.emg_avg[i],
      az: sr.az[i],
      f: sr.filtered_az[i],
      tremor: sr.tremor_detected[i],
      servo: sr.servo_engaged[i],
      rms: sr.rms[i],
    }));
  }, [detail]);

  const duration = rows.length ? -rows[0].x : 0;
  const st = detail?.stats;
  const timeTick = (v: number) => `${Math.round(v + duration)}s`;
  // thresholds in force when the session was recorded
  const hi = detail?.session.settings?.emg_threshold_high ?? 1500;
  const lo = detail?.session.settings?.emg_threshold_low ?? 500;

  return (
    <Card
      title={`Review · ${session.id}`}
      subtitle={`${fmtDate(session.created)} · ${fmtDuration(session.duration)} · ${session.samples.toLocaleString()} samples`}
      icon={History}
      actions={
        <>
          {session.source === "simulated" && <Badge tone="warn" icon={FlaskConical}>Simulated</Badge>}
          <a href={`/api/sessions/${session.id}/download`}>
            <Button size="sm" icon={Download}>Processed CSV</Button>
          </a>
          <a href={`/api/sessions/${session.id}/download?kind=raw`}>
            <Button size="sm" icon={Download}>Raw CSV</Button>
          </a>
          <Button size="sm" variant="ghost" icon={X} onClick={onClose} aria-label="Close review" />
        </>
      }
    >
      {error ? (
        <p className="text-xs text-crit">{error}</p>
      ) : !detail ? (
        <div className="flex items-center gap-2 py-8 text-xs text-ink-3">
          <Loader2 className="size-4 animate-spin" /> Loading session…
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {(
              [
                ["Mean EMG avg", fmt(st?.mean_emg_avg, 0), "ADC"],
                ["Mean RMS", fmt(st?.mean_rms, 4), "g"],
                ["Median freq.", fmt(st?.median_peak_frequency, 2), "Hz"],
                ["Mean peak power", fmt(st?.mean_peak_power, 3), ""],
                ["Tremor detected", fmt(st?.tremor_pct, 1), "%"],
                ["Servo engaged", fmt(st?.servo_pct, 1), "%"],
              ] as const
            ).map(([k, v, u]) => (
              <div key={k} className="rounded-lg border border-line-soft bg-panel-2 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{k}</div>
                <div className="mt-1 text-lg font-semibold text-ink tabular">
                  {v} <span className="text-xs font-normal text-ink-3">{u}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-3">Segments:</span>
            {session.segments.map((s) => (
              <span key={s.index} className="inline-flex items-center gap-1.5">
                <LabelChip label={`#${s.index + 1} ${s.label}`} />
                <span className="text-ink-3 tabular">{s.samples.toLocaleString()}</span>
              </span>
            ))}
            {session.description && <span className="ml-2 text-ink-2">“{session.description}”</span>}
            {detail.step > 1 && <span className="ml-auto text-ink-3">Showing every {detail.step}th sample</span>}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium text-ink-2">sEMG</div>
              <SensorChart
                rows={rows}
                series={[
                  { key: "emg", label: "Raw", color: SERIES.s1, width: 1 },
                  { key: "avg", label: "Moving avg", color: SERIES.s2, width: 1.75 },
                ]}
                yDomain={[0, 4095]}
                refLines={[
                  { y: hi, label: `High ${hi}` },
                  { y: lo, label: `Low ${lo}` },
                ]}
                windowSeconds={duration || 1}
                xTickFormat={timeTick}
                height={200}
                format={(v) => v.toFixed(0)}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-ink-2">Accelerometer Z</div>
              <SensorChart
                rows={rows}
                series={[{ key: "az", label: "AZ raw (g)", color: SERIES.s3, width: 1.25 }]}
                windowSeconds={duration || 1}
                xTickFormat={timeTick}
                height={200}
                yTickFormat={(v) => v.toFixed(2)}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-ink-2">Filtered Z (latest value of each analysis window)</div>
              <SensorChart
                rows={rows}
                series={[{ key: "f", label: "AZ filtered (g)", color: SERIES.s3, width: 1.25 }]}
                windowSeconds={duration || 1}
                xTickFormat={timeTick}
                height={180}
                yTickFormat={(v) => v.toFixed(2)}
              />
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-ink-2">Detector output (1 = on)</div>
              <SensorChart
                rows={rows}
                series={[
                  { key: "tremor", label: "Tremor detected", color: SERIES.s2, width: 1.75 },
                  { key: "servo", label: "Servo engaged", color: SERIES.s1, width: 1.75, dashed: true },
                ]}
                yDomain={[-0.1, 1.1]}
                windowSeconds={duration || 1}
                xTickFormat={timeTick}
                height={180}
                format={(v) => (v >= 0.5 ? "on" : "off")}
                yTickFormat={(v) => (v === 1 ? "on" : v === 0 ? "off" : "")}
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
