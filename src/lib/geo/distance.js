// Distance + duration estimation for transportation requests.
//
// Fleet maps pickup/dropoff arriving from Booking as free-text strings
// ("NAIA Terminal 2 - Arrivals", "CoCo Star Hotel").
// This module resolves known endpoint strings and hotel base routes. Canonical
// NAIA arrivals/departures are kept in one shared list; an unspecified terminal
// remains ad-hoc instead of silently choosing the wrong curbside point.

import { NAIA_CANONICAL_LOCATIONS } from "@/lib/naia-locations";

const EARTH_RADIUS_KM = 6371;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Known landmarks around CoCo Star Hotel's service area. Airport coordinates
// come from the canonical location registry; route distances are calculated by
// the resolver/TomTom when both endpoint IDs are available.
const GAZETTEER = [
  // CoCo Star Hotel Base Location
  {
    match: /coco star|coco|hotel|lobby|property|on.?site|premises/i,
    lat: 14.5159034,
    lng: 120.9953405,
    label: "CoCo Star Hotel",
    isHotel: true,
  },

  ...NAIA_CANONICAL_LOCATIONS.map((location) => ({
    match: new RegExp(escapeRegExp(location.name), "i"),
    lat: location.latitude,
    lng: location.longitude,
    label: location.name,
  })),

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

/** CoCo Star Hotel base coordinates, used as the fallback when a position is unknown. */
export const HOTEL_BASE = { lat: 14.5159034, lng: 120.9953405 };

/** Resolve a free-text location to gazetteer coordinates, or null. */
export function resolveCoordinates(text) {
  if (!text) return null;
  const s = String(text);
  for (const entry of GAZETTEER) {
    if (entry.match.test(s)) return { lat: entry.lat, lng: entry.lng, label: entry.label };
  }
  return null;
}

/** Resolve a free-text location to the full gazetteer entry, or null. */
function resolveLocation(text) {
  if (!text) return null;
  const s = String(text);
  for (const entry of GAZETTEER) {
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
export function estimateTrip(pickup, dropoff) {
  const from = resolveLocation(pickup);
  const to = resolveLocation(dropoff);

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
