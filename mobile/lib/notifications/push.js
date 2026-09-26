/**
 * expo-notifications wrapper for in-app-simulated push.
 *
 * Honest scope: this schedules *local* OS notifications from app code. It
 * works while the app is running in the foreground or recently backgrounded —
 * the driver sees a real system banner ("push-like"). True background push
 * for a fully terminated app needs FCM/APNs + the outbox pattern; that stays
 * documented future work. This keeps the capstone demo truthful and light.
 *
 * Everything here is defensive: permission is requested on demand, channels
 * are created once, and every native call is wrapped so a missing permission
 * or an Expo Go limitation degrades to a no-op rather than a crash.
 */
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";

let channelReady = false;
let handlerReady = false;

/** Present foregrounded notifications as real banners/list entries. */
function ensureHandler() {
  if (handlerReady) return;
  handlerReady = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Create the Android channels once (Android 8+ needs one per delivery tier). */
async function ensureChannel() {
  if (channelReady || Platform.OS !== "android") return;
  channelReady = true;
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "FleetOps Alerts",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 180, 250],
      lightColor: "#285448",
    });
    await Notifications.setNotificationChannelAsync("heads-up", {
      name: "FleetOps Updates",
      importance: Notifications.AndroidImportance.LOW,
      lightColor: "#285448",
    });
  } catch {
    // Expo Go / missing native module — degrades silently.
  }
}

/** Check OS permission without prompting. Returns true if authorized. */
export async function hasPushPermission() {
  if (Platform.OS === "web") return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    return Boolean(
      current.granted ||
        current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** Request OS permission. Prompts user if undetermined. Returns true if the OS will show notifications. */
export async function requestPushPermission() {
  if (Platform.OS === "web") return false;
  try {
    ensureHandler();
    const alreadyGranted = await hasPushPermission();
    if (alreadyGranted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return Boolean(
      req.granted ||
        req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/**
 * Initialize push handling once at app startup: installs the foreground
 * notification handler and ensures the Android default channel exists. A
 * channel must exist BEFORE a remote FCM push arrives, or Android 8+ silently
 * drops it even though Expo marks it "delivered". Safe to call multiple times.
 */
export async function initPush() {
  if (Platform.OS === "web") return;
  ensureHandler();
  await ensureChannel();
}

/** Fire an immediate OS local notification. */
export async function showLocalNotification({ title, body, data = {} }) {
  try {
    ensureHandler();
    await ensureChannel();
    const granted = await Notifications.getPermissionsAsync();
    if (!granted.granted && !granted.ios?.status) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: "default",
      },
      trigger: null, // null = fire immediately
    });
    return true;
  } catch {
    return false;
  }
}

export async function dismissAllLocalNotifications() {
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    /* ignore */
  }
}

/**
 * Mint this install's Expo push token (the address the server pushes to).
 *
 * When `requestPermission` is false (default), this is strictly non-prompting:
 * it checks if permission is already granted and returns null if not.
 * When `requestPermission` is true, it explicitly requests OS permission first.
 *
 * Requires the EAS projectId embedded by prebuild (app.json extra.eas.projectId)
 * and, on Android, a `google-services.json` in the build — otherwise Expo Go or
 * a build without FCM throws, which degrades to null so login never breaks.
 */
export async function getPushToken({ requestPermission = false } = {}) {
  try {
    const granted = requestPermission
      ? await requestPushPermission()
      : await hasPushPermission();
    if (!granted) return null;
    const projectId = Constants.easConfig?.projectId;
    if (!projectId) return null;
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    return result?.data || null;
  } catch {
    return null;
  }
}

/** Non-prompting helper: returns push token only if already authorized. */
export async function getPushTokenIfAuthorized() {
  return getPushToken({ requestPermission: false });
}

/**
 * Watch for taps on a local notification and deep-link to the matching mobile
 * route. Returns an unsubscribe fn. Call once from the host.
 */
export function subscribePushResponses(onResponse) {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data || {};
    onResponse?.(data);
  });
  return () => sub.remove();
}