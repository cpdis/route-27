import { useEffect, useMemo, useState } from "react";
import type { Departure } from "../lib/transperth";
import AlertBanner from "./components/AlertBanner";
import LeaveCue from "./components/LeaveCue";
import RouteStrip from "./components/RouteStrip";
import { STOPS, STOP_IDS, isStop, type StopId } from "./config";
import { useAlerts } from "./hooks/useAlerts";
import { useDepartures } from "./hooks/useDepartures";
import { useTrip } from "./hooks/useTrip";
import { countdownLabel, formatDate, formatHour, formatLocalTime, minuteCount, updateAge } from "./lib/format";
import { leaveCue, type LeaveCue as Cue } from "./lib/leave";

const STOP_KEY = "subiaco-route27-stop";

function initialStop(): StopId {
  const param = new URLSearchParams(window.location.search).get("stop");
  if (isStop(param)) return param;
  try {
    const saved = localStorage.getItem(STOP_KEY);
    if (isStop(saved)) return saved;
  } catch { /* private browsing */ }
  return Number(formatHour.format(new Date())) >= 12 ? "10091" : "10106";
}
function RefreshIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.6 6.1"/><path d="M20 4v7h-7"/>
    </svg>
  );
}
function OutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 5h6v6M19 5l-9 9M19 13v6H5V5h6"/>
    </svg>
  );
}
function StatusBadge({ departure, stale }: { departure: Departure; stale: boolean }) {
  const cls = stale ? "is-stale" : departure.live ? "" : "is-scheduled";
  const text = stale ? "OLD DATA" : departure.live ? "LIVE" : "SCHEDULED";
  return <span className={"status-pill " + cls}><i className="status-dot" aria-hidden="true" />{text}</span>;
}
function NextDeparture({ departure, now, stale, loading, cue, walkMinutes }: {
  departure: Departure | undefined; now: number; stale: boolean; loading: boolean;
  cue: Cue | null; walkMinutes: number;
}) {
  const late = Boolean(departure?.live && departure.delayMinutes != null && departure.delayMinutes !== 0);
  return (
    <section className="hero" aria-label="Next route 27 departure">
      <div className="hero-top">
        <span className="hero-label">Next route 27</span>
        {departure && <StatusBadge departure={departure} stale={stale} />}
      </div>
      {departure ? (
        <>
          <div className="hero-countdown" aria-label={countdownLabel(departure.expected, now)}>
            <span className="hero-digits">{minuteCount(departure.expected, now)}</span>
            <span className="hero-minutes">min</span>
          </div>
          <LeaveCue cue={cue} walkMinutes={walkMinutes} />
          <div className="hero-divider" />
          <div className="hero-bottom">
            <div className="hero-bottom-left">
              <span className="hero-small">Towards</span>
              <strong className="hero-destination">{departure.destination}</strong>
            </div>
            <div className="hero-bottom-right">
              <div className="hero-time">{formatLocalTime.format(new Date(departure.expected))}</div>
              <div className="hero-time-note">
                {late ? (
                  (departure.delayMinutes! > 0 ? "+" : "") + departure.delayMinutes + " min vs timetable"
                ) : departure.live ? "Live estimate" : "Timetabled"}
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="hero-empty">
          <div className="hero-empty-title">{loading ? "Checking departures…" : "No upcoming departures"}</div>
          <p className="hero-empty-copy">
            {loading ? "Looking for your next Route 27 on Transperth." :
              "No Route 27 departures currently reported within the available timetable window."}
          </p>
        </div>
      )}
    </section>
  );
}
function DepartureItem({ departure, now, stale }: {
  departure: Departure; now: number; stale: boolean;
}) {
  const mins = minuteCount(departure.expected, now);
  const late = Boolean(departure.live && departure.delayMinutes != null && departure.delayMinutes !== 0);
  const diff = departure.delayMinutes ?? 0;
  const cancelled = Boolean(departure.cancelled);
  return (
    <li className={"departure-row" + (cancelled ? " is-cancelled" : "")}>
      <div className="row-count" aria-label={cancelled ? "Cancelled" : countdownLabel(departure.expected, now)}>
        <span className="row-count-num">{mins}</span><span className="row-count-unit">min</span>
      </div>
      <div>
        <div className="row-destination">{departure.destination}</div>
        <div className="row-details">
          {cancelled ? <span className="row-cancelled">Cancelled</span> : (
            <span className={departure.live && !stale ? "row-live" : ""}>
              {departure.live && !stale ? "● Live" : "Scheduled"}
            </span>
          )}
          {late && !stale && !cancelled &&
            <span className="row-delay">{diff > 0 ? "+" : ""}{diff} min</span>}
        </div>
      </div>
      <div className="row-right">
        <time className="row-time" dateTime={departure.expected}>
          {formatLocalTime.format(new Date(departure.expected))}
        </time>
        {late && <span className="row-original">
          {formatLocalTime.format(new Date(departure.scheduled))}
        </span>}
      </div>
    </li>
  );
}

