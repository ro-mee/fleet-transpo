// Distance + duration estimation for transportation requests.
//
// Fleet maps pickup/dropoff arriving from Booking as free-text strings
// (e.g. an airport terminal name, a hotel name).
// This module resolves known endpoint strings and hotel base routes.
//
// Fully-dynamic contract (2026-10-01): the hotel and the airport endpoints are
// DB-driven. `system_settings.hotel_location` owns the hotel base and the
// `locations` registry owns the airport terminals (managed via
// /routes/locations). The static lists below are SEED DEFAULTS only — the
// fallback when no DB override is supplied — never the authority. Pass
// `{ hotel, airportLocations }` to resolve against live data instead.

import { NAIA_CANONICAL_LOCATIONS } from "@/lib/naia-locations";

const EARTH_RADIUS_KM = 6371;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validCoord(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180
    ? { lat: la, lng: ln }
    : null;
}

/**
 * Build the hotel gazetteer entry from a DB hotel object.
 * Returns null when the hotel carries no usable name + coordinates.
 */
export function buildHotelEntry(hotel) {
  const name = String(hotel?.hotel_name ?? hotel?.name ?? "").trim();
  const coords = hotel ? validCoord(hotel.latitude ?? hotel.lat, hotel.longitude ?? hotel.lng) : null;
  if (!name || !coords) return null;
  // Exact hotel-name match first, then generic on-site words (lobby, premises,
  // property, base) which mean "the configured hotel", whichever it is.
  // NOTE: no brand literal here — the previous `/coco star|coco/` match is
  // deliberately gone. A rename must not leave a stale brand match behind.
  return {
    match: new RegExp(`${escapeRegExp(name)}|hotel|lobby|property|base|headquarters|on.?site|premises`, "i"),
    lat: coords.lat,
    lng: coords.lng,
    label: name,
    isHotel: true,
  };
}

/**
 * Build airport gazetteer entries from DB location rows.
 * Falls back to the seed defaults when no usable rows are supplied.
 */
export function buildAirportEntries(airportLocations) {
  const rows = Array.isArray(airportLocations) ? airportLocations : [];
  const usable = rows
    .map((loc) => {
      const name = String(loc?.name ?? "").trim();
      const coords = validCoord(loc?.latitude ?? loc?.lat, loc?.longitude ?? loc?.lng);
      return name && coords ? { name, ...coords } : null;
    })
    .filter(Boolean);
  const source = usable.length ? usable : NAIA_CANONICAL_LOCATIONS;
  return source.map((location) => ({
    match: new RegExp(escapeRegExp(location.name), "i"),
    lat: Number(location.latitude ?? location.lat),
    lng: Number(location.longitude ?? location.lng),
    label: location.name,
  }));
}

// Metro landmarks around the service area. These are generic city estimates,
// NOT hotel/airport identity — they stay static by design (see scope decision
// 2026-10-01: "Hotel + NAIA only"). Airport coordinates come from the location
// registry; route distances are calculated by the resolver/TomTom when both
// endpoint IDs are available.
const METRO_LANDMARKS = [

  // Metro Landmarks
  {
    match: /pasay|mall of asia|moa/i,
    lat: 14.5378,
    lng: 120.9822,
    label: "Pasay/MOA",
    distanceOverride: 4.2,
    durationOverride: 12,
  },
  {
    match: /makati|ayala|bgc|bonifacio|taguig/i,
    lat: 14.5547,
    lng: 121.0244,
    label: "Makati/BGC",
    distanceOverride: 6.5,
    durationOverride: 20,
  },
  {
    match: /manila|intramuros|ermita|malate/i,
    lat: 14.5995,
    lng: 120.9842,
    label: "Manila",
    distanceOverride: 9.8,
    durationOverride: 25,
  },
  {
    match: /quezon city|qc|cubao|diliman/i,
    lat: 14.676,
    lng: 121.0437,
    label: "Quezon City",
    distanceOverride: 18.5,
    durationOverride: 45,
  },
  {
    match: /alabang|muntinlupa|paranaque/i,
    lat: 14.4229,
    lng: 121.0245,
    label: "Alabang",
    distanceOverride: 14.2,
    durationOverride: 30,
  },
  {
    match: /ortigas|pasig|mandaluyong/i,
    lat: 14.5866,
    lng: 121.0614,
    label: "Ortigas",
    distanceOverride: 12.0,
    durationOverride: 35,
  },
  {
    match: /clark|pampanga|angeles/i,
    lat: 15.1855,
    lng: 120.5601,
    label: "Clark",
    distanceOverride: 95.0,
    durationOverride: 110,
  },
  {
    match: /tagaytay|cavite/i,
    lat: 14.1153,
    lng: 120.9621,
    label: "Tagaytay",
    distanceOverride: 58.0,
    durationOverride: 85,
  },
  {
    match: /batangas|lipa/i,
    lat: 13.7565,
    lng: 121.0583,
    label: "Batangas",
    distanceOverride: 105.0,
    durationOverride: 120,
  },
];

