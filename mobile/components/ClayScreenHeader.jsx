import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/theme-context";
import { TOUCH_TARGET } from "../lib/theme";
import { clayShade } from "../lib/clay";

/**
 * Clay sub-screen header: raised 48dp circular back control + centered title,
 * transparent over the screen background (no bottom border). Extracted from
 * the Trip Details headerBar pattern so every Profile/Settings sub-screen
 * shares the exact same affordance.
 */
export default function ClayScreenHeader({ title, onBack }) {
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }) => [
          styles.backBtn,
          clayShade,
          { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={[type.titleLg, styles.title]}>{title}</Text>
      <View style={{ width: TOUCH_TARGET }} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 4,
  },
  title: { flex: 1, textAlign: "center" },
  backBtn: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: TOUCH_TARGET / 2 },
});
