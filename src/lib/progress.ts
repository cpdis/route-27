import type { Departure, TripStop } from "../../lib/transperth";

export type ProgressState =
  | "previous-run"  // the bus is still finishing the trip before this one
  | "waiting"       // at or near the first stop, before departure time
  | "en-route"
  | "at-your-stop"
  | "passed";

export type Progress = {
  source: "gps" | "timetable";
  state: ProgressState;
  /** Fractional stop index along the trip: 4.5 is halfway from stop 4 to stop 5. -1 means before the first stop. */
  position: number;
  /** Index of the selected stop in the trip. */
  target: number;
  /** Stops still to come before (and including) yours. 0 at your stop. */
  stopsAway: number;
  /** Last stop the bus reached, or the one it is waiting at. */
  nearStop: TripStop | null;
  /** Seconds since the GPS fix, when the position comes from GPS. */
  gpsAge: number | null;
  /** Distance from the route line in metres, when the fix looks off-route. */
  offRoute: number | null;
};

const SNAP_M = 35;          // within this of a stop counts as at the stop
const ON_ROUTE_M = 120;     // a fix this close to a segment is on that segment
const OFF_ROUTE_M = 300;    // beyond this the bus is treated as off its path
const ORIGIN_M = 300;       // how close to the first stop counts as "waiting there"
const GPS_MAX_AGE_S = 240;  // older fixes fall back to the timetable

type XY = { x: number; y: number };

function projector(lat0: number) {
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  return (lat: number, lon: number): XY => ({ x: lon * kx, y: lat * ky });
}

function distance(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Project a point onto each segment; returns [segment index, fraction 0..1, metres from line]. */
export function projectOnto(stops: TripStop[], lat: number, lon: number): Array<{ i: number; t: number; d: number; len: number }> {
  if (stops.length < 2) return [];
  const p = projector(stops[0].lat);
  const point = p(lat, lon);
  const out = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = p(stops[i].lat, stops[i].lon);
    const b = p(stops[i + 1].lat, stops[i + 1].lon);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    out.push({ i, t, d: distance(point, q), len: Math.sqrt(len2) });
  }
  return out;
}

/** Where the timetable says the bus is, shifted by the live delay. */
export function timetablePosition(stops: TripStop[], at: number): number {
  const times = stops.map(s => (s.time ? Date.parse(s.time) : NaN));
  const first = times.findIndex(Number.isFinite);
  if (first < 0) return -1;
  if (at < times[first]) return -1;
  let lastKnown = first;
  for (let i = first + 1; i < stops.length; i++) {
    if (!Number.isFinite(times[i])) continue;
    if (at < times[i]) {
      const span = times[i] - times[lastKnown];
      const frac = span > 0 ? (at - times[lastKnown]) / span : 0;
      return lastKnown + frac * (i - lastKnown);
    }
    lastKnown = i;
  }
  return lastKnown;
}

function snap(seg: { i: number; t: number; len: number }): number {
  const along = seg.t * seg.len;
  if (along <= SNAP_M) return seg.i;
  if (seg.len - along <= SNAP_M) return seg.i + 1;
  return seg.i + seg.t;
}

function finish(position: number, target: number, stops: TripStop[], base: Omit<Progress, "position" | "target" | "stopsAway" | "nearStop" | "state">, state?: ProgressState): Progress {
  const atTarget = Math.abs(position - target) < 1e-6;
  const resolved: ProgressState = state ?? (atTarget ? "at-your-stop" : position > target ? "passed" : "en-route");
  const reached = position < 0 ? null : stops[Math.min(stops.length - 1, Math.floor(position + 1e-6))];
  return {
    ...base,
    state: resolved,
    position,
    target,
    stopsAway: Math.max(0, target - Math.floor(Math.max(position, -1) + 1e-6)),
    nearStop: reached ?? null,
  };
}

/**
 * Locate a departure's bus along its trip. Uses the GPS fix when it is fresh and
 * near the route (choosing among overlapping segments by the timetable), else the
 * timetable shifted by the live delay.
 */
export function locateBus(stops: TripStop[], targetCode: string, departure: Departure, now: number): Progress | null {
  const target = stops.findIndex(s => s.code === targetCode);
  if (target < 0 || stops.length < 2) return null;
  const targetTime = stops[target].time ? Date.parse(stops[target].time!) : Date.parse(departure.scheduled);
  const delay = Number.isFinite(targetTime) ? Date.parse(departure.expected) - targetTime : 0;
  const expectedIndex = timetablePosition(stops, now - delay);
  const firstTime = stops[0].time ? Date.parse(stops[0].time) + Math.max(0, delay) : NaN;
  const beforeStart = Number.isFinite(firstTime) && now < firstTime;

  const vehicle = departure.vehicle;
  const gpsAge = vehicle?.updated ? Math.max(0, (now - Date.parse(vehicle.updated)) / 1000) : null;
  const gpsUsable = Boolean(vehicle && departure.live && (gpsAge == null || gpsAge <= GPS_MAX_AGE_S));

  if (gpsUsable && vehicle) {
    const base = { source: "gps" as const, gpsAge, offRoute: null };
    const segments = projectOnto(stops, vehicle.lat, vehicle.lon);
    if (beforeStart) {
      const p = projector(stops[0].lat);
      const fromOrigin = distance(p(vehicle.lat, vehicle.lon), p(stops[0].lat, stops[0].lon));
      return finish(fromOrigin <= ORIGIN_M ? 0 : -1, target, stops, base, fromOrigin <= ORIGIN_M ? "waiting" : "previous-run");
    }
    const near = segments.filter(s => s.d <= ON_ROUTE_M);
    if (near.length > 0) {
      // Routes double back on themselves; the timetable breaks ties between candidate segments.
      const pick = near.reduce((best, s) => {
        const score = Math.abs(s.i + s.t - expectedIndex);
        const bestScore = Math.abs(best.i + best.t - expectedIndex);
        return score < bestScore ? s : best;
      });
      return finish(snap(pick), target, stops, base);
    }
    const nearest = segments.reduce((best, s) => (s.d < best.d ? s : best));
    if (nearest.d <= OFF_ROUTE_M) return finish(snap(nearest), target, stops, base);
    // Far off the line (detour or bad fix): fall through to the timetable, but say so.
    const fallback = expectedIndex < 0 ? -1 : expectedIndex;
    return finish(fallback, target, stops, { source: "timetable", gpsAge, offRoute: Math.round(nearest.d) },
      fallback < 0 ? "waiting" : undefined);
  }

  const base = { source: "timetable" as const, gpsAge: null, offRoute: null };
  if (expectedIndex < 0) return finish(-1, target, stops, base, "waiting");
  return finish(expectedIndex, target, stops, base);
}

/** "St Georges Tce Stand 32 - Cat Id 21" → "St Georges Tce Stand 32". */
export function shortStopName(name: string): string {
  return name
    .replace(/\s*-?\s*Cat Id \d+\s*$/i, "")
    .replace(/\s+-\s+(Before|After)\s+/i, " · $1 ")
    .replace(/\s+/g, " ")
    .trim();
}
