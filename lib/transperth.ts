// Transperth's SilverRail stop-timetable endpoint (unofficial website API).
// Adapted from the public MIT-licensed aiotransperth project by Chris112.
// Server-side only: protects against CORS and makes a stop-specific response.
const BASE = "https://www.transperth.wa.gov.au";
const STOP_API = BASE + "/API/SilverRailRestService/SilverRailService/GetStopTimetableAsync";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const STOPS = {
  "10106": { short: "Subiaco", name: "Bagot Rd before Rowland St", direction: "Towards Perth", destination: "East Perth" },
  "10091": { short: "Perth CBD", name: "St Georges Tce · Stand 32", direction: "Towards Subiaco", destination: "Claremont" },
} as const;
export type StopId = keyof typeof STOPS;
export const VALID_STOPS = STOPS;

export type Departure = {
  id: string;
  route: "27";
  destination: string;
  scheduled: string;
  expected: string;
  live: boolean;
  delayMinutes: number | null;
  status: string;
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

type Token = { verification: string; cookie: string; expires: number };
const tokens = new Map<StopId, Token>();
const cached = new Map<StopId, { at: number; value: DeparturesPayload }>();
const pending = new Map<StopId, Promise<DeparturesPayload>>();
const CACHE_AGE_MS = 110_000;
const STALE_AGE_MS = 30 * 60_000;
const blockedUntil = new Map<StopId, number>();

function perthClock(): { date: string; time: string } {
  const pieces = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Perth", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const d = Object.fromEntries(pieces.map(x => [x.type, x.value]));
  return { date: d.year + "-" + d.month + "-" + d.day, time: d.hour + ":" + d.minute };
}
function toIsoLocal(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const match = s.match(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/);
  return match ? match[1] + "T" + match[2] + ":00+08:00" : null;
}
function expectedIso(display: unknown, scheduled: string): string | null {
  const raw = String(display ?? "").replace(/\s/g, "").toLowerCase();
  const m = raw.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (!m) return null;
  let hh = Number(m[1]);
  if (m[3]) hh = (hh % 12) + (m[3] === "pm" ? 12 : 0);
  if (hh > 23 || Number(m[2]) > 59) return null;
  const scheduledDate = new Date(scheduled);
  const midnight = Date.parse(scheduled.slice(0, 10) + "T00:00:00+08:00");
  let next = midnight + hh * 3_600_000 + Number(m[2]) * 60_000;
  // If a bare clock wraps midnight, bind it to the closest day.
  if (next - scheduledDate.getTime() > 12 * 3_600_000) next -= 86_400_000;
  if (scheduledDate.getTime() - next > 12 * 3_600_000) next += 86_400_000;
  return new Date(next).toISOString();
}
function tokenFromPage(html: string): string | null {
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
async function verificationFor(stop: StopId, fresh = false): Promise<Token> {
  const prior = tokens.get(stop);
  if (!fresh && prior && prior.expires > Date.now()) return prior;
  const url = BASE + "/Journey-Planner/Stops-Near-You?locationtype=stop&location=" + stop;
  const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept": "text/html" }, signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error("Transperth token page HTTP " + resp.status);
  const html = await resp.text();
  const verification = tokenFromPage(html);
  if (!verification) throw new Error("Verification token missing from Transperth stop page");
  const result = { verification, cookie: getCookie(resp), expires: Date.now() + 15 * 60_000 };
  tokens.set(stop, result);
  return result;
}
async function transperth(stop: StopId): Promise<DeparturesPayload> {
  const { date, time } = perthClock();
  const referer = BASE + "/Journey-Planner/Stops-Near-You?locationtype=stop&location=" + stop;
  const params = new URLSearchParams({
    StopNumber: stop, SearchDate: date, SearchTime: time,
    IsRealTimeChecked: "true", ReturnNoteCodes: "DV,LM,CM,TC,BG,FG,LK",
    MaxTripCount: "100",
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await verificationFor(stop, attempt > 0);
    const headers: Record<string, string> = {
      "RequestVerificationToken": token.verification,
      "ModuleId": "5310", "TabId": "141",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": USER_AGENT, "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer, "Origin": BASE,
    };
    if (token.cookie) headers.Cookie = token.cookie;
    const response = await fetch(STOP_API, {
      method: "POST", headers, body: params.toString(), signal: AbortSignal.timeout(14000),
    });
    if (response.status === 401 && attempt === 0) {
      tokens.delete(stop);
      continue;
    }
    if (response.status === 429) {
      blockedUntil.set(stop, Date.now() + 180_000);
      throw new Error("Transperth rate limit reached; next retry deferred");
    }
    if (!response.ok) throw new Error("Transperth departures HTTP " + response.status);
    const body = await response.json();
    if (body?.result !== "success" || !body?.stop) {
      throw new Error("Unexpected Transperth timetable response");
    }
    const rows: Departure[] = [];
    for (const entry of (Array.isArray(body.trips) ? body.trips : [])) {
      const summary = entry?.Summary || {};
      if (String(summary.RouteCode || "").trim() !== "27") continue;
      const scheduled = toIsoLocal(entry.DepartTime || entry.ArriveTime);
      if (!scheduled) continue;
      const live = Boolean(entry.IsRealTime);
      const estimated = live ? expectedIso(entry.DisplayTripStatus, scheduled) : null;
      const expected = estimated ?? scheduled;
      const delayMinutes = estimated ? Math.round((Date.parse(estimated) - Date.parse(scheduled)) / 60000) : null;
      const destination = String(summary.Headsign || entry?.Destination?.Name || STOPS[stop].destination).trim();
      rows.push({
        id: String(summary.TripUid || scheduled + destination),
        route: "27", destination,
        scheduled, expected, live, delayMinutes,
        status: String(entry.RealTimeStopStatusDetail || (live ? "Live" : "Scheduled")),
      });
    }
    const unique = new Map<string, Departure>();
    for (const row of rows) unique.set(row.id + row.scheduled, row);
    const sorted = [...unique.values()].sort((a, b) => Date.parse(a.expected) - Date.parse(b.expected));
    return {
      stop, stopName: String(body.stop.Description || STOPS[stop].name),
      direction: STOPS[stop].direction, destination: STOPS[stop].destination,
      source: "Transperth", fetchedAt: new Date().toISOString(),
      departures: sorted.filter(d => Date.parse(d.expected) > Date.now() - 60000).slice(0, 12),
    };
  }
  throw new Error("Transperth verification failed");
}

export async function readDepartures(stop: StopId): Promise<DeparturesPayload> {
  const previous = cached.get(stop);
  if (previous && Date.now() - previous.at < CACHE_AGE_MS) return previous.value;
  const inflight = pending.get(stop);
  if (inflight) return inflight;
  if ((blockedUntil.get(stop) || 0) > Date.now()) {
    if (previous) return { ...previous.value, stale: true, warning: "Transperth temporarily rate-limited requests" };
    throw new Error("Transperth temporarily rate-limited requests");
  }
  const task = (async () => {
    try {
      const fresh = await transperth(stop);
      cached.set(stop, { at: Date.now(), value: fresh });
      return fresh;
    } catch (e) {
      console.error("Route 27 stop " + stop + ": " + String(e));
      if (previous && Date.now() - previous.at <= STALE_AGE_MS) {
        return { ...previous.value, stale: true, warning: "Departure feed unavailable; last-known data" };
      }
      throw e;
    } finally { pending.delete(stop); }
  })();
  pending.set(stop, task);
  return task;
}
