// Where the pin map's viewport goes — the decision, kept out of Leaflet.
//
// `SyncView` in `address-pin-map.jsx` performs the two `setView` calls, but the
// question of WHICH move to make, if any, is pure arithmetic on four inputs and
// lives here. The reason is testability and nothing else: this repo cannot render
// React in a test (`vitest.config.mjs` sets `environment: "node"`, with no jsdom
// and no testing-library), and `address-pin-map.jsx` imports Leaflet at module
// scope, which throws without a `window`. Anything deserving an assertion has to
// be importable by plain node — the same reason `centreFromSearch` lives in
// `tomtom.js` rather than inside the component that calls it.
//
// What is encoded here is a rule about the product, not about maps: a pin the
// operator placed outranks a lookup result for the same address. That ordering
// used to be asserted only by watching the browser; it is now a function.

// Where the map opens when there is no pin and nothing to centre on.
//
// The PSGC tables carry no coordinates — they are an administrative hierarchy,
// not a gazetteer — so the cascade alone cannot say where a barangay is, and
// nothing here invents a centroid for one: a centroid is a place nobody chose.
// Zoom 6 frames the Philippines.
//
// That refusal is the FALLBACK rather than the whole story. The dialog looks the
// entered address up (`useAddressCentre`) and passes the result down as
// `centre`, which moves the viewport to it. The point is never written to the
// pin — see `centreFromSearch` in `tomtom.js` for why a looked-up point is not
// evidence that anything is there.
export const DEFAULT_CENTER = [12.8797, 121.774];
export const COUNTRY_ZOOM = 6;

/**
 * The zoom a placed pin is shown at.
 *
 * `LOOKUP_MAX_ZOOM` in `tomtom.js` restates this as a literal `16` on purpose,
 * so that moving one without the other is a failing test rather than a silent
 * divergence — a lookup must never frame tighter than a pin would. The literal
 * is asserted here too, so the coupling is checked from both ends and neither
 * side can drift alone.
 */
export const PIN_ZOOM = 16;

/**
 * Whether a `centre` is something `setView` can actually be given.
 *
 * `centre` comes from `centreFromSearch`, which is total and validates its own
 * coordinates, so in practice this passes everything. It exists so that the
 * decision below is TOTAL — it returns an answer for every input rather than
 * trusting its caller — and it is applied in `address-pin-map.jsx` as well, so
 * the initial props, the aria-label and the view sync all agree on what counts
 * as a usable centre instead of each having its own idea.
 *
 * Only finiteness is checked. Out-of-range values cannot reach here (the parser
 * clamps and range-checks), and Leaflet wraps rather than throws on them, so a
 * bounds test here would be a second opinion about something already settled.
 *
 * @param {{lat: number, lng: number, zoom: number}|null|undefined} centre
 */
export function isViewableCentre(centre) {
  return (
    centre != null &&
    Number.isFinite(centre.lat) &&
    Number.isFinite(centre.lng) &&
    Number.isFinite(centre.zoom)
  );
}

/** Identity for a centre, so "has this changed?" is a string comparison. */
function viewKey(centre) {
  return isViewableCentre(centre) ? `${centre.lat},${centre.lng},${centre.zoom}` : null;
}

/**
 * The move `SyncView` should make, given what it last did and what it has now.
 *
 * Returns `{ key, move }`, where `move` is `{ center, zoom }` for a `setView`
 * call or `null` to leave the view alone. The caller stores `key` and passes it
 * back as `lastKey` next time; it is returned even when there is no move, so a
 * caller cannot accidentally record an action that did not happen.
 *
 * @param {object} state
 * @param {boolean} state.hasPin      a pin is placed right now
 * @param {boolean} state.hadPin      one was placed last time this ran
 * @param {string|null} state.lastKey the key returned by the previous call
 * @param {object|null} state.centre  the address lookup's result
 * @returns {{key: string|null, move: {center: number[], zoom: number}|null}}
 */
export function planViewMove({ hasPin, hadPin, lastKey, centre }) {
  // A placed pin owns the view. Nothing moves the map while one exists, and
  // `lastKey` is handed back untouched rather than advanced to the centre we are
  // declining to act on.
  if (hasPin) return { key: lastKey, move: null };

  const key = viewKey(centre);

  // Clearing the pin is a move even when the centre has not changed: the
  // operator asked to see the address again after the pin had taken the view, so
  // "nothing new to show" is the wrong answer for it.
  const pinWasCleared = !hasPin && hadPin;
  // This is also what makes mount a no-op. On first run `lastKey` is null and, with
  // no centre, the new key is null too — so `MapContainer`'s own `center`/`zoom`
  // props stand rather than being immediately re-asserted.
  if (!pinWasCleared && lastKey === key) return { key: lastKey, move: null };

  if (!isViewableCentre(centre)) {
    return { key, move: { center: DEFAULT_CENTER, zoom: COUNTRY_ZOOM } };
  }
  return { key, move: { center: [centre.lat, centre.lng], zoom: centre.zoom } };
}
