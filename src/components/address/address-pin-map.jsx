"use client";

// Click-to-place pin for the cascading address form.
//
// WHAT A DROPPED PIN IS, AND WHAT IT IS NOT
// -----------------------------------------
// The pin is asked for explicitly and is honest about what it is — an
// operator's claim about where an address is. Nothing re-derives an address
// from it and nothing treats it as a provider verification. The mounted
// TomTom combobox this used to be contrasted against was deleted 2026-09-25
// with the rest of its dead island; the distinction it drew is kept here
// because the pin outlived it. Two things keep it honest:
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

import { useEffect, useRef, useState } from "react";
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
//
// Getting from there to a street is the operator's whole job on this control, so
// the zoom affordances are deliberate rather than incidental: `+` is always there,
// and the wheel is one click away — see `WheelZoom` below.
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

/**
 * Scroll-wheel zoom, off until the operator asks for it.
 *
 * `scrollWheelZoom={false}` on the MapContainer is deliberate — a wheel-capturing
 * map inside a form swallows the page scroll — but on its own it left `+` as the
 * only way in, and from COUNTRY_ZOOM to PIN_ZOOM is ten presses of it. The wheel
 * is therefore available, behind one explicit click.
 *
 * WHY THE CLICK IS AN ACTUAL CONTROL, NOT FOCUS. The obvious version of this —
 * enable on focus, disable on blur — does not work here, and the reason is worth
 * keeping. Clicking the map both focuses it (`_onMouseDown`, leaflet-src.js:14009)
 * and places the pin (`ClickToPlace` below), so the activating click would drop a
 * pin on whatever happened to be under the cursor at country zoom — a pin nobody
 * chose, which is the exact thing this component refuses to fabricate. And the
 * `+` control is a `<button>`, so using it never focuses the container at all:
 * the wheel would stay dead for precisely the operator already struggling to
 * navigate. Asking costs one click in a state where the operator is about to
 * spend twenty, and it keeps the original promise — the page scrolls normally
 * until someone says otherwise.
 *
 * Consent then stands for as long as the dialog is open; moving the pointer off
 * the map is how you get the page scroll back, the same as any embed. The map is
 * not re-centred here, only made navigable — `SyncView` above owns the view.
 */
function WheelZoom({ enabled }) {
  const map = useMap();

  useEffect(() => {
    if (!enabled) return undefined;
    map.scrollWheelZoom.enable();
    // The handler survives the component, and `scrollWheelZoom={false}` will not
    // put it back, so unmounting (the dialog closing) has to undo it by hand.
    return () => map.scrollWheelZoom.disable();
  }, [map, enabled]);

  return null;
}

export default function AddressPinMap({ latitude, longitude, onChange, className }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  // The `!= null` pair is load-bearing, not defensive noise. `Number(null)` is
  // `0`, which passes `Number.isFinite` AND the bounds test, so without it a form
  // with NO pin computed `hasPin = true` — and every consequence of that followed:
  // a phantom marker at (0, 0) in the Gulf of Guinea, `center` pinned to [0, 0] at
  // zoom 16 rather than the country view below, a "Pin at 0.00000, 0.00000" caption
  // for a pin nobody placed, the "Clear pin" button offered on an empty field, and
  // `SyncView` never re-centring because it never saw the pin leave. The blank
  // address stores `latitude: null`, so this was the state of every form that had
  // not been touched. Bounds and finiteness still guard a malformed pair; absence
  // has to be tested before either of them can mean anything.
  const hasPin =
    latitude != null &&
    longitude != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  // Declared above the server guard, not after it: a hook that runs on the client
  // and not on the server is a hook-order mismatch waiting to happen.
  const [wheelZoom, setWheelZoom] = useState(false);

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
        <div className="flex shrink-0 items-center gap-3">
          {!wheelZoom && (
            <button
              type="button"
              onClick={() => setWheelZoom(true)}
              className="text-xs font-semibold text-foreground-muted underline-offset-2 hover:text-primary hover:underline"
            >
              Enable wheel zoom
            </button>
          )}
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
          // That is the STARTING state, not the only one — `WheelZoom` above hands
          // the wheel over on request rather than leaving `+` as the sole way in.
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://developer.tomtom.com">TomTom</a>'
            url={rasterTileUrl()}
          />
          <SyncView hasPin={hasPin} />
          <WheelZoom enabled={wheelZoom} />
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
