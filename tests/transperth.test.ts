import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockNear, parseStopTimetable, parseTrip, readDepartures, readTrip, resetForTests, tokenFromPage, toIsoLocal,
} from "../lib/transperth";

const fixture = (name: string) => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
const at = (iso: string) => Date.parse(iso);

describe("time helpers", () => {
  it("reads Transperth wall-clock stamps as Perth time", () => {
    expect(toIsoLocal("2026-11-11T13:36")).toBe("2026-11-11T13:36:00+08:00");
    expect(toIsoLocal("")).toBeNull();
  });

  it("binds display clocks to the scheduled day", () => {
    expect(clockNear("1:42pm", "2026-11-11T13:41:00+08:00")).toBe("2026-11-11T05:42:00.000Z");
    expect(clockNear("13:42:50", "2026-11-11T13:41:00+08:00")).toBe("2026-11-11T05:42:50.000Z");
    expect(clockNear("12:05am", "2026-11-11T12:00:00+08:00")).toBe("2026-11-10T16:05:00.000Z");
  });

  it("wraps across midnight in both directions", () => {
    // Scheduled 23:50, running 12 minutes late.
    expect(clockNear("12:02am", "2026-11-11T23:50:00+08:00")).toBe("2026-11-11T16:02:00.000Z");
    // Scheduled 00:05, running 3 minutes early.
    expect(clockNear("11:62pm", "2026-11-12T00:05:00+08:00")).toBeNull();
    expect(clockNear("11:58pm", "2026-11-12T00:05:00+08:00")).toBe("2026-11-11T15:58:00.000Z");
  });

  it("rejects nonsense", () => {
    expect(clockNear("Not Available", "2026-11-11T13:41:00+08:00")).toBeNull();
    expect(clockNear("13:10pm", "2026-11-11T13:41:00+08:00")).toBeNull();
    expect(clockNear("25:00", "2026-11-11T13:41:00+08:00")).toBeNull();
  });
});

describe("parseStopTimetable", () => {
  const now = at("2026-11-11T13:21:30+08:00");

  it("keeps route 27 only, sorted, with trip and vehicle details", () => {
    const payload = parseStopTimetable(fixture("stop-10106.json"), "10106", now);
    expect(payload.stop).toBe("10106");
    expect(payload.stopName).toBe("Bagot Rd Before Rowland St");
    expect(payload.departures.map(d => d.scheduled)).toEqual([
      "2026-11-11T13:36:00+08:00",
      "2026-11-11T14:06:00+08:00",
    ]);
    const [live, scheduled] = payload.departures;
    expect(live).toMatchObject({
      id: "PerthRestricted:7413982",
      route: "27",
      destination: "East Perth",
      live: true,
      delayMinutes: 0,
      status: "On Time",
      // Seconds from RealTimeInfo drive the countdown.
      expected: "2026-11-11T05:36:15.000Z",
      trip: {
        uid: "PerthRestricted:7413982",
        routeUid: "PerthRestricted:SWA-CLA-1646",
        direction: "0",
        date: "2026-11-11",
        start: "2026-11-11T13:30:00+08:00",
        origin: "Lemnos St Shenton Park",
      },
      vehicle: { bearing: 51, fleet: "2584", updated: "2026-11-11T13:20:00+08:00" },
    });
    expect(live.vehicle!.lat).toBeCloseTo(-31.95681, 4);
    expect(live.vehicle!.lon).toBeCloseTo(115.79678, 4);
    expect(scheduled).toMatchObject({ live: false, delayMinutes: null, status: "Not Available", vehicle: null, expected: scheduled.scheduled });
  });

  it("matches the official delay label and handles midnight and cancellations", () => {
    const payload = parseStopTimetable(fixture("stop-10091.json"), "10091", at("2026-11-11T13:21:30+08:00"));
    const byId = Object.fromEntries(payload.departures.map(d => [d.id, d]));
    // Display "1:42pm" vs 13:41 → +1, even though the precise estimate is 13:42:50.
    expect(byId["PerthRestricted:7413922"]).toMatchObject({ delayMinutes: 1, expected: "2026-11-11T05:42:50.000Z" });
    // 23:50 scheduled, "12:02am" displayed → next calendar day, +12.
    expect(byId["PerthRestricted:7413001"]).toMatchObject({ delayMinutes: 12, expected: "2026-11-11T16:02:30.000Z" });
    expect(byId["PerthRestricted:7413889"]).toMatchObject({ cancelled: true, status: "Cancelled", vehicle: null });
  });

  it("drops departures more than a minute gone", () => {
    const payload = parseStopTimetable(fixture("stop-10106.json"), "10106", at("2026-11-11T13:40:00+08:00"));
    expect(payload.departures.map(d => d.id)).toEqual(["PerthRestricted:7413967"]);
  });

  it("rejects an unexpected body", () => {
    expect(() => parseStopTimetable({ result: "error" }, "10106", now)).toThrow(/Unexpected/);
  });
});

