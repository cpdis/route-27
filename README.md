# Route 27 · Subiaco ↔ Perth

Mobile-first departure board for Transperth Route 27, remixed from
[Owen Christofferson's Grand & Perkins Board](https://www.val.town/x/owenchristofferson/GrandPerkinsBoard).
It ran on Val Town as `subiaco27.val.run` until the end of 2026 and now runs on Vercel.

**Live:** https://27.cpd.dev

Use the **Subiaco** / **Perth CBD** switcher. The selected stop is remembered on the
device and can be linked with `?stop=10106` or `?stop=10091`.

| Stop | Official Transperth description | Route 27 direction | Walk |
| --- | --- | --- | --- |
| 10106 | Bagot Rd Before Rowland St | East Perth | 4 min |
| 10091 | St Georges Tce Stand 32 - Cat Id 21 | Claremont / Shenton Park (via Subiaco) | 2 min |

## What it shows

- **Next bus** countdown with live or timetabled status and the delay against the timetable.
- **Leave cue**: when to walk out the door, from the walk time to the stop in `src/config.ts`.
  Rounded down, so the full walk always fits. When the next bus is too tight it points at the
  one after.
- **Where's the bus**: the next bus on a strip of the stops before yours, from its live GPS
  when Transperth has a recent fix on the route, otherwise estimated from the timetable. A
  **Map** button opens the same on an OpenStreetMap/CARTO map (Leaflet, loaded on demand).
- **Notices** from Transperth's Service Updates page that name route 27: current ones above
  the next bus, upcoming ones further down. Each can be dismissed on the device.
- **Following departures**, with cancelled services struck through.
- Works offline from the home screen: a service worker keeps the page shell, and the page
  keeps the last departures it saw (up to 30 minutes old, clearly marked).

## Data

- Source: the Transperth website's SilverRail endpoints (`GetStopTimetableAsync` for each
  stop, `GetTimetableTripAsync` for a trip's stop list) and the Service Updates page. All are
  **unofficial**, need a verification token scraped from a Transperth page, and may change
  without notice.
- Times are Australia/Perth (+08:00). A departure is labelled live only when Transperth has a
  real-time estimate for it; otherwise it is labelled scheduled.
- The browser checks every 60 seconds while the page is visible. Vercel's CDN caches each
  stop for 30 seconds (plus 30 seconds stale-while-revalidate), so Transperth sees about two
  requests a minute per stop however many people are looking. Trip stop lists are cached for
  six hours and notices for fifteen minutes.
- If Transperth fails, the function serves its last good copy for up to 30 minutes with a
  prominent **old data** warning, and the page falls back to its own saved copy.
- An empty list is returned rather than inventing times when Transperth reports no route 27
  departures.

## API

All JSON, served from the Sydney region.

- `GET /api/departures?stop=10106|10091`: same contract as the Val Town version, plus optional
  `cancelled`, `trip` (a reference for `/api/trip`) and `vehicle` (`lat`, `lon`, `bearing`,
  `updated`, `fleet`) on each departure. Other stops return 400.
- `GET /api/trip?trip=…&route=…&date=YYYY-MM-DD&dir=0|1`: every stop on one trip with
  coordinates and scheduled times. The parameters come from a departure's `trip`.
- `GET /api/alerts`: current and upcoming Transperth notices naming route 27.

## Development

Node 24 (see `.nvmrc`).

```sh
npm ci
npm run dev        # Vite on :5173; /api/* runs the real functions against Transperth
npm run dev:mock   # same UI on recorded fixtures, with a bus that moves along the route
npm run check      # typecheck, tests, production build
```

`dev:mock` takes `MOCK_LEAD` (minutes until the bus reaches your stop, default 7; try 3 for
the "too tight" cue), `MOCK_DELAY` (default 2) and `MOCK_FAIL=1` (every API call fails).

Tests run against real Transperth responses saved in `tests/fixtures`.

## Layout

- `api/*.ts`: Vercel functions (Web `fetch` handlers) for departures, trips and notices
- `lib/transperth.ts`: Transperth token handling, request limits, parsing and caching
- `lib/alerts.ts`: Service Updates parsing and route 27 filtering
- `lib/http.ts`: JSON responses with CDN cache headers
- `src/`: the React app (`App.tsx`, `components/`, `hooks/`, `lib/` for pure logic)
- `public/`: icons, manifest and the service worker
- `dev/mock-api.ts`: fixture-backed API for `npm run dev:mock`
- `scripts/health-check.mjs`: checks the live site end to end

## Deployment

Vercel builds every push; `main` goes to production at 27.cpd.dev (Cloudflare DNS, CNAME to
Vercel, not proxied). Functions run in `syd1` (see `vercel.json`).

GitHub Actions run the checks on every pull request and a **daily health check** at 08:30
Perth against the live site. A failure emails the repo owner, which is the early warning that
Transperth changed something. Run it by hand from the Actions tab, or locally with
`npm run health`. Set the repository variable `HEALTH_BASE_URL` to check another deployment.
GitHub turns off scheduled workflows in public repositories after 60 days without a commit;
re-enable it from the Actions tab if that happens.

## Credits

The Transperth API integration uses patterns documented in the MIT-licensed
[aiotransperth](https://github.com/Chris112/aiotransperth) project. The original board design
is Owen Christofferson's Grand & Perkins Board on Val Town. Map data © OpenStreetMap
contributors, tiles © CARTO.
