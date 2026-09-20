import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../../lib/theme-context";
import { fonts } from "../../../lib/theme";
import { moderateScale } from "../../../lib/scaling";

export default function DemoProgressHeader({
  title = "Safe practice",
  subtitle = "Training only",
  onSkip,
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <View
          style={[
            styles.badge,
            {
              backgroundColor: colors.primaryContainer,
              borderColor: colors.outlineVariant,
            },
          ]}
        >
          <Text style={[styles.badgeText, { color: colors.onPrimaryContainer }]}>
            DEMO • SAFE PRACTICE
          </Text>
        </View>
        <Text style={[styles.title, { color: colors.onSurface }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
          {subtitle}
        </Text>
      </View>

      {onSkip ? (
        <Pressable
          onPress={onSkip}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Skip sample demonstration"
          style={({ pressed }) => [
            styles.skip,
            { borderColor: colors.outlineVariant },
            pressed && { opacity: 0.72 },
          ]}
        >
          <Text style={[styles.skipText, { color: colors.primary }]}>Skip demo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(10),
  },
  copy: { flex: 1, minWidth: 0 },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: moderateScale(999),
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(4),
    marginBottom: moderateScale(7),
  },
  badgeText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: moderateScale(9.5),
    letterSpacing: 0.7,
  },
  title: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: moderateScale(17),
    lineHeight: moderateScale(22),
  },
  subtitle: {
    marginTop: moderateScale(2),
    fontFamily: fonts.body,
    fontSize: moderateScale(12),
    lineHeight: moderateScale(17),
  },
  skip: {
    minHeight: moderateScale(40),
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: moderateScale(11),
    paddingHorizontal: moderateScale(11),
  },
  skipText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(12),
  },
});
