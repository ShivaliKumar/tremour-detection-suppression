import { useEffect, useMemo, useState } from "react";
import { Cog, FlaskConical, Gauge, Monitor, Plug, PlugZap, RefreshCw, RotateCcw, Save, ShieldCheck, Unplug, Usb, Waves, Zap } from "lucide-react";
import { telemetry, useWebSocket } from "../hooks/useWebSocket";
import { api, ApiError } from "../lib/api";
import { cx } from "../lib/format";
import type { Settings, SettingsPayload } from "../types";
import { Badge, Button, Callout, Card, Toggle } from "../components/ui";

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

interface FieldDef {
  key: NumKey;
  label: string;
  unit?: string;
  step?: number;
  help?: string;
}

const GROUPS: { title: string; icon: typeof Zap; subtitle: string; fields: FieldDef[] }[] = [
  {
    title: "Sampling",
    icon: Gauge,
    subtitle: "Must match the firmware SAMPLE_RATE (100 Hz in MPU6050.ino)",
    fields: [{ key: "fs", label: "Sampling frequency", unit: "Hz", step: 1, help: "Used for filter design and the FFT frequency axis" }],
  },
  {
    title: "sEMG detection",
    icon: Zap,
    subtitle: "Counter logic: avg > high → +1, avg < low → −1",
    fields: [
      { key: "emg_threshold_high", label: "High threshold", unit: "ADC", step: 10 },
      { key: "emg_threshold_low", label: "Low threshold", unit: "ADC", step: 10 },
      { key: "emg_avg_samples", label: "Moving-average length", unit: "samples", step: 1 },
      { key: "emg_window", label: "EMG buffer size", unit: "samples", step: 10 },
      { key: "emg_confirmation", label: "Confirmation threshold", unit: "count", step: 1, help: "EMG active when counter ≥ this" },
      { key: "emg_counter_max", label: "Counter maximum", unit: "count", step: 1 },
    ],
  },
  {
    title: "MPU6050 detection",
    icon: Waves,
    subtitle: "Bandpass → Hann → FFT on the Z-axis buffer",
    fields: [
      { key: "lowcut", label: "Lower cutoff", unit: "Hz", step: 0.5 },
      { key: "highcut", label: "Upper cutoff", unit: "Hz", step: 0.5 },
      { key: "filter_order", label: "Butterworth order", step: 1 },
      { key: "mpu_buffer_size", label: "MPU buffer size", unit: "samples", step: 1 },
      { key: "min_movement_rms", label: "Minimum movement RMS", unit: "g", step: 0.005 },
      { key: "min_peak_power", label: "Minimum peak power", step: 0.05 },
      { key: "confirmation_threshold", label: "Confirmation threshold", unit: "count", step: 1, help: "MPU active when counter ≥ this" },
      { key: "mpu_counter_max", label: "Counter maximum", unit: "count", step: 1 },
      { key: "detection_every_n", label: "Detection step every", unit: "samples", step: 1, help: "1 = every sample. The original script ran once per plot frame." },
    ],
  },
  {
    title: "Servo",
    icon: Cog,
    subtitle: "The ESP32 releases the servo on its own if heartbeats stop for 3 s",
    fields: [
      { key: "hold_seconds", label: "Hold after last detection", unit: "s", step: 0.1 },
      { key: "heartbeat_seconds", label: "Heartbeat interval", unit: "s", step: 0.1, help: "Must stay below the 3 s ESP32 failsafe" },
    ],
  },
  {
    title: "Display & safety",
    icon: Monitor,
    subtitle: "Graph refresh is independent of acquisition and recording",
    fields: [
      { key: "graph_refresh_ms", label: "Graph refresh interval", unit: "ms", step: 10 },
      { key: "graph_window_s", label: "Live chart window", unit: "s", step: 1 },
      { key: "stale_timeout_ms", label: "Stale-data timeout", unit: "ms", step: 50, help: "No samples for this long → SENSOR ERROR and servo released" },
    ],
  },
];

