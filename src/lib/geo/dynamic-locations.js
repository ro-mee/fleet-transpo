// DB-driven location resolution — the fully-dynamic path for hotel + airport.
//
// The sync gazetteer in `./distance` is a fallback for unknown text. When a
// `db` handle is available, resolve against the live registry FIRST so a
// hotel rename, a hotel move, or a new/renamed terminal needs no code change:
//
//   1. exact normalized-name match against active `locations` rows
//   2. hotel-name match against `system_settings.hotel_location`
//   3. sync gazetteer fallback (metro landmarks + seed airport defaults)
//
// Results are honestly labelled: `canonical` (registry row), `hotel`
// (configured base), `gazetteer` (static fallback), or null (unknown — never
// guessed, per the "Honest unknown" scope decision 2026-10-01).

import { resolveCoordinates as resolveGazetteer } from "@/lib/geo/distance";

const CACHE_TTL_MS = 30 * 1000;

let hotelCache = { at: 0, value: null, has: false };
let locationsCache = { at: 0, value: [] };

function normalizeName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function toCoords(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  if (la === 0 && ln === 0) return null;
  return { lat: la, lng: ln };
}

export function clearDynamicLocationCache() {
  hotelCache = { at: 0, value: null, has: false };
  locationsCache = { at: 0, value: [] };
}

/** Read the configured hotel base. Cached 30s; null when unconfigured. */
export async function getHotelContext(db) {
  if (!db?.query) return null;
  if (Date.now() - hotelCache.at < CACHE_TTL_MS && hotelCache.has) return hotelCache.value;
  try {
    const { rows } = await db.query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location' LIMIT 1`
    );
    const hotel = rows?.[0]?.setting_value ?? null;
    hotelCache = { at: Date.now(), value: hotel, has: true };
    return hotel;
  } catch {
    return hotelCache.value;
  }
}

/** All active registry locations (name + coords). Cached 30s. */
export async function getActiveLocations(db) {
  if (!db?.query) return [];
  if (Date.now() - locationsCache.at < CACHE_TTL_MS) return locationsCache.value;
  try {
    const { rows } = await db.query(
      `SELECT name, latitude, longitude FROM locations WHERE is_active = true`
    );
    const list = (rows ?? [])
      .map((r) => {
        const coords = toCoords(r.latitude, r.longitude);
        const name = String(r.name ?? "").trim();
        return name && coords ? { name, ...coords } : null;
      })
      .filter(Boolean);
    locationsCache = { at: Date.now(), value: list };
    return list;
  } catch {
    return locationsCache.value;
  }
}

/**
 * Resolve free-text to coordinates against live data first.
 * @returns {{lat,lng,label,source}|null}
 */
export async function resolveCoordinatesWithDb(db, text) {
  if (!text) return null;
  const wanted = normalizeName(text);
  if (!wanted) return null;

  if (db?.query) {
    const [locations, hotel] = await Promise.all([getActiveLocations(db), getHotelContext(db)]);

    const hit = locations.find((loc) => normalizeName(loc.name) === wanted);
    if (hit) return { lat: hit.lat, lng: hit.lng, label: hit.name, source: "canonical" };

    const hotelName = String(hotel?.hotel_name ?? hotel?.name ?? "").trim();
    if (hotelName && wanted === normalizeName(hotelName)) {
      const coords = toCoords(hotel.latitude ?? hotel.lat, hotel.longitude ?? hotel.lng);
      if (coords) return { ...coords, label: hotelName, source: "hotel" };
    }
    // Generic on-site words mean "the configured hotel", whichever it is.
    if (/hotel|lobby|property|base|headquarters|on.?site|premises/i.test(String(text))) {
      const coords = hotel ? toCoords(hotel.latitude ?? hotel.lat, hotel.longitude ?? hotel.lng) : null;
      if (coords) return { ...coords, label: hotelName || "Hotel Base", source: "hotel" };
    }
  }

  const fallback = resolveGazetteer(text);
  return fallback ? { ...fallback, source: "gazetteer" } : null;
}

/**
 * Estimate a trip using live registry coords first (haversine), else the
 * legacy estimator. Never invents: unresolvable sides yield low-confidence
 * metro-average, labelled as such.
 */
export async function estimateTripWithDb(db, pickup, dropoff) {
  const { estimateTrip, haversineKm } = await import("@/lib/geo/distance");
  if (db?.query) {
    const [from, to] = await Promise.all([
      resolveCoordinatesWithDb(db, pickup),
      resolveCoordinatesWithDb(db, dropoff),
    ]);
    if (from && to && from.source !== "gazetteer" && to.source !== "gazetteer") {
      const straight = haversineKm(from, to);
      const distanceKm = straight < 1 ? 3 : straight * 1.35;
      return {
        distanceKm: Number(distanceKm.toFixed(2)),
        durationMin: Math.round((distanceKm / 25) * 60 + 10),
        confidence: "high",
        basis: `${from.label} → ${to.label}`,
        source: "Live registry",
      };
    }
    // One or both sides only match the static fallback — run the legacy
    // estimator with the live hotel so the base is never stale.
    const hotel = await getHotelContext(db);
    const locations = await getActiveLocations(db);
    return { ...estimateTrip(pickup, dropoff, { hotel, airportLocations: locations }), source: "Legacy / Unknown" };
  }
  return { ...estimateTrip(pickup, dropoff), source: "Legacy / Unknown" };
}
