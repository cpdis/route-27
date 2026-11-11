/** @jsxImportSource https://esm.sh/react@18.2.0 */
import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.2.0";
import { createRoot } from "https://esm.sh/react-dom@18.2.0/client?deps=react@18.2.0";

type StopId = "10106" | "10091";
type Departure = {
  id: string;
  route: "27";
  destination: string;
  scheduled: string;
  expected: string;
  live: boolean;
  delayMinutes: number | null;
  status: string;
};
type Feed = {
  stop: StopId;
  stopName: string;
  direction: string;
  destination: string;
  fetchedAt: string;
  departures: Departure[];
  stale?: boolean;
  warning?: string;
};
const STOPS = {
  "10106": { place: "Subiaco", direction: "To Perth", location: "Bagot Rd · before Rowland St" },
  "10091": { place: "Perth CBD", direction: "To Subiaco", location: "St Georges Tce · Stand 32" },
} as const;
const formatLocalTime = new Intl.DateTimeFormat("en-AU", {
  hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Australia/Perth",
});
const formatDate = new Intl.DateTimeFormat("en-AU", {
  weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Perth",
});
const formatHour = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", hourCycle: "h23", timeZone: "Australia/Perth",
});
function initialStop(): StopId {
  const param = new URLSearchParams(window.location.search).get("stop");
  if (param === "10106" || param === "10091") return param;
  try {
    const saved = localStorage.getItem("subiaco-route27-stop");
    if (saved === "10106" || saved === "10091") return saved;
  } catch { /* private browsing */ }
  return Number(formatHour.format(new Date())) >= 12 ? "10091" : "10106";
}
function minuteCount(date: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(date) - now) / 60_000));
}
function countdownLabel(date: string, now: number): string {
  const minutes = minuteCount(date, now);
  return minutes < 1 ? "Due now" : minutes + " min";
}
function updateAge(fetchedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 1000));
  if (seconds < 60) return "Updated just now";
  const minutes = Math.floor(seconds / 60);
  return "Updated " + minutes + " min ago";
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
function NextDeparture({ departure, now, stale, loading }: {
  departure: Departure | undefined; now: number; stale: boolean; loading: boolean;
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
  return (
    <li className="departure-row">
      <div className="row-count" aria-label={countdownLabel(departure.expected, now)}>
        <span className="row-count-num">{mins}</span><span className="row-count-unit">min</span>
      </div>
      <div>
        <div className="row-destination">{departure.destination}</div>
        <div className="row-details">
          <span className={departure.live && !stale ? "row-live" : ""}>
            {departure.live && !stale ? "● Live" : "Scheduled"}
          </span>
          {late && !stale &&
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
function App() {
  const [stop, setStop] = useState<StopId>(initialStop);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(true);
  const [now, setNow] = useState(Date.now());
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    try { localStorage.setItem("subiaco-route27-stop", stop); } catch { /* optional */ }
    const url = new URL(location.href);
    url.searchParams.set("stop", stop);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [stop]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    setFeed(null);
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
        setNow(Date.now());
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

  const currentFeed = feed?.stop === stop ? feed : null;
  const dataAge = currentFeed ? now - Date.parse(currentFeed.fetchedAt) : Infinity;
  const stale = Boolean(currentFeed && (currentFeed.stale || dataAge > 5 * 60_000));
  const currentDepartures = useMemo(() => (
    currentFeed?.departures || []
  ).filter(d => Number.isFinite(Date.parse(d.expected)) && Date.parse(d.expected) >= now - 30_000)
    .sort((a, b) => Date.parse(a.expected) - Date.parse(b.expected)), [currentFeed, now]);
  const next = currentDepartures[0];
  const following = currentDepartures.slice(1, 7);
  const loading = updating && !currentFeed;
  const selected = STOPS[stop];
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
          {(["10106", "10091"] as StopId[]).map(id => {
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
          <button className="refresh-button" type="button" onClick={() => reloadRef.current()}
            disabled={updating} aria-label="Refresh departures" title="Refresh departures">
            <RefreshIcon />
          </button>
        </div>

        {(stale || error) && (
          <aside className="feedback" role="status">
            <span aria-hidden="true">!</span>
            <span>
              {error || "Live updates interrupted. Displaying previously retrieved departures."}{" "}
              <a href={officialUrl} target="_blank" rel="noopener noreferrer">Check Transperth ↗</a>
            </span>
          </aside>
        )}

        <NextDeparture departure={next} now={now} stale={stale} loading={loading} />

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
            Independent display using public Transperth data.
          </p>
        </footer>
      </main>
    </div>
  );
}
const node = document.getElementById("app");
if (node) createRoot(node).render(<App />);
