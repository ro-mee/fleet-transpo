import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Driver consent gate (mobile).
 *
 * Mirrors src/lib/consent/policies.js on the web. The version here must stay in
 * lockstep with CURRENT_PRIVACY_POLICY_VERSION — bumping the policy wording on
 * the web without bumping it here would let a stale acceptance through. The
 * server remains the authority on acceptance (POST /api/driver/me/consent
 * rejects a stale version); this module only gates the UI and remembers the
 * accepted version locally so a returning driver is not re-prompted.
 *
 * SecureStore has no web implementation, so on web we fall back to
 * localStorage with the same async API.
 */

export const CURRENT_PRIVACY_POLICY_VERSION = 1;

const KEY = "fleetops_consent_version";

export async function getAcceptedConsentVersion() {
  const raw =
    Platform.OS === "web"
      ? localStorage.getItem(KEY)
      : await SecureStore.getItemAsync(KEY);
  return raw ? Number(raw) : null;
}

export async function setAcceptedConsentVersion(version) {
  if (Platform.OS === "web") {
    localStorage.setItem(KEY, String(version));
  } else {
    await SecureStore.setItemAsync(KEY, String(version));
  }
}