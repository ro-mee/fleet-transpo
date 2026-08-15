import React, { createContext, useContext, useState, useEffect } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// SecureStore has no web implementation — fall back to localStorage on web.
const store = {
  async get(key) {
    if (Platform.OS === "web") return localStorage.getItem(key);
    return await SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },
};

const DEFAULTS = {
  highContrast: false,
  pushNotifications: true,
  locationTracking: true,
  language: "en",
  textSize: "medium",
  colorScheme: "system",
};

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const keys = Object.keys(DEFAULTS);
        const values = await Promise.all(
          keys.map((k) => store.get(`settings_${k}`))
        );
        const loaded = {};
        keys.forEach((k, i) => {
          if (values[i] !== null && values[i] !== undefined) {
            // Booleans are stored as strings
            if (typeof DEFAULTS[k] === "boolean") {
              loaded[k] = values[i] === "true";
            } else {
              loaded[k] = values[i];
            }
          } else {
            loaded[k] = DEFAULTS[k];
          }
        });
        setSettings(loaded);
      } catch (e) {
        console.warn("[Settings] Failed to load settings", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const updateSetting = async (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    try {
      await store.set(`settings_${key}`, String(value));
    } catch (e) {
      console.warn("[Settings] Failed to save setting", key, e);
    }
  };

  if (!loaded) return null;

  return (
    <SettingsContext.Provider value={{ settings, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
