import { memo, type ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Sample } from "../types";

export const SERIES = {
  s1: "#3987e5", // blue
  s2: "#d95926", // orange
  s3: "#199e70", // aqua (detection axis / primary signal)
  muted: "#64748b",
};
export const GRID = "#1b2739";
export const AXIS = "#263449";

export interface Series {
  key: string;
  label: string;
  color: string;
  width?: number;
  dashed?: boolean;
}

export interface RefLine {
  y: number;
  label: string;
}

export type Row = { x: number } & Record<string, number | null>;

/** Convert samples to chart rows. x = seconds relative to the newest sample (evenly spaced by seq). */
export function toRows(samples: Sample[], fs: number, pick: (s: Sample) => Record<string, number | null>): Row[] {
  if (!samples.length) return [];
  const last = samples[samples.length - 1].seq;
  return samples.map((s) => ({ x: (s.seq - last) / fs, ...pick(s) }) as Row);
}

function ChartTooltip({
  active,
  payload,
  label,
  series,
  format,
  xFormat,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: number;
  series: Series[];
  format: (v: number) => string;
  xFormat: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-[#0d1626]/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1 text-ink-3 tabular">{xFormat(Number(label))}</div>
      {series.map((s) => {
        const p = payload.find((q) => q.dataKey === s.key);
        if (!p || p.value === null || p.value === undefined) return null;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            <span className="text-ink-2">{s.label}</span>
            <span className="ml-auto pl-4 font-medium text-ink tabular">{format(p.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Legend with live values: identity is carried by swatch + text, never color alone. */
export function SeriesLegend({ series, latest, format }: { series: Series[]; latest?: Row; format: (v: number) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((s) => {
        const v = latest?.[s.key];
        return (
          <div key={s.key} className="flex items-center gap-1.5 text-xs">
            <span
              className="w-3.5 rounded-full"
              style={{
                height: s.width && s.width > 2 ? 3 : 2,
                background: s.dashed ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` : s.color,
              }}
            />
            <span className="text-ink-2">{s.label}</span>
            {v !== undefined && v !== null && <span className="font-medium text-ink tabular">{format(v)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function SensorChartImpl({
  rows,
  series,
  height = 200,
  yDomain = ["auto", "auto"],
  refLines = [],
  band,
  windowSeconds,
  format = (v) => v.toFixed(3),
  yTickFormat,
  xTickFormat = (v) => (v === 0 ? "0" : `${Math.round(v)}s`),
  showLegend = true,
  legendExtra,
  emptyLabel = "Waiting for data…",
}: {
  rows: Row[];
  series: Series[];
  height?: number;
  yDomain?: [number | "auto" | ((v: number) => number), number | "auto" | ((v: number) => number)];
  refLines?: RefLine[];
  band?: { y1: number; y2: number; label?: string };
  windowSeconds: number;
  format?: (v: number) => string;
  yTickFormat?: (v: number) => string;
  xTickFormat?: (v: number) => string;
  showLegend?: boolean;
  legendExtra?: ReactNode;
  emptyLabel?: string;
}) {
  const latest = rows[rows.length - 1];
  const xFormat = (v: number) => (v === 0 ? "now" : `${v.toFixed(1)} s`);
  return (
    <div>
      {showLegend && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <SeriesLegend series={series} latest={latest} format={format} />
          {legendExtra}
        </div>
      )}
      <div style={{ height }} className="relative">
        {!rows.length && (
          <div className="absolute inset-0 z-10 grid place-items-center text-xs text-ink-3">{emptyLabel}</div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              domain={[-windowSeconds, 0]}
              tickCount={windowSeconds >= 2 ? Math.min(Math.round(windowSeconds) + 1, 9) : 5}
              tickFormatter={xTickFormat}
              stroke={AXIS}
              tickLine={false}
              allowDataOverflow
            />
            <YAxis
              domain={yDomain}
              width={48}
              stroke={AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={yTickFormat}
              allowDataOverflow
            />
            {band && (
              <ReferenceArea y1={band.y1} y2={band.y2} fill="#14b8a6" fillOpacity={0.05} stroke="none" ifOverflow="hidden" />
            )}
            {refLines.map((r) => (
              <ReferenceLine
                key={r.label}
                y={r.y}
                stroke="#94a3b8"
                strokeDasharray="4 4"
                strokeOpacity={0.7}
                ifOverflow="hidden"
                label={{ value: r.label, position: "insideTopRight", fill: "#94a3b8", fontSize: 10 }}
              />
            ))}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "#475569", strokeWidth: 1 }}
              content={(p: any) => <ChartTooltip {...p} series={series} format={format} xFormat={xFormat} />}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                type="linear"
                stroke={s.color}
                strokeWidth={s.width ?? 1.5}
                strokeDasharray={s.dashed ? "5 3" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#111c2e" }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export const SensorChart = memo(SensorChartImpl);
