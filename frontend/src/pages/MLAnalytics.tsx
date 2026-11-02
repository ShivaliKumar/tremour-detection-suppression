import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, CheckCircle2, CircleDashed, Database, Grid3x3, ListOrdered, RefreshCw, Target, Terminal } from "lucide-react";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessions } from "../hooks/useSessions";
import { api } from "../lib/api";
import { cx, fmt } from "../lib/format";
import type { MLStatus } from "../types";
import { ConfusionMatrix } from "../components/ConfusionMatrix";
import { Badge, Button, Callout, Card, EmptyState } from "../components/ui";

const pct = (v: number | undefined) => (v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);

export default function MLAnalytics() {
  const t = useWebSocket();
  const [ml, setMl] = useState<MLStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { sessions } = useSessions();

  const load = async (reload = false) => {
    setBusy(true);
    try {
      setMl(reload ? await api.post<MLStatus>("/api/ml/reload") : await api.get<MLStatus>("/api/ml/status"));
    } catch {
      setMl(null);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const readiness = useMemo(() => {
    const m = new Map<string, { sessions: number; samples: number }>();
    for (const s of sessions ?? []) {
      if (s.source === "simulated") continue;
      for (const seg of s.segments) {
        const e = m.get(seg.label) ?? { sessions: 0, samples: 0 };
        e.samples += seg.samples;
        m.set(seg.label, e);
      }
      for (const l of new Set(s.segments.map((x) => x.label))) m.get(l)!.sessions += 1;
    }
    return [...m.entries()].sort((a, b) => b[1].samples - a[1].samples);
  }, [sessions]);

  const meta = ml?.metadata;
  const prediction = t.status?.ml.prediction ?? null;
  const actual = t.status?.recording.state === "recording" ? t.status.recording.label : null;

  if (!ml?.available || !meta) {
    return (
      <div className="space-y-6">
        <Card
          title="Model status"
          icon={BrainCircuit}
          actions={
            <>
              <Badge tone="warn" icon={CircleDashed}>In development</Badge>
              <Button size="sm" icon={RefreshCw} onClick={() => load(true)} disabled={busy}>
                Reload model
              </Button>
            </>
          }
        >
          <EmptyState icon={BrainCircuit} title="No trained model available">
            Nothing is shown here until a model is trained on your recorded data. The dashboard does not display placeholder accuracy or predictions.
            {ml?.error && <div className="mt-2 text-crit">{ml.error}</div>}
          </EmptyState>
          <ol className="mx-auto mt-2 grid max-w-4xl gap-3 md:grid-cols-3">
            {[
              { icon: Database, title: "1 · Record labelled sessions", body: "Use Data Acquisition. Aim for several hardware sessions per label so whole sessions can be held out for testing." },
              { icon: Terminal, title: "2 · Train", body: <><code className="text-ink-2">cd backend</code><br /><code className="text-ink-2">pip install scikit-learn pandas joblib</code><br /><code className="text-ink-2">python train_model.py</code></> },
              { icon: RefreshCw, title: "3 · Reload", body: <>Writes <code className="text-ink-2">models/trained_model.pkl</code> and <code className="text-ink-2">model_metadata.json</code>. Then press Reload model.</> },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-lg border border-line-soft bg-panel-2 p-4">
                <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <Icon className="size-4 text-teal" /> {title}
                </div>
                <div className="mt-1.5 text-xs leading-relaxed text-ink-3">{body}</div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Dataset readiness" subtitle="Hardware recordings only (simulated sessions are excluded)" icon={ListOrdered}>
          {readiness.length ? (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line-soft text-[11px] uppercase tracking-wider text-ink-3">
                    <th className="px-5 py-2 font-medium">Label</th>
                    <th className="px-3 py-2 text-right font-medium">Sessions</th>
                    <th className="px-3 py-2 text-right font-medium">Samples</th>
                    <th className="px-5 py-2 font-medium">Held-out testing</th>
                  </tr>
                </thead>
                <tbody>
                  {readiness.map(([label, r]) => (
                    <tr key={label} className="border-b border-line-soft/50 last:border-0">
                      <td className="px-5 py-2.5 font-medium text-ink">{label}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink">{r.sessions}</td>
                      <td className="px-3 py-2.5 text-right tabular text-ink">{r.samples.toLocaleString()}</td>
                      <td className="px-5 py-2.5">
                        {r.sessions >= 2 ? <Badge tone="ok">Possible</Badge> : <Badge tone="warn">Needs ≥ 2 sessions</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-[13px] text-ink-3">No hardware recordings yet.</div>
          )}
        </Card>
      </div>
    );
  }

  const m = meta.metrics;
  const fi = Object.entries(meta.feature_importance ?? {}).sort((a, b) => b[1] - a[1]);
  const fiMax = Math.max(...fi.map(([, v]) => v), 1e-9);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          title={meta.name}
          subtitle={`Version ${meta.version} · trained ${meta.trained_at}`}
          icon={BrainCircuit}
          className="xl:col-span-2"
          actions={
            <Button size="sm" icon={RefreshCw} onClick={() => load(true)} disabled={busy}>
              Reload
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ["Accuracy", m?.accuracy],
                [`Precision${m?.average ? ` (${m.average})` : ""}`, m?.precision],
                [`Recall${m?.average ? ` (${m.average})` : ""}`, m?.recall],
                [`F1-score${m?.average ? ` (${m.average})` : ""}`, m?.f1],
              ] as [string, number | undefined][]
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line-soft bg-panel-2 p-3.5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{k}</div>
                <div className="mt-1 text-2xl font-semibold text-ink tabular">{pct(v)}</div>
              </div>
            ))}
          </div>
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-ink-3">Evaluation</dt>
              <dd className="text-ink-2">{meta.split ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Train / test samples</dt>
              <dd className="text-ink-2 tabular">
                {m?.n_train?.toLocaleString() ?? "—"} / {m?.n_test?.toLocaleString() ?? "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-ink-3">Features</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {meta.features.map((f) => (
                  <span key={f} className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                    {f}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Live prediction" subtitle="From the latest processed sample" icon={Target}>
          {prediction ? (
            <>
              <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Predicted class</div>
              <div className="mt-1 text-2xl font-bold text-ink">{prediction.label}</div>
              <div className="mt-1 text-xs text-ink-3">
                Confidence:{" "}
                {prediction.confidence !== null ? (
                  <span className="text-ink tabular">{pct(prediction.confidence)}</span>
                ) : (
                  "not shown (model probabilities are not calibrated)"
                )}
              </div>
              <div className="mt-4 rounded-lg border border-line-soft bg-panel-2 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-3">Actual label (current recording)</span>
                  <span className="font-medium text-ink">{actual ?? "not recording"}</span>
                </div>
                {actual && (
                  <div className={cx("mt-2 flex items-center gap-1.5 font-medium", actual === prediction.label ? "text-ok" : "text-warn")}>
                    <CheckCircle2 className="size-3.5" />
                    {actual === prediction.label ? "Prediction matches label" : "Prediction differs from label"}
                  </div>
                )}
              </div>
            </>
          ) : (
            <EmptyState icon={Target} title="Waiting for data" className="!py-6">
              Predictions start when sensor data is streaming.
            </EmptyState>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Confusion matrix" subtitle="Held-out test data · rows = actual, columns = predicted" icon={Grid3x3}>
          {m?.confusion_matrix ? <ConfusionMatrix classes={meta.classes} matrix={m.confusion_matrix} /> : <div className="text-xs text-ink-3">Not provided.</div>}
        </Card>
        <Card title="Feature importance" subtitle="Impurity-based importance reported by the model" icon={ListOrdered}>
          {fi.length ? (
            <ul className="space-y-2.5">
              {fi.map(([k, v]) => (
                <li key={k} className="grid grid-cols-[140px_1fr_52px] items-center gap-3 text-xs">
                  <span className="truncate font-mono text-ink-2">{k}</span>
                  <div className="h-2.5 rounded-sm bg-white/[0.04]">
                    <div className="h-full rounded-sm bg-s1" style={{ width: `${(v / fiMax) * 100}%` }} />
                  </div>
                  <span className="text-right text-ink tabular">{fmt(v, 3)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-ink-3">This model does not report feature importance.</div>
          )}
        </Card>
      </div>
      {meta.test_sessions && meta.test_sessions.length < 2 && (
        <Callout tone="warn">The test set contains fewer than two sessions. These metrics may not generalise.</Callout>
      )}
    </div>
  );
}
