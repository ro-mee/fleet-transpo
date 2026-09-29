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
import { Crosshair, MapPin, Search } from "lucide-react";
import "leaflet/dist/leaflet.css";
import "@/styles/map.css";
import { rasterTileUrl } from "@/lib/tomtom";
import {
  COUNTRY_ZOOM,
  DEFAULT_CENTER,
  MIN_PIN_ZOOM,
  PIN_ZOOM,
  canPlacePinAtZoom,
  isViewableCentre,
  planViewMove,
} from "@/lib/address/pin-view";
import { CHART_COLORS } from "@/lib/chart-tokens";
import { cn } from "@/lib/utils";

// `DEFAULT_CENTER`, `COUNTRY_ZOOM` and `PIN_ZOOM` now live in
// `@/lib/address/pin-view`, beside the decision that uses them. The reasoning
// behind the country view — the PSGC tables carry no coordinates, and nothing
// invents a centroid for a barangay — moved there with them, because it is
// reasoning about that constant rather than about this component.
//
// Even with a centre, getting to a street is the operator's job on this control,
// so the zoom affordances are deliberate rather than incidental: `+` is always
// there, and the wheel is one click away — see `WheelZoom` below.

/**
 * What to say under the map while the address lookup is not showing a result.
 *
 * `found` is the load-bearing one. It is the only place the operator is told
 * that a map which has moved itself is not a pin that got placed — the sentence
 * that keeps "the viewport is here" from reading as "the door is here". It
 * deliberately does not repeat the verification caveat in the caption below,
 * which already covers it.
 *
 * `idle` has no line: there is nothing to explain before a barangay is chosen.
 */
const LOOKUP_MESSAGES = Object.freeze({
  stale: "The address changed after the last lookup. Find it again before placing a pin.",
  looking: "Finding this address on the map…",
  ambiguous: "TomTom returned multiple possible locations. Choose one to center the map.",
  empty: "TomTom returned no result. Zoom in and place the pin yourself.",
  unavailable: "Address lookup is unavailable. Zoom in and place the pin yourself.",
});