describe("parseTrip", () => {
  const ref = { tripUid: "PerthRestricted:7413967", routeUid: "PerthRestricted:SWA-CLA-1646", date: "2026-11-11", direction: "0" as const };

  it("returns ordered stops with absolute times and coordinates", () => {
    const trip = parseTrip(fixture("trip-7413967-outbound.json"), ref);
    expect(trip.headsign).toBe("East Perth");
    expect(trip.stops).toHaveLength(49);
    expect(trip.stops[0]).toMatchObject({ code: "28527", time: "2026-11-11T05:45:00.000Z", timing: true });
    const mine = trip.stops.findIndex(s => s.code === "10106");
    expect(mine).toBe(32);
    expect(trip.stops[mine].time).toBe("2026-11-11T06:06:00.000Z");
    expect(trip.stops.at(-1)!.code).toBe("28001");
  });

  it("keeps times monotonic past midnight", () => {
    const body = fixture("trip-7413922-inbound.json");
    const timings = body.data.TripStopTimings;
    timings[0].DepartTime = "23:58";
    timings[1].ArrivalTime = timings[1].DepartTime = "23:59";
    timings[2].ArrivalTime = timings[2].DepartTime = "00:01";
    timings[3].ArrivalTime = timings[3].DepartTime = "24:02";
    const trip = parseTrip(body, { ...ref, direction: "1" });
    const times = trip.stops.slice(0, 4).map(s => s.time);
    expect(times).toEqual([
      "2026-11-11T15:58:00.000Z",
      "2026-11-11T15:59:00.000Z",
      "2026-11-11T16:01:00.000Z",
      "2026-11-11T16:02:00.000Z",
    ]);
  });
});

describe("tokenFromPage", () => {
  it("finds the verification token in either attribute order", () => {
    expect(tokenFromPage('<input name="__RequestVerificationToken" type="hidden" value="abc123" />')).toBe("abc123");
    expect(tokenFromPage("<input type='hidden' value='xyz' name='__RequestVerificationToken'>")).toBe("xyz");
    expect(tokenFromPage("<input name=\"other\" value=\"no\">")).toBeNull();
  });
});

describe("upstream calls", () => {
  // The fixtures are a snapshot from 11 Nov 2026; pin the clock there so their buses are still to come.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T13:21:30+08:00"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetForTests();
  });

  function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    });
    return calls;
  }
  const page = (token: string) => new Response(`<input name="__RequestVerificationToken" type="hidden" value="${token}" />`, {
    headers: { "set-cookie": "ASP.NET_SessionId=s1; path=/; HttpOnly" },
  });

  it("refreshes the token once after a 401 and sends the stop-page headers", async () => {
    let tokenCount = 0;
    const calls = stubFetch((url, init) => {
      if (url.includes("Stops-Near-You")) return page("t" + ++tokenCount);
      const headers = init!.headers as Record<string, string>;
      if (headers.RequestVerificationToken === "t1") return new Response("", { status: 401 });
      return Response.json(fixture("stop-10106.json"));
    });
    const payload = await readDepartures("10106");
    expect(payload.departures.length).toBeGreaterThan(0);
    const posts = calls.filter(c => c.init?.method === "POST");
    expect(posts).toHaveLength(2);
    const headers = posts[1].init!.headers as Record<string, string>;
    expect(headers).toMatchObject({ ModuleId: "5310", TabId: "141", RequestVerificationToken: "t2", Cookie: "ASP.NET_SessionId=s1" });
    expect(String(posts[1].init!.body)).toContain("StopNumber=10106");
  });

  it("uses the route-page token for trips and retries the other direction on empty data", async () => {
    const calls = stubFetch((url, init) => {
      if (url.includes("timetables/details?Bus=27")) return page("route");
      const body = String(init!.body);
      if (body.includes("TripDirection=outbound")) return Response.json({ result: "success", data: null });
      return Response.json(fixture("trip-7413922-inbound.json"));
    });
    const trip = await readTrip({ tripUid: "PerthRestricted:7413922", routeUid: "PerthRestricted:SWA-CLA-1646", date: "2026-11-11", direction: "0" });
    expect(trip.stops.some(s => s.code === "10091")).toBe(true);
    const posts = calls.filter(c => c.init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[0].init!.headers).toMatchObject({ ModuleId: "5345", TabId: "133", RequestVerificationToken: "route" });
  });

  it("refuses trips that never serve our stops", async () => {
    const body = fixture("trip-7413922-inbound.json");
    body.data.TripStopTimings = body.data.TripStopTimings.filter((t: any) => t.Stop.Code !== "10091");
    stubFetch(url => (url.includes("timetables") ? page("route") : Response.json(body)));
    await expect(readTrip({ tripUid: "PerthRestricted:1", routeUid: "PerthRestricted:SWA-CLA-1646", date: "2026-11-11", direction: "1" }))
      .rejects.toThrow(/Not a route 27 trip/);
  });

  it("serves last-known data, marked stale, when Transperth fails", async () => {
    let fail = false;
    stubFetch(url => {
      if (fail) return new Response("", { status: 500 });
      if (url.includes("Stops-Near-You")) return page("ok");
      return Response.json(fixture("stop-10106.json"));
    });
    vi.useFakeTimers({ now: at("2026-11-11T13:21:30+08:00"), toFake: ["Date"] });
    try {
      const first = await readDepartures("10106");
      expect(first.stale).toBeUndefined();
      fail = true;
      vi.setSystemTime(at("2026-11-11T13:23:00+08:00"));
      const second = await readDepartures("10106");
      expect(second).toMatchObject({ stale: true, warning: expect.stringMatching(/last-known/) });
    } finally {
      vi.useRealTimers();
    }
  });
});
