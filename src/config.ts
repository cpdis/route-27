export type StopId = "10106" | "10091";

export const STOPS = {
  "10106": {
    place: "Subiaco", direction: "To Perth", location: "Bagot Rd · before Rowland St",
    /** Minutes from home to the stop on foot. */
    walkMinutes: 4,
  },
  "10091": {
    place: "Perth CBD", direction: "To Subiaco", location: "St Georges Tce · Stand 32",
    walkMinutes: 2,
  },
} as const satisfies Record<StopId, { place: string; direction: string; location: string; walkMinutes: number }>;

export const STOP_IDS: StopId[] = ["10106", "10091"];

export function isStop(value: unknown): value is StopId {
  return value === "10106" || value === "10091";
}
