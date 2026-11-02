import { useEffect, useState } from "react";
import {
  CircleDot,
  Database,
  FileDown,
  FlaskConical,
  ListChecks,
  Pause,
  Play,
  Plus,
  Save,
  Square,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useWebSocket, useWindow } from "../hooks/useWebSocket";
import { useLabels, useSessions } from "../hooks/useSessions";
import { api } from "../lib/api";
import { cx, fmtDuration, fmtInt } from "../lib/format";
import type { Session } from "../types";
import { SensorChart, SERIES, toRows } from "../components/SensorChart";
import { SessionTable } from "../components/SessionTable";
import { Badge, Button, Callout, Card, EmptyState } from "../components/ui";

const FIELDS: [string, string][] = [
  ["timestamp", "Host receive time (Unix s)"],
  ["sample_index", "Sample counter since connect"],
  ["segment", "Recording segment (new after each resume)"],
  ["emg", "Raw sEMG ADC value"],
  ["ax · ay · az", "Accelerometer (g)"],
  ["gx · gy · gz", "Gyroscope (°/s), blank if not streamed"],
  ["magnitude", "Movement magnitude (g)"],
  ["filtered_az", "Band-passed Z, latest value"],
  ["emg_avg", "EMG moving average"],
  ["rms", "RMS of filtered Z window"],
  ["peak_frequency", "Dominant FFT frequency (Hz)"],
  ["peak_power", "FFT peak magnitude"],
  ["emg_counter · mpu_counter", "Detector counters"],
  ["emg_active · mpu_active", "Gate states"],
  ["tremor_detected", "Combined detector output"],
  ["servo_engaged", "Commanded servo state"],
  ["data_valid", "0 if sample failed range checks"],
  ["label", "Manual ground-truth label"],
];

