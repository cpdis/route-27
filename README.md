# Route 27 · Subiaco ↔ Perth

Mobile-first departure board for Transperth Route 27, remixed from
[Owen Christofferson's Grand & Perkins Board](https://www.val.town/x/owenchristofferson/GrandPerkinsBoard).

## Live app

https://subiaco27.val.run/

Use the **Subiaco** / **Perth CBD** switcher. The selected stop is remembered
on the device and can be linked explicitly with `?stop=10106` or `?stop=10091`.

| Stop | Official Transperth description | Route 27 direction |
| --- | --- | --- |
| 10106 | Bagot Rd Before Rowland St | East Perth |
| 10091 | St Georges Tce Stand 32 - Cat Id 21 | Claremont Stn (via Subiaco) |

## Data

- Source: Transperth website's stop timetable (SilverRail) endpoint.
- The website API is **unofficial**, requires a dynamically obtained verification
  token, and may change without notice.
- The server queries both stop-specific timetables and filters to **Route 27**.
- An available live estimate is displayed as live; otherwise departures are
  explicitly labeled **scheduled**.
- Times are interpreted in **Australia/Perth** (+08:00).
- Client checks every 55 seconds; the backend caches each stop for 110 seconds to
  avoid unnecessarily high request rates.
- If the upstream service is unavailable, a recently cached response can be
  shown with a prominent **old data** warning (up to 30 minutes).
- Server returns an empty route-specific list rather than falsely inventing
  times when Transperth reports no route 27 departures.

## Public API

- `GET /api/departures?stop=10106`
- `GET /api/departures?stop=10091`

Other stop numbers return HTTP 400.

## Mobile access

On your phone open the live URL, then use **Add to Home Screen** or
**Install app** in the browser menu. A mobile viewport, standalone app
manifest, and scalable Route 27 icon are supplied.

## Implementation

- `main.ts` — Hono HTTP routes and static file serving
- `lib/transperth.ts` — Transperth feed, verification, parsing, caching
- `frontend/root.tsx` — HTML shell and metadata
- `frontend/index.tsx` — React mobile interface, optimized for one-handed use
- `frontend/styles.css` — explicit light/dark CSS, responsive geometry and reduced-motion support; no runtime Tailwind dependency
- `frontend/icon.svg` and `frontend/manifest.webmanifest` — home-screen assets

The Transperth API integration uses patterns documented in the public
MIT-licensed [aiotransperth](https://github.com/Chris112/aiotransperth)
project by Chris. The fork maintains attribution to the original
Grand & Perkins Board in Val Town.
