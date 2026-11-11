import { useEffect, useState } from "react";
import type { TripPayload, TripRef } from "../../lib/transperth";

const memory = new Map<string, TripPayload>();

function key(ref: TripRef): string {
  return ref.uid + "|" + ref.date;
}

/** Stop list for one trip. Trips never change during the day, so each is fetched once per page load. */
export function useTrip(ref: TripRef | null | undefined): TripPayload | null {
  const [trip, setTrip] = useState<TripPayload | null>(() => (ref ? memory.get(key(ref)) ?? null : null));
  const id = ref ? key(ref) : "";

  useEffect(() => {
    if (!ref) { setTrip(null); return; }
    const cached = memory.get(key(ref));
    if (cached) { setTrip(cached); return; }
    setTrip(null);
    const ctrl = new AbortController();
    const q = new URLSearchParams({ trip: ref.uid, route: ref.routeUid, date: ref.date, dir: ref.direction });
    fetch("/api/trip?" + q.toString(), { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((payload: TripPayload | null) => {
        if (!payload || !Array.isArray(payload.stops)) return;
        memory.set(key(ref), payload);
        setTrip(payload);
      })
      .catch(() => { /* the strip simply stays hidden */ });
    return () => ctrl.abort();
  }, [id]);

  // State lags the ref by one render when the next bus changes; never pair a departure with another trip.
  return trip && ref && trip.tripUid === ref.uid && trip.date === ref.date ? trip : null;
}
