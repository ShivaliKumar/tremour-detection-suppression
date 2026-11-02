// Sequential single-hue (blue) ramp: darker = more samples. Rows = actual, columns = predicted.
const RAMP = ["#16233a", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#5598e7", "#6da7ec"];

export function ConfusionMatrix({ classes, matrix }: { classes: string[]; matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[3px] text-xs">
        <thead>
          <tr>
            <th />
            <th colSpan={classes.length} className="pb-1 text-center text-[10px] font-medium uppercase tracking-wider text-ink-3">
              Predicted
            </th>
          </tr>
          <tr>
            <th className="pr-2 text-right text-[10px] font-medium uppercase tracking-wider text-ink-3">Actual</th>
            {classes.map((c) => (
              <th key={c} className="max-w-20 px-1 pb-1 text-center font-medium text-ink-2">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => {
            const total = row.reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={classes[i]}>
                <th className="pr-2 text-right font-medium whitespace-nowrap text-ink-2">{classes[i]}</th>
                {row.map((v, j) => {
                  const step = v === 0 ? 0 : Math.max(1, Math.round((v / max) * (RAMP.length - 1)));
                  return (
                    <td
                      key={j}
                      title={`Actual ${classes[i]} → predicted ${classes[j]}: ${v} (${((v / total) * 100).toFixed(1)}% of row)`}
                      className="size-16 rounded-md text-center align-middle tabular"
                      style={{ background: RAMP[step], outline: i === j ? "1px solid rgba(226,232,240,0.35)" : undefined }}
                    >
                      <div className="font-semibold text-white">{v}</div>
                      <div className="text-[10px] text-white/70">{((v / total) * 100).toFixed(0)}%</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
