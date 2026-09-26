import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { moderateScale } from "../../lib/scaling";

export function PermissionsHeroIllustration() {
  const { isDark } = useTheme();

  return (
    <View
      style={styles.container}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel="App Permissions Device and Orbiting Sensors Illustration"
    >
      {/* Background ambient radial glow disc */}
      <LinearGradient
        colors={
          isDark
            ? ["rgba(52, 211, 153, 0.26)", "rgba(16, 185, 129, 0.08)", "transparent"]
            : ["rgba(40, 84, 72, 0.16)", "rgba(52, 211, 153, 0.06)", "transparent"]
        }
        style={styles.ambientGlow}
      />

      {/* Ground Perspective / Angled Street Grid Lines */}
      <View style={styles.gridContainer}>
        <View
          style={[
            styles.angledLine,
            styles.angledLine1,
            { borderColor: isDark ? "rgba(52, 211, 153, 0.14)" : "rgba(40, 84, 72, 0.10)" },
          ]}
        />
        <View
          style={[
            styles.angledLine,
            styles.angledLine2,
            { borderColor: isDark ? "rgba(52, 211, 153, 0.12)" : "rgba(40, 84, 72, 0.08)" },
          ]}
        />
        <View
          style={[
            styles.angledLine,
            styles.angledLine3,
            { borderColor: isDark ? "rgba(52, 211, 153, 0.10)" : "rgba(40, 84, 72, 0.06)" },
          ]}
        />
      </View>

      {/* Orbit Track Arc */}
      <View
        style={[
          styles.orbitArc,
          { borderColor: isDark ? "rgba(52, 211, 153, 0.20)" : "rgba(40, 84, 72, 0.14)" },
        ]}
      />

      {/* Floating 3D Smartphone Frame */}
      <View
        style={[
          styles.phoneShadowContainer,
          {
            shadowColor: isDark ? "#10B981" : "#1A3830",
          },
        ]}
      >
        <LinearGradient
          colors={
            isDark
              ? ["#2A3F35", "#131E19", "#0B120F"]
              : ["#3D564D", "#233932", "#162722"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.phoneChassis}
        >
          {/* Top Speaker / Dynamic Island */}
          <View
            style={[
              styles.speakerPill,
              { backgroundColor: isDark ? "#0A100D" : "#101A16" },
            ]}
          />

          {/* Screen Content: Mini Route Map Preview */}
          <View
            style={[
              styles.phoneScreen,
              {
                backgroundColor: isDark ? "#070E0B" : "#F4F7F5",
              },
            ]}
          >
            {/* Screen Road Grid Lines */}
            <View
              style={[
                styles.screenGridH,
                { backgroundColor: isDark ? "rgba(52, 211, 153, 0.08)" : "rgba(40, 84, 72, 0.06)" },
              ]}
            />
            <View
              style={[
                styles.screenGridV,
                { backgroundColor: isDark ? "rgba(52, 211, 153, 0.08)" : "rgba(40, 84, 72, 0.06)" },
              ]}
            />

            {/* Glowing Route Polyline Path */}
            <View style={styles.routeContainer}>
              <View
                style={[
                  styles.routeDotStart,
                  { backgroundColor: isDark ? "#34D399" : "#285448" },
                ]}
              />
              <View
                style={[
                  styles.routePath1,
                  { backgroundColor: isDark ? "#10B981" : "#285448" },
                ]}
              />
              <View
                style={[
                  styles.routePath2,
                  { backgroundColor: isDark ? "#34D399" : "#3B7A68" },
                ]}
              />
              {/* Destination Marker */}
              <View style={styles.destMarker}>
                <Ionicons
                  name="location"
                  size={moderateScale(14)}
                  color={isDark ? "#34D399" : "#285448"}
                />
              </View>
            </View>

            {/* Screen Glass Sheen */}
            <LinearGradient
              colors={["rgba(255, 255, 255, 0.20)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.8, y: 0.6 }}
              style={styles.screenSheen}
            />
          </View>
        </LinearGradient>
      </View>

      {/* Floating Orbiting Badges */}
      {/* 1. Location Pin Badge (Top-Left) */}
      <View
        style={[
          styles.orbitBadge,
          styles.badgeLocation,
          {
            backgroundColor: isDark ? "#15221C" : "#FFFFFF",
            borderColor: isDark ? "rgba(52, 211, 153, 0.35)" : "rgba(40, 84, 72, 0.20)",
            shadowColor: isDark ? "#10B981" : "#000000",
          },
        ]}
      >
        <LinearGradient
          colors={
            isDark
              ? ["#1E352B", "#10231B"]
              : ["#E8F5EE", "#D4EADC"]
          }
          style={styles.badgeInner}
        >
          <Ionicons
            name="location-sharp"
            size={moderateScale(16)}
            color={isDark ? "#34D399" : "#285448"}
          />
        </LinearGradient>
      </View>

      {/* 2. Camera Badge (Top-Right) */}
      <View
        style={[
          styles.orbitBadge,
          styles.badgeCamera,
          {
            backgroundColor: isDark ? "#15221C" : "#FFFFFF",
            borderColor: isDark ? "rgba(52, 211, 153, 0.35)" : "rgba(40, 84, 72, 0.20)",
            shadowColor: isDark ? "#10B981" : "#000000",
          },
        ]}
      >
        <LinearGradient
          colors={
            isDark
              ? ["#1E352B", "#10231B"]
              : ["#E8F5EE", "#D4EADC"]
          }
          style={styles.badgeInner}
        >
          <Ionicons
            name="camera"
            size={moderateScale(15)}
            color={isDark ? "#34D399" : "#285448"}
          />
        </LinearGradient>
      </View>

      {/* 3. Car / Vehicle Badge (Bottom-Right) */}
      <View
        style={[
          styles.orbitBadge,
          styles.badgeCar,
          {
            backgroundColor: isDark ? "#15221C" : "#FFFFFF",
            borderColor: isDark ? "rgba(52, 211, 153, 0.35)" : "rgba(40, 84, 72, 0.20)",
            shadowColor: isDark ? "#10B981" : "#000000",
          },
        ]}
      >
        <LinearGradient
          colors={
            isDark
              ? ["#1E352B", "#10231B"]
              : ["#E8F5EE", "#D4EADC"]
          }
          style={styles.badgeInner}
        >
          <Ionicons
            name="car-outline"
            size={moderateScale(16)}
            color={isDark ? "#34D399" : "#285448"}
          />
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
  gridContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  angledLine: {
    position: "absolute",
    borderWidth: 1,
  },
  angledLine1: {
    width: moderateScale(240),
    height: moderateScale(90),
    borderRadius: moderateScale(45),
    transform: [{ rotate: "-15deg" }],
  },
  angledLine2: {
    width: moderateScale(200),
    height: moderateScale(70),
    borderRadius: moderateScale(35),
    transform: [{ rotate: "18deg" }],
  },
  angledLine3: {
    width: moderateScale(160),
    height: moderateScale(50),
    borderRadius: moderateScale(25),
    transform: [{ rotate: "-6deg" }],
  },
  orbitArc: {
    position: "absolute",
    width: moderateScale(210),
    height: moderateScale(130),
    borderRadius: moderateScale(65),
    borderWidth: 1,
    borderStyle: "dashed",
  },
  phoneShadowContainer: {
    shadowOffset: { width: 0, height: moderateScale(8) },
    shadowOpacity: 0.45,
    shadowRadius: moderateScale(16),
    elevation: 10,
  },
  phoneChassis: {
    width: moderateScale(74),
    height: moderateScale(114),
    borderRadius: moderateScale(18),
    padding: moderateScale(4),
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
  },
  speakerPill: {
    width: moderateScale(18),
    height: moderateScale(3.5),
    borderRadius: moderateScale(2),
    marginBottom: moderateScale(3),
  },
  phoneScreen: {
    width: "100%",
    flex: 1,
    borderRadius: moderateScale(13),
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  screenGridH: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: 1,
  },
  screenGridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: 1,
  },
  routeContainer: {
    width: moderateScale(46),
    height: moderateScale(56),
    position: "relative",
  },
  routeDotStart: {
    position: "absolute",
    bottom: moderateScale(4),
    left: moderateScale(4),
    width: moderateScale(6),
    height: moderateScale(6),
    borderRadius: moderateScale(3),
  },
  routePath1: {
    position: "absolute",
    bottom: moderateScale(7),
    left: moderateScale(6),
    width: moderateScale(20),
    height: 2,
    transform: [{ rotate: "-35deg" }],
    transformOrigin: "left bottom",
  },
  routePath2: {
    position: "absolute",
    top: moderateScale(18),
    right: moderateScale(8),
    width: moderateScale(22),
    height: 2,
    transform: [{ rotate: "45deg" }],
    transformOrigin: "left top",
  },
  destMarker: {
    position: "absolute",
    top: moderateScale(2),
    right: moderateScale(4),
  },
  screenSheen: {
    ...StyleSheet.absoluteFillObject,
  },
  orbitBadge: {
    position: "absolute",
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(18),
    borderWidth: 1,
    padding: moderateScale(2),
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  badgeInner: {
    flex: 1,
    borderRadius: moderateScale(16),
    alignItems: "center",
    justifyContent: "center",
  },
  badgeLocation: {
    top: moderateScale(14),
    left: moderateScale(28),
  },
  badgeCamera: {
    top: moderateScale(18),
    right: moderateScale(30),
  },
  badgeCar: {
    bottom: moderateScale(16),
    right: moderateScale(44),
  },
});

