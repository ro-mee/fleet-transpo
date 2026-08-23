import { Linking, Platform } from "react-native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { requestPushPermission } from "./notifications/push";

export const PERMISSION_STATUS = {
  GRANTED: "granted",
  DENIED: "denied",
  UNDETERMINED: "undetermined",
};

function treatsProvisionalAsGranted(res) {
  return (
    res?.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

function normalize(res) {
  if (!res) {
    return { status: PERMISSION_STATUS.UNDETERMINED, canAskAgain: true };
  }
  const granted = Boolean(res.granted);
  return {
    status: granted
      ? PERMISSION_STATUS.GRANTED
      : res.status === "undetermined"
        ? PERMISSION_STATUS.UNDETERMINED
        : PERMISSION_STATUS.DENIED,
    canAskAgain: res.canAskAgain !== false,
  };
}

export const APP_PERMISSIONS = [
  {
    key: "location",
    title: "Location",
    why: "Dispatches trips, tracks your progress, powers SOS and incident reporting.",
    withoutIt: "Trip dispatch, SOS and incident reports stop working.",
    icon: "location",
    check: () => Location.getForegroundPermissionsAsync(),
    request: () => Location.requestForegroundPermissionsAsync(),
  },
  {
    key: "locationBackground",
    title: "Background Location",
    why: "Keeps trip tracking running when the app is in the background or closed.",
    withoutIt: "Trip tracking pauses whenever you background the app.",
    icon: "navigate",
    nativeOnly: true,
    check: () => Location.getBackgroundPermissionsAsync(),
    request: () => Location.requestBackgroundPermissionsAsync(),
  },
  {
    key: "camera",
    title: "Camera",
    why: "Scans fuel receipts and photographs your license for uploads.",
    withoutIt: "You cannot scan receipts or photograph your license.",
    icon: "camera-outline",
    check: () => ImagePicker.getCameraPermissionsAsync(),
    request: () => ImagePicker.requestCameraPermissionsAsync(),
  },
  {
    key: "mediaLibrary",
    title: "Photo Library",
    why: "Attaches existing photos of receipts or license scans.",
    withoutIt: "You cannot attach existing photos of receipts or licenses.",
    icon: "images-outline",
    check: () => ImagePicker.getMediaLibraryPermissionsAsync(),
    request: () => ImagePicker.requestMediaLibraryPermissionsAsync(),
  },
  {
    key: "notifications",
    title: "Notifications",
    why: "Delivers dispatch assignments and trip alerts.",
    withoutIt: "Dispatch assignments and trip alerts will not reach you.",
    icon: "notifications-outline",
    async check() {
      const res = await Notifications.getPermissionsAsync();
      if (treatsProvisionalAsGranted(res)) return { ...res, granted: true };
      return res;
    },
    async request() {
      try {
        const granted = await requestPushPermission();
        if (granted) {
          const res = await Notifications.getPermissionsAsync();
          if (treatsProvisionalAsGranted(res)) return { ...res, granted: true };
          return { ...res, granted: true };
        }
        const res = await Notifications.getPermissionsAsync().catch(() => null);
        if (res) return res;
        return null;
      } catch {
        return null;
      }
    },
  },
];

function supportsEntry(entry) {
  return !(entry.nativeOnly && Platform.OS === "web");
}

export function listAppPermissions() {
  return APP_PERMISSIONS.filter(supportsEntry).map(({ key, title, why, withoutIt, icon }) => ({
    key,
    title,
    why,
    withoutIt,
    icon,
  }));
}

export async function getPermissionStatuses() {
  return Promise.all(
    APP_PERMISSIONS.filter(supportsEntry).map(async (entry) => {
      let state;
      try {
        state = normalize(await entry.check());
      } catch {
        state = { status: PERMISSION_STATUS.UNDETERMINED, canAskAgain: true };
      }
      return { key: entry.key, ...state };
    })
  );
}

export async function requestAppPermission(key) {
  const entry = APP_PERMISSIONS.find((p) => p.key === key);
  if (!entry) return null;
  try {
    return normalize(await entry.request());
  } catch {
    return null;
  }
}

export function openSystemSettings() {
  if (Platform.OS === "web") return false;
  Linking.openSettings();
  return true;
}

export function describePermissionState(state) {
  if (!state) return { label: "Unknown", tone: "neutral" };
  switch (state.status) {
    case PERMISSION_STATUS.GRANTED:
      return { label: "Approved", tone: "success" };
    case PERMISSION_STATUS.DENIED:
      return state.canAskAgain
        ? { label: "Denied", tone: "warning" }
        : { label: "Blocked", tone: "error" };
    default:
      return { label: "Not asked", tone: "neutral" };
  }
}

export function summarizeStatuses(statuses) {
  const known = statuses.filter(Boolean);
  return {
    approved: known.filter((s) => s.status === PERMISSION_STATUS.GRANTED).length,
    total: statuses.length,
    pending: known.length < statuses.length,
  };
}