function clientValidate(d: Settings, limits: Record<string, [number, number]>): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, [lo, hi]] of Object.entries(limits)) {
    const v = d[k as keyof Settings] as number;
    if (typeof v !== "number" || Number.isNaN(v)) e[k] = "Required";
    else if (v < lo || v > hi) e[k] = `Must be between ${lo} and ${hi}`;
  }
  const ints: NumKey[] = ["emg_window", "emg_avg_samples", "emg_counter_max", "emg_confirmation", "filter_order", "mpu_buffer_size", "confirmation_threshold", "mpu_counter_max", "detection_every_n", "stale_timeout_ms", "graph_refresh_ms", "graph_window_s"];
  for (const k of ints) if (!e[k] && !Number.isInteger(d[k])) e[k] = "Must be a whole number";
  if (!e.emg_threshold_low && d.emg_threshold_low >= d.emg_threshold_high) e.emg_threshold_low = "Must be below the high threshold";
  if (!e.lowcut && d.lowcut >= d.highcut) e.lowcut = "Must be below the upper cutoff";
  if (!e.highcut && d.highcut >= d.fs / 2) e.highcut = `Must be below Nyquist (${d.fs / 2} Hz)`;
  if (!e.emg_confirmation && d.emg_confirmation > d.emg_counter_max) e.emg_confirmation = "Cannot exceed the counter maximum";
  if (!e.confirmation_threshold && d.confirmation_threshold > d.mpu_counter_max) e.confirmation_threshold = "Cannot exceed the counter maximum";
  if (!e.emg_avg_samples && d.emg_avg_samples > d.emg_window) e.emg_avg_samples = "Cannot exceed the EMG buffer";
  if (d.source === "serial" && !d.port.trim()) e.port = "Required";
  return e;
}

