import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle, type LucideIcon } from "lucide-react";
import { cx } from "../lib/format";

export function Card({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={2} />}
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export type Tone = "ok" | "warn" | "crit" | "info" | "neutral" | "teal";

const toneClasses: Record<Tone, string> = {
  ok: "text-ok bg-ok/10 border-ok/25",
  warn: "text-warn bg-warn/10 border-warn/30",
  crit: "text-crit bg-crit/10 border-crit/30",
  info: "text-cyan bg-cyan/10 border-cyan/25",
  teal: "text-teal bg-teal/10 border-teal/25",
  neutral: "text-ink-2 bg-white/[0.03] border-line",
};

const toneIcon: Record<Tone, LucideIcon> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  crit: XCircle,
  info: Info,
  teal: CheckCircle2,
  neutral: CircleDashed,
};

export function Badge({
  tone = "neutral",
  children,
  icon,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  icon?: LucideIcon | null;
  className?: string;
}) {
  const Icon = icon === null ? null : icon ?? toneIcon[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider",
        toneClasses[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "warn";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-teal text-[#04231f] hover:bg-teal/90 border-transparent",
  secondary: "bg-raised text-ink border-line hover:border-ink-3/60 hover:bg-[#1a2943]",
  danger: "bg-crit/15 text-crit border-crit/35 hover:bg-crit/25",
  warn: "bg-warn/15 text-warn border-warn/35 hover:bg-warn/25",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-white/[0.04] hover:text-ink",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
}) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        "disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "lg" && "h-11 px-5 text-sm",
        variantClasses[variant],
        className,
      )}
    >
      {Icon && <Icon className={size === "lg" ? "size-4.5" : "size-4"} strokeWidth={2} />}
      {children}
    </button>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="tabular text-lg font-semibold text-ink">{value}</span>
        {unit && <span className="text-xs text-ink-3">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-xl border border-line bg-panel-2">
        <Icon className="size-5 text-ink-3" />
      </div>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const Icon = toneIcon[tone];
  return (
    <div className={cx("flex gap-3 rounded-lg border px-4 py-3 text-[13px]", toneClasses[tone])}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="text-ink-2">
        {title && <div className="mb-0.5 font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full border transition-colors disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
        checked ? "border-teal/50 bg-teal/80" : "border-line bg-raised",
      )}
    >
      <span
        className={cx(
          "inline-block size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** Segmented 0..max counter with the confirmation threshold marked. */
export function CounterBar({ value, max, threshold, active }: { value: number; max: number; threshold: number; active: boolean }) {
  return (
    <div className="flex items-center gap-[3px]" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value;
        return (
          <div key={i} className="relative h-3 flex-1">
            {i === threshold - 1 && <div className="absolute -top-1.5 -bottom-1.5 right-[-2.5px] w-px bg-ink-3" />}
            <div
              className={cx(
                "h-full rounded-[3px] transition-colors duration-150",
                filled ? (active ? "bg-teal" : "bg-ink-3") : "bg-white/[0.05]",
              )}
            />
          </div>
        );
      })}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block size-4 animate-spin rounded-full border-2 border-ink-3 border-t-teal", className)} />;
}
