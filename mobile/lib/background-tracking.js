import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { accumulateFix, createAccumulator } from "./gps-odometer";

/**
 * Background location tracking for the driver's active trip.
 *
 * Why: expo-location's foreground `watchPositionAsync` stops firing once the app
 * is backgrounded (e.g. the driver opens Google Maps for turn-by-turn nav). This
 * module runs a headless TaskManager task that keeps posting the driver's GPS and
 * accumulating per-leg km while the app is in the background, so the web dashboard's
 * live map keeps updating and the odometer stays accurate across backgrounded
 * stretches.
 *
 * IMPORTANT (native): requires a development build — Expo Go cannot run background
 * location, and the currently-installed build lacks the native module/config, so a
 * rebuild + reinstall is needed. See app.json (expo-location plugin flags) and the
 * ACCESS_BACKGROUND_LOCATION / FOREGROUND_SERVICE / FOREGROUND_SERVICE_LOCATION
 * permissions.
 *
 * Design: the foreground (map.js) starts the task only when the app goes to the
 * background with an active trip, and stops it when the app returns to the
 * foreground — so there is never both a foreground watcher and this task running,
 * which would double-count km and duplicate GPS rows.
 */

const TASK_NAME = "fleetops-background-location";

const STORAGE_KEY = "fleetops_bg_tracking";
// Shape: { tripId, leg: "leg1"|"leg2"|null, km1, km2, prev: {lat,lng,atMs}|null }

// Statuses where the driver is travelling to the pickup; anything else is the
// second leg to the destination. Mirrors map.js so both agree on leg assignment.
const HEADING_TO_PICKUP_STATUSES = [
  "Pending",
  "Approved",
  "Assigned",
  "Vehicle Assigned",
  "Driver Assigned",
  "Dispatched",
  "Driver Accepted",
  "Trip Started",
  "At Pickup",
];

const HEADING_TO_PICKUP = new Set(HEADING_TO_PICKUP_STATUSES);

// km between two lat/lng pairs and the segment acceptance rules now live in
// ./gps-odometer so the foreground watcher and this task cannot drift apart
// again. This module only owns the per-leg totals and the previous fix.

const DEFAULT_CONTEXT = { tripId: null, leg: null, km1: 0, km2: 0, prev: null };
// Foreground status/AppState events can arrive back-to-back. Serialize context
// writes so a slower read from an older trip cannot overwrite the newer trip.
let contextWrite = Promise.resolve();

async function loadContext() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONTEXT, ...JSON.parse(raw) };
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_CONTEXT };
}

async function saveContext(ctx) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    // A failed persist means the km for this background stretch is lost; not
    // worth surfacing mid-trip.
  }
}

/**
 * The background task. Runs headless whenever the OS delivers a background
 * location update. It posts the fix to the same GPS endpoints the foreground
 * uses (so the web dashboard live map updates) and accumulates per-leg km into
 * AsyncStorage (merged back into the foreground accumulator on resume).
 */
TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const { locations } = data || {};
  if (!locations || !locations.length) return;

  const ctx = await loadContext();

  for (const loc of locations) {
    const lat = loc.coords?.latitude;
    const lng = loc.coords?.longitude;
    if (lat == null || lng == null) continue;

    // GPS is trip-scoped. A driver without an active trip can still view their
    // local position, but the app must not persist idle/non-trip telemetry.
    const body = {
      latitude: lat,
      longitude: lng,
      speed: loc.coords?.speed ?? null,
      heading: loc.coords?.heading ?? null,
      altitude: loc.coords?.altitude ?? null,
      accuracy: loc.coords?.accuracy ?? null,
      recorded_at: loc.timestamp ? new Date(loc.timestamp).toISOString() : undefined,
    };
    if (ctx.tripId) {
      // queueOnFailure:false is load-bearing, not an optimisation. Live
      // location must never be replayed from the offline outbox: a queued ping
      // that syncs twenty minutes later would overwrite the driver's CURRENT
      // position with a stale one on the dispatcher's live map and in the
      // geofence/monitor verdicts derived from it. The responder and standby
      // branches of lib/tracking.js already say exactly this; the trip branch
      // and this task were the two that did not.
      api.post(`/api/mobile/driver/trips/${ctx.tripId}/gps`, body, { queueOnFailure: false }).catch(() => {});
    }

    // Accumulate km per leg through the SAME rules the foreground watcher uses
    // (./gps-odometer), so a backgrounded stretch cannot accumulate distance
    // the foreground would have rejected as jitter.
    if (ctx.tripId && ctx.leg) {
      const acc = createAccumulator();
      acc.leg1 = Number(ctx.km1) || 0;
      acc.leg2 = Number(ctx.km2) || 0;
      acc.leg = ctx.leg;
      acc.prev = ctx.prev || null;
      accumulateFix(acc, {
        lat,
        lng,
        speedMs: loc.coords?.speed ?? null,
        atMs: loc.timestamp ?? null,
        leg: ctx.leg,
      });
      ctx.km1 = acc.leg1;
      ctx.km2 = acc.leg2;
    }
    // Always re-anchor, dropped segment or not: the rejected fix is the driver's
    // real position and the next segment must be measured from it.
    ctx.prev = { lat, lng, atMs: loc.timestamp ?? null };
  }

  await saveContext(ctx);
});

/**
 * Start background location updates. Requests the Android "Allow all the time"
 * permission first (a separate prompt from the foreground one on Android 10+).
 * No-op on web or if the permission is refused.
 */
export async function startBackgroundTracking() {
  if (Platform.OS === "web") return;
  try {
    const { status } = await Location.requestBackgroundPermissionsAsync();
    if (status !== "granted") return;
    await Location.startLocationUpdatesAsync(TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 10,
      timeInterval: 30000,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: "FleetOps tracking active",
        notificationBody: "Sharing your live location with dispatch",
        notificationColor: "#0f766e",
      },
    });
  } catch {
    // Background location may be unavailable (device policy, etc.). Foreground
    // tracking continues; this just means backgrounded km/GPS are not captured.
  }
}

/**
 * Stop background location updates. Safe to call when not started.
 */
export async function stopBackgroundTracking() {
  if (Platform.OS === "web") return;
  try {
    await Location.stopLocationUpdatesAsync(TASK_NAME);
  } catch {
    // not running
  }
}

/**
 * Tell the background task which trip/leg is active. Called by the foreground on
 * every status change. `prev` is reset so a leg transition's straddling gap is
 * not counted. Existing km are preserved only for the same trip.
 */
export async function updateLegContext({ tripId, leg }) {
  const write = contextWrite.then(async () => {
    const ctx = await loadContext();
    const nextTripId = tripId ?? null;
    if (ctx.tripId != null && String(ctx.tripId) !== String(nextTripId)) {
      // Distance totals belong to one trip. Never carry them into the next
      // assignment (or into an idle state) when the foreground changes first.
      ctx.km1 = 0;
      ctx.km2 = 0;
    }
    ctx.tripId = nextTripId;
    ctx.leg = leg ?? null;
    ctx.prev = null;
    await saveContext(ctx);
  });
  contextWrite = write.catch(() => {});
  return write;
}

/**
 * Fold background-accumulated km into the foreground accumulator (`distRef`).
 * Called when the app returns to the foreground. Adds km1/km2 to the matching
 * leg, then clears the stored totals so the next background cycle starts fresh.
 */
export async function mergeStoredKm(distRef, expectedTripId = null) {
  await contextWrite;
  const ctx = await loadContext();
  const sameTrip = expectedTripId != null && ctx.tripId != null && String(ctx.tripId) === String(expectedTripId);
  if (sameTrip) {
    if (ctx.km1 > 0) distRef.current.leg1 += ctx.km1;
    if (ctx.km2 > 0) distRef.current.leg2 += ctx.km2;
  }
  ctx.km1 = 0;
  ctx.km2 = 0;
  ctx.prev = null;
  await saveContext(ctx);
}

/** Derive the leg label from a trip status string ("leg1" | "leg2" | null). */
export function legForStatus(status) {
  if (!status) return null;
  return HEADING_TO_PICKUP.has(status) ? "leg1" : "leg2";
}
