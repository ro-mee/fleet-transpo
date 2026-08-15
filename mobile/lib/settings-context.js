import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from '@react-native-async-storage/async-storage';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({
    highContrast: false,
    pushNotifications: true,
    locationTracking: true,
    language: 'en',
    textSize: 'medium',
    colorScheme: 'system'
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const hc = await AsyncStorage.getItem('@settings_highContrast');
        const pn = await AsyncStorage.getItem('@settings_pushNotifications');
        const lt = await AsyncStorage.getItem('@settings_locationTracking');
        const lang = await AsyncStorage.getItem('@settings_language');
        const ts = await AsyncStorage.getItem('@settings_textSize');
        const cs = await AsyncStorage.getItem('@settings_colorScheme');

        setSettings({
          highContrast: hc !== null ? hc === 'true' : false,
          pushNotifications: pn !== null ? pn === 'true' : true,
          locationTracking: lt !== null ? lt === 'true' : true,
          language: lang || 'en',
          textSize: ts || 'medium',
          colorScheme: cs || 'system'
        });
      } catch (e) {
        console.warn("Failed to load settings", e);
      } finally {
        setLoaded(true);
      }
    };
    loadSettings();
  }, []);

  const updateSetting = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    try {
      await AsyncStorage.setItem(`@settings_${key}`, String(value));
    } catch (e) {
      console.warn("Failed to save setting", key, e);
    }
  };

  if (!loaded) return null; // Or a loading spinner if preferred

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