const DEFAULT_DISTANCE_KM = 12;
const ROAD_WINDING_FACTOR = 1.35;
const AVG_SPEED_KMH = 25;
const FIXED_OVERHEAD_MIN = 10;

/**
 * @deprecated Seed fallback only. Read the hotel base from
 * `system_settings.hotel_location` (see `src/lib/geo/dynamic-locations.js`
 * `getHotelContext`) instead of importing this constant.
 */
export const HOTEL_BASE = { lat: 14.5159034, lng: 120.9953405 };

/**
 * Resolve the hotel base coordinates from a DB hotel object.
 * Returns the hotel's own coordinates when valid, else the seed fallback.
 */
export function resolveHotelBase(hotel) {
  const coords = hotel ? validCoord(hotel.latitude ?? hotel.lat, hotel.longitude ?? hotel.lng) : null;
  return coords ?? HOTEL_BASE;
}

/**
 * Assemble the gazetteer for one resolution. Hotel + airport entries are
 * dynamic (DB overrides win); metro landmarks are static by design.
 */
function gazetteerFor(overrides) {
  const hotelEntry = buildHotelEntry(overrides?.hotel);
  const airportEntries = buildAirportEntries(overrides?.airportLocations);
  if (hotelEntry) return [hotelEntry, ...airportEntries, ...METRO_LANDMARKS];
  // No DB hotel supplied — seed hotel entry so legacy callers keep working.
  // Brand literal removed; generic on-site words point at the seed coords.
  return [
    {
      match: /hotel|lobby|property|base|headquarters|on.?site|premises/i,
      lat: HOTEL_BASE.lat,
      lng: HOTEL_BASE.lng,
      label: "Hotel Base",
      isHotel: true,
    },
    ...airportEntries,
    ...METRO_LANDMARKS,
  ];
}

/** Resolve a free-text location to gazetteer coordinates, or null. */
export function resolveCoordinates(text, overrides) {
  if (!text) return null;
  const s = String(text);
  for (const entry of gazetteerFor(overrides)) {
    if (entry.match.test(s)) return { lat: entry.lat, lng: entry.lng, label: entry.label };
  }
  return null;
}

/** Resolve a free-text location to the full gazetteer entry, or null. */
function resolveLocation(text, overrides) {
  if (!text) return null;
  const s = String(text);
  for (const entry of gazetteerFor(overrides)) {
    if (entry.match.test(s)) return entry;
  }
  return null;
}

/** Great-circle distance between two lat/lng points, in km. */
export function haversineKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Estimate distance and duration for a pickup → dropoff pair.
 *
 * @param {string} pickup   free-text pickup location
 * @param {string} dropoff  free-text dropoff location
 * @returns {{ distanceKm: number, durationMin: number, confidence: "high"|"low", basis: string }}
 */
export function estimateTrip(pickup, dropoff, overrides) {
  const from = resolveLocation(pickup, overrides);
  const to = resolveLocation(dropoff, overrides);

  let distanceKm;
  let durationMin;
  let confidence;
  let basis;

  if (from && to) {
    const overrideDist = from.distanceOverride || to.distanceOverride;
    const overrideDur = from.durationOverride || to.durationOverride;

    if ((from.isHotel || to.isHotel) && overrideDist && overrideDur) {
      distanceKm = overrideDist;
      durationMin = overrideDur;
      confidence = "high";
      basis = `Pre-configured Route: ${from.label} ↔ ${to.label}`;
    } else {
      const straight = haversineKm(from, to);
      distanceKm = straight < 1 ? 3 : straight * ROAD_WINDING_FACTOR;
      durationMin = Math.round((distanceKm / AVG_SPEED_KMH) * 60 + FIXED_OVERHEAD_MIN);
      confidence = "high";
      basis = `${from.label} → ${to.label}`;
    }
  } else {
    distanceKm = DEFAULT_DISTANCE_KM;
    durationMin = Math.round((distanceKm / AVG_SPEED_KMH) * 60 + FIXED_OVERHEAD_MIN);
    confidence = "low";
    basis = "Unrecognized locations — using metro-average estimate";
  }

  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    durationMin,
    confidence,
    basis,
  };
}

/**
 * Estimate fuel needed for a trip.
 *
 * @param {number} distanceKm
 * @param {number} [kmPerLiter=8] vehicle efficiency; 8 is a fair sedan/van average
 * @returns {{ liters: number, percentOfTank: number|null }}
 */
export function estimateFuel(distanceKm, kmPerLiter = 8, tankCapacityL = null) {
  const efficiency = kmPerLiter > 0 ? kmPerLiter : 8;
  const liters = (distanceKm * 2) / efficiency;
  return {
    liters: Number(liters.toFixed(2)),
    percentOfTank: tankCapacityL ? Number(((liters / tankCapacityL) * 100).toFixed(1)) : null,
  };
}
