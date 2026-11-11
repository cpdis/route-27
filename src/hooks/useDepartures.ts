import { useEffect, useRef, useState } from "react";
import type { DeparturesPayload } from "../../lib/transperth";
import type { StopId } from "../config";
import { readJson, writeJson } from "../lib/storage";

const LAST_GOOD_MAX_AGE = 30 * 60_000;
const cacheKey = (stop: StopId) => "route27-feed-" + stop;

/** Last good payload for a stop, if it is recent enough to be worth showing. */
function lastGood(stop: StopId): DeparturesPayload | null {
  const saved = readJson<DeparturesPayload>(cacheKey(stop));
  if (!saved || saved.stop !== stop || !Array.isArray(saved.departures)) return null;
  const age = Date.now() - Date.parse(saved.fetchedAt);
  return Number.isFinite(age) && age <= LAST_GOOD_MAX_AGE ? saved : null;
}

/**
 * Polls /api/departures every minute while the page is visible, and on focus or reconnect.
 * Shows the last good copy from this device straight away and keeps it through failures.
 */
export function useDepartures(stop: StopId) {
  const [feed, setFeed] = useState<DeparturesPayload | null>(() => lastGood(stop));
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(true);
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    setFeed(lastGood(stop));
    setError("");
    setUpdating(true);
    const load = async () => {
      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;
      setUpdating(true);
      try {
        const response = await fetch("/api/departures?stop=" + stop, {
          cache: "no-store", signal: ctrl.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload.stop !== stop || !Array.isArray(payload.departures)) {
          throw new Error("Invalid stop-specific departure response");
        }
        if (!active || controller !== ctrl) return;
        setFeed(payload);
        setError("");
        if (!payload.stale) writeJson(cacheKey(stop), payload);
      } catch {
        if (!active || ctrl.signal.aborted) return;
        setError("Live departures are temporarily unavailable.");
      } finally {
        if (active && controller === ctrl) setUpdating(false);
      }
    };
    reloadRef.current = () => { void load(); };
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    const foreground = () => {
      if (document.visibilityState === "visible") void load();
    };
    const online = () => { void load(); };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("online", online);
    return () => {
      active = false;
      controller?.abort();
      reloadRef.current = () => {};
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("online", online);
    };
  }, [stop]);

  return { feed: feed?.stop === stop ? feed : null, error, updating, reload: () => reloadRef.current() };
}
