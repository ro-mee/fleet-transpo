import { Platform } from "react-native";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

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
// Shape: { tripId, leg: "leg1"|"leg2"|null, km1, km2, prev: {lat,lng}|null }

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

// km between two lat/lng pairs (haversine). Same formula as map.js.
function haversineKm(latA, lonA, latB, lonB) {
  const R = 6371;
  const p1 = (latA * Math.PI) / 180;
  const p2 = (latB * Math.PI) / 180;
  const dp = ((latB - latA) * Math.PI) / 180;
  const dl = ((lonB - lonA) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Same noise filter as map.js: drop >400m/3s jumps (glitches) and GPS jitter
// while parked (short segment with ~0 speed).
const MAX_SEGMENT_KM = 0.4;
const MIN_MOVING_SEGMENT_KM = 0.02;

const DEFAULT_CONTEXT = { tripId: null, leg: null, km1: 0, km2: 0, prev: null };

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

    // Post the fix. With an active trip post to the trip GPS endpoint; otherwise
    // the generic driver GPS endpoint (keeps idle drivers visible too).
    const body = {
      latitude: lat,
      longitude: lng,
      speed: loc.coords?.speed ?? 0,
      heading: loc.coords?.heading ?? 0,
      altitude: loc.coords?.altitude ?? 0,
      accuracy: loc.coords?.accuracy ?? 0,
      recorded_at: loc.timestamp ? new Date(loc.timestamp).toISOString() : undefined,
    };
    const path = ctx.tripId
      ? `/api/mobile/driver/trips/${ctx.tripId}/gps`
      : "/api/mobile/driver/gps";
    api.post(path, body).catch(() => {});

    // Accumulate km per leg, same rules as the foreground watcher.
    if (ctx.tripId && ctx.leg && ctx.prev) {
      const seg = haversineKm(ctx.prev.lat, ctx.prev.lng, lat, lng);
      const speed = loc.coords?.speed ?? 0;
      if (seg > 0 && seg <= MAX_SEGMENT_KM && (speed > 1 || seg > MIN_MOVING_SEGMENT_KM)) {
        if (ctx.leg === "leg1") ctx.km1 += seg;
        else ctx.km2 += seg;
      }
    }
    ctx.prev = { lat, lng };
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
 * not counted. Existing km are preserved.
 */
export async function updateLegContext({ tripId, leg }) {
  const ctx = await loadContext();
  ctx.tripId = tripId ?? null;
  ctx.leg = leg ?? null;
  ctx.prev = null;
  await saveContext(ctx);
}

/**
 * Fold background-accumulated km into the foreground accumulator (`distRef`).
 * Called when the app returns to the foreground. Adds km1/km2 to the matching
 * leg, then clears the stored totals so the next background cycle starts fresh.
 */
export async function mergeStoredKm(distRef) {
  const ctx = await loadContext();
  if (ctx.km1 > 0) distRef.current.leg1 += ctx.km1;
  if (ctx.km2 > 0) distRef.current.leg2 += ctx.km2;
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