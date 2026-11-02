import { useState } from "react";
import { Download, Eye, FlaskConical, Trash2 } from "lucide-react";
import type { Session } from "../types";
import { cx, fmtDate, fmtDuration } from "../lib/format";
import { Badge, Button } from "./ui";

export function LabelChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-ink-2">
      {label}
    </span>
  );
}

export function SessionTable({
  sessions,
  onOpen,
  onDelete,
  selectedId,
  compact = false,
}: {
  sessions: Session[];
  onOpen?: (s: Session) => void;
  onDelete?: (s: Session) => Promise<void>;
  selectedId?: string | null;
  compact?: boolean;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line-soft text-[11px] uppercase tracking-wider text-ink-3">
            <th className="px-5 py-2 font-medium">Session</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Label</th>
            <th className="px-3 py-2 text-right font-medium">Samples</th>
            {!compact && <th className="px-3 py-2 font-medium">File</th>}
            <th className="px-5 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr
              key={s.id}
              className={cx(
                "border-b border-line-soft/60 transition-colors last:border-0 hover:bg-white/[0.02]",
                selectedId === s.id && "bg-teal/[0.05]",
              )}
            >
              <td className="px-5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink tabular">{s.id}</span>
                  {s.source === "simulated" && (
                    <Badge tone="warn" icon={FlaskConical} className="!px-1.5 !text-[9px]">Sim</Badge>
                  )}
                </div>
                {!compact && s.description && <div className="mt-0.5 max-w-56 truncate text-xs text-ink-3">{s.description}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{fmtDate(s.created)}</td>
              <td className="px-3 py-2.5 text-ink-2 tabular">{fmtDuration(s.duration)}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {(s.labels.length ? s.labels : [s.label]).map((l) => (
                    <LabelChip key={l} label={l} />
                  ))}
                </div>
              </td>
              <td className="px-3 py-2.5 text-right text-ink tabular">{s.samples.toLocaleString()}</td>
              {!compact && <td className="px-3 py-2.5 font-mono text-xs text-ink-3">{s.file}</td>}
              <td className="px-5 py-2.5">
                <div className="flex items-center justify-end gap-1">
                  {confirm === s.id ? (
                    <>
                      <span className="mr-1 text-xs text-crit">Delete files?</span>
                      <Button size="sm" variant="danger" onClick={async () => { await onDelete?.(s); setConfirm(null); }}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      {onOpen && (
                        <Button size="sm" variant="ghost" icon={Eye} onClick={() => onOpen(s)} aria-label={`Review ${s.id}`}>
                          Review
                        </Button>
                      )}
                      <a
                        href={`/api/sessions/${s.id}/download`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-2 hover:bg-white/[0.04] hover:text-ink"
                        aria-label={`Download ${s.file}`}
                      >
                        <Download className="size-4" /> CSV
                      </a>
                      {onDelete && (
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirm(s.id)} aria-label={`Delete ${s.id}`} />
                      )}
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
