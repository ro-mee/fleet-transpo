"use client";

// The confirmation map under an AddressValidator.
//
// Shows the ONE coordinate the server resolved for the selected address, so an
// operator can see that the pin is where they meant. It is a confirmation, not
// a picker: there is no drag-to-move and no click-to-place, because a
// hand-placed pin is a coordinate with no address behind it — exactly the
// "Address B with Latitude A" shape this feature exists to prevent.
//
// Loaded through `dynamic(() => import(...), { ssr: false })` by the validator,
// the same way every other Leaflet surface in this app is loaded. Leaflet
// touches `window` at import time and throws during SSR otherwise.
//
// Props are plain numbers rather than an address object so this component can
// be dropped anywhere a coordinate exists, including outside this feature.

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "@/styles/map.css";
import { rasterTileUrl } from "@/lib/tomtom";
import { CHART_COLORS } from "@/lib/chart-tokens";
import { cn } from "@/lib/utils";

const DEFAULT_ZOOM = 16;

/**
 * Keeps the view on the current coordinate when it changes.
 *
 * Two jobs, both of which are silent failures if skipped:
 *  - `setView` when the operator picks a different address, because MapContainer
 *    reads `center` only on its FIRST render and would otherwise leave the pin
 *    off-screen while the marker moved.
 *  - `invalidateSize` because this map frequently mounts inside a dialog that is
 *    still animating open; the container reports its pre-animation size and
 *    Leaflet renders a clipped, half-grey tile grid.
 */
function SyncView({ latitude, longitude, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView([latitude, longitude], zoom, { animate: false });
    map.invalidateSize();
  }, [map, latitude, longitude, zoom]);
  return null;
}

export default function AddressMapPreview({ latitude, longitude, label, className }) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  // No coordinate, no map. Rendering an empty basemap would imply a location we
  // do not have — the validator shows a "not verified" state instead.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (typeof window === "undefined") return null;

  return (
    <div
      // role="img" + a label, because a canvas of tiles is otherwise silent to a
      // screen reader. The verification state chips carry the real meaning; this
      // just describes what the picture shows.
      role="img"
      aria-label={
        label ? `Map showing the location of ${label}` : "Map showing the selected location"
      }
      className={cn("h-[200px] w-full overflow-hidden rounded-xl border border-border", className)}
    >
      <MapContainer
        center={[lat, lng]}
        zoom={DEFAULT_ZOOM}
        // Inside a form, a wheel-capturing map traps the page scroll mid-page.
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://developer.tomtom.com">TomTom</a>'
          url={rasterTileUrl()}
        />
        <SyncView latitude={lat} longitude={lng} zoom={DEFAULT_ZOOM} />
        <CircleMarker
          center={[lat, lng]}
          radius={9}
          pathOptions={{
            color: CHART_COLORS.info,
            fillColor: CHART_COLORS.info,
            fillOpacity: 0.85,
            weight: 2,
          }}
        >
          {label ? <Tooltip>{label}</Tooltip> : null}
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
