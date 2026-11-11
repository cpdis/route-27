// Transperth's SilverRail website endpoints (unofficial, token-guarded).
// Adapted from the public MIT-licensed aiotransperth project by Chris112.
// Server-side only: avoids CORS and keeps the upstream request shape in one place.

const BASE = "https://www.transperth.wa.gov.au";
const SILVERRAIL = BASE + "/API/SilverRailRestService/SilverRailService";
const STOP_API = SILVERRAIL + "/GetStopTimetableAsync";
const TRIP_API = SILVERRAIL + "/GetTimetableTripAsync";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const NOTE_CODES = "DV,LM,CM,TC,BG,FG,LK";
export const ROUTE = "27";

export const STOPS = {
  "10106": { short: "Subiaco", name: "Bagot Rd before Rowland St", direction: "Towards Perth", destination: "East Perth" },
  "10091": { short: "Perth CBD", name: "St Georges Tce · Stand 32", direction: "Towards Subiaco", destination: "Claremont" },
} as const;
export type StopId = keyof typeof STOPS;
export const VALID_STOPS = STOPS;
export function isStopId(value: unknown): value is StopId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(STOPS, value);
}

export type Vehicle = {
  lat: number;
  lon: number;
  bearing: number | null;
  /** When Transperth last heard from the bus (ISO, minute precision). */
  updated: string | null;
  fleet: string | null;
};
export type TripRef = {
  uid: string;
  routeUid: string;
  /** Transperth's direction flag: "0" towards Perth/East Perth, "1" towards Subiaco/Claremont. */
  direction: "0" | "1";
  /** Perth-local service date of the trip, YYYY-MM-DD. */
  date: string;
  start: string | null;
  origin: string | null;
};
export type Departure = {
  id: string;
  route: "27";
  destination: string;
  scheduled: string;
  expected: string;
  live: boolean;
  delayMinutes: number | null;
  status: string;
  cancelled?: boolean;
  trip?: TripRef | null;
  vehicle?: Vehicle | null;
};
export type DeparturesPayload = {
  stop: StopId;
  stopName: string;
  direction: string;
  destination: string;
  source: "Transperth";
  fetchedAt: string;
  departures: Departure[];
  stale?: boolean;
  warning?: string;
};
export type TripStop = {
  code: string;
  name: string;
  /** Scheduled time at this stop (ISO), or null when Transperth gives none. */
  time: string | null;
  lat: number;
  lon: number;
  timing: boolean;
};
export type TripPayload = {
  tripUid: string;
  routeUid: string;
  headsign: string;
  direction: "0" | "1";
  date: string;
  stops: TripStop[];
  fetchedAt: string;
};

export class UpstreamError extends Error {}
export class NotFoundError extends Error {}

// ---------------------------------------------------------------- time helpers

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function perthClock(now = new Date()): { date: string; time: string } {
  const pieces = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Perth", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const d = Object.fromEntries(pieces.map(x => [x.type, x.value]));
  return { date: d.year + "-" + d.month + "-" + d.day, time: d.hour + ":" + d.minute };
}

/** "2026-11-11T13:36" (Perth wall clock) → "2026-11-11T13:36:00+08:00". Perth has no DST. */
export function toIsoLocal(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const match = s.match(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/);
  return match ? match[1] + "T" + match[2] + ":00+08:00" : null;
}

/**
 * Bind a bare clock reading ("1:42pm", "13:42", "13:42:50") to the day of `anchor`,
 * choosing whichever day keeps it within 12 hours of the anchor (handles midnight wrap).
 */
export function clockNear(display: unknown, anchor: string): string | null {
  const raw = String(display ?? "").replace(/\s/g, "").toLowerCase();
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (m[4]) {
    if (hh < 1 || hh > 12) return null;
    hh = (hh % 12) + (m[4] === "pm" ? 12 : 0);
  }
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const anchorMs = Date.parse(anchor);
  if (!Number.isFinite(anchorMs)) return null;
  const midnight = Date.parse(anchor.slice(0, 10) + "T00:00:00+08:00");
  let value = midnight + hh * HOUR_MS + mm * 60_000 + ss * 1000;
  if (value - anchorMs > 12 * HOUR_MS) value -= DAY_MS;
  if (anchorMs - value > 12 * HOUR_MS) value += DAY_MS;
  return new Date(value).toISOString();
}

