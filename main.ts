import { Hono } from "npm:hono";
import { parseVal, serveImmutableFile, serveFile } from "https://esm.town/v/std/utils/index.ts";
import Root from "./frontend/root.tsx";
import { readDepartures, VALID_STOPS, type StopId } from "./lib/transperth.ts";

const app = new Hono();

app.get("/", c => c.html(Root()));
app.get("/__immutable/*", c => serveImmutableFile(c.req.path));
app.get("/styles.css", c => serveFile("/frontend/styles.css"));
app.get("/icon.svg", c => serveFile("/frontend/icon.svg"));
app.get("/manifest.webmanifest", c => serveFile("/frontend/manifest.webmanifest"));
app.get("/api/departures", async c => {
  const stop = c.req.query("stop") || "10106";
  if (!(stop in VALID_STOPS)) {
    return c.json({ error: "Unknown stop; choose 10106 or 10091" }, 400, { "Cache-Control": "no-store" });
  }
  try {
    const payload = await readDepartures(stop as StopId);
    return c.json(payload, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    console.error("Failed departure API:", String(error));
    return c.json({ error: "Live departures are currently unavailable", stop, source: "Transperth" }, 503, { "Cache-Control": "no-store" });
  }
});
app.get("/source", c => c.redirect(parseVal().links.self.val));
app.onError(err => Promise.reject(err));

export default app.fetch;
