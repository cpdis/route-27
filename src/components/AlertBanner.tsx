import type { AlertsPayload } from "../../lib/alerts";
import { shortDay } from "../lib/format";

type Alert = AlertsPayload["alerts"][number];

function when(alert: Alert): string {
  if (alert.from && alert.until && alert.from !== alert.until) return `${shortDay(alert.from)} – ${shortDay(alert.until)}`;
  if (alert.from && alert.until) return shortDay(alert.from);
  if (alert.from) return (alert.active ? "Since " : "From ") + shortDay(alert.from);
  if (alert.until) return "Until " + shortDay(alert.until);
  return "";
}

/** "Routes 24, 27, 32 and 940 Bus Stop Disruption" → "Bus Stop Disruption". */
export function cleanTitle(title: string): string {
  const trimmed = title.replace(/^Routes?\s+[\d,&\s]+(?:and\s+\d+\s*)?/i, "").trim();
  return trimmed.length >= 6 ? trimmed : title;
}

/** Active notices sit above the next bus; upcoming ones sit lower down the page. */
export default function AlertBanner({ alerts, onDismiss, variant }: {
  alerts: Alert[]; onDismiss: (id: string) => void; variant: "active" | "upcoming";
}) {
  const shown = alerts.filter(a => (variant === "active" ? a.active : !a.active)).slice(0, 3);
  if (shown.length === 0) return null;
  const list = (
    <div className={"alerts is-" + variant}>
      {shown.map(alert => (
        <aside key={alert.id} className={"alert" + (alert.active ? " is-active" : "")}>
          <div className="alert-main">
            <span className="alert-label">
              {alert.active ? "Now" : alert.kind === "change" ? "Service change" : "Disruption"}
              {when(alert) ? " · " + when(alert) : ""}
            </span>
            <a className="alert-title" href={alert.url} target="_blank" rel="noopener noreferrer">{cleanTitle(alert.title)} ↗</a>
          </div>
          <button type="button" className="alert-close" aria-label={"Dismiss " + cleanTitle(alert.title)} onClick={() => onDismiss(alert.id)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </aside>
      ))}
    </div>
  );
  if (variant === "active") return <div role="region" aria-label="Current Transperth notices for route 27">{list}</div>;
  return (
    <section aria-labelledby="notices-title">
      <div className="section-heading">
        <h2 id="notices-title" className="section-title">Coming up</h2>
        <span className="section-note">TRANSPERTH NOTICES</span>
      </div>
      {list}
    </section>
  );
}
