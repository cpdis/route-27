import { readAlerts } from "../lib/alerts.js";
import { json } from "../lib/http.js";

// GET /api/alerts — current and upcoming Transperth notices that name route 27.
export default {
  async fetch(): Promise<Response> {
    try {
      return json(await readAlerts(), 200, 900, 3600);
    } catch (error) {
      console.error("Failed alerts API:", String(error));
      return json({ error: "Service updates are currently unavailable" }, 503);
    }
  },
};
