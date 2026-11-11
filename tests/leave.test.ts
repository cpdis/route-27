import { describe, expect, it } from "vitest";
import type { Departure } from "../lib/transperth";
import { leaveCue } from "../src/lib/leave";

const now = Date.parse("2026-11-11T13:20:00+08:00");
const dep = (minutes: number, extra: Partial<Departure> = {}): Departure => {
  const t = new Date(now + minutes * 60_000).toISOString();
  return { id: "t" + minutes, route: "27", destination: "East Perth", scheduled: t, expected: t, live: true, delayMinutes: 0, status: "", ...extra };
};

describe("leaveCue", () => {
  it("rounds down so the full walk always fits", () => {
    expect(leaveCue([dep(7.5)], 4, now)).toMatchObject({ kind: "leave-in", minutes: 3 });
    expect(leaveCue([dep(5)], 4, now)).toMatchObject({ kind: "leave-in", minutes: 1 });
  });

  it("says leave now inside the last minute", () => {
    expect(leaveCue([dep(4.5)], 4, now)).toMatchObject({ kind: "leave-now" });
    expect(leaveCue([dep(4)], 4, now)).toMatchObject({ kind: "leave-now" });
  });

  it("points at the next catchable bus when the first is too tight", () => {
    const cue = leaveCue([dep(3), dep(33)], 4, now);
    expect(cue).toMatchObject({ kind: "too-tight", minutes: 29 });
    expect(cue && cue.kind === "too-tight" && cue.next?.id).toBe("t33");
    expect(leaveCue([dep(1)], 2, now)).toMatchObject({ kind: "too-tight", next: null, minutes: null });
  });

  it("skips cancelled services", () => {
    expect(leaveCue([dep(10, { cancelled: true }), dep(20)], 4, now)).toMatchObject({ kind: "leave-in", minutes: 16 });
    expect(leaveCue([], 4, now)).toBeNull();
  });
});

describe("leave-by time", () => {
  it("gives the clock time to leave, rounded down to the minute", () => {
    const cue = leaveCue([dep(7.5)], 4, now);
    expect(cue && cue.kind === "leave-in" && new Date(cue.leaveBy).toISOString()).toBe("2026-11-11T05:23:00.000Z");
  });
});