export default function DataAcquisition() {
  const t = useWebSocket();
  const rec = t.status?.recording;
  const src = t.status?.source;
  const fs = t.settings?.fs ?? 100;
  const { labels, refresh: refreshLabels } = useLabels();
  const { sessions } = useSessions();
  const preview = useWindow(6, 400);

  const [label, setLabel] = useState("Normal");
  const [description, setDescription] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addingLabel, setAddingLabel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Session | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const state = rec?.state ?? "idle";
  const connected = src?.state === "connected";

  // follow the label of an in-progress recording (e.g. after a page reload)
  useEffect(() => {
    if (state !== "idle" && rec?.label) setLabel(rec.label);
  }, [state, rec?.label]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => {
    setLastSaved(null);
    await api.post("/api/recording/start", { label, description });
  });
  const pause = () => run(() => api.post("/api/recording/pause"));
  const resume = () => run(() => api.post("/api/recording/resume", { label: label !== rec?.label ? label : null }));
  const stop = () => run(async () => {
    const s = await api.post<Session>("/api/recording/stop");
    setLastSaved(s);
    setDescription("");
  });
  const discard = () => run(async () => {
    await api.post("/api/recording/discard");
    setConfirmDiscard(false);
  });
  const addLabel = () => run(async () => {
    await api.post("/api/labels", { name: newLabel });
    await refreshLabels();
    setLabel(newLabel.trim());
    setNewLabel("");
    setAddingLabel(false);
  });
  const removeLabel = (name: string) => run(async () => {
    await api.del(`/api/labels/${encodeURIComponent(name)}`);
    await refreshLabels();
    if (label === name) setLabel("Normal");
  });
  const exportAll = () => run(async () => {
    const r = await api.post<{ file: string }>("/api/datasets/export");
    setExported(r.file);
  });

  const labelLocked = state === "recording";
  const rows = toRows(preview, fs, (x) => ({ emg: x.processing.emg_avg, az: x.sensors.az }));

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-5">
        <Card
          title="Recording session"
          subtitle="Every sample is written to disk by the backend, independently of the charts"
          icon={CircleDot}
          className="xl:col-span-3"
          actions={
            state === "recording" ? (
              <Badge tone="crit" className="animate-pulse">Recording</Badge>
            ) : state === "paused" ? (
              <Badge tone="warn">Paused</Badge>
            ) : (
              <Badge tone="neutral">Idle</Badge>
            )
          }
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                    <Tag className="size-3.5" /> Ground-truth label
                  </span>
                  {state === "paused" && <span className="text-[11px] text-warn">The next segment will use the selected label</span>}
                  {state === "recording" && <span className="text-[11px] text-ink-3">Pause to change the label</span>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {labels.map((l) => (
                    <div key={l.name} className="group relative">
                      <button
                        type="button"
                        disabled={labelLocked}
                        onClick={() => setLabel(l.name)}
                        className={cx(
                          "w-full rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
                          label === l.name ? "border-teal/60 bg-teal/[0.08]" : "border-line bg-panel-2 hover:border-ink-3/50",
                          labelLocked && label !== l.name && "opacity-40",
                        )}
                        aria-pressed={label === l.name}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cx("size-2 rounded-full", label === l.name ? "bg-teal" : "bg-ink-3/50")} />
                          <span className="text-[13px] font-medium text-ink">{l.name}</span>
                        </div>
                        {l.description && <div className="mt-0.5 pl-4 text-xs text-ink-3">{l.description}</div>}
                      </button>
                      {!l.builtin && state === "idle" && (
                        <button
                          onClick={() => removeLabel(l.name)}
                          className="absolute top-2 right-2 hidden rounded p-0.5 text-ink-3 hover:text-crit group-hover:block"
                          aria-label={`Remove label ${l.name}`}
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {addingLabel ? (
                    <form
                      className="flex gap-2 rounded-lg border border-dashed border-line p-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addLabel();
                      }}
                    >
                      <input
                        autoFocus
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        maxLength={40}
                        placeholder="e.g. Drinking task"
                        className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 text-[13px] text-ink outline-none focus:border-teal/60"
                      />
                      <Button size="sm" variant="primary" type="submit" disabled={!newLabel.trim() || busy}>
                        Add
                      </Button>
                      <Button size="sm" variant="ghost" type="button" onClick={() => setAddingLabel(false)}>
                        <X className="size-4" />
                      </Button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingLabel(true)}
                      disabled={labelLocked}
                      className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-[13px] text-ink-3 hover:border-ink-3/50 hover:text-ink-2 disabled:opacity-40"
                    >
                      <Plus className="size-4" /> Custom label
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="desc" className="mb-2 block text-xs font-medium text-ink-2">
                  Session description
                </label>
                <textarea
                  id="desc"
                  value={state === "idle" ? description : rec?.description ?? ""}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={state !== "idle"}
                  rows={2}
                  maxLength={500}
                  placeholder="Subject, task, electrode placement, servo configuration…"
                  className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-teal/60 disabled:opacity-60"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {state === "idle" && (
                  <Button variant="primary" size="lg" icon={Play} onClick={start} disabled={busy || !connected || !label}>
                    Start recording
                  </Button>
                )}
                {state === "recording" && (
                  <Button variant="warn" size="lg" icon={Pause} onClick={pause} disabled={busy}>
                    Pause
                  </Button>
                )}
                {state === "paused" && (
                  <Button variant="primary" size="lg" icon={Play} onClick={resume} disabled={busy}>
                    Resume{label !== rec?.label ? ` as "${label}"` : ""}
                  </Button>
                )}
                {state !== "idle" && (
                  <>
                    <Button size="lg" icon={Save} onClick={stop} disabled={busy}>
                      Stop & save
                    </Button>
                    {confirmDiscard ? (
                      <span className="flex items-center gap-2">
                        <Button size="lg" variant="danger" icon={Trash2} onClick={discard} disabled={busy}>
                          Confirm discard
                        </Button>
                        <Button size="lg" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <Button size="lg" variant="ghost" icon={Trash2} onClick={() => setConfirmDiscard(true)} disabled={busy}>
                        Discard
                      </Button>
                    )}
                  </>
                )}
              </div>
              {!connected && state === "idle" && (
                <p className="text-xs text-warn">Connect a data source (Settings) before recording.</p>
              )}
              {src?.simulated && (
                <Callout tone="warn" title="Simulator active">
                  Sessions recorded now are marked <b>simulated</b> in the metadata and in every CSV row. The training script ignores them unless you ask it to include them.
                </Callout>
              )}
              {error && <Callout tone="crit">{error}</Callout>}
              {lastSaved && (
                <Callout tone="ok" title={`${lastSaved.id} saved`}>
                  {lastSaved.samples.toLocaleString()} samples · {fmtDuration(lastSaved.duration)} · {lastSaved.file}{" "}
                  <a className="ml-1 font-medium text-teal hover:underline" href={`/api/sessions/${lastSaved.id}/download`}>
                    Download CSV
                  </a>
                  <a className="ml-3 font-medium text-teal hover:underline" href={`/api/sessions/${lastSaved.id}/download?kind=raw`}>
                    Raw CSV
                  </a>
                </Callout>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-line-soft bg-panel-2 p-4">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Duration</div>
                <div className="mt-0.5 text-3xl font-semibold text-ink tabular">{fmtDuration(rec?.duration ?? 0)}</div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Samples</div>
                <div className="mt-0.5 text-2xl font-semibold text-ink tabular">{fmtInt(rec?.samples ?? 0)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-line-soft pt-3 text-xs">
                <div>
                  <div className="text-ink-3">Session</div>
                  <div className="mt-0.5 font-medium text-ink tabular">{rec?.session_id ?? "—"}</div>
                </div>
                <div>
                  <div className="text-ink-3">Segment</div>
                  <div className="mt-0.5 font-medium text-ink tabular">{state === "idle" ? "—" : (rec?.segment ?? 0) + 1}</div>
                </div>
                <div>
                  <div className="text-ink-3">Label</div>
                  <div className="mt-0.5 truncate font-medium text-ink">{rec?.label ?? label}</div>
                </div>
                <div>
                  <div className="text-ink-3">Invalid</div>
                  <div className={cx("mt-0.5 font-medium tabular", rec?.invalid_samples ? "text-warn" : "text-ink")}>
                    {rec?.invalid_samples ?? 0}
                  </div>
                </div>
              </div>
              <div className="border-t border-line-soft pt-3 text-xs text-ink-3">
                Rate <span className="text-ink tabular">{src?.sample_rate?.toFixed(1) ?? "—"} Hz</span>
                {src?.simulated && (
                  <span className="ml-2 inline-flex items-center gap-1 text-warn">
                    <FlaskConical className="size-3" /> sim
                  </span>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-6 xl:col-span-2">
          <Card title="Live preview" subtitle="Last 6 s" icon={Database}>
            <SensorChart
              rows={rows}
              series={[{ key: "emg", label: "EMG moving avg", color: SERIES.s1, width: 1.75 }]}
              yDomain={[0, 4095]}
              windowSeconds={6}
              height={110}
              format={(v) => v.toFixed(0)}
            />
            <div className="mt-3">
              <SensorChart
                rows={rows}
                series={[{ key: "az", label: "AZ raw (g)", color: SERIES.s3, width: 1.75 }]}
                windowSeconds={6}
                height={110}
                yTickFormat={(v) => v.toFixed(2)}
              />
            </div>
          </Card>
          <Callout tone="info" title="Ground truth is manual">
            The label column is what you select here, per segment. The detector output is stored separately in <code>tremor_detected</code> and is never used as the label.
          </Callout>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Card
          title="Previous recordings"
          icon={Database}
          className="xl:col-span-3"
          bodyClassName="py-1"
          actions={
            <Button size="sm" icon={FileDown} onClick={exportAll} disabled={busy || !sessions?.length}>
              Export all as one CSV
            </Button>
          }
        >
          {exported && (
            <div className="mb-2 text-xs text-ink-2">
              Exported to <span className="font-mono">datasets/exported/{exported}</span>{" "}
              <a className="font-medium text-teal hover:underline" href={`/api/datasets/exported/${exported}`}>
                Download
              </a>
            </div>
          )}
          {sessions?.length ? (
            <SessionTable sessions={sessions.slice(0, 8)} compact />
          ) : (
            <EmptyState icon={Database} title="No recordings yet">
              Choose a label, then press Start recording.
            </EmptyState>
          )}
        </Card>
        <Card title="Recorded fields" subtitle="Columns in the processed CSV (the raw CSV keeps sensor values only)" icon={ListChecks} className="xl:col-span-2">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {FIELDS.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0 font-mono text-ink-2">{k}</dt>
                <dd className="truncate text-ink-3" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
            <Square className="size-3" /> Files: datasets/raw/session_XXX_raw.csv and datasets/processed/session_XXX.csv
          </p>
        </Card>
      </div>
    </div>
  );
}
