// Distance + duration estimation for transportation requests.
//
// Fleet has no mapping-provider integration, and pickup/dropoff arrive from
// Booking as free-text strings ("NAIA Terminal 3", "Hotel Lobby"). Rather than
// pretend to route, this module estimates from a small gazetteer of known
// locations and falls back to a conservative default.
//
// These numbers drive fuel estimates and ETA hints in the dispatch UI. They are
// ADVISORY — always rendered as "~" estimates, never billed against. When a
// real routing provider is wired in, replace estimateTrip() and leave callers
// untouched.

const EARTH_RADIUS_KM = 6371;

// Known landmarks around the hotel's service area (lat, lng).
// Extend as operations expand; unknown locations fall through to the default.
const GAZETTEER = [
  { match: /naia|ninoy aquino|terminal [1-4]|airport/i, lat: 14.5086, lng: 121.0198, label: "NAIA" },
  { match: /makati|ayala|bgc|bonifacio|taguig/i, lat: 14.5547, lng: 121.0244, label: "Makati/BGC" },
  { match: /manila|intramuros|ermita|malate/i, lat: 14.5995, lng: 120.9842, label: "Manila" },
  { match: /quezon city|qc|cubao|diliman/i, lat: 14.676, lng: 121.0437, label: "Quezon City" },
  { match: /pasay|mall of asia|moa/i, lat: 14.5378, lng: 120.9822, label: "Pasay" },
  { match: /alabang|muntinlupa|paranaque/i, lat: 14.4229, lng: 121.0245, label: "Alabang" },
  { match: /ortigas|pasig|mandaluyong/i, lat: 14.5866, lng: 121.0614, label: "Ortigas" },
  { match: /clark|pampanga|angeles/i, lat: 15.1855, lng: 120.5601, label: "Clark" },
  { match: /tagaytay|cavite/i, lat: 14.1153, lng: 120.9621, label: "Tagaytay" },
  { match: /batangas|lipa/i, lat: 13.7565, lng: 121.0583, label: "Batangas" },
  { match: /hotel|lobby|property|on.?site|premises/i, lat: 14.5547, lng: 121.0244, label: "Hotel" },
];

// Fallback when neither endpoint resolves: a typical metro transfer.
const DEFAULT_DISTANCE_KM = 15;
// Straight-line distance underestimates real roads; metro Manila street layout
// plus traffic routing adds roughly 35%.
const ROAD_WINDING_FACTOR = 1.35;
// Average effective speed in km/h including traffic and stops.
const AVG_SPEED_KMH = 25;
// Buffer added to every trip for pickup, loading, and drop-off (minutes).
const FIXED_OVERHEAD_MIN = 10;

/** Resolve a free-text location to gazetteer coordinates, or null. */
function resolveLocation(text) {
  if (!text) return null;
  const s = String(text);
  for (const entry of GAZETTEER) {
    if (entry.match.test(s)) return entry;
  }
  return null;
}

/** Great-circle distance between two lat/lng points, in km. */
function haversineKm(a, b) {
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
export function estimateTrip(pickup, dropoff) {
  const from = resolveLocation(pickup);
  const to = resolveLocation(dropoff);

  let distanceKm;
  let confidence;
  let basis;

  if (from && to) {
    const straight = haversineKm(from, to);
    // Same resolved landmark (e.g. hotel → hotel): treat as a short local run
    // rather than reporting 0 km, which would zero out the fuel estimate.
    distanceKm = straight < 1 ? 3 : straight * ROAD_WINDING_FACTOR;
    confidence = "high";
    basis = `${from.label} → ${to.label}`;
  } else {
    distanceKm = DEFAULT_DISTANCE_KM;
    confidence = "low";
    basis = "Unrecognized locations — using metro-average estimate";
  }

  const durationMin = Math.round((distanceKm / AVG_SPEED_KMH) * 60 + FIXED_OVERHEAD_MIN);

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
  // Round-trip: the vehicle returns to base after the drop-off.
  const liters = (distanceKm * 2) / efficiency;
  return {
    liters: Number(liters.toFixed(2)),
    percentOfTank: tankCapacityL ? Number(((liters / tankCapacityL) * 100).toFixed(1)) : null,
  };
}