/** Places the pin only after the map has reached street scale. */
function ClickToPlace({ onPlace }) {
  const map = useMap();
  useMapEvents({
    click(event) {
      if (event.originalEvent?.target?.closest?.("[data-pin-center-control]")) return;
      if (!canPlacePinAtZoom(map.getZoom())) return;
      onPlace(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}

/** Keyboard-accessible way to pin the map after using its pan/zoom controls. */
function PinAtMapCenter({ onPlace, onZoomChange }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  const canPlace = canPlacePinAtZoom(zoom);

  useMapEvents({
    zoomend() {
      const nextZoom = map.getZoom();
      setZoom(nextZoom);
      onZoomChange(nextZoom);
    },
  });

  return (
    <button
      type="button"
      data-pin-center-control=""
      disabled={!canPlace}
      title={canPlace ? "Place pin at map center" : `Zoom in to level ${MIN_PIN_ZOOM} before placing a pin`}
      aria-label="Place pin at map center"
      onClick={() => {
        const centre = map.getCenter();
        onPlace(centre.lat, centre.lng);
      }}
      className="absolute bottom-3 right-3 z-[1000] inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/95 px-2.5 py-2 text-xs font-semibold text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
      Place pin at center
    </button>
  );
}

/**
 * Sizes the map once it is mounted, and performs every move of the viewport.
 *
 * `invalidateSize` is not optional: this map mounts inside a dialog that is still
 * animating open, so the container reports its pre-animation size and Leaflet
 * renders a clipped, half-grey tile grid.
 *
 * WHICH move to make, and whether to make one at all, is `planViewMove` over in
 * `@/lib/address/pin-view` — a separate module for one reason: this file imports
 * Leaflet at module scope and no node test can load it, so anything worth
 * asserting has to live somewhere else. What stays here is only what needs
 * `useMap`: the `setView` call and the refs holding the state the decision reads.
 *
 * The ordering that matters — a placed pin outranks a lookup result, and a
 * lookup for the same address does not get to overrule the operator's own answer
 * about where the door is — is asserted in `pin-view.test.js` rather than
 * watched in a browser.
 *
 * It still deliberately does NOT re-centre on a click. The operator just clicked
 * where they wanted to look; `setView` would yank the map out from under the next
 * click and make placing a pin at high zoom feel like fighting the control. A
 * click sets `hasPin`, which leaves through the pin branch anyway.
 */
function SyncView({ hasPin, centre }) {
  const map = useMap();
  const hadPin = useRef(hasPin);
  const lastCentre = useRef(null);

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  useEffect(() => {
    const { key, move } = planViewMove({
      hasPin,
      hadPin: hadPin.current,
      lastKey: lastCentre.current,
      centre,
    });
    // Recorded before the early return: a pin taking the view is itself a state
    // change, and the next run has to be able to see it as `hadPin` to know the
    // pin was cleared rather than never there.
    hadPin.current = hasPin;
    if (!move) return;

    lastCentre.current = key;
    map.setView(move.center, move.zoom, { animate: false });
    map.invalidateSize();
  }, [map, hasPin, centre]);

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

export default function AddressPinMap({
  latitude,
  longitude,
  /**
   * Where the address lookup says the entered address is, as `{ lat, lng, zoom }`.
   *
   * A VIEWPORT, never a pin. It is read to move the map and for nothing else —
   * it is never written to `latitude`/`longitude`, never stored, and never sent
   * anywhere. See `centreFromSearch` for why a looked-up point is not evidence
   * that anything is at it.
   */
  centre = null,
  /** `useAddressCentre`'s status, for the one line under the map. */
  lookupStatus = "idle",
  lookupCandidate = null,
  lookupCandidates = [],
  onFind,
  onChooseCandidate,
  canFind = false,
  onChange,
  className,
}) {
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

  // One opinion about what counts as a usable centre, applied everywhere `centre`
  // is read: the initial props, the label, and the view sync. `centre` arrives
  // from `centreFromSearch`, which validates its own output, so this normally
  // passes everything through — but three separate `centre ?` tests would each be
  // a chance for them to disagree about a malformed one, and the aria-label
  // claiming the map is centred on an address it is not is the kind of lie worth
  // making impossible.
  const usableCentre = isViewableCentre(centre) ? centre : null;

  // `MapContainer` reads `center` and `zoom` only as INITIAL values — changing
  // them later is inert, which is why `SyncView` exists. They are still made
  // centre-aware so a remount (the dialog reopening on the same address, with a
  // lookup result already held) opens in the right place rather than looking at
  // the country for a frame and then jumping.
  const initialCenter = hasPin
    ? [lat, lng]
    : usableCentre
      ? [usableCentre.lat, usableCentre.lng]
      : DEFAULT_CENTER;
  const initialZoom = hasPin ? PIN_ZOOM : usableCentre ? usableCentre.zoom : COUNTRY_ZOOM;

  // Declared above the server guard, not after it: a hook that runs on the client
  // and not on the server is a hook-order mismatch waiting to happen.
  const [wheelZoom, setWheelZoom] = useState(false);
  const [mapZoom, setMapZoom] = useState(initialZoom);

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
          <button
            type="button"
            onClick={onFind}
            disabled={!canFind || lookupStatus === "looking"}
            aria-busy={lookupStatus === "looking"}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-foreground-muted disabled:no-underline"
          >
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
            {lookupStatus === "looking" ? "Finding…" : "Find on map"}
          </button>
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

      <p className="text-[0.7rem] leading-relaxed text-foreground-muted">
        Find on map sends this address to TomTom only when you press the button. Its result centers the map; it does not place or verify a pin.
        {hasPin ? " Clear the pin before searching again." : !canFind ? " Enter a barangay, house number, and street to search." : ""}
      </p>

      <div
        role="application"
        aria-label={
          hasPin
            ? `Map with a pin placed at ${lat}, ${lng}. Click to move it.`
            : usableCentre
              ? `Map centred on the address you entered. Zoom to level ${MIN_PIN_ZOOM} to place a pin.`
              : `Map of the Philippines. Zoom to level ${MIN_PIN_ZOOM} to place a pin.`
        }
        className="h-[220px] w-full overflow-hidden rounded-xl border border-border"
      >
        <MapContainer
          center={initialCenter}
          zoom={initialZoom}
          // Inside a form, a wheel-capturing map traps the page scroll mid-page.
          // That is the STARTING state, not the only one — `WheelZoom` above hands
          // the wheel over on request rather than leaving `+` as the sole way in.
          scrollWheelZoom={false}
          keyboard={true}
          keyboardPanDelta={40}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://developer.tomtom.com">TomTom</a>'
            url={rasterTileUrl()}
          />
          <SyncView hasPin={hasPin} centre={usableCentre} />
          <WheelZoom enabled={wheelZoom} />
          <ClickToPlace onPlace={place} />
          <PinAtMapCenter onPlace={place} onZoomChange={setMapZoom} />
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
          canPlacePinAtZoom(mapZoom)
            ? <>Click the map or use “Place pin at center” to drop a pin. The address saves without one.</>
            : <>Zoom in to level {MIN_PIN_ZOOM} before placing a pin. The address saves without one.</>
        )}{" "}
        A pin records where someone said the door is — it does not verify that the
        address exists there, and is never treated as one.
      </p>

      {/* Only ever shown with no pin on the map: once one is placed the view is
          the pin's, the lookup result is irrelevant to it, and a line about the
          lookup would be talking about something the operator can no longer see.
          `idle` has no message at all — there is nothing to explain before a
          barangay has been chosen. */}
      {!hasPin && lookupStatus === "found" && (
        <p role="status" className="text-[0.7rem] leading-relaxed text-foreground-muted">
          {lookupCandidate?.label ? `TomTom result: ${lookupCandidate.label}. ` : "TomTom found a result. "}
          {lookupCandidate?.precision ? `Result type: ${lookupCandidate.precision}. ` : ""}
          {Number.isFinite(lookupCandidate?.confidence)
            ? `Provider text-match score: ${Math.round(lookupCandidate.confidence * 100)}%. `
            : ""}
          Review the map and place the pin yourself. The result and its score do not prove the door is there.
        </p>
      )}
      {!hasPin && LOOKUP_MESSAGES[lookupStatus] && (
        <p role="status" className="text-[0.7rem] leading-relaxed text-foreground-muted">
          {LOOKUP_MESSAGES[lookupStatus]}
        </p>
      )}
      {!hasPin && lookupStatus === "ambiguous" && (
        <div className="space-y-1.5" role="group" aria-label="Choose a map search result">
          {lookupCandidates.map((candidate, index) => (
            <button
              key={`${candidate.centre.lat},${candidate.centre.lng}`}
              type="button"
              onClick={() => onChooseCandidate?.(candidate)}
              className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-xs hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="block font-semibold text-foreground">
                {candidate.label || `Result ${index + 1}`}
              </span>
              <span className="mt-0.5 block text-foreground-muted">
                {candidate.precision || "Unknown result type"}
                {Number.isFinite(candidate.confidence)
                  ? ` · text-match score ${Math.round(candidate.confidence * 100)}%`
                  : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
