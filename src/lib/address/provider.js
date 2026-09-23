// The AddressGeocoder interface — the seam that keeps every address form in the
// app decoupled from the vendor behind it.
//
// Forms and API routes import from HERE, never from `providers/tomtom` directly.
// That is what makes the provider decision reversible: swapping or adding a
// provider is a change to this file, not to the twelve call sites that would
// otherwise hardcode TomTom.
//
// The interface is three async functions:
//
//   search(query, opts)   query text   -> suggestions (id + label, NO coordinates)
//   geocode(placeId, opts) place id    -> a full, verified AddressValue
//   reverse(lat, lon, opts) coordinates -> a full, verified AddressValue
//
// Coordinate confidentiality is part of the contract, not an implementation
// detail: `search` deliberately does not return coordinates, so the browser
// cannot submit a location it resolved itself. Only `geocode` — which the server
// calls on the browser's behalf — produces an authoritative position.

import { tomtomProvider } from "./providers/tomtom";

/**
 * The active provider. Swapping this line is the entire migration cost.
 * @type {{ name: string, search: Function, geocode: Function, reverse: Function }}
 */
export const addressGeocoder = tomtomProvider;

/** The provider's stable identifier, stored alongside every verified address. */
export const activeProviderName = addressGeocoder.name;

export { MIN_QUERY_LENGTH } from "./providers/tomtom";
