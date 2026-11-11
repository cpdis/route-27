import { json } from "../lib/http.js";
import { isStopId, readDepartures } from "../lib/transperth.js";

// GET /api/departures?stop=10106|10091 — the same contract as the Val Town version, plus
// optional `trip`, `vehicle` and `cancelled` fields on each departure.
export default {
  async fetch(request: Request): Promise<Response> {
    const stop = new URL(request.url).searchParams.get("stop") || "10106";
    if (!isStopId(stop)) {
      return json({ error: "Unknown stop; choose 10106 or 10091" }, 400);
    }
    try {
      const payload = await readDepartures(stop);
      // 30 s on the CDN caps upstream calls at about two a minute per stop, however many people look.
      return payload.stale ? json(payload, 200, 10) : json(payload, 200, 30, 30);
    } catch (error) {
      console.error("Failed departure API:", String(error));
      return json({ error: "Live departures are currently unavailable", stop, source: "Transperth" }, 503);
    }
  },
};
