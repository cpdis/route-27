import { useCallback, useEffect, useState } from "react";
import type { AlertsPayload } from "../../lib/alerts";
import { readJson, writeJson } from "../lib/storage";

const DISMISSED_KEY = "route27-dismissed-alerts";

/** Route 27 service notices, refreshed every 30 minutes, minus the ones dismissed on this device. */
export function useAlerts() {
  const [alerts, setAlerts] = useState<AlertsPayload["alerts"]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => readJson<string[]>(DISMISSED_KEY) ?? []);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch("/api/alerts")
        .then(r => (r.ok ? r.json() : null))
        .then((payload: AlertsPayload | null) => {
          if (active && payload && Array.isArray(payload.alerts)) setAlerts(payload.alerts);
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
