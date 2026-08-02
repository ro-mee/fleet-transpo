import * as SecureStore from "expo-secure-store";

const KEYS = {
  ACCESS_TOKEN: "fleetops_access_token",
  REFRESH_TOKEN: "fleetops_refresh_token",
  USER: "fleetops_user",
};

/**
 * Thin async wrapper around SecureStore. All values are JSON-serialized so the
 * storage layer doesn't need to know the shape.
 */

export async function saveTokens({ accessToken, refreshToken }) {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, accessToken),
    SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, refreshToken),
  ]);
}

export async function getAccessToken() {
  return await SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
}

export async function getRefreshToken() {
  return await SecureStore.getItemAsync(KEYS.REFRESH_TOKEN);
}

export async function saveUser(user) {
  await SecureStore.setItemAsync(KEYS.USER, JSON.stringify(user));
}

export async function getUser() {
  const json = await SecureStore.getItemAsync(KEYS.USER);
  return json ? JSON.parse(json) : null;
}

export async function clearAll() {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
    SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
    SecureStore.deleteItemAsync(KEYS.USER),
  ]);
}
