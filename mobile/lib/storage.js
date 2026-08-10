import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEYS = {
  ACCESS_TOKEN: "fleetops_access_token",
  REFRESH_TOKEN: "fleetops_refresh_token",
  USER: "fleetops_user",
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

export async function saveTokens({ accessToken, refreshToken }) {
  await Promise.all([
    store.setItem(KEYS.ACCESS_TOKEN, accessToken),
    store.setItem(KEYS.REFRESH_TOKEN, refreshToken),
  ]);
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

export async function getUser() {
  const json = await store.getItem(KEYS.USER);
  return json ? JSON.parse(json) : null;
}

export async function clearAll() {
  await Promise.all([
    store.deleteItem(KEYS.ACCESS_TOKEN),
    store.deleteItem(KEYS.REFRESH_TOKEN),
    store.deleteItem(KEYS.USER),
  ]);
}