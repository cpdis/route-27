import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TripPayload, Vehicle } from "../../lib/transperth";
import { shortStopName, type Progress } from "../lib/progress";

// CARTO's raster tiles need a key since 25 Sep 2026 (free for personal use up to 5M tiles a
// month; request one at carto.com/basemaps/apikey). Without one, fall back to the standard
// OpenStreetMap tiles, toned down with a CSS filter (see .route-map.is-osm in styles.css).
const CARTO_KEY: string = import.meta.env.VITE_CARTO_KEY ?? "";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function tileLayer(dark: boolean): L.TileLayer {
  if (CARTO_KEY) {
    return L.tileLayer(
      `https://basemaps.cartocdn.com/rastertiles/${dark ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`,
      { attribution: OSM_ATTRIBUTION + ' &copy; <a href="https://carto.com/attributions">CARTO</a>', maxZoom: 19, detectRetina: true },
    );
  }
  // OSM has no @2x tiles; detectRetina would fetch four times the tiles at unreadable label sizes.
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: OSM_ATTRIBUTION, maxZoom: 19 });
}

function prefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Point at a fractional stop index, for timetable-estimated positions. */
function pointAt(trip: TripPayload, position: number): L.LatLngTuple | null {
  if (position < 0) return null;
  const i = Math.min(trip.stops.length - 1, Math.floor(position));
  const j = Math.min(trip.stops.length - 1, i + 1);
  const t = position - i;
  const a = trip.stops[i];
  const b = trip.stops[j];
  return [a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t];
}

function busIcon(bearing: number | null, estimated: boolean): L.DivIcon {
  const arrow = bearing == null ? "" :
    `<span class="map-bus-arrow" style="transform:rotate(${Math.round(bearing)}deg)"></span>`;
  return L.divIcon({
    className: "map-bus" + (estimated ? " is-estimated" : ""),
    html: `${arrow}<span class="map-bus-dot">27</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export default function RouteMap({ trip, progress, vehicle }: {
  trip: TripPayload; progress: Progress; vehicle: Vehicle | null;
}) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const bus = useRef<L.Marker | null>(null);
  const fitted = useRef("");

  // Build the map and route once per trip.
  useEffect(() => {
    if (!node.current) return;
    const m = L.map(node.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
      // On phones a one-finger drag scrolls the page; pinch still zooms.
      dragging: !L.Browser.mobile,
    });
    tileLayer(prefersDark()).addTo(m);
    const accent = cssVar("--accent", "#087954");
    const faint = cssVar("--faint", "#87968d");
    const line = trip.stops.map(s => [s.lat, s.lon] as L.LatLngTuple);
    L.polyline(line.slice(0, progress.target + 1), { color: accent, weight: 5, opacity: 0.85 }).addTo(m);
    L.polyline(line.slice(progress.target), { color: faint, weight: 3, opacity: 0.6, dashArray: "4 6" }).addTo(m);
    trip.stops.forEach((s, i) => {
      const yours = i === progress.target;
      L.circleMarker([s.lat, s.lon], {
        radius: yours ? 7 : 3.5,
        color: yours ? accent : faint,
        weight: yours ? 3 : 1.5,
        fillColor: yours ? "#fff" : cssVar("--surface", "#fff"),
        fillOpacity: 1,
      }).bindTooltip(shortStopName(s.name) + (yours ? " · your stop" : ""), { direction: "top", offset: [0, -6] }).addTo(m);
    });
    map.current = m;
    fitted.current = "";
    return () => { m.remove(); map.current = null; bus.current = null; };
  }, [trip.tripUid, progress.target]);

  // Move the bus without rebuilding the map.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const point: L.LatLngTuple | null = vehicle ? [vehicle.lat, vehicle.lon] : pointAt(trip, progress.position);
    const estimated = !vehicle;
    if (point) {
      if (!bus.current) bus.current = L.marker(point, { icon: busIcon(vehicle?.bearing ?? null, estimated), keyboard: false, zIndexOffset: 1000 }).addTo(m);
      else { bus.current.setLatLng(point); bus.current.setIcon(busIcon(vehicle?.bearing ?? null, estimated)); }
    } else if (bus.current) {
      bus.current.remove();
      bus.current = null;
    }
    // Frame the bus and your stop the first time, then leave the view to the person.
    const key = trip.tripUid;
    if (fitted.current !== key) {
      const yours = trip.stops[progress.target];
      const from = Math.max(0, Math.min(progress.target - 3, Math.floor(Math.max(progress.position, 0))));
      const pts: L.LatLngTuple[] = trip.stops.slice(from, progress.target + 1).map(s => [s.lat, s.lon]);
      if (point) pts.push(point);
      pts.push([yours.lat, yours.lon]);
      m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
      fitted.current = key;
    }
  }, [trip, progress.position, progress.target, vehicle]);

  return <div ref={node} className={"route-map" + (CARTO_KEY ? "" : " is-osm")} role="region" aria-label="Map of the bus and your stop" />;
}
