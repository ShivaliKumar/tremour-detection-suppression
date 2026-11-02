import { createContext, createElement, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Analysis, Sample, Settings, Status } from "../types";

/**
 * Live telemetry store.
 *
 * Samples are kept in a rolling buffer outside React state; components re-render
 * once per WebSocket frame (the backend's graph refresh rate), not once per sample.
 */

export type LinkState = "connecting" | "open" | "stalled" | "closed";

const MAX_SAMPLES = 3500; // > 30 s at 100 Hz (max graph window)
const STALL_MS = 3000;

class TelemetryStore {
  samples: Sample[] = [];
  status: Status | null = null;
  analysis: Analysis | null = null;
  settings: Settings | null = null;
  link: LinkState = "connecting";
  lastMessageAt = 0;
  version = 0;

  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private retry = 0;
  private retryTimer: number | undefined;
  private stallTimer: number | undefined;
  private stopped = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  start() {
    this.stopped = false;
    this.connect();
    this.stallTimer = window.setInterval(() => {
      if (this.link === "open" && Date.now() - this.lastMessageAt > STALL_MS) {
        this.link = "stalled";
        this.emit();
      }
    }, 1000);
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.stallTimer);
    this.ws?.close();
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.link = "connecting";
    this.emit();

    ws.onopen = () => {
      this.retry = 0;
    };
    ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.lastMessageAt = Date.now();
      this.link = "open";
      if (msg.type === "hello") {
        this.settings = msg.settings;
        this.samples = msg.samples ?? [];
      } else {
        this.append(msg.samples ?? []);
      }
      this.status = msg.status ?? this.status;
      this.analysis = msg.analysis ?? null;
      this.emit();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.link = "closed";
      this.status = null;
      this.emit();
      if (!this.stopped) {
        const delay = Math.min(5000, 500 * 2 ** this.retry++);
        this.retryTimer = window.setTimeout(() => this.connect(), delay);
      }
    };
    ws.onerror = () => ws.close();
  }

  private append(incoming: Sample[]) {
    // frames may overlap the hello snapshot; keep only newer samples. (A backend restart
    // closes the socket, and the reconnect's hello frame replaces the buffer.)
    if (!incoming.length) return;
    const lastSeq = this.samples.length ? this.samples[this.samples.length - 1].seq : 0;
    for (const s of incoming) if (s.seq > lastSeq) this.samples.push(s);
    if (this.samples.length > MAX_SAMPLES) this.samples = this.samples.slice(-MAX_SAMPLES);
  }

  /** Update cached settings after a successful save (the socket only sends them on connect). */
  setSettings(s: Settings) {
    this.settings = s;
    this.emit();
  }
}

export const telemetry = new TelemetryStore();

const TelemetryContext = createContext<TelemetryStore>(telemetry);

export function TelemetryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    telemetry.start();
    return () => telemetry.stop();
  }, []);
  return createElement(TelemetryContext.Provider, { value: telemetry }, children);
}

/** Subscribe to every telemetry frame. */
export function useWebSocket() {
  const store = useContext(TelemetryContext);
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** Latest `seconds` of samples, decimated to at most `maxPoints`. */
export function useWindow(seconds: number, maxPoints = 800): Sample[] {
  const store = useWebSocket();
  const fs = store.settings?.fs ?? 100;
  const n = Math.ceil(seconds * fs);
  const slice = store.samples.slice(-n);
  if (slice.length <= maxPoints) return slice;
  const step = Math.ceil(slice.length / maxPoints);
  const out: Sample[] = [];
  for (let i = slice.length - 1; i >= 0; i -= step) out.push(slice[i]);
  return out.reverse();
}

/** Ticks once per second, for "x seconds ago" labels that must update without data. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
