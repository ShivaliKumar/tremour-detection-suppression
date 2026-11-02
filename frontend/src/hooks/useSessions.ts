import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Label, Session } from "../types";
import { useWebSocket } from "./useWebSocket";

/** Session list; refetches automatically when a recording is saved. */
export function useSessions() {
  const t = useWebSocket();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTotal = t.status?.recording.state === "idle" ? t.status.recording.total_samples : undefined;

  const refresh = useCallback(async () => {
    try {
      setSessions(await api.get<Session[]>("/api/sessions"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, savedTotal]);

  return { sessions, error, refresh };
}

export function useLabels() {
  const [labels, setLabels] = useState<Label[]>([]);
  const refresh = useCallback(async () => {
    try {
      setLabels(await api.get<Label[]>("/api/labels"));
    } catch {
      /* backend offline: keep previous */
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { labels, refresh };
}