export default function SettingsPage() {
  const t = useWebSocket();
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ports, setPorts] = useState<{ device: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadPorts = async () => {
    try {
      setPorts(await api.get("/api/serial/ports"));
    } catch {
      setPorts([]);
    }
  };

  useEffect(() => {
    api.get<SettingsPayload>("/api/settings").then((p) => {
      setPayload(p);
      setDraft(p.settings);
    }).catch((e) => setMessage({ tone: "crit", text: e.message }));
    loadPorts();
  }, []);

  const changed = useMemo(() => {
    if (!payload || !draft) return {} as Partial<Settings>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as (keyof Settings)[]) if (draft[k] !== payload.settings[k]) out[k] = draft[k];
    return out as Partial<Settings>;
  }, [draft, payload]);
  const dirty = Object.keys(changed).length > 0;

  if (!payload || !draft) {
    return <div className="text-[13px] text-ink-3">{message?.text ?? "Loading settings…"}</div>;
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setDraft({ ...draft, [k]: v });
    setErrors((e) => ({ ...e, [k]: "" }));
    setMessage(null);
  };

  const apply = (p: SettingsPayload, text: string) => {
    setPayload(p);
    setDraft(p.settings);
    setErrors({});
    telemetry.setSettings(p.settings);
    setMessage({ tone: "ok", text });
  };

  const save = async (): Promise<boolean> => {
    const e = clientValidate(draft, payload.limits);
    if (Object.values(e).some(Boolean)) {
      setErrors(e);
      setMessage({ tone: "crit", text: "Fix the highlighted fields before saving." });
      return false;
    }
    setBusy(true);
    try {
      apply(await api.put<SettingsPayload>("/api/settings", changed), "Settings validated and applied.");
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setMessage({ tone: "crit", text: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      apply(await api.post<SettingsPayload>("/api/settings/reset"), "Defaults restored (values from the original combine.py).");
      setConfirmReset(false);
    } catch (err) {
      setMessage({ tone: "crit", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    // saving source/port/baud already restarts the source on the backend
    if (dirty) {
      await save();
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/source/connect");
    } catch (err) {
      setMessage({ tone: "crit", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await api.post("/api/source/disconnect");
    } finally {
      setBusy(false);
    }
  };

  const src = t.status?.source;
  const portInList = ports.some((p) => p.device === draft.port);
  const isDefault = (k: keyof Settings) => draft[k] === payload.defaults[k];

  return (
    <div className="space-y-6 pb-20">
      <Card
        title="Connection"
        subtitle="The backend is the only process that opens the COM port. Close combine.py and the Arduino Serial Monitor first."
        icon={Usb}
        actions={
          src?.state === "connected" ? (
            <Badge tone={src.simulated ? "warn" : "ok"}>{src.simulated ? "Simulator running" : `Connected · ${src.info}`}</Badge>
          ) : src?.state === "connecting" ? (
            <Badge tone="warn">Retrying…</Badge>
          ) : (
            <Badge tone="neutral">Disconnected</Badge>
          )
        }
      >
        <div className="grid gap-5 lg:grid-cols-4">
          <div className="lg:col-span-4">
            <div className="mb-2 text-xs font-medium text-ink-2">Data source</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["serial", Usb, "ESP32 hardware (serial)", "Live MPU6050 + sEMG data, servo commands sent to the ESP32"],
                  ["simulator", FlaskConical, "Simulator", "Synthetic signals for demos without hardware. Clearly marked as simulated."],
                ] as const
              ).map(([id, Icon, title, desc]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set("source", id)}
                  aria-pressed={draft.source === id}
                  className={cx(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    draft.source === id ? (id === "simulator" ? "border-warn/50 bg-warn/[0.06]" : "border-teal/60 bg-teal/[0.07]") : "border-line bg-panel-2 hover:border-ink-3/50",
                  )}
                >
                  <Icon className={cx("mt-0.5 size-4.5", draft.source === id ? (id === "simulator" ? "text-warn" : "text-teal") : "text-ink-3")} />
                  <div>
                    <div className="text-[13px] font-medium text-ink">{title}</div>
                    <div className="mt-0.5 text-xs text-ink-3">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className={cx("lg:col-span-2", draft.source !== "serial" && "opacity-50")}>
            <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-2">
              COM port
              <button type="button" onClick={loadPorts} className="flex items-center gap-1 text-ink-3 hover:text-ink">
                <RefreshCw className="size-3" /> Scan
              </button>
            </label>
            <div className="flex gap-2">
              <select
                value={portInList ? draft.port : "__custom"}
                onChange={(e) => e.target.value !== "__custom" && set("port", e.target.value)}
                disabled={draft.source !== "serial"}
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2.5 text-[13px] text-ink outline-none focus:border-teal/60"
              >
                {ports.map((p) => (
                  <option key={p.device} value={p.device}>
                    {p.device} · {p.description}
                  </option>
                ))}
                <option value="__custom">{portInList ? "Other…" : `${draft.port || "Other"} (not detected)`}</option>
              </select>
              <input
                value={draft.port}
                onChange={(e) => set("port", e.target.value)}
                disabled={draft.source !== "serial"}
                className={cx(
                  "h-9 w-28 rounded-lg border bg-panel-2 px-2.5 font-mono text-[13px] text-ink outline-none focus:border-teal/60",
                  errors.port ? "border-crit/60" : "border-line",
                )}
                aria-label="Port name"
              />
            </div>
            {errors.port && <p className="mt-1 text-xs text-crit">{errors.port}</p>}
            {!ports.length && <p className="mt-1 text-xs text-ink-3">No serial ports detected. Plug in the ESP32 and press Scan.</p>}
          </div>

          <div className={cx(draft.source !== "serial" && "opacity-50")}>
            <label className="mb-1.5 block text-xs font-medium text-ink-2">Baud rate</label>
            <select
              value={draft.baud}
              onChange={(e) => set("baud", Number(e.target.value))}
              disabled={draft.source !== "serial"}
              className="h-9 w-full rounded-lg border border-line bg-panel-2 px-2.5 text-[13px] text-ink outline-none focus:border-teal/60"
            >
              {payload.baud_rates.map((b) => (
                <option key={b} value={b}>
                  {b.toLocaleString()}
                  {b === 115200 ? " (firmware)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end justify-between gap-3">
            <label className="flex items-center gap-2 pb-2 text-xs text-ink-2">
              <Toggle checked={draft.auto_reconnect} onChange={(v) => set("auto_reconnect", v)} label="Auto-reconnect" />
              Auto-reconnect
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-4">
            <Button variant="primary" icon={src?.state === "connected" ? PlugZap : Plug} onClick={connect} disabled={busy}>
              {src?.state === "connected" ? "Reconnect" : "Connect"}
            </Button>
            <Button icon={Unplug} onClick={disconnect} disabled={busy || src?.state === "disconnected"}>
              Disconnect
            </Button>
            {src?.error && src.state !== "connected" && <span className="text-xs text-warn">{src.error}</span>}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {GROUPS.map((g) => (
          <Card key={g.title} title={g.title} subtitle={g.subtitle} icon={g.icon} className={g.title === "MPU6050 detection" ? "xl:row-span-2" : ""}>
            <div className="grid gap-4 sm:grid-cols-2">
              {g.fields.map((f) => {
                const [lo, hi] = payload.limits[f.key] ?? [undefined, undefined];
                const err = errors[f.key];
                return (
                  <div key={f.key}>
                    <label htmlFor={f.key} className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-ink-2">
                      <span>{f.label}</span>
                      {!isDefault(f.key) && (
                        <button
                          type="button"
                          onClick={() => set(f.key, payload.defaults[f.key])}
                          className="text-[10px] font-semibold tracking-wide text-warn hover:underline"
                          title={`Default: ${payload.defaults[f.key]}`}
                        >
                          MODIFIED · reset to {payload.defaults[f.key]}
                        </button>
                      )}
                    </label>
                    <div className="relative">
                      <input
                        id={f.key}
                        type="number"
                        step={f.step}
                        min={lo}
                        max={hi}
                        value={Number.isNaN(draft[f.key]) ? "" : draft[f.key]}
                        onChange={(e) => set(f.key, e.target.value === "" ? NaN : Number(e.target.value))}
                        className={cx(
                          "h-9 w-full rounded-lg border bg-panel-2 px-3 pr-16 text-[13px] text-ink outline-none tabular focus:border-teal/60",
                          err ? "border-crit/60" : "border-line",
                        )}
                        aria-invalid={!!err}
                      />
                      {f.unit && <span className="pointer-events-none absolute top-2 right-3 text-xs text-ink-3">{f.unit}</span>}
                    </div>
                    {err ? (
                      <p className="mt-1 text-xs text-crit">{err}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-ink-3">
                        {f.help ? `${f.help} · ` : ""}
                        {lo !== undefined && `Range ${lo}–${hi}`}
                      </p>
                    )}
                  </div>
                );
              })}
              {g.title === "Servo" && (
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between rounded-lg border border-line-soft bg-panel-2 px-3 py-2.5">
                    <div>
                      <div className="text-xs font-medium text-ink-2">Automatic suppression</div>
                      <div className="text-[11px] text-ink-3">When off, the backend always sends '0'. Useful for recording unsuppressed tremor.</div>
                    </div>
                    <Toggle checked={draft.actuation_enabled} onChange={(v) => set("actuation_enabled", v)} label="Automatic suppression" />
                  </div>
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-ink-3">
                    <ShieldCheck className="mt-px size-3.5 shrink-0" />
                    There is no manual "engage" command. The servo only engages from validated detections on fresh data.
                  </p>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="fixed right-0 bottom-0 left-0 z-20 border-t border-line bg-bg/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          {message ? (
            <span className={cx("text-xs", message.tone === "ok" ? "text-ok" : "text-crit")}>{message.text}</span>
          ) : dirty ? (
            <span className="text-xs text-warn">{Object.keys(changed).length} unsaved change(s)</span>
          ) : (
            <span className="text-xs text-ink-3">All settings saved</span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {confirmReset ? (
              <>
                <span className="self-center text-xs text-warn">Restore every setting to the original defaults?</span>
                <Button variant="warn" icon={RotateCcw} onClick={reset} disabled={busy}>
                  Restore
                </Button>
                <Button variant="ghost" onClick={() => setConfirmReset(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" icon={RotateCcw} onClick={() => setConfirmReset(true)} disabled={busy}>
                Restore defaults
              </Button>
            )}
            <Button onClick={() => { setDraft(payload.settings); setErrors({}); setMessage(null); }} disabled={!dirty || busy}>
              Revert
            </Button>
            <Button variant="primary" icon={Save} onClick={() => save()} disabled={!dirty || busy}>
              Validate & apply
            </Button>
          </div>
        </div>
      </div>
      {draft.fs !== 100 && (
        <Callout tone="warn">
          The firmware samples at 100 Hz. A different sampling frequency here does not change the hardware rate; it only changes how the backend interprets the data.
        </Callout>
      )}
    </div>
  );
}