export default function App() {
  const [stop, setStop] = useState<StopId>(initialStop);
  const [now, setNow] = useState(Date.now());
  const { feed: currentFeed, error, updating, reload } = useDepartures(stop);
  const { alerts, dismiss } = useAlerts();

  useEffect(() => {
    try { localStorage.setItem(STOP_KEY, stop); } catch { /* optional */ }
    const url = new URL(location.href);
    url.searchParams.set("stop", stop);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [stop]);

  useEffect(() => {
    // 10 s keeps "leave now" honest without busy re-rendering.
    const clockTimer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(clockTimer);
  }, []);
  useEffect(() => { if (currentFeed) setNow(Date.now()); }, [currentFeed]);

  const dataAge = currentFeed ? now - Date.parse(currentFeed.fetchedAt) : Infinity;
  const stale = Boolean(currentFeed && (currentFeed.stale || dataAge > 5 * 60_000));
  const currentDepartures = useMemo(() => (
    currentFeed?.departures || []
  ).filter(d => Number.isFinite(Date.parse(d.expected)) && Date.parse(d.expected) >= now - 30_000)
    .sort((a, b) => Date.parse(a.expected) - Date.parse(b.expected)), [currentFeed, now]);
  const next = currentDepartures.find(d => !d.cancelled);
  const following = currentDepartures.filter(d => d !== next).slice(0, 6);
  const loading = updating && !currentFeed;
  const selected = STOPS[stop];
  const cue = useMemo(() => leaveCue(currentDepartures, selected.walkMinutes, now), [currentDepartures, selected.walkMinutes, now]);
  const trip = useTrip(next?.trip);
  const officialUrl = "https://136213.mobi/RealTime/QRRealTimeStopResults.aspx?SN=" + stop;
  return (
    <div className="route-app">
      <main className="content">
        <div className="topline">
          <div className="topline-brand">
            <span className={"brand-dot " + (error || stale ? "is-offline" : "")} />
            Transperth / Departures
          </div>
          <time className="local-time" dateTime={new Date(now).toISOString()}>
            {formatLocalTime.format(new Date(now))}
          </time>
        </div>

        <header className="headline">
          <div className="route-number" aria-label="Bus route 27">27</div>
          <div className="headline-copy">
            <div className="headline-eyebrow">Your bus</div>
            <h1 className="headline-title">Subiaco ↔ Perth</h1>
            <p className="headline-subtitle">Route 27 · {formatDate.format(new Date(now))}</p>
          </div>
        </header>

        <nav className="stop-selector" aria-label="Select departure stop">
          {STOP_IDS.map(id => {
            const item = STOPS[id];
            return (
              <button key={id} type="button" className={"stop-option " + (id === stop ? "is-selected" : "")}
                aria-pressed={id === stop} onClick={() => { if (id !== stop) setStop(id); }}>
                <span className="stop-option-title">
                  {item.place}
                  {id === stop && <span className="selected-check" aria-hidden="true" />}
                </span>
                <span className="stop-option-caption">{item.direction}</span>
                <span className="stop-option-code">Stop {id}</span>
              </button>
            );
          })}
        </nav>

        <div className="stop-detail">
          <div className="stop-detail-main">
            <div className="stop-detail-label">{selected.direction} · Stop {stop}</div>
            <div className="stop-detail-name">{selected.location}</div>
          </div>
          <button className="refresh-button" type="button" onClick={reload}
            disabled={updating} aria-label="Refresh departures" title="Refresh departures">
            <RefreshIcon />
          </button>
        </div>

        <AlertBanner alerts={alerts} onDismiss={dismiss} variant="active" />

        {(stale || error) && (
          <aside className="feedback" role="status">
            <span aria-hidden="true">!</span>
            <span>
              {error ? error + (currentFeed ? " Showing the last departures this phone saw." : "") :
                "Live updates interrupted. Displaying previously retrieved departures."}{" "}
              <a href={officialUrl} target="_blank" rel="noopener noreferrer">Check Transperth ↗</a>
            </span>
          </aside>
        )}

        <NextDeparture departure={next} now={now} stale={stale} loading={loading}
          cue={stale ? null : cue} walkMinutes={selected.walkMinutes} />

        {next && trip && <RouteStrip trip={trip} departure={next} stopCode={stop} now={now} stale={stale} />}

        <section aria-labelledby="upcoming-title">
          <div className="section-heading">
            <h2 id="upcoming-title" className="section-title">Following departures</h2>
            <span className="section-note">PERTH LOCAL TIME</span>
          </div>
          {following.length > 0 ? (
            <ol className="departure-list">
              {following.map(departure => <DepartureItem
                key={departure.id + departure.scheduled} departure={departure} now={now} stale={stale} />)}
            </ol>
          ) : (
            <div className="empty-list">
              {loading ? "Checking for later services…" : "No additional Route 27 times currently available."}
            </div>
          )}
        </section>

        <AlertBanner alerts={alerts} onDismiss={dismiss} variant="upcoming" />

        <footer className="footer">
          <div className="footer-row">
            <div>
              <div className="footer-status" role="status">
                <span className={"footer-light " + (stale || error ? "is-warning" : "")} />
                {error ? "Connection interrupted" :
                  updating ? "Checking Transperth…" :
                  currentFeed ? updateAge(currentFeed.fetchedAt, now) : "Connecting…"}
              </div>
              <div className="footer-note">Checks every minute · Route 27 only</div>
            </div>
            <div className="footer-links">
              <a className="footer-link" href={officialUrl} target="_blank" rel="noopener noreferrer">
                Official stop <OutIcon />
              </a>
              <a className="footer-link footer-source" href="/source">View source</a>
            </div>
          </div>
          <p className="footer-disclosure">
            Live = vehicle-tracked estimate. Scheduled = timetable only. Times may change.
            Independent display using public Transperth data. Map © OpenStreetMap contributors.
          </p>
        </footer>
      </main>
    </div>
  );
}
