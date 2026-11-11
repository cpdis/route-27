import { json } from "../lib/http.js";
import { DATE_RE, NotFoundError, ROUTE_UID_RE, TRIP_UID_RE, readTrip } from "../lib/transperth.js";

// GET /api/trip?trip=PerthRestricted:7413967&route=PerthRestricted:SWA-CLA-1646&date=2026-11-11&dir=0
// Every stop on one route 27 trip with coordinates and scheduled times, for the route strip and map.
export default {
  async fetch(request: Request): Promise<Response> {
    const q = new URL(request.url).searchParams;
    const tripUid = q.get("trip") || "";
    const routeUid = q.get("route") || "";
    const date = q.get("date") || "";
    const dir = q.get("dir") || "0";
    if (!TRIP_UID_RE.test(tripUid) || !ROUTE_UID_RE.test(routeUid) || !DATE_RE.test(date) || (dir !== "0" && dir !== "1")) {
      return json({ error: "Expected trip, route, date (YYYY-MM-DD) and dir (0 or 1)" }, 400);
    }
    try {
      const trip = await readTrip({ tripUid, routeUid, date, direction: dir });
      // A trip's stop pattern and timetable do not change during the day.
      return json(trip, 200, 6 * 3600, 86400);
    } catch (error) {
      if (error instanceof NotFoundError) return json({ error: error.message }, 404, 600);
      console.error("Failed trip API:", String(error));
      return json({ error: "Trip details are currently unavailable" }, 503);
    }
  },
};
