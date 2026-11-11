// Route 27 notices scraped from Transperth's public Service Updates page.
// The page is plain HTML (DNN/EasyDNNNews): one table of disruptions and one of
// planned changes, each row "Notice | Services affected | From | Until".

const BASE = "https://www.transperth.wa.gov.au";
export const SERVICE_UPDATES_URL = BASE + "/Service-Updates";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

export type AlertKind = "disruption" | "change";
export type ServiceAlert = {
  id: string;
  kind: AlertKind;
  title: string;
  url: string;
  services: string;
  /** Perth-local dates, YYYY-MM-DD. */
  from: string | null;
  until: string | null;
};
export type AlertsPayload = {
  route: "27";
  fetchedAt: string;
  alerts: Array<ServiceAlert & { active: boolean }>;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DAY_MS = 86_400_000;

function decode(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/\s+/g, " ")
    .trim();
}

function perthToday(now: number): string {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** "Sat 14 Nov" has no year: pick the year that lands closest to today. */
export function parseShortDate(text: string, now: number): string | null {
  const m = decode(text).match(/(\d{1,2})\s+([A-Za-z]{3})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month || day < 1 || day > 31) return null;
  const today = Date.parse(perthToday(now) + "T00:00:00Z");
  const thisYear = Number(perthToday(now).slice(0, 4));
  let best: string | null = null;
  let bestGap = Infinity;
  for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const gap = Math.abs(Date.parse(iso + "T00:00:00Z") - today);
    if (gap < bestGap) { bestGap = gap; best = iso; }
  }
  return best;
}

/** True when a "Services affected" cell names route 27 (and not 270, 127 or a date). */
export function mentionsRoute(services: string, route = "27"): boolean {
  if (!/\broutes?\b/i.test(services)) return false;
  return new RegExp("(^|[^\\d])" + route + "(?![\\d])").test(services);
}

function absolute(href: string): string | null {
  try {
    const url = new URL(href.replace(/&amp;/g, "&"), BASE + "/");
    if (url.hostname !== "www.transperth.wa.gov.au" && url.hostname !== "transperth.wa.gov.au") return null;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

/** Every route-27 notice on the page, in page order. */
export function parseServiceUpdates(html: string, now = Date.now(), route = "27"): ServiceAlert[] {
  const out: ServiceAlert[] = [];
  const headings: Array<{ at: number; kind: AlertKind }> = [];
  for (const m of html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    const text = decode(m[1]).toLowerCase();
    if (text.includes("service disruptions")) headings.push({ at: m.index!, kind: "disruption" });
    else if (text.includes("planned service changes")) headings.push({ at: m.index!, kind: "change" });
  }
  for (const table of html.matchAll(/<table\b[^>]*class="[^"]*service-wid-tbl[^"]*"[^>]*>([\s\S]*?)<\/table>/gi)) {
    const inner = table[1];
    if (!/services affected/i.test(inner)) continue;
    const heading = headings.filter(h => h.at < table.index!).pop();
    const kind: AlertKind = heading?.kind ?? "disruption";
    for (const row of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
      if (cells.length < 4) continue;
      const services = decode(cells[2]);
      if (!mentionsRoute(services, route)) continue;
      const link = cells[1].match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const url = link ? absolute(link[1]) : null;
      const title = decode(link ? link[2] : cells[1]);
      if (!title || !url) continue;
      out.push({
        id: url,
        kind,
        title,
        url,
        services,
        from: parseShortDate(cells[3] ?? "", now),
        until: parseShortDate(cells[4] ?? "", now),
      });
    }
  }
  const seen = new Set<string>();
  return out.filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

/**
 * Keep what is worth a banner: disruptions that have not ended and start within two weeks,
 * and planned changes from a week before they take effect until a week after.
 */
export function relevantAlerts(alerts: ServiceAlert[], now = Date.now()): AlertsPayload["alerts"] {
  const today = perthToday(now);
  const day = (iso: string) => Date.parse(iso + "T00:00:00Z");
  const t = day(today);
  return alerts.flatMap(alert => {
    const from = alert.from ? day(alert.from) : null;
    const until = alert.until ? day(alert.until) : null;
    if (until != null && until < t) return [];
    if (alert.kind === "disruption") {
      if (from != null && from - t > 14 * DAY_MS) return [];
    } else {
      if (from == null) return [];
      if (from - t > 7 * DAY_MS) return [];
      if (until == null && t - from > 7 * DAY_MS) return [];
    }
    const active = (from == null || from <= t) && (until == null || until >= t);
    return [{ ...alert, active }];
  }).sort((a, b) => Number(b.active) - Number(a.active) || (a.from ?? "").localeCompare(b.from ?? ""));
}

const cache: { at: number; value: AlertsPayload | null } = { at: 0, value: null };
const CACHE_MS = 10 * 60_000;

export async function readAlerts(): Promise<AlertsPayload> {
  if (cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  const resp = await fetch(SERVICE_UPDATES_URL, {
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html" },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) throw new Error("Transperth service updates HTTP " + resp.status);
  const html = await resp.text();
  if (!/service-wid-tbl/.test(html)) throw new Error("Service updates page layout changed");
  const now = Date.now();
  const value: AlertsPayload = {
    route: "27",
    fetchedAt: new Date(now).toISOString(),
    alerts: relevantAlerts(parseServiceUpdates(html, now), now),
  };
  cache.at = now;
  cache.value = value;
  return value;
}
