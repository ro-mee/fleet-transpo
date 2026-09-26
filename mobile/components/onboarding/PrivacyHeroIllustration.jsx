import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { moderateScale } from "../../lib/scaling";

export function PrivacyHeroIllustration() {
  const { isDark } = useTheme();

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel="Driver Data Privacy Shield Illustration"
    >
      {/* Background ambient radial glow disc */}
      <LinearGradient
        colors={
          isDark
            ? ["rgba(52, 211, 153, 0.28)", "rgba(16, 185, 129, 0.10)", "transparent"]
            : ["rgba(40, 84, 72, 0.18)", "rgba(52, 211, 153, 0.08)", "transparent"]
        }
        style={styles.ambientGlow}
      />

      {/* Topographic / contour wave rings */}
      <View
        style={[
          styles.contourRing,
          styles.contourRingOuter,
          {
            borderColor: isDark ? "rgba(52, 211, 153, 0.12)" : "rgba(40, 84, 72, 0.10)",
          },
        ]}
      >
        {/* Radar accent node dot 1 */}
        <View
          style={[
            styles.accentDot,
            styles.accentDotOuterTop,
            { backgroundColor: isDark ? "#34D399" : "#285448" },
          ]}
        />
      </View>

      <View
        style={[
          styles.contourRing,
          styles.contourRingMid,
          {
            borderColor: isDark ? "rgba(52, 211, 153, 0.18)" : "rgba(40, 84, 72, 0.14)",
          },
        ]}
      >
        {/* Radar accent node dot 2 */}
        <View
          style={[
            styles.accentDot,
            styles.accentDotMidRight,
            { backgroundColor: isDark ? "#10B981" : "#1E473C" },
          ]}
        />
      </View>

      <View
        style={[
          styles.contourRing,
          styles.contourRingInner,
          {
            borderColor: isDark ? "rgba(52, 211, 153, 0.25)" : "rgba(40, 84, 72, 0.18)",
          },
        ]}
      />

      {/* 3D Shield Emblem with Split-Faceted Shading */}
      <View
        style={[
          styles.shieldWrapper,
          {
            shadowColor: isDark ? "#10B981" : "#285448",
          },
        ]}
      >
        {/* Bezel Outer Glow Ring */}
        <LinearGradient
          colors={
            isDark
              ? ["#6EE7B7", "#10B981", "#064E3B"]
              : ["#4ADE80", "#285448", "#14332B"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.shieldBezel}
        >
          {/* Shield Face Container */}
          <View style={styles.shieldBody}>
            {/* Split face left: Lighter reflection */}
            <LinearGradient
              colors={
                isDark
                  ? ["#34D399", "#10B981", "#059669"]
                  : ["#3B7A68", "#285448", "#1E473C"]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={styles.shieldHalfLeft}
            />

            {/* Split face right: Deep shadow */}
            <LinearGradient
              colors={
                isDark
                  ? ["#059669", "#047857", "#064E3B"]
                  : ["#1E473C", "#14332B", "#0D221D"]
              }
              start={{ x: 0.2, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.shieldHalfRight}
            />

            {/* Glossy top highlight overlay */}
            <LinearGradient
              colors={["rgba(255, 255, 255, 0.35)", "transparent"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 0.5 }}
              style={styles.shieldGloss}
            />

            {/* Embossed checkmark emblem */}
            <View style={styles.checkContainer}>
              <Ionicons
                name="checkmark-sharp"
                size={moderateScale(38)}
                color="#FFFFFF"
                style={styles.checkIcon}
              />
            </View>
          </View>
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: moderateScale(160),
    alignItems: "center",
    justifyContent: "center",
    marginVertical: moderateScale(6),
    position: "relative",
  },
  ambientGlow: {
    position: "absolute",
    width: moderateScale(240),
    height: moderateScale(160),
    borderRadius: moderateScale(120),
  },
  contourRing: {
    position: "absolute",
    borderWidth: 1,
  },
  contourRingOuter: {
    width: moderateScale(260),
    height: moderateScale(140),
    borderRadius: moderateScale(70),
  },
  contourRingMid: {
    width: moderateScale(200),
    height: moderateScale(110),
    borderRadius: moderateScale(55),
  },
  contourRingInner: {
    width: moderateScale(140),
    height: moderateScale(80),
    borderRadius: moderateScale(40),
  },
  accentDot: {
    position: "absolute",
    width: moderateScale(5),
    height: moderateScale(5),
    borderRadius: moderateScale(3),
  },
  accentDotOuterTop: {
    top: moderateScale(12),
    right: moderateScale(60),
  },
  accentDotMidRight: {
    bottom: moderateScale(18),
    left: moderateScale(34),
  },
  shieldWrapper: {
    shadowOffset: { width: 0, height: moderateScale(8) },
    shadowOpacity: 0.45,
    shadowRadius: moderateScale(18),
    elevation: 12,
  },
  shieldBezel: {
    width: moderateScale(86),
    height: moderateScale(94),
    padding: moderateScale(2.5),
    borderTopLeftRadius: moderateScale(36),
    borderTopRightRadius: moderateScale(36),
    borderBottomLeftRadius: moderateScale(42),
    borderBottomRightRadius: moderateScale(42),
  },
  shieldBody: {
    flex: 1,
    flexDirection: "row",
    overflow: "hidden",
    borderTopLeftRadius: moderateScale(34),
    borderTopRightRadius: moderateScale(34),
    borderBottomLeftRadius: moderateScale(40),
    borderBottomRightRadius: moderateScale(40),
    position: "relative",
  },
  shieldHalfLeft: {
    width: "50%",
    height: "100%",
  },
  shieldHalfRight: {
    width: "50%",
    height: "100%",
  },
  shieldGloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "45%",
  },
  checkContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  checkIcon: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
  },
});

