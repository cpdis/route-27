import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mentionsRoute, parseServiceUpdates, parseShortDate, relevantAlerts } from "../lib/alerts";

const html = readFileSync(new URL("./fixtures/service-updates.html", import.meta.url), "utf8");
const now = Date.parse("2026-11-11T10:00:00+08:00");

describe("mentionsRoute", () => {
  it("matches 27 as a route number only", () => {
    expect(mentionsRoute("Routes 24, 27, 32 and 940")).toBe(true);
    expect(mentionsRoute("Route 27")).toBe(true);
    expect(mentionsRoute("Routes 27 & 28")).toBe(true);
    expect(mentionsRoute("Route 270")).toBe(false);
    expect(mentionsRoute("Route 127")).toBe(false);
    expect(mentionsRoute("Armadale Line and Thornlie-Cockburn Line")).toBe(false);
    expect(mentionsRoute("Sun 27 Dec")).toBe(false);
  });
});

describe("parseShortDate", () => {
  it("picks the nearest year", () => {
    expect(parseShortDate("Sat&nbsp;14&nbsp;Nov", now)).toBe("2026-11-14");
    expect(parseShortDate("Mon 8 Feb", now)).toBe("2027-02-08");
    expect(parseShortDate("Tue 3 Mar", Date.parse("2027-01-05T10:00:00+08:00"))).toBe("2027-03-03");
    expect(parseShortDate("Sun 27 Dec", Date.parse("2027-01-05T10:00:00+08:00"))).toBe("2026-12-27");
    expect(parseShortDate("&nbsp;", now)).toBeNull();
  });
});

describe("parseServiceUpdates", () => {
  const alerts = parseServiceUpdates(html, now);

  it("finds route 27 rows in both tables and ignores the sidebar", () => {
    expect(alerts.map(a => [a.kind, a.title])).toEqual([
      ["disruption", "Routes 24, 27, 32, 33, 39, 72, 73, 160, 176, 177, 178, 270, 910, 930, 935 and 940 Bus Stop Disruption"],
      ["disruption", "TEST Bagot Road Roadworks"],
      ["disruption", "TEST Old Route 27 Detour"],
      ["disruption", "TEST Far Future Route 27 Works"],
      ["change", "1 November Service Changes"],
      ["change", "TEST Summer Timetable"],
    ]);
  });

  it("makes links absolute and drops links off the Transperth site", () => {
    expect(alerts.find(a => a.title.includes("Roadworks"))!.url)
      .toBe("https://www.transperth.wa.gov.au/Service-Updates/Service-Update-Details/90001");
    expect(alerts.some(a => a.title.includes("Offsite"))).toBe(false);
  });

  it("reads dates, leaving blank ones null", () => {
    const stop = alerts[0];
    expect([stop.from, stop.until]).toEqual(["2026-11-14", "2026-11-15"]);
    const roadworks = alerts[1];
    expect([roadworks.from, roadworks.until]).toEqual(["2026-11-09", null]);
  });
});

describe("relevantAlerts", () => {
  it("keeps current and soon-upcoming notices, active ones first", () => {
    const kept = relevantAlerts(parseServiceUpdates(html, now), now);
    expect(kept.map(a => [a.title.replace(/^Routes 24.*Disruption$/, "Bus Stop Disruption"), a.active])).toEqual([
      ["TEST Bagot Road Roadworks", true],
      ["Bus Stop Disruption", false],
      ["TEST Summer Timetable", false],
    ]);
  });

  it("drops a planned change a week after it takes effect", () => {
    const later = Date.parse("2026-11-23T10:00:00+08:00");
    const kept = relevantAlerts(parseServiceUpdates(html, later), later);
    expect(kept.map(a => a.title)).not.toContain("TEST Summer Timetable");
  });
});
