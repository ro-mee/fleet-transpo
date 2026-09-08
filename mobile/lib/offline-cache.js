/**
 * Offline read cache — FleetOps Offline Read Mode (foundation).
 *
 * Display-only last-known data so screens stay useful offline. The cache is
 * NEVER a source of authority: trip lifecycle gates, RBAC, and server
 * validation all run as before; cached payloads only fill the same state the
 * network would have filled.
 *
 * Boundary contract (locked):
 * - Every function takes an explicit `driverId`. This module never imports
 *   storage.js/auth (no reach-back into auth state), so storage.js can safely
 *   call clearOfflineCache() without a circular dependency.
 * - Callers resolve the id via resolveDriverId(user) BEFORE touching auth
 *   cleanup: remember driverId → clearOfflineCache(driverId) → clearAll().
 * - Entries are `{ data, syncedAt }`. No TTL — last-good is kept indefinitely
 *   and the global ConnectivityBanner shows the app-wide last-success age
 *   when offline (per-screen "connect once" empty states cover never-synced
 *   devices).
 * - Fail-open everywhere: corrupt JSON / missing bridge reads as null, never
 *   throws into a screen.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "fleetops_cache";

export const CACHE_KEYS = {
  /** GET /api/mobile/driver/trips?status=all (Trips tab + History tab share this) */
  TRIPS_ALL: "trips:all",
  /** GET /api/mobile/driver/trips (Home dashboard default view) */
  HOME_TRIPS: "home:trips",
  /** GET /api/mobile/driver/submissions (Activity Logs) */
  SUBMISSIONS: "submissions",
  /** GET /api/mobile/driver/inspections (Activity Logs) */
  INSPECTIONS: "inspections",
  /** GET /api/driver-work-schedules → days array */
  SCHEDULE_DAYS: "schedule:days",
  /** GET /api/driver/leave */
  LEAVES: "leaves",
  /** GET /api/driver/balances */
  BALANCES: "balances",
  /** GET /api/driver/me (Home + profile header) */
  DRIVER_ME: "driver:me",
};

/** Per-trip detail key: `trip:{id}` (dynamic, enumerated by prefix on clear). */
export function tripCacheKey(id) {
  return `trip:${String(id)}`;
}

/** Static keys enumerated by clearOfflineCache without a full keyscan. */
const STATIC_KEYS = [
  CACHE_KEYS.TRIPS_ALL,
  CACHE_KEYS.HOME_TRIPS,
  CACHE_KEYS.SUBMISSIONS,
  CACHE_KEYS.INSPECTIONS,
  CACHE_KEYS.SCHEDULE_DAYS,
  CACHE_KEYS.LEAVES,
  CACHE_KEYS.BALANCES,
  CACHE_KEYS.DRIVER_ME,
];

/**
 * Resolve the stable per-driver namespace from whatever user shape the caller
 * holds (auth state or stored user). Returns null when unknown — callers must
 * then skip cache read/write entirely.
 *
 * The login route returns camelCase (`employeeId`/`driverId`), and `signIn`
 * stores that response verbatim — so camelCase must be checked FIRST. The
 * snake_case fallbacks cover hand-shaped test fixtures and any future caller
 * holding a raw /driver/me payload.
 */
export function resolveDriverId(user) {
  const id =
    user?.employeeId ?? user?.driverId ?? user?.employee_id ?? user?.id ?? user?.driver_id ?? null;
  return id == null ? null : String(id);
}

function namespacedKey(driverId, key) {
  return `${PREFIX}:${driverId}:${key}`;
}

/**
 * Read a cached entry. Returns `{ data, syncedAt }` or null (miss / corrupt /
 * unknown driver / bridge not ready). Never throws.
 */
export async function getCached(driverId, key) {
  if (driverId == null || key == null) return null;
  try {
    const raw = await AsyncStorage.getItem(namespacedKey(driverId, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== "object" || !("data" in parsed)) return null;
    return {
      data: parsed.data,
      syncedAt: Number.isFinite(parsed.syncedAt) ? parsed.syncedAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Write a cached entry with a fresh syncedAt. Fire-and-forget safe — never
 * throws (cold-start bridge gaps resolve on the next successful sync).
 */
export async function setCached(driverId, key, data) {
  if (driverId == null || key == null) return;
  try {
    await AsyncStorage.setItem(
      namespacedKey(driverId, key),
      JSON.stringify({ data: data ?? null, syncedAt: Date.now() })
    );
  } catch {
    // Cold-start "Native module is null" or quota trouble: the next online
    // load retries. Cache must never break a screen.
  }
}

/**
 * Remove every cached entry for one driver. Called on logout / session death
 * BEFORE auth storage is deleted (the caller holds driverId explicitly), so a
 * second driver on a shared phone never sees the first driver's data.
 */
export async function clearOfflineCache(driverId) {
  if (driverId == null) return;
  const prefix = `${PREFIX}:${driverId}:`;
  try {
    await AsyncStorage.multiRemove(STATIC_KEYS.map((k) => prefix + k));
  } catch {
    // Best-effort: continue to the dynamic trip: keys below.
  }
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const tripKeys = (allKeys || []).filter(
      (k) => typeof k === "string" && k.startsWith(prefix + "trip:")
    );
    if (tripKeys.length > 0) await AsyncStorage.multiRemove(tripKeys);
  } catch {
    // Best-effort.
  }
}

/**
 * Human age for the badge: "just now" / "12 min ago" / "3h ago" /
 * "yesterday at 4:32 PM" / "Sep 4 at 4:32 PM". Pure — clock injectable.
 */
export function formatLastSynced(syncedAt, now = Date.now()) {
  if (!Number.isFinite(syncedAt)) return null;
  const diff = now - syncedAt;
  if (diff < 0) return "just now";
  const date = new Date(syncedAt);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const at = new Date(now);
  const startOfToday = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  if (syncedAt >= startOfToday) {
    // Same calendar day: relative age.
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }
  if (syncedAt >= startOfToday - 86400000) {
    return `yesterday at ${time}`;
  }
  const dayLabel = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${dayLabel} at ${time}`;
}
