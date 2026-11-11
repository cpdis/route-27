#!/usr/bin/env node
// Daily check that the live site still gets fresh Route 27 data from Transperth.
// The Transperth endpoints are unofficial, so a layout or token change shows up here
// first. Exits 1 on failure, which makes the GitHub Action email the repo owner.
//
//   BASE_URL=https://27.cpd.dev node scripts/health-check.mjs

const BASE_URL = (process.env.BASE_URL || "https://27.cpd.dev").replace(/\/+$/, "");
const STOPS = ["10106", "10091"];
const MAX_AGE_MS = 10 * 60_000;
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 20_000);

const failures = [];
const warnings = [];
const fail = (msg) => { failures.push(msg); console.log("✗ " + msg); };
const warn = (msg) => { warnings.push(msg); console.log("! " + msg); };
const pass = (msg) => console.log("✓ " + msg);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path) {
  const res = await fetch(BASE_URL + path, {
    headers: { "User-Agent": "route-27-health-check", Accept: "application/json, text/html" },
    signal: AbortSignal.timeout(35_000),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* HTML or an error page */ }
  return { status: res.status, body, text, cache: res.headers.get("x-vercel-cache") };
}

/** One retry, so a single slow Transperth answer or cold start does not send an email. */
async function check(name, path, validate) {
  let problem = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await get(path);
      problem = validate(res);
      if (!problem) return res;
    } catch (error) {
      problem = String(error?.cause?.code || error?.message || error);
    }
    if (attempt === 1) {
      console.log(`  ${name}: ${problem}; retrying in ${RETRY_DELAY_MS / 1000} s`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  fail(`${name}: ${problem}`);
  return null;
}

function departuresProblem(stop) {
  return ({ status, body }) => {
    if (status !== 200) return `HTTP ${status}${body?.error ? ` (${body.error})` : ""}`;
    if (!body || body.stop !== stop || !Array.isArray(body.departures)) return "unexpected payload shape";
    if (body.stale) return `stale data${body.warning ? `: ${body.warning}` : ""}`;
    const age = Date.now() - Date.parse(body.fetchedAt);
    if (!Number.isFinite(age) || age > MAX_AGE_MS) return `fetchedAt ${body.fetchedAt} is too old`;
    const bad = body.departures.find((d) => !d.id || !Number.isFinite(Date.parse(d.expected)) || typeof d.live !== "boolean");
    if (bad) return `malformed departure ${JSON.stringify(bad).slice(0, 160)}`;
    return "";
  };
}

console.log(`Route 27 health check against ${BASE_URL}`);

const page = await check("page", "/", ({ status, text }) =>
  status !== 200 ? `HTTP ${status}` : text.includes("Route 27") ? "" : "page does not mention Route 27");
if (page) pass("page loads");

let tripRef = null;
for (const stop of STOPS) {
  const res = await check(`departures ${stop}`, `/api/departures?stop=${stop}`, departuresProblem(stop));
  if (!res) continue;
  const deps = res.body.departures;
  const live = deps.filter((d) => d.live).length;
  if (deps.length === 0) warn(`departures ${stop}: no Route 27 times reported (fine late at night, odd at 8:30 am)`);
  else pass(`departures ${stop}: ${deps.length} times, ${live} live, cache ${res.cache ?? "n/a"}`);
  tripRef ??= deps.find((d) => d.trip && !d.cancelled)?.trip ?? null;
}

if (tripRef) {
  const q = new URLSearchParams({ trip: tripRef.uid, route: tripRef.routeUid, date: tripRef.date, dir: tripRef.direction });
  const res = await check("trip", "/api/trip?" + q, ({ status, body }) => {
    if (status !== 200) return `HTTP ${status}${body?.error ? ` (${body.error})` : ""}`;
    if (!Array.isArray(body?.stops) || body.stops.length < 2) return "no stop list";
    if (!body.stops.some((s) => s.code === "10106" || s.code === "10091")) return "trip skips both stops";
    if (body.stops.some((s) => !Number.isFinite(s.lat) || !Number.isFinite(s.lon))) return "stop without coordinates";
    return "";
  });
  if (res) pass(`trip ${tripRef.uid}: ${res.body.stops.length} stops`);
} else {
  warn("trip: no departure carried a trip reference, so the route strip was not checked");
}

const alerts = await check("alerts", "/api/alerts", ({ status, body }) =>
  status !== 200 ? `HTTP ${status}${body?.error ? ` (${body.error})` : ""}` :
  Array.isArray(body?.alerts) ? "" : "unexpected payload shape");
if (alerts) pass(`alerts: ${alerts.body.alerts.length} relevant notice(s)`);

console.log(`\n${failures.length} failure(s), ${warnings.length} warning(s)`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  const lines = [
    `### Route 27 health check: ${failures.length ? "failing" : "OK"}`,
    `Checked ${BASE_URL} at ${new Date().toISOString()}.`,
    ...failures.map((f) => `- ✗ ${f}`),
    ...warnings.map((w) => `- ! ${w}`),
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}
process.exit(failures.length ? 1 : 0);
