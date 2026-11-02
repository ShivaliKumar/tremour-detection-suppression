import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "../lib/format";

export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  footer,
  accent = false,
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  icon: LucideIcon;
  footer?: ReactNode;
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cx("flex flex-col rounded-xl border bg-panel p-4", accent ? "border-crit/40" : "border-line")}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3">{label}</span>
        <Icon className="size-4 text-ink-3" />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tabular text-[28px] leading-none font-semibold tracking-tight text-ink">{value}</span>
        {unit && <span className="text-sm text-ink-3">{unit}</span>}
      </div>
      {children && <div className="mt-3">{children}</div>}
      {footer && <div className="mt-auto pt-3 text-xs text-ink-3">{footer}</div>}
    </div>
  );
}
