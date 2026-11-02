import { Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, SERIES } from "./SensorChart";

/** FFT magnitude spectrum with the tremor band, dominant peak and peak-power threshold marked. */
export function FrequencySpectrum({
  freqs,
  spectrum,
  lowcut,
  highcut,
  peakFrequency,
  powerThreshold,
  peakIsNoise = false,
  height = 260,
}: {
  freqs: number[];
  spectrum: number[];
  lowcut: number;
  highcut: number;
  peakFrequency: number | null;
  powerThreshold: number;
  peakIsNoise?: boolean;
  height?: number;
}) {
  const rows = freqs.map((f, i) => ({ f, m: spectrum[i] ?? 0 }));
  const binWidth = freqs.length > 1 ? freqs[1] - freqs[0] : 1;
  const maxM = Math.max(powerThreshold * 1.4, ...spectrum.map((v) => v * 1.1));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-teal/40 bg-teal/15" /> Tremor band {lowcut}–{highcut} Hz
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-s3" /> In-band bins
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[#d6d2c4]" /> Out-of-band bins
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 border-t border-dashed border-ink-2" /> Min peak power {powerThreshold}
        </span>
      </div>
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 18, right: 8, bottom: 14, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <ReferenceArea
            x1={lowcut}
            x2={highcut}
            fill="#c6613f"
            fillOpacity={0.06}
            stroke="#c6613f"
            strokeOpacity={0.25}
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="f"
            type="number"
            domain={[0, freqs[freqs.length - 1] ?? 50]}
            stroke={AXIS}
            tickLine={false}
            ticks={[0, lowcut, highcut, ...[20, 30, 40, 50].filter((v) => v > highcut && v <= (freqs[freqs.length - 1] ?? 50))]}
            label={{ value: "Frequency (Hz)", position: "insideBottom", offset: -8, fill: "#87867f", fontSize: 11 }}
          />
          <YAxis domain={[0, maxM]} width={48} stroke={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
          <ReferenceLine
            y={powerThreshold}
            stroke="#87867f"
            strokeDasharray="4 4"
          />
          {peakFrequency !== null && (
            <ReferenceLine
              x={peakFrequency}
              stroke={peakIsNoise ? "#87867f" : "#141413"}
              strokeOpacity={0.6}
              strokeDasharray={peakIsNoise ? "2 3" : undefined}
              label={{
                value: peakIsNoise ? `Noise peak ${peakFrequency.toFixed(1)} Hz` : `Peak ${peakFrequency.toFixed(1)} Hz`,
                position: "top",
                fill: peakIsNoise ? "#87867f" : "#141413",
                fontSize: 10,
              }}
            />
          )}
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }: any) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-line bg-panel/95 px-3 py-2 text-xs shadow-lg shadow-black/5">
                  <div className="text-ink-3 tabular">
                    {payload[0].payload.f.toFixed(2)} Hz (bin ±{(binWidth / 2).toFixed(2)})
                  </div>
                  <div className="font-medium text-ink tabular">|FFT| {payload[0].payload.m.toFixed(3)}</div>
                </div>
              ) : null
            }
          />
          <Bar dataKey="m" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {rows.map((r) => (
              <Cell key={r.f} fill={r.f >= lowcut && r.f <= highcut ? SERIES.s3 : "#d6d2c4"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}
