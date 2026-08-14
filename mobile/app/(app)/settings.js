import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from "../../lib/theme-context";
import { fonts } from "../../lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, colorScheme, toggleColorScheme } = useTheme();

  const [isLightMode, setIsLightMode] = useState(colorScheme === "light");
  const [highContrast, setHighContrast] = useState(false);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [locationTracking, setLocationTracking] = useState(true);

  useEffect(() => {
    // Load persisted settings
    const loadSettings = async () => {
      try {
        const hc = await AsyncStorage.getItem('@settings_highContrast');
        const pn = await AsyncStorage.getItem('@settings_pushNotifications');
        const lt = await AsyncStorage.getItem('@settings_locationTracking');
        
        if (hc !== null) setHighContrast(hc === 'true');
        if (pn !== null) setPushNotifications(pn === 'true');
        if (lt !== null) setLocationTracking(lt === 'true');
      } catch (e) {
        console.warn("Failed to load settings", e);
      }
    };
    loadSettings();
  }, []);

  const handleToggleTheme = () => {
    setIsLightMode(!isLightMode);
    toggleColorScheme();
  };

  const handleToggle = async (key, value, setter) => {
    setter(value);
    try {
      await AsyncStorage.setItem(`@settings_${key}`, String(value));
    } catch (e) {
      console.warn("Failed to save setting", key, e);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.onSurface }]}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        
        {/* DISPLAY SECTION */}
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>DISPLAY</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          
          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="moon" size={18} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>
                {isLightMode ? "Light Mode" : "Dark Mode"}
              </Text>
            </View>
            <Switch
              value={isLightMode}
              onValueChange={handleToggleTheme}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>

          <Pressable style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="text" size={18} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Text Size</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.rowValue, { color: colors.onSurfaceVariant }]}>Medium</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
            </View>
          </Pressable>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="contrast" size={18} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>High Contrast Mode</Text>
            </View>
            <Switch
              value={highContrast}
              onValueChange={(val) => handleToggle('highContrast', val, setHighContrast)}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>
        </View>

        {/* PREFERENCES SECTION */}
        <Text style={[styles.sectionTitle, { color: colors.primary }]}>PREFERENCES</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          
          <Pressable style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="globe" size={18} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Language</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.rowValue, { color: colors.onSurfaceVariant }]}>English (US)</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
            </View>
          </Pressable>

          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="notifications" size={18} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Push Notifications</Text>
            </View>
            <Switch
              value={pushNotifications}
              onValueChange={(val) => handleToggle('pushNotifications', val, setPushNotifications)}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>

          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="location" size={18} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.onSurface }]}>Location Tracking</Text>
            </View>
            <Switch
              value={locationTracking}
              onValueChange={(val) => handleToggle('locationTracking', val, setLocationTracking)}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>

        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: fonts.displayBold },
  scroll: { padding: 16, paddingTop: 24, gap: 24 },
  
  sectionTitle: {
    fontSize: 12,
    fontFamily: fonts.displayBold,
    letterSpacing: 1,
    marginBottom: -16,
    marginLeft: 8,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: {
    fontSize: 16,
    fontFamily: fonts.bodyMedium,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowValue: {
    fontSize: 14,
    fontFamily: fonts.body,
  }
});
