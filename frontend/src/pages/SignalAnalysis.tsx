import { useMemo, useState } from "react";
import { BarChart3, GitCompare, Loader2, Sigma, Waves } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessions } from "../hooks/useSessions";
import { api } from "../lib/api";
import { cx, fmt, isNoisePeak } from "../lib/format";
import type { SessionComparison } from "../types";
import { FrequencySpectrum } from "../components/FrequencySpectrum";
import { AXIS, GRID, SensorChart, SeriesLegend, SERIES, type Row } from "../components/SensorChart";
import { Badge, Button, Callout, Card, EmptyState } from "../components/ui";

const SLOT_COLORS = [SERIES.s1, SERIES.s2, SERIES.s3];

function Characteristic({
  label,
  value,
  unit,
  pass,
  rule,
  noise = false,
}: {
  label: string;
  value: string;
  unit?: string;
  pass?: boolean | null;
  rule?: string;
  noise?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-panel-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</span>
        {noise ? (
          <Badge tone="neutral" className="!text-[9px]">Noise</Badge>
        ) : pass !== undefined && pass !== null && (
          <Badge tone={pass ? "teal" : "neutral"} className="!text-[9px]">{pass ? "Pass" : "Fail"}</Badge>
        )}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={cx("text-xl font-semibold tabular", noise ? "text-ink-3" : "text-ink")}>{value}</span>
        {unit && <span className="text-xs text-ink-3">{unit}</span>}
      </div>
      {rule && <div className="mt-0.5 text-[11px] text-ink-3">{rule}</div>}
    </div>
  );
}

export default function SignalAnalysis() {
  const t = useWebSocket();
  const a = t.analysis;
  const s = t.settings;
  const p = t.status?.processing;
  const fs = a?.fs ?? s?.fs ?? 100;
  const n = a?.raw_z.length ?? s?.mpu_buffer_size ?? 64;
  const windowS = n / fs;

  const toWindowRows = (vals: number[] | undefined, key: string): Row[] =>
    (vals ?? []).map((v, i) => ({ x: (i - (vals!.length - 1)) / fs, [key]: v }) as Row);

  const rawRows = toWindowRows(a?.raw_z, "raw");
  const filtRows = toWindowRows(a?.filtered_z, "f");

  const rmsPass = p?.rms != null && s ? p.rms > s.min_movement_rms : null;
  const noise = isNoisePeak(p?.rms, s?.min_movement_rms);
  const freqPass = p?.peak_frequency != null && s ? p.peak_frequency >= s.lowcut && p.peak_frequency <= s.highcut : null;
  const powPass = p?.peak_power != null && s ? p.peak_power > s.min_peak_power : null;
  const msTick = (v: number) => `${Math.round(v * 1000)}`;

  return (
    <div className="space-y-6">
      <Callout tone="info">
        Each detection step analyses the latest <b>{n} Z-axis samples</b> ({(windowS * 1000).toFixed(0)} ms at {fs} Hz): zero-phase Butterworth
        bandpass (order {s?.filter_order ?? 2}, {s?.lowcut ?? 4}–{s?.highcut ?? 12} Hz), then a Hann window, then the FFT. The panels below show that exact window.
      </Callout>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Raw Z-axis window" subtitle={`Accelerometer Z (g), the last ${n} samples. X axis in ms.`} icon={Waves}>
          <SensorChart
            rows={rawRows}
            series={[{ key: "raw", label: "AZ raw", color: SERIES.s1, width: 1.75 }]}
            windowSeconds={windowS}
            height={200}
            showLegend={false}
            xTickFormat={msTick}
            yTickFormat={(v) => v.toFixed(2)}
            emptyLabel="No analysis window yet"
          />
        </Card>
        <Card title="Butterworth-filtered window" subtitle={`Bandpass ${s?.lowcut ?? 4}–${s?.highcut ?? 12} Hz (g). X axis in ms.`} icon={Waves}>
          <SensorChart
            rows={filtRows}
            series={[{ key: "f", label: "AZ filtered", color: SERIES.s3, width: 1.75 }]}
            windowSeconds={windowS}
            height={200}
            showLegend={false}
            xTickFormat={msTick}
            yDomain={[(min: number) => Math.min(-0.05, min), (max: number) => Math.max(0.05, max)]}
            yTickFormat={(v) => v.toFixed(2)}
            emptyLabel="No analysis window yet"
          />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          title="Frequency spectrum"
          subtitle={`|FFT| of the Hann-windowed filtered signal · bin width ${(fs / n).toFixed(2)} Hz`}
          icon={BarChart3}
          className="xl:col-span-2"
        >
          {a ? (
            <FrequencySpectrum
              freqs={a.freqs}
              spectrum={a.spectrum}
              lowcut={s?.lowcut ?? 4}
              highcut={s?.highcut ?? 12}
              peakFrequency={p?.peak_frequency ?? null}
              peakIsNoise={noise}
              powerThreshold={s?.min_peak_power ?? 0.5}
              height={290}
            />
          ) : (
            <EmptyState icon={BarChart3} title="No spectrum yet">
              The spectrum appears once sensor data is streaming.
            </EmptyState>
          )}
        </Card>
        <Card title="Signal characteristics" subtitle="The three MPU tremor conditions, plus context" icon={Sigma}>
          <div className="grid grid-cols-2 gap-3">
            <Characteristic label="RMS" value={fmt(p?.rms, 4)} unit="g" pass={rmsPass} rule={`> ${s?.min_movement_rms ?? 0.02}`} />
            <Characteristic
              label="Dominant freq."
              value={fmt(p?.peak_frequency, 2)}
              unit="Hz"
              pass={freqPass}
              noise={noise && !!t.status}
              rule={noise && t.status ? "RMS below threshold: peak is sensor noise" : `${s?.lowcut ?? 4} ≤ f ≤ ${s?.highcut ?? 12}`}
            />
            <Characteristic label="Peak power" value={fmt(p?.peak_power, 3)} pass={powPass} rule={`> ${s?.min_peak_power ?? 0.5}`} />
            <Characteristic label="Amplitude" value={fmt(p?.amplitude, 4)} unit="g p-p" rule="Filtered window" />
            <Characteristic label="EMG moving avg" value={fmt(p?.emg_avg, 0)} unit="ADC" rule={`${s?.emg_threshold_low ?? 500} / ${s?.emg_threshold_high ?? 1500}`} />
            <Characteristic
              label="MPU condition"
              value={t.status?.detection.mpu_condition ? "MET" : "NOT MET"}
              pass={t.status ? t.status.detection.mpu_condition : null}
              rule="All three must pass"
            />
          </div>
        </Card>
      </div>

      <Comparison />
    </div>
  );
}

