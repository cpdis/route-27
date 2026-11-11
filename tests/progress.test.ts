import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStopTimetable, parseTrip, type Departure, type TripPayload } from "../lib/transperth";
import { locateBus, shortStopName, timetablePosition } from "../src/lib/progress";

const fixture = (name: string) => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
const at = (iso: string) => Date.parse(iso);

const outbound: TripPayload = parseTrip(fixture("trip-7413967-outbound.json"),
  { tripUid: "PerthRestricted:7413967", routeUid: "PerthRestricted:SWA-CLA-1646", date: "2026-11-11", direction: "0" });
const inbound: TripPayload = parseTrip(fixture("trip-7413922-inbound.json"),
  { tripUid: "PerthRestricted:7413922", routeUid: "PerthRestricted:SWA-CLA-1646", date: "2026-11-11", direction: "1" });

/** A live departure at 10106 on the outbound trip (scheduled 14:06), with the bus at a given point. */
function outboundDeparture(lat: number, lon: number, updated: string, delayMin = 0): Departure {
  const scheduled = "2026-11-11T14:06:00+08:00";
  return {
    id: "PerthRestricted:7413967", route: "27", destination: "East Perth",
    scheduled, expected: new Date(at(scheduled) + delayMin * 60_000).toISOString(),
    live: true, delayMinutes: delayMin, status: "Live",
    trip: { uid: "PerthRestricted:7413967", routeUid: "PerthRestricted:SWA-CLA-1646", direction: "0", date: "2026-11-11", start: "2026-11-11T13:45:00+08:00", origin: "Claremont Stn Stand 4" },
    vehicle: { lat, lon, bearing: 90, updated, fleet: "2584" },
  };
}

describe("timetablePosition", () => {
  it("interpolates between scheduled stops", () => {
    expect(timetablePosition(outbound.stops, at("2026-11-11T13:40:00+08:00"))).toBe(-1);
    expect(timetablePosition(outbound.stops, at("2026-11-11T13:45:00+08:00"))).toBe(0);
    // 14:05 is shared by stops 30 and 31; 14:05:30 sits halfway from 31 to 32 (14:06).
    expect(timetablePosition(outbound.stops, at("2026-11-11T14:05:30+08:00"))).toBeCloseTo(31.5, 5);
    expect(timetablePosition(outbound.stops, at("2026-11-11T15:00:00+08:00"))).toBe(48);
  });
});

