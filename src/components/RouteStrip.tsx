import { Suspense, lazy, useMemo, useState } from "react";
import type { Departure, TripPayload } from "../../lib/transperth";
import { ageLabel, formatLocalTime } from "../lib/format";
import { locateBus, shortStopName, type Progress } from "../lib/progress";

const RouteMap = lazy(() => import("./RouteMap"));

const WINDOW = 8; // stops shown before yours

function BusGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="15" rx="3" />
      <path d="M4 11h16M8 21v-3M16 21v-3" />
      <circle cx="8" cy="14.5" r=".6" fill="currentColor" /><circle cx="16" cy="14.5" r=".6" fill="currentColor" />
    </svg>
  );
}

function startTime(trip: TripPayload, departure: Departure): string | null {
  const first = trip.stops[0]?.time;
  if (!first) return null;
  // A late bus usually left late too; an early estimate never makes it leave early.
  const delay = Math.max(0, Date.parse(departure.expected) - Date.parse(departure.scheduled)) || 0;
  return formatLocalTime.format(new Date(Date.parse(first) + delay));
}

function describe(progress: Progress, trip: TripPayload, departure: Departure): { headline: string; detail: string } {
  const origin = shortStopName(trip.stops[0].name);
  const leaves = startTime(trip, departure);
  const near = progress.nearStop ? shortStopName(progress.nearStop.name) : origin;
  switch (progress.state) {
    case "previous-run":
      return { headline: "Finishing its previous run", detail: `Starts from ${origin}${leaves ? " at " + leaves : ""}.` };
    case "waiting":
      return progress.source === "gps"
        ? { headline: `Waiting at ${origin}`, detail: leaves ? `Leaves at ${leaves}.` : "About to leave." }
        : { headline: "Not on the road yet", detail: `Leaves ${origin}${leaves ? " at " + leaves : ""}.` };
    case "at-your-stop":
      return { headline: "At your stop now", detail: shortStopName(trip.stops[progress.target].name) + "." };
    case "passed":
      return { headline: "Just passed your stop", detail: `Now near ${near}.` };
    default: {
      const away = progress.stopsAway === 1 ? "Next stop is yours" : `${progress.stopsAway} stops away`;
      const verb = progress.source === "gps" ? "Last seen near" : "Probably near";
      return { headline: away, detail: `${verb} ${near}.` };
    }
  }
}

export default function RouteStrip({ trip, departure, stopCode, now, stale }: {
  trip: TripPayload; departure: Departure; stopCode: string; now: number; stale: boolean;
}) {
  const [showMap, setShowMap] = useState(false);
  const progress = useMemo(() => locateBus(trip.stops, stopCode, departure, now), [trip, stopCode, departure, now]);
  if (!progress) return null;

  const start = Math.max(0, progress.target - WINDOW);
  const shown = trip.stops.slice(start, progress.target + 1);
  const span = Math.max(1, shown.length - 1);
  const pct = (index: number) => Math.min(100, Math.max(0, ((index - start) / span) * 100));
  const busPct = progress.position < start ? 0 : pct(progress.position);
  const behind = progress.position < start;
  const gps = progress.source === "gps";
  const { headline, detail } = describe(progress, trip, departure);
  const fleet = departure.vehicle?.fleet ? "Bus " + departure.vehicle.fleet + " · " : "";
  const note = stale ? "Old data"
    : progress.offRoute != null ? "Off its usual path"
    : progress.source === "gps" ? fleet + "GPS " + ageLabel(progress.gpsAge ?? 0)
    : "Timetable estimate";

  return (
    <section className="tracker" aria-labelledby="tracker-title">
      <div className="section-heading">
        <h2 id="tracker-title" className="section-title">Where's the bus</h2>
        <span className={"section-note" + (progress.source === "gps" && !stale ? " is-live" : "")}>{note}</span>
      </div>
      <div className="tracker-card">
        {/* Keyed by trip so a new bus starts in place instead of sliding over from the last one. */}
        <div className="strip" key={trip.tripUid} role="img" aria-label={`${headline}. ${detail}`}>
          <div className="strip-line">
            <div className="strip-done" style={{ transform: `translateX(${busPct - 100}%)` }} />
          </div>
          {shown.map((stop, k) => {
            const index = start + k;
            const cls = index === progress.target ? "is-yours" : index <= progress.position ? "is-passed" : "";
            return <span key={stop.code + index} className={"strip-stop " + cls} style={{ left: pct(index) + "%" }} />;
          })}
          <span className="strip-bus-track" style={{ transform: `translateX(${busPct}%)` }}>
            <span className={"strip-bus" + (gps ? " is-gps" : "") + (behind || progress.position < 0 ? " is-behind" : "")}>
              <BusGlyph />
              {gps && !stale && <span key={departure.vehicle?.updated ?? ""} className="strip-bus-ping" />}
            </span>
          </span>
        </div>
        <div className="strip-labels">
          <span>{start > 0 ? "… " : ""}{shortStopName(trip.stops[start].name)}</span>
          <span className="strip-yours">Your stop</span>
        </div>
        <div className="tracker-summary">
          <div>
            <strong className="tracker-headline">{headline}</strong>
            <p className="tracker-detail">{detail}</p>
          </div>
          <button type="button" className="map-toggle" aria-expanded={showMap} onClick={() => setShowMap(v => !v)}>
            {showMap ? "Hide map" : "Map"}
          </button>
        </div>
        {showMap && (
          <Suspense fallback={<div className="route-map is-loading">Loading map…</div>}>
            <RouteMap trip={trip} progress={progress} vehicle={progress.source === "gps" ? departure.vehicle ?? null : null} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
