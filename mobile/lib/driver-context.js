/**
 * Cached driver context — the one shared source of "what vehicle am I
 * driving" for offline screens (Offline Read Mode follow-up).
 *
 * Report Incident, Fuel Report, and Profile > Assigned Vehicle all need the
 * driver's vehicle. Before this module each screen did its own live fetch
 * with a silent catch, so offline meant a silently missing vehicle. Now they
 * read the SAME cache entries the core screens already write
 * (HOME_TRIPS/TRIPS_ALL/TRIPS_TODAY + DRIVER_ME) and resolve through one
 * priority chain. The trip snapshots are read together and the newest
 * syncedAt wins, so a date-scoped snapshot never shadows fresher data.
 *
 * Vehicle priority (locked):
 *   1. trip explicitly opened — the trip's own vehicle
 *   2. active trip vehicle — a genuinely in-progress trip
 *   3. the driver's standing assignment (driver_vehicle_assignments)
 *   4. null — no saved assignment; say so, never guess
 * NEVER a "recent trip" vehicle: a finished trip's vehicle is not proof of a
 * current assignment — the driver may have been reassigned since.
 *
 * Shape tolerance (locked): trips rows and /api/mobile/driver/me are
 * snake_case (vehicle_id, vehicle_plate/plate_number); /api/driver/me's
 * assignedVehicle is camelCase (vehicleId, plateNumber). Both are accepted —
 * and both wire shapes are pinned in driver-context.test.js (the
 * resolveDriverId lesson: test the shape the wire actually sends).
 */

import { CACHE_KEYS, getCached } from "./offline-cache";

/** Trip statuses that make a trip's vehicle "the active trip vehicle". */
const ACTIVE_TRIP_STATUSES = [
  "Driver Accepted",
  "Trip Started",
  "At Pickup",
  "Passenger Onboard",
  "En Route",
  "Drop-off",
  "Arrived",
  "In Progress",
];

function vehicleIdOf(obj) {
  const id = obj?.vehicle_id ?? obj?.vehicleId ?? null;
  return id == null ? null : id;
}

function plateOf(obj) {
  const plate = obj?.vehicle_plate ?? obj?.plate_number ?? obj?.plateNumber ?? obj?.plate ?? null;
  return plate == null ? null : String(plate);
}

/**
 * Pure resolver — no storage, no network. Callers pass whatever they hold.
 * @param {{trip?: object|null, trips?: Array|null, me?: object|null, activeStatuses?: string[]}} input
 * @returns {{vehicleId, plate}|null}
 */
export function resolveVehicleContext({ trip, trips, me, activeStatuses } = {}) {
  const active = Array.isArray(activeStatuses) && activeStatuses.length > 0
    ? activeStatuses
    : ACTIVE_TRIP_STATUSES;

  // 1. The trip the driver explicitly opened (or is submitting against).
  if (trip != null && vehicleIdOf(trip) != null) {
    return { vehicleId: vehicleIdOf(trip), plate: plateOf(trip) };
  }

  // 2. A genuinely in-progress trip from the driver's trip list.
  const list = Array.isArray(trips) ? trips : [];
  const activeTrip = list.find(
    (t) => t != null && active.includes(t.trip_status) && vehicleIdOf(t) != null
  );
  if (activeTrip) {
    return { vehicleId: vehicleIdOf(activeTrip), plate: plateOf(activeTrip) };
  }

  // 3. The driver's standing assignment from their /driver/me profile.
  const assigned = me?.assignedVehicle ?? me?.assigned_vehicle ?? null;
  if (assigned != null && vehicleIdOf(assigned) != null) {
    return { vehicleId: vehicleIdOf(assigned), plate: plateOf(assigned) };
  }

  // 4. No saved assignment — never fall back to a finished trip's vehicle.
  return null;
}

/**
 * Read the cached driver context (no network). The caches are the ones the
 * core screens already maintain: legacy, Today and Home snapshots, plus
 * DRIVER_ME. The newest work-list snapshot wins; an older active trip must
 * not be reintroduced after a fresher list removes it. `null` entries
 * mean "that source was never cached". Never throws.
 */
export async function getCachedVehicleContext(driverId) {
  if (driverId == null) return { trips: null, me: null };
  const read = async (key) => {
    try {
      return await getCached(driverId, key);
    } catch {
      return null;
    }
  };
  const [tripsAll, homeTrips, todayTrips, meC] = await Promise.all([
    read(CACHE_KEYS.TRIPS_ALL),
    read(CACHE_KEYS.HOME_TRIPS),
    read(CACHE_KEYS.TRIPS_TODAY),
    read(CACHE_KEYS.DRIVER_ME),
  ]);
  const latest = [tripsAll, homeTrips, todayTrips]
    .filter((entry) => Array.isArray(entry?.data) || Array.isArray(entry?.data?.trips))
    .sort((a, b) => (b.syncedAt || 0) - (a.syncedAt || 0))[0];
  return {
    trips: latest ? (Array.isArray(latest.data) ? latest.data : latest.data.trips).filter((trip) => trip?.trip_id != null) : null,
    me: meC?.data ?? null,
  };
}
