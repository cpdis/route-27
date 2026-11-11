import { useCallback, useEffect, useState } from "react";
import type { AlertsPayload } from "../../lib/alerts";
import { readJson, writeJson } from "../lib/storage";

const DISMISSED_KEY = "route27-dismissed-alerts";
const CACHE_KEY = "route27-alerts";
const CACHE_MAX_AGE = 6 * 3_600_000;

/** Notices from the last visit, so a current one paints with the page instead of pushing it down later. */
function cachedAlerts(): AlertsPayload["alerts"] {
  const saved = readJson<AlertsPayload>(CACHE_KEY);
  const age = saved ? Date.now() - Date.parse(saved.fetchedAt) : Infinity;
  return saved && Array.isArray(saved.alerts) && age <= CACHE_MAX_AGE ? saved.alerts : [];
}

/** Route 27 service notices, refreshed every 30 minutes, minus the ones dismissed on this device. */
export function useAlerts() {
  const [alerts, setAlerts] = useState<AlertsPayload["alerts"]>(cachedAlerts);
  const [dismissed, setDismissed] = useState<string[]>(() => readJson<string[]>(DISMISSED_KEY) ?? []);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch("/api/alerts")
        .then(r => (r.ok ? r.json() : null))
        .then((payload: AlertsPayload | null) => {
          if (!active || !payload || !Array.isArray(payload.alerts)) return;
          setAlerts(payload.alerts);
          writeJson(CACHE_KEY, payload);
        })
        .catch(() => { /* notices are optional */ });
    };
    load();
    const timer = window.setInterval(load, 30 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => {
      const next = [...prev.filter(x => x !== id), id].slice(-30);
      writeJson(DISMISSED_KEY, next);
      return next;
    });
  }, []);

  return { alerts: alerts.filter(a => !dismissed.includes(a.id)), dismiss };
}
