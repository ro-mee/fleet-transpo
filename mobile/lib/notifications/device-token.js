// Device-token registration for real (server-sent) push.
//
// On sign-in the app mints its Expo push token and posts it to the server; on
// sign-out it deactivates it. Both are best-effort and fire-and-forget — a push
// setup hiccup must never block login/logout.
import { Platform } from "react-native";
import { api } from "../api";
import { getPushToken } from "./push";

let cachedToken = null;

export async function registerDeviceToken() {
  try {
    const token = await getPushToken();
    if (!token) return;
    cachedToken = token;
    await api.post("/api/device-tokens", {
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
  } catch {
    // Best-effort: no push yet, never fail the session on it.
  }
}

export async function unregisterDeviceToken() {
  const token = cachedToken;
  cachedToken = null;
  if (!token) return;
  try {
    await api.del("/api/device-tokens", { token });
  } catch {
    /* best-effort */
  }
}