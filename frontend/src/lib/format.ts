export const fmt = (v: number | null | undefined, digits = 2, fallback = "—") =>
  v === null || v === undefined || Number.isNaN(v) ? fallback : v.toFixed(digits);

export const fmtInt = (v: number | null | undefined, fallback = "—") =>
  v === null || v === undefined ? fallback : Math.round(v).toLocaleString();

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtClock(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtAgo(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "never";
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The FFT argmax always returns a bin; below the movement RMS threshold that bin is sensor noise. */
export const isNoisePeak = (rms: number | null | undefined, minRms: number | undefined) =>
  rms === null || rms === undefined || rms <= (minRms ?? 0.02);

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
