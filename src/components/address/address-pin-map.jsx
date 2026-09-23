"use client";

// Click-to-place pin for the cascading address form.
//
// WHY THIS ONE IS A PICKER WHEN `address-map-preview.jsx` DELIBERATELY IS NOT
// -------------------------------------------------------------------------
// That component sits under an AddressValidator and shows the ONE coordinate a
// provider resolved. It refuses click-to-place, and is right to: a hand-placed
// pin there would be a coordinate with no address behind it, dressed up as a
// verification. The operator would read "map agrees" where nothing agreed.
//
// Here the pin is asked for explicitly and is honest about what it is — an
// operator's claim about where an address is. Two things keep it honest:
//
//   * the row is written with `provider = 'manual'` and `verified = false`, so
//     nothing downstream can mistake it for a provider verification, and
//   * the caption below says so in words, because the failure mode is a person
//     believing a dropped pin proved an address exists. It does not. It records
//     where someone said the door is.
//
// The cascade is what makes the address structurally valid; the pin is a useful
// extra, never the source of truth. A form with no pin is complete.
//
// Loaded through `dynamic(() => import(...), { ssr: false })` by the dialog, the
// same way every other Leaflet surface in this app is loaded — Leaflet touches
// `window` at import time and throws during SSR otherwise.

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import { Crosshair } from "lucide-react";
import "leaflet/dist/leaflet.css";
import "@/styles/map.css";
import { rasterTileUrl } from "@/lib/tomtom";
import { CHART_COLORS } from "@/lib/chart-tokens";
import { cn } from "@/lib/utils";

// Where the map opens when there is no pin yet.
//
// The PSGC tables carry no coordinates — they are an administrative hierarchy,
// not a gazetteer — so after picking a barangay there is still nothing to centre
// on. Rather than invent a centroid for the barangay (which would put a pin on a
// place no one chose), the map opens on the country and the operator zooms to
// their street. Zoom 6 frames the Philippines.
const DEFAULT_CENTER = [12.8797, 121.774];
const COUNTRY_ZOOM = 6;
const PIN_ZOOM = 16;

/** Places the pin wherever the operator clicks. */
function ClickToPlace({ onPlace }) {
  useMapEvents({
    click(event) {
      onPlace(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

/**
 * Sizes the map once it is mounted, and re-centres when the pin is CLEARED.
 *
 * `invalidateSize` is not optional: this map mounts inside a dialog that is still
 * animating open, so the container reports its pre-animation size and Leaflet
 * renders a clipped, half-grey tile grid.
 *
 * It deliberately does NOT re-centre on a click. The operator just clicked where
 * they wanted to look; `setView` would yank the map out from under the next click
 * and make placing a pin at high zoom feel like fighting the control.
 */
function SyncView({ hasPin }) {
  const map = useMap();
  const hadPin = useRef(hasPin);

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  useEffect(() => {
    if (!hasPin && hadPin.current) {
      map.setView(DEFAULT_CENTER, COUNTRY_ZOOM, { animate: false });
      map.invalidateSize();
    }
    hadPin.current = hasPin;
  }, [map, hasPin]);

  return null;
}

export default function AddressPinMap({ latitude, longitude, onChange, className }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasPin =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  // Leaflet cannot render on the server. The dialog dynamic-imports this file, so
  // this is belt-and-braces for any other caller.
  if (typeof window === "undefined") return null;

  function place(nextLat, nextLng) {
    // Six decimals is ~11cm — far finer than a hand-placed pin's real accuracy,
    // and short enough that the stored value does not imply precision it lacks.
    onChange?.({
      latitude: Number(nextLat.toFixed(6)),
      longitude: Number(nextLng.toFixed(6)),
    });
  }

  function clear() {
    onChange?.({ latitude: null, longitude: null });
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Crosshair className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span className="text-[0.68rem] font-bold uppercase tracking-[0.11em] text-foreground-muted">
            Pin the location{" "}
            <span className="font-medium normal-case tracking-normal">(optional)</span>
          </span>
        </div>
        {hasPin && (
          <button
            type="button"
            onClick={clear}
            className="text-xs font-semibold text-foreground-muted underline-offset-2 hover:text-danger hover:underline"
          >
            Clear pin
          </button>
        )}
      </div>

      <div
        role="application"
        aria-label={
          hasPin
            ? `Map with a pin placed at ${lat}, ${lng}. Click to move it.`
            : "Map of the Philippines. Click to place a pin."
        }
        className="h-[220px] w-full overflow-hidden rounded-xl border border-border"
      >
        <MapContainer
          center={hasPin ? [lat, lng] : DEFAULT_CENTER}
          zoom={hasPin ? PIN_ZOOM : COUNTRY_ZOOM}
          // Inside a form, a wheel-capturing map traps the page scroll mid-page.
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://developer.tomtom.com">TomTom</a>'
            url={rasterTileUrl()}
          />
          <SyncView hasPin={hasPin} />
          <ClickToPlace onPlace={place} />
          {hasPin && (
            <CircleMarker
              center={[lat, lng]}
              radius={9}
              pathOptions={{
                color: CHART_COLORS.info,
                fillColor: CHART_COLORS.info,
                fillOpacity: 0.85,
                weight: 2,
              }}
            />
          )}
        </MapContainer>
      </div>

      <p className="text-[0.7rem] leading-relaxed text-foreground-muted">
        {hasPin ? (
          <>
            Pin at {lat.toFixed(5)}, {lng.toFixed(5)}. Click the map to move it.
          </>
        ) : (
          <>Click the map to drop a pin. The address saves without one.</>
        )}{" "}
        A pin records where someone said the door is — it does not verify that the
        address exists there, and is never treated as one.
      </p>
    </div>
  );
}
