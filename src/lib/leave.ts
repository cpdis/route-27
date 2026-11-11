import type { Departure } from "../../lib/transperth";

export type LeaveCue =
  | { kind: "leave-in"; minutes: number; departure: Departure; leaveBy: number }
  | { kind: "leave-now"; departure: Departure }
  | { kind: "too-tight"; missed: Departure; next: Departure | null; minutes: number | null };

/**
 * When to walk out the door. Minutes are rounded down, so "leave in 3 min" always
 * leaves at least the full walking time.
 */
export function leaveCue(departures: Departure[], walkMinutes: number, now: number): LeaveCue | null {
  const usable = departures.filter(d => !d.cancelled);
  const first = usable[0];
  if (!first) return null;
  const slack = (d: Departure) => (Date.parse(d.expected) - now) / 60_000 - walkMinutes;
  const firstSlack = slack(first);
  if (firstSlack >= 1) {
    // Rounded down to the whole minute, matching the relative cue.
    const leaveBy = Math.floor((Date.parse(first.expected) - walkMinutes * 60_000) / 60_000) * 60_000;
    return { kind: "leave-in", minutes: Math.floor(firstSlack), departure: first, leaveBy };
  }
  if (firstSlack >= 0) return { kind: "leave-now", departure: first };
  const next = usable.slice(1).find(d => slack(d) >= 0) ?? null;
  return { kind: "too-tight", missed: first, next, minutes: next ? Math.floor(slack(next)) : null };
}