// ------------------------------------------------------------------- parsing

function parseVehicle(info: any): Vehicle | null {
  if (!info || typeof info !== "object") return null;
  const parts = String(info.CurrentPosition ?? "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const [lat, lon] = parts;
  // Anything outside greater Perth is a bad fix, not a bus.
  if (lat < -33 || lat > -31 || lon < 115 || lon > 117) return null;
  const bearing = Number(info.CurrentBearing);
  return {
    lat, lon,
    bearing: info.CurrentBearing != null && Number.isFinite(bearing) ? bearing : null,
    updated: toIsoLocal(info.LastUpdated),
    fleet: info.FleetNumber ? String(info.FleetNumber) : null,
  };
}

function parseTripRef(entry: any, scheduled: string): TripRef | null {
  const summary = entry?.Summary || {};
  const uid = String(summary.TripUid || "");
  const routeUid = String(summary.RouteUid || "");
  if (!uid || !routeUid) return null;
  const start = toIsoLocal(summary.TripStartTime);
  const date = String(summary.TripStartTime || scheduled).slice(0, 10);
  return {
    uid, routeUid,
    direction: String(summary.Direction) === "1" ? "1" : "0",
    date,
    start,
    origin: entry?.Origin?.Name ? String(entry.Origin.Name) : null,
  };
}

/** Turn a raw GetStopTimetableAsync body into the public payload (route 27 only). */
export function parseStopTimetable(body: any, stop: StopId, now = Date.now()): DeparturesPayload {
  if (body?.result !== "success" || !body?.stop) {
    throw new UpstreamError("Unexpected Transperth timetable response");
  }
  const rows: Departure[] = [];
  for (const entry of (Array.isArray(body.trips) ? body.trips : [])) {
    const summary = entry?.Summary || {};
    if (String(summary.RouteCode || "").trim() !== ROUTE) continue;
    const scheduled = toIsoLocal(entry.DepartTime || entry.ArriveTime);
    if (!scheduled) continue;
    const live = Boolean(entry.IsRealTime);
    const realtime = entry.RealTimeInfo || null;
    const cancelled = Boolean(realtime?.IsCancelled || summary?.RealTimeInfo?.IsCancelled);
    // Minute-level estimate as Transperth displays it: drives the delay label so it matches the official board.
    const displayed = live ? clockNear(entry.DisplayTripStatus, scheduled) : null;
    // Seconds-level estimate when present: drives the countdown.
    const precise = live ? clockNear(realtime?.EstimatedDepartureTime || realtime?.EstimatedArrivalTime, scheduled) : null;
    const expected = precise ?? displayed ?? scheduled;
    const delaySource = displayed ?? precise;
    const delayMinutes = delaySource ? Math.round((Date.parse(delaySource) - Date.parse(scheduled)) / 60000) : null;
    const destination = String(summary.Headsign || entry?.Destination?.Name || STOPS[stop].destination).trim();
    rows.push({
      id: String(summary.TripUid || scheduled + destination),
      route: ROUTE, destination,
      scheduled, expected, live, delayMinutes,
      status: cancelled ? "Cancelled" : String(entry.RealTimeStopStatusDetail || (live ? "Live" : "Scheduled")),
      ...(cancelled ? { cancelled: true } : {}),
      trip: parseTripRef(entry, scheduled),
      vehicle: live ? parseVehicle(summary.RealTimeInfo) : null,
    });
  }
  const unique = new Map<string, Departure>();
  for (const row of rows) unique.set(row.id + row.scheduled, row);
  const sorted = [...unique.values()].sort((a, b) => Date.parse(a.expected) - Date.parse(b.expected));
  return {
    stop, stopName: String(body.stop.Description || STOPS[stop].name),
    direction: STOPS[stop].direction, destination: STOPS[stop].destination,
    source: "Transperth", fetchedAt: new Date(now).toISOString(),
    departures: sorted.filter(d => Date.parse(d.expected) > now - 60000).slice(0, 12),
  };
}

/** Turn a raw GetTimetableTripAsync body into an ordered stop list with absolute times. */
export function parseTrip(body: any, ref: { tripUid: string; routeUid: string; date: string; direction: "0" | "1" }, now = Date.now()): TripPayload {
  const data = body?.data;
  if (body?.result !== "success" || !data || !Array.isArray(data.TripStopTimings)) {
    throw new UpstreamError("Unexpected Transperth trip response");
  }
  const stops: TripStop[] = [];
  let previous: number | null = null;
  for (const timing of data.TripStopTimings) {
    const stop = timing?.Stop || {};
    const lat = Number(stop.Latitude);
    const lon = Number(stop.Longitude);
    if (!stop.Code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const clock = String(timing.DepartTime || timing.ArrivalTime || "");
    let time: string | null = null;
    const m = clock.match(/^(\d{1,2}):(\d{2})/);
    if (m) {
      // Timetables can run past midnight as "24:10" or wrap to "00:10"; keep times monotonic.
      const hh = Number(m[1]);
      const base = Date.parse(ref.date + "T00:00:00+08:00");
      let value = base + hh * HOUR_MS + Number(m[2]) * 60_000;
      if (previous != null) {
        while (value < previous - 6 * HOUR_MS) value += DAY_MS;
      }
      previous = value;
      time = new Date(value).toISOString();
    }
    stops.push({
      code: String(stop.Code),
      name: String(stop.Description || stop.Code).trim(),
      time,
      lat, lon,
      timing: Boolean(timing.IsTimingPoint),
    });
  }
  if (stops.length < 2) throw new UpstreamError("Trip has too few stops");
  return {
    tripUid: ref.tripUid,
    routeUid: ref.routeUid,
    headsign: String(data.Headsign || "").trim(),
    direction: ref.direction,
    date: ref.date,
    stops,
    fetchedAt: new Date(now).toISOString(),
  };
}

// --------------------------------------------------------------- upstream I/O

type Context = "stop" | "route";
const CONTEXTS: Record<Context, { moduleId: string; tabId: string; page: (ref: string) => string }> = {
  // Stop pages and route pages issue different tokens, each valid only with its own module headers.
  stop: { moduleId: "5310", tabId: "141", page: ref => BASE + "/Journey-Planner/Stops-Near-You?locationtype=stop&location=" + ref },
  route: { moduleId: "5345", tabId: "133", page: ref => BASE + "/timetables/details?Bus=" + ref },
};

type Token = { verification: string; cookie: string; expires: number };
const tokens = new Map<string, Token>();
const blockedUntil = new Map<string, number>();
const TOKEN_TTL_MS = 15 * 60_000;
const BLOCK_MS = 180_000;

export function tokenFromPage(html: string): string | null {
  for (const tag of html.match(/<input\b[^>]*>/gi) || []) {
    if (!/\bname\s*=\s*["']__RequestVerificationToken["']/i.test(tag)) continue;
    return tag.match(/\bvalue\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  }
  return null;
}
function getCookie(resp: Response): string {
  const values = typeof resp.headers.getSetCookie === "function"
    ? resp.headers.getSetCookie() : [resp.headers.get("set-cookie") || ""];
  return values.map(s => s.split(";")[0]).filter(Boolean).join("; ");
}
async function verificationFor(context: Context, ref: string, fresh: boolean): Promise<Token> {
  const key = context + ":" + ref;
  const prior = tokens.get(key);
  if (!fresh && prior && prior.expires > Date.now()) return prior;
  const resp = await fetch(CONTEXTS[context].page(ref), {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new UpstreamError("Transperth token page HTTP " + resp.status);
  const verification = tokenFromPage(await resp.text());
  if (!verification) throw new UpstreamError("Verification token missing from Transperth page");
  const result = { verification, cookie: getCookie(resp), expires: Date.now() + TOKEN_TTL_MS };
  tokens.set(key, result);
  return result;
}

/** Token-authenticated form POST, retrying once with a fresh token on 401. */
async function silverRailPost(context: Context, ref: string, url: string, form: Record<string, string>): Promise<any> {
  const key = context + ":" + ref;
  if ((blockedUntil.get(key) || 0) > Date.now()) {
    throw new UpstreamError("Transperth temporarily rate-limited requests");
  }
  const referer = CONTEXTS[context].page(ref);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await verificationFor(context, ref, attempt > 0);
    const headers: Record<string, string> = {
      "RequestVerificationToken": token.verification,
      "ModuleId": CONTEXTS[context].moduleId,
      "TabId": CONTEXTS[context].tabId,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": USER_AGENT,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer,
      "Origin": BASE,
    };
    if (token.cookie) headers.Cookie = token.cookie;
    const response = await fetch(url, {
      method: "POST", headers, body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(14000),
    });
    if (response.status === 401 && attempt === 0) {
      tokens.delete(key);
      continue;
    }
    if (response.status === 429) {
      blockedUntil.set(key, Date.now() + BLOCK_MS);
      throw new UpstreamError("Transperth rate limit reached; next retry deferred");
    }
    if (!response.ok) throw new UpstreamError("Transperth HTTP " + response.status + " from " + url.split("/").pop());
    try {
      return await response.json();
    } catch {
      throw new UpstreamError("Non-JSON response from Transperth");
    }
  }
  throw new UpstreamError("Transperth verification failed");
}

// ----------------------------------------------------------- cached readers

const CACHE_AGE_MS = 25_000;
const STALE_AGE_MS = 30 * 60_000;
const departuresCache = new Map<StopId, { at: number; value: DeparturesPayload }>();
const departuresPending = new Map<StopId, Promise<DeparturesPayload>>();

/**
 * Departures for one stop. The CDN is the main cache; this in-memory layer only
 * dedupes bursts on a warm instance and keeps a last-good copy for short outages.
 */
export async function readDepartures(stop: StopId): Promise<DeparturesPayload> {
  const previous = departuresCache.get(stop);
  if (previous && Date.now() - previous.at < CACHE_AGE_MS) return previous.value;
  const inflight = departuresPending.get(stop);
  if (inflight) return inflight;
  const task = (async () => {
    try {
      const { date, time } = perthClock();
      const body = await silverRailPost("stop", stop, STOP_API, {
        StopNumber: stop, SearchDate: date, SearchTime: time,
        IsRealTimeChecked: "true", ReturnNoteCodes: NOTE_CODES,
        MaxTripCount: "100",
      });
      const fresh = parseStopTimetable(body, stop);
      departuresCache.set(stop, { at: Date.now(), value: fresh });
      return fresh;
    } catch (e) {
      console.error("Route 27 stop " + stop + ": " + String(e));
      if (previous && Date.now() - previous.at <= STALE_AGE_MS) {
        return { ...previous.value, stale: true, warning: "Departure feed unavailable; last-known data" };
      }
      throw e;
    } finally { departuresPending.delete(stop); }
  })();
  departuresPending.set(stop, task);
  return task;
}

const tripCache = new Map<string, TripPayload>();
const TRIP_CACHE_MAX = 60;

export const TRIP_UID_RE = /^PerthRestricted:\d{1,12}$/;
export const ROUTE_UID_RE = /^PerthRestricted:[A-Z]{2,6}-[A-Z]{2,6}-\d{1,8}$/;
export const DATE_RE = /^\d{4}-\d\d-\d\d$/;

/** Every stop on one route 27 trip. Patterns are fixed for the day, so this caches hard. */
export async function readTrip(ref: { tripUid: string; routeUid: string; date: string; direction: "0" | "1" }): Promise<TripPayload> {
  const key = [ref.tripUid, ref.date].join("|");
  const hit = tripCache.get(key);
  if (hit) return hit;
  const directions: Array<"inbound" | "outbound"> = ref.direction === "1" ? ["inbound", "outbound"] : ["outbound", "inbound"];
  let body: any = null;
  for (const dir of directions) {
    // The API answers data:null when the direction is wrong; aiotransperth retries the opposite one.
    body = await silverRailPost("route", ROUTE, TRIP_API, {
      RouteUid: ref.routeUid, TripUid: ref.tripUid, TripDate: ref.date,
      TripDirection: dir, ReturnNoteCodes: NOTE_CODES,
    });
    if (body?.data) break;
  }
  if (!body?.data) throw new NotFoundError("Trip not found");
  const trip = parseTrip(body, ref);
  // Refuse to act as a general proxy: the trip must serve one of our two stops.
  if (!trip.stops.some(s => isStopId(s.code))) throw new NotFoundError("Not a route 27 trip for these stops");
  if (tripCache.size >= TRIP_CACHE_MAX) tripCache.delete(tripCache.keys().next().value!);
  tripCache.set(key, trip);
  return trip;
}

/** Test hook: forget tokens and caches between tests. */
export function resetForTests(): void {
  tokens.clear();
  blockedUntil.clear();
  departuresCache.clear();
  departuresPending.clear();
  tripCache.clear();
}
