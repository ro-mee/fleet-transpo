import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEYS = {
  ACCESS_TOKEN: "fleetops_access_token",
  REFRESH_TOKEN: "fleetops_refresh_token",
  USER: "fleetops_user",
  SESSION_STATE: "fleetops_session_state",
};

/**
 * Thin async wrapper around SecureStore. All values are JSON-serialized so the
 * storage layer doesn't need to know the shape.
 *
 * SecureStore has no web implementation, so on web we fall back to
 * localStorage with the same async API.
 */

const store = {
  async setItem(key, value) {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },
  async getItem(key) {
    if (Platform.OS === "web") {
      return localStorage.getItem(key);
    }
    return await SecureStore.getItemAsync(key);
  },
  async deleteItem(key) {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  },
};

let authMutation = Promise.resolve();
function mutateAuth(isCurrent, work) {
  const operation = authMutation.catch(() => {}).then(async () => {
    if (!isCurrent()) return false;
    await work();
    return true;
  });
  authMutation = operation;
  return operation;
}

export async function saveTokens({ accessToken, refreshToken }, isCurrent = () => true) {
  return mutateAuth(isCurrent, async () => {
    const results = await Promise.allSettled([
      store.setItem(KEYS.ACCESS_TOKEN, accessToken),
      store.setItem(KEYS.REFRESH_TOKEN, refreshToken),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  });
}

export async function getAccessToken() {
  return await store.getItem(KEYS.ACCESS_TOKEN);
}

export async function getRefreshToken() {
  return await store.getItem(KEYS.REFRESH_TOKEN);
}

export async function saveUser(user) {
  await store.setItem(KEYS.USER, JSON.stringify(user));
}

export async function markSignInPending() {
  return mutateAuth(() => true, () => store.setItem(KEYS.SESSION_STATE, "transition"));
}

export async function markSignInComplete() {
  return mutateAuth(() => true, () => store.setItem(KEYS.SESSION_STATE, "active"));
}

export async function getSessionState() {
  return await store.getItem(KEYS.SESSION_STATE);
}

export async function getUser() {
  const json = await store.getItem(KEYS.USER);
  return json ? JSON.parse(json) : null;
}

/** Removes enrollment items left by the retired biometric app lock. */
export async function clearLegacyBiometricEnrollment() {
  if (Platform.OS === "web") return;

  await Promise.all([
    SecureStore.deleteItemAsync("fleetops_biometric_sentinel", {
      keychainService: "fleetops.biometric",
    }).catch(() => {}),
    SecureStore.deleteItemAsync("fleetops_biometric_meta").catch(() => {}),
  ]);
}

export async function clearAll(isCurrent = () => true) {
  return mutateAuth(isCurrent, async () => {
    // Persist the fence first. If any later delete fails, cold-start restore
    // still knows this credential set is incomplete and must stay signed out.
    await store.setItem(KEYS.SESSION_STATE, "signed_out");
    // Keep the mutation locked until every native delete finishes, including
    // after a sibling fails, so none can delete a later sign-in's credentials.
    const results = await Promise.allSettled([
      store.deleteItem(KEYS.ACCESS_TOKEN),
      store.deleteItem(KEYS.REFRESH_TOKEN),
      store.deleteItem(KEYS.USER),
      clearLegacyBiometricEnrollment(),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  });
}