function Comparison() {
  const { sessions } = useSessions();
  const t = useWebSocket();
  const s = t.settings;
  const [picked, setPicked] = useState<(string | "")[]>(["", "", ""]);
  const [data, setData] = useState<SessionComparison[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // suggest one session for each of Normal / Tremor / Tremor Suppressed
  const suggested = useMemo(() => {
    if (!sessions) return ["", "", ""];
    return ["Normal", "Tremor", "Tremor Suppressed"].map((l) => sessions.find((x) => x.label === l)?.id ?? "");
  }, [sessions]);
  const choice = picked.map((v, i) => v || suggested[i]);

  const compare = async () => {
    const ids = choice.filter(Boolean);
    if (!ids.length) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<SessionComparison[]>(`/api/sessions/compare?ids=${ids.join(",")}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const series = (data ?? []).map((d, i) => ({ key: `s${i}`, label: `${d.id} · ${d.label}`, color: SLOT_COLORS[i] }));
  const specRows = data?.[0]?.freqs.map((f, k) => {
    const row: Record<string, number> = { f };
    data.forEach((d, i) => (row[`s${i}`] = d.spectrum[k]));
    return row;
  });

  const STAT_ROWS: [string, (c: SessionComparison) => string][] = [
    ["Samples", (c) => c.samples.toLocaleString()],
    ["Mean EMG moving avg", (c) => fmt(c.stats.mean_emg_avg, 0)],
    ["Mean RMS (g)", (c) => fmt(c.stats.mean_rms, 4)],
    ["Median dominant freq. (Hz)", (c) => fmt(c.stats.median_peak_frequency, 2)],
    ["Mean peak power", (c) => fmt(c.stats.mean_peak_power, 3)],
    ["AZ std. dev. (g)", (c) => fmt(c.stats.az_std, 4)],
    ["EMG gate active", (c) => `${fmt(c.stats.emg_active_pct, 1)} %`],
    ["MPU gate active", (c) => `${fmt(c.stats.mpu_active_pct, 1)} %`],
    ["Tremor detected", (c) => `${fmt(c.stats.tremor_pct, 1)} %`],
    ["Servo engaged", (c) => `${fmt(c.stats.servo_pct, 1)} %`],
  ];

  return (
    <Card
      title="Comparative analysis"
      subtitle="Compare recorded sessions, e.g. normal, tremor and tremor with suppression"
      icon={GitCompare}
    >
      {!sessions?.length ? (
        <EmptyState icon={GitCompare} title="No sessions to compare">
          Record sessions labelled Normal, Tremor and Tremor Suppressed in Data Acquisition, then compare them here.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            {[0, 1, 2].map((i) => (
              <label key={i} className="min-w-52 flex-1">
                <span className="mb-1 flex items-center gap-1.5 text-xs text-ink-2">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: SLOT_COLORS[i] }} /> Session {i + 1}
                </span>
                <select
                  value={choice[i]}
                  onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
                  className="h-9 w-full rounded-lg border border-line bg-panel-2 px-2.5 text-[13px] text-ink outline-none focus:border-teal/60"
                >
                  <option value="">None</option>
                  {sessions.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.id} · {x.label}
                      {x.source === "simulated" ? " (sim)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <Button variant="primary" icon={loading ? Loader2 : GitCompare} onClick={compare} disabled={loading || !choice.some(Boolean)}>
              Compare
            </Button>
          </div>
          {error && <p className="mt-3 text-xs text-crit">{error}</p>}

          {data && (
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <div className="-mx-1 overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line-soft text-[11px] uppercase tracking-wider text-ink-3">
                      <th className="px-1 py-2 font-medium">Metric</th>
                      {data.map((d, i) => (
                        <th key={d.id} className="px-2 py-2 text-right font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-0.5 w-3 rounded-full" style={{ background: SLOT_COLORS[i] }} />
                            <span className="normal-case text-ink-2">{d.label}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {STAT_ROWS.map(([name, get]) => (
                      <tr key={name} className="border-b border-line-soft/50 last:border-0">
                        <td className="px-1 py-2 text-ink-3">{name}</td>
                        {data.map((d) => (
                          <td key={d.id} className="px-2 py-2 text-right text-ink tabular">
                            {get(d)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-ink-2">Average spectrum (filtered Z, {s?.mpu_buffer_size ?? 64}-sample windows, 50% overlap)</div>
                <div className="mb-2">
                  <SeriesLegend series={series} format={() => ""} />
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={specRows} margin={{ top: 6, right: 8, bottom: 14, left: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <ReferenceArea x1={s?.lowcut ?? 4} x2={s?.highcut ?? 12} fill="#14b8a6" fillOpacity={0.06} stroke="none" />
                      <XAxis
                        dataKey="f"
                        type="number"
                        domain={[0, "dataMax"]}
                        stroke={AXIS}
                        tickLine={false}
                        label={{ value: "Frequency (Hz)", position: "insideBottom", offset: -8, fill: "#64748b", fontSize: 11 }}
                      />
                      <YAxis width={44} stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
                      <Tooltip
                        isAnimationActive={false}
                        cursor={{ stroke: "#475569" }}
                        content={({ active, payload, label }: any) =>
                          active && payload?.length ? (
                            <div className="rounded-lg border border-line bg-[#0d1626]/95 px-3 py-2 text-xs shadow-xl">
                              <div className="mb-1 text-ink-3 tabular">{Number(label).toFixed(2)} Hz</div>
                              {series.map((se) => {
                                const pt = payload.find((q: any) => q.dataKey === se.key);
                                return pt ? (
                                  <div key={se.key} className="flex items-center gap-2">
                                    <span className="h-0.5 w-3 rounded-full" style={{ background: se.color }} />
                                    <span className="text-ink-2">{se.label}</span>
                                    <span className="ml-auto pl-3 text-ink tabular">{pt.value.toFixed(3)}</span>
                                  </div>
                                ) : null;
                              })}
                            </div>
                          ) : null
                        }
                      />
                      {series.map((se) => (
                        <Line key={se.key} dataKey={se.key} stroke={se.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
          {data?.some((d) => d.source === "simulated") && (
            <p className={cx("mt-3 text-xs text-warn")}>One or more compared sessions contain simulated data.</p>
          )}
        </>
      )}
    </Card>
  );
}
