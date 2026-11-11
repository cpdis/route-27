// Fixture-backed API for `npm run dev:mock`: real trip shapes, times shifted to now,
// and a bus that creeps along the route so the strip and map have something to show.
import { readFileSync } from "node:fs";
import { parseServiceUpdates, relevantAlerts } from "../lib/alerts";
import { json } from "../lib/http";
import { parseTrip, type Departure, type DeparturesPayload, type StopId, type TripPayload } from "../lib/transperth";

const read = (name: string) => readFileSync(new URL("../tests/fixtures/" + name, import.meta.url), "utf8");
const ROUTE_UID = "PerthRestricted:SWA-CLA-1646";

const TRIPS: Record<StopId, { file: string; uid: string; direction: "0" | "1"; headsign: string }> = {
  "10106": { file: "trip-7413967-outbound.json", uid: "PerthRestricted:7413967", direction: "0", headsign: "East Perth" },
  "10091": { file: "trip-7413922-inbound.json", uid: "PerthRestricted:7413922", direction: "1", headsign: "Shenton Park" },
};
const DELAY_MIN = Number(process.env.MOCK_DELAY ?? 2);
// Minutes until the first bus reaches your stop; MOCK_LEAD=3 shows the "too tight" cue.
const LEAD_MIN = Number(process.env.MOCK_LEAD ?? 7);

/** The fixture trip re-timed so the first bus reaches `stop` LEAD_MIN minutes from now (cycle of 30 min). */
function shiftedTrip(stop: StopId, now: number): { trip: TripPayload; offset: number } {
  const meta = TRIPS[stop];
  const base = parseTrip(JSON.parse(read(meta.file)), { tripUid: meta.uid, routeUid: ROUTE_UID, date: "2026-11-11", direction: meta.direction });
  const mine = base.stops.find(s => s.code === stop)!;
  const scheduledAtMine = Math.floor((now + (LEAD_MIN - DELAY_MIN) * 60_000) / 60_000) * 60_000;
  const offset = scheduledAtMine - Date.parse(mine.time!);
  const perthDate = new Date(scheduledAtMine + 8 * 3_600_000).toISOString().slice(0, 10);
  return {
    offset,
    trip: {
      ...base,
      date: perthDate,
      stops: base.stops.map(s => ({ ...s, time: s.time ? new Date(Date.parse(s.time) + offset).toISOString() : null })),
    },
  };
}

function busPoint(trip: TripPayload, at: number): { lat: number; lon: number } | null {
  const times = trip.stops.map(s => Date.parse(s.time!));
  if (at < times[0]) return null;
  for (let i = 0; i < times.length - 1; i++) {
    if (at < times[i + 1]) {
      const t = times[i + 1] === times[i] ? 0 : (at - times[i]) / (times[i + 1] - times[i]);
      const a = trip.stops[i];
      const b = trip.stops[i + 1];
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
  }
  return null;
}

function departures(stop: StopId, now: number): DeparturesPayload {
  const { trip } = shiftedTrip(stop, now);
  const mine = trip.stops.find(s => s.code === stop)!;
  const rows: Departure[] = [0, 30, 60, 90].map((gap, k) => {
    const scheduled = new Date(Date.parse(mine.time!) + gap * 60_000);
    const live = k < 2;
    const delay = live ? DELAY_MIN : 0;
    const expected = new Date(scheduled.getTime() + delay * 60_000).toISOString();
    const local = new Date(scheduled.getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
    const uid = k === 0 ? trip.tripUid : "PerthRestricted:99" + k;
    const point = k === 0 ? busPoint(trip, now - delay * 60_000) : null;
    return {
      id: uid, route: "27", destination: TRIPS[stop].headsign,
      scheduled: local + ":00+08:00", expected, live, delayMinutes: live ? delay : null,
      status: live ? (delay ? delay + " min delay" : "On Time") : "Not Available",
      trip: k === 0 ? { uid, routeUid: ROUTE_UID, direction: TRIPS[stop].direction, date: trip.date, start: trip.stops[0].time, origin: trip.stops[0].name } : null,
      vehicle: point ? { ...point, bearing: 80, updated: new Date(now - 25_000).toISOString(), fleet: "2584" } : null,
    };
  });
  return {
    stop, stopName: mine.name, direction: stop === "10106" ? "Towards Perth" : "Towards Subiaco",
    destination: TRIPS[stop].headsign, source: "Transperth", fetchedAt: new Date(now).toISOString(), departures: rows,
  };
}

export const handlers = {
  departures: {
    fetch(request: Request) {
      const stop = (new URL(request.url).searchParams.get("stop") || "10106") as StopId;
      if (!(stop in TRIPS)) return json({ error: "Unknown stop" }, 400);
      if (process.env.MOCK_FAIL) return json({ error: "Live departures are currently unavailable" }, 503);
      return json(departures(stop, Date.now()), 200);
    },
  },
  trip: {
    fetch(request: Request) {
      const uid = new URL(request.url).searchParams.get("trip");
      const stop = (Object.keys(TRIPS) as StopId[]).find(s => TRIPS[s].uid === uid);
      if (!stop) return json({ error: "Trip not found" }, 404);
      return json(shiftedTrip(stop, Date.now()).trip, 200);
    },
  },
  alerts: {
    fetch() {
      // The fixture's dates are pinned to 11 Nov 2026, so evaluate them on that day.
      const day = Date.parse("2026-11-11T10:00:00+08:00");
      const alerts = relevantAlerts(parseServiceUpdates(read("service-updates.html"), day), day);
      return json({ route: "27", fetchedAt: new Date().toISOString(), alerts }, 200);
    },
  },
};
