import React from "react";
import { Image, StyleSheet, View, Text, Pressable, Linking } from "react-native";
import { useTheme } from "../lib/theme-context";

/**
 * TomTom static-image map with modern floating navigation UI — Expo Go safe.
 * Renders high-resolution TomTom base map with vehicle pins, live GPS overlays,
 * floating status pills, and navigation controls.
 */
export default function TripMap({
  origin,
  destination,
  live,
  originName = "",
  destinationName = "",
  driverName = "",
  plateNumber = "",
  height = 280,
  borderRadius = 24,
  onNavigate,
}) {
  const { colors } = useTheme();
  const key = process.env.EXPO_PUBLIC_TOMTOM_API_KEY || "3UvNRAZJ2015H29jWzKGJbAAB41Yf8hL";

  const originValid = origin && Number.isFinite(Number(origin.latitude)) && Number.isFinite(Number(origin.longitude));
  const destValid = destination && Number.isFinite(Number(destination.latitude)) && Number.isFinite(Number(destination.longitude));

  // Centre on midpoint
  const known = [];
  if (originValid) known.push([Number(origin.latitude), Number(origin.longitude)]);
  if (destValid) known.push([Number(destination.latitude), Number(destination.longitude)]);
  if (live) known.push([Number(live.latitude), Number(live.longitude)]);

  const center = known.length > 0
    ? [
        known.reduce((s, p) => s + p[0], 0) / known.length,
        known.reduce((s, p) => s + p[1], 0) / known.length,
      ]
    : [14.5159, 120.9953];

  const markers = [];
  if (originValid) markers.push({ lat: Number(origin.latitude), lng: Number(origin.longitude), color: "10B981" });
  if (destValid) markers.push({ lat: Number(destination.latitude), lng: Number(destination.longitude), color: "EF4444" });

  const url = staticImageSource({ key, center, markers, width: 640, height: 480 });
  const liveValid = live && Number.isFinite(Number(live.latitude)) && Number.isFinite(Number(live.longitude));

  const handleOpenGoogleMaps = () => {
    if (destValid) {
      const gurl = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}`;
      Linking.openURL(gurl).catch(() => {});
    }
  };

  return (
    <View style={[styles.wrap, { height, borderRadius, overflow: "hidden" }]}>
      <Image source={{ uri: url }} style={styles.image} resizeMode="cover" />
      
      {/* Dark Overlay Gradient for High Contrast */}
      <View style={styles.overlay} pointerEvents="none" />

      {/* Floating Top Navigation Header Pill */}
      <View style={styles.topPillWrap} pointerEvents="box-none">
        <View style={styles.topPill}>
          <View style={styles.pulseDot} />
          <Text style={styles.topPillText} numberOfLines={1}>
            {liveValid ? "GPS Live Tracking Active" : "Route Navigation"}
          </Text>
        </View>
      </View>

      {/* Live Vehicle Marker Overlay */}
      {liveValid && (
        <View
          pointerEvents="none"
          style={[
            styles.liveMarker,
            {
              left: `${liveX(live, center) * 100}%`,
              top: `${liveY(live, center) * 100}%`,
            },
          ]}
        >
          <View style={styles.livePulseHalo} />
          <View style={styles.liveCoreDot} />
        </View>
      )}

      {/* Bottom Floating Quick Navigation Bar */}
      <View style={styles.bottomBar} pointerEvents="box-none">
        <Pressable
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          onPress={handleOpenGoogleMaps}
        >
          <Text style={styles.navButtonIcon}>🧭</Text>
          <Text style={styles.navButtonText}>Open Navigation</Text>
        </Pressable>
      </View>
    </View>
  );
}

function staticImageSource({ key, center, markers, width, height }) {
  const params = new URLSearchParams({
    key,
    format: "png",
    zoom: "13",
    width: String(width),
    height: String(height),
  });
  if (center) params.set("center", `${center[1]},${center[0]}`);
  for (const m of markers) {
    const label = m.color === "10B981" ? "A" : "B";
    params.append("markers", `color:0x${m.color}|label:${label}|${m.lat},${m.lng}`);
  }
  return `https://api.tomtom.com/map/1/staticimage?${params.toString()}`;
}

function liveX(live, center) {
  const span = 0.02;
  const f = (Number(live.longitude) - center[1]) / span;
  return clamp(0.5 + f, 0.08, 0.92);
}

function liveY(live, center) {
  const span = 0.02;
  const f = (center[0] - Number(live.latitude)) / span;
  return clamp(0.5 + f, 0.08, 0.92);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

const styles = StyleSheet.create({
  wrap: { width: "100%", backgroundColor: "#0F172A", position: "relative" },
  image: { width: "100%", height: "100%" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.15)",
  },
  topPillWrap: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    alignItems: "center",
    zIndex: 10,
  },
  topPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
  },
  topPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  liveMarker: {
    position: "absolute",
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    alignItems: "center",
    justify: "center",
    zIndex: 5,
  },
  livePulseHalo: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(37, 99, 235, 0.35)",
  },
  liveCoreDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#2563EB",
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
  },
  bottomBar: {
    position: "absolute",
    bottom: 10,
    right: 10,
    zIndex: 10,
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2563EB",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  navButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  navButtonIcon: {
    fontSize: 12,
  },
  navButtonText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
});