describe("locateBus with GPS", () => {
  it("places a bus between two stops and counts stops to yours", () => {
    // Midway along Railway Rd between Redfern St (28) and Lawler St (29).
    const d = outboundDeparture(-31.952338, 115.813028, "2026-11-11T14:03:00+08:00");
    const p = locateBus(outbound.stops, "10106", d, at("2026-11-11T14:03:30+08:00"))!;
    expect(p.source).toBe("gps");
    expect(p.state).toBe("en-route");
    expect(p.target).toBe(32);
    expect(Math.floor(p.position)).toBe(28);
    expect(p.position % 1).toBeGreaterThan(0.2);
    expect(p.stopsAway).toBe(4);
    expect(p.nearStop?.code).toBe("19423");
    expect(p.gpsAge).toBe(30);
  });

  it("snaps to a stop when the bus is standing at it", () => {
    const hensman = outbound.stops[31];
    const d = outboundDeparture(hensman.lat + 0.0001, hensman.lon, "2026-11-11T14:05:00+08:00");
    const p = locateBus(outbound.stops, "10106", d, at("2026-11-11T14:05:20+08:00"))!;
    expect(p.position).toBe(31);
    expect(p.stopsAway).toBe(1);
  });

  it("reports arrival at your stop and passing it", () => {
    const mine = outbound.stops[32];
    const atStop = locateBus(outbound.stops, "10106", outboundDeparture(mine.lat, mine.lon, "2026-11-11T14:06:00+08:00"), at("2026-11-11T14:06:10+08:00"))!;
    expect(atStop.state).toBe("at-your-stop");
    expect(atStop.stopsAway).toBe(0);
    const next = outbound.stops[34];
    const gone = locateBus(outbound.stops, "10106", outboundDeparture(next.lat, next.lon, "2026-11-11T14:08:00+08:00"), at("2026-11-11T14:08:10+08:00"))!;
    expect(gone.state).toBe("passed");
  });

  it("waits at the first stop before departure time", () => {
    const origin = outbound.stops[0];
    const d = outboundDeparture(origin.lat + 0.0008, origin.lon, "2026-11-11T13:40:00+08:00");
    const p = locateBus(outbound.stops, "10106", d, at("2026-11-11T13:40:30+08:00"))!;
    expect(p.state).toBe("waiting");
    expect(p.position).toBe(0);
    expect(p.stopsAway).toBe(32);
  });

  it("knows a bus still on its previous run, even when that run shares the street", () => {
    // Real 13:21 fix for trip 7413922: on St Georges Tce heading east, 14 minutes before this
    // trip starts at Terrace Rd. The point sits on this trip's own path, so only the clock tells.
    const payload = parseStopTimetable(fixture("stop-10091.json"), "10091", at("2026-11-11T13:21:30+08:00"));
    const d = payload.departures.find(x => x.id === "PerthRestricted:7413922")!;
    const p = locateBus(inbound.stops, "10091", d, at("2026-11-11T13:21:30+08:00"))!;
    expect(p.state).toBe("previous-run");
    expect(p.position).toBe(-1);
    expect(p.stopsAway).toBe(7);
  });

  it("uses the timetable to choose between overlapping segments", () => {
    // Lemnos St near Shenton Park: outbound passes Lemnos St After Brockway Rd (21) to Shenton Park (22).
    // The same street is close to segment 22→23, so the clock decides.
    const d = outboundDeparture(-31.957175, 115.7985, "2026-11-11T14:00:00+08:00");
    const p = locateBus(outbound.stops, "10106", d, at("2026-11-11T14:00:20+08:00"))!;
    expect(p.position).toBeGreaterThanOrEqual(22);
    expect(p.position).toBeLessThan(24);
  });

  it("falls back to the timetable when the fix is stale or far off the route", () => {
    const old = outboundDeparture(-31.952338, 115.813028, "2026-11-11T13:50:00+08:00");
    const stale = locateBus(outbound.stops, "10106", old, at("2026-11-11T14:03:30+08:00"))!;
    expect(stale.source).toBe("timetable");
    const kingsPark = outboundDeparture(-31.9600, 115.8300, "2026-11-11T14:03:00+08:00");
    const off = locateBus(outbound.stops, "10106", kingsPark, at("2026-11-11T14:03:30+08:00"))!;
    expect(off.source).toBe("timetable");
    expect(off.offRoute).toBeGreaterThan(300);
  });
});

describe("locateBus without GPS", () => {
  it("estimates from the timetable shifted by the live delay", () => {
    const d: Departure = { ...outboundDeparture(0, 0, ""), live: false, vehicle: null };
    const early = locateBus(outbound.stops, "10106", d, at("2026-11-11T13:30:00+08:00"))!;
    expect(early).toMatchObject({ source: "timetable", state: "waiting", position: -1 });
    const mid = locateBus(outbound.stops, "10106", d, at("2026-11-11T14:04:00+08:00"))!;
    expect(mid.source).toBe("timetable");
    expect(mid.position).toBeCloseTo(29, 5);
    const late: Departure = { ...d, live: true, expected: "2026-11-11T06:09:00.000Z", delayMinutes: 3 };
    const shifted = locateBus(outbound.stops, "10106", late, at("2026-11-11T14:07:00+08:00"))!;
    expect(shifted.position).toBeCloseTo(29, 5);
  });

  it("returns null when your stop is not on the trip", () => {
    const d = outboundDeparture(0, 0, "");
    expect(locateBus(outbound.stops, "10091", d, Date.now())).toBeNull();
  });
});

describe("shortStopName", () => {
  it("drops catalogue ids and tidies stand names", () => {
    expect(shortStopName("St Georges Tce Stand 32 - Cat Id 21")).toBe("St Georges Tce Stand 32");
    expect(shortStopName("Kings Park Rd Thomas Street Cat Id 140")).toBe("Kings Park Rd Thomas Street");
    expect(shortStopName("St Georges Tce Stand 2 - After Milligan St")).toBe("St Georges Tce Stand 2 · After Milligan St");
  });
});
