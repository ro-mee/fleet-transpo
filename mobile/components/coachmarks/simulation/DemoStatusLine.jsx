import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts } from "../../../lib/theme";
import { moderateScale } from "../../../lib/scaling";

export default function DemoStatusLine({
  text,
  icon = "scan-outline",
  success = false,
}) {
  const { colors } = useTheme();
  const tone = success ? (colors.success || colors.primary) : colors.primary;

  if (!text) return null;

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.surfaceContainerLow,
          borderColor: colors.outlineVariant,
        },
      ]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={icon} size={moderateScale(16)} color={tone} />
      <Text style={[styles.text, { color: colors.onSurface }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: moderateScale(38),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: moderateScale(11),
    paddingHorizontal: moderateScale(11),
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
  text: {
    flex: 1,
    fontFamily: fonts.bodyMedium || fonts.body,
    fontSize: moderateScale(12),
    lineHeight: moderateScale(17),
  },
});
