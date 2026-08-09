import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  StyleSheet,
  View,
  Text,
  Pressable,
  Linking,
  PanResponder,
} from "react-native";
import { useTheme } from "../lib/theme-context";

/**
 * TomTom static-image map with pan/zoom/drag — Expo Go safe (no native module).
 * Renders the base map as a static image and simulates interactivity:
 *  - drag-to-pan with live transform feedback (image re-fetches on release)
 *  - 4-directional pan buttons
 *  - zoom in/out buttons (zoom 10–17)
 *  - recenter button (back to the route midpoint / live fix)
 * The TomTom public key is intentionally in the bundle (same posture as the
 * web tiles). Markers are baked into the static image at their geo position,
 * so they track correctly as the map pans.
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
  showControls = true,
}) {
  const { colors } = useTheme();
  const key = process.env.EXPO_PUBLIC_TOMTOM_API_KEY;

  const originValid = origin && Number.isFinite(Number(origin.latitude)) && Number.isFinite(Number(origin.longitude));
  const destValid = destination && Number.isFinite(Number(destination.latitude)) && Number.isFinite(Number(destination.longitude));
  const liveValid = live && Number.isFinite(Number(live.latitude)) && Number.isFinite(Number(live.longitude));

  // Initial centre = midpoint of all known points.
  const known = useMemo(() => {
    const pts = [];
    if (originValid) pts.push([Number(origin.latitude), Number(origin.longitude)]);
    if (destValid) pts.push([Number(destination.latitude), Number(destination.longitude)]);
    if (liveValid) pts.push([Number(live.latitude), Number(live.longitude)]);
    return pts;
  }, [originValid, destValid, liveValid, origin, destination, live]);

  const initialCenter = useMemo(
    () =>
      known.length > 0
        ? [
            known.reduce((s, p) => s + p[0], 0) / known.length,
            known.reduce((s, p) => s + p[1], 0) / known.length,
          ]
        : [14.5159, 120.9953],
    [known]
  );

  const [center, setCenter] = useState(initialCenter);
  const [zoom, setZoom] = useState(13);
  // Live-drag transform; committed to `center` on release.
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const centerRef = useRef(center);
  centerRef.current = center;

  // Approximate degrees-per-pixel at the current zoom. The static image spans
  // ~0.02° of longitude at zoom 13; each zoom step halves/doubles the span.
  const spanDeg = 0.02 * Math.pow(2, 13 - zoom);
  const degPerPx = spanDeg / 640;
  // Kept in a ref so the PanResponder (created once) reads the live value.
  const degPerPxRef = useRef(degPerPx);
  degPerPxRef.current = degPerPx;

  const panBy = (dLat, dLng) => {
    setCenter([centerRef.current[0] + dLat, centerRef.current[1] + dLng]);
  };

  const panStep = () => spanDeg * 0.22;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
      onPanResponderGrant: () => setDrag({ x: 0, y: 0 }),
      onPanResponderMove: (_, g) => setDrag({ x: g.dx, y: g.dy }),
      onPanResponderRelease: (_, g) => {
        // Screen y grows downward: dragging down moves the map north.
        panBy(g.dy * degPerPxRef.current, -g.dx * degPerPxRef.current);
        setDrag({ x: 0, y: 0 });
      },
      onPanResponderTerminate: () => setDrag({ x: 0, y: 0 }),
    })
  ).current;

  const markers = [];
  if (originValid) markers.push({ lat: Number(origin.latitude), lng: Number(origin.longitude), color: "10B981" });
  if (destValid) markers.push({ lat: Number(destination.latitude), lng: Number(destination.longitude), color: "EF4444" });

  const url = staticImageSource({ key, center, markers, width: 640, height: 480, zoom });

  // Show a stable image while a new one downloads. Without this, changing
  // `center`/`zoom` (on drag release, pan, or zoom) swaps the Image source and
  // React Native blanks the tile until the new static image loads — a visible
  // "loading then reappears" flash. Prefetch first, then swap once ready.
  const [displaySrc, setDisplaySrc] = useState(null);
  const firstPaintRef = useRef(true);
  useEffect(() => {
    let active = true;
    // First render: paint immediately so there is never a blank map.
    if (firstPaintRef.current) {
      firstPaintRef.current = false;
      setDisplaySrc(url);
      return () => { active = false; };
    }
    Image.prefetch(url)
      .then(() => { if (active) setDisplaySrc(url); })
      .catch(() => { if (active) setDisplaySrc(url); });
    return () => { active = false; };
  }, [url]);

  const handleOpenGoogleMaps = () => {
    if (destValid) {
      const gurl = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}`;
      Linking.openURL(gurl).catch(() => {});
    }
  };

  const zoomStep = (d) => {
    setZoom((z) => Math.min(17, Math.max(10, z + d)));
  };

  const handleRecenter = () => {
    setCenter(initialCenter);
    setZoom(13);
    setDrag({ x: 0, y: 0 });
  };

  return (
    <View style={[styles.wrap, { height, borderRadius, overflow: "hidden" }]}>
      {/* Draggable map surface (image + overlays move together). */}
      <View
        style={[styles.mapSurface, { transform: [{ translateX: drag.x }, { translateY: drag.y }] }]}
        {...panResponder.panHandlers}
      >
        <Image source={{ uri: displaySrc }} style={styles.image} resizeMode="cover" />
        <View style={styles.overlay} pointerEvents="none" />

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
      </View>

      {showControls && (
        <>
          {/* Floating Top Navigation Header Pill (not dragged) */}
          <View style={styles.topPillWrap} pointerEvents="none">
            <View style={styles.topPill}>
              <View style={styles.pulseDot} />
              <Text style={styles.topPillText} numberOfLines={1}>
                {liveValid ? "GPS Live Tracking Active" : "Route Navigation"}
              </Text>
            </View>
          </View>

          {/* Right control stack: zoom + / − and recenter */}
          <View style={styles.controlStack}>
            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]}
              onPress={() => zoomStep(1)}
              hitSlop={6}
            >
              <Text style={styles.controlText}>+</Text>
            </Pressable>
            <View style={styles.zoomBadge}>
              <Text style={styles.zoomBadgeText}>{zoom}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]}
              onPress={() => zoomStep(-1)}
              hitSlop={6}
            >
              <Text style={styles.controlText}>−</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.controlBtn, pressed && styles.controlBtnPressed]}
              onPress={handleRecenter}
              hitSlop={6}
            >
              <Text style={styles.controlText}>◎</Text>
            </Pressable>
          </View>

          {/* 4-directional pan pad */}
          <View style={styles.panPad} pointerEvents="box-none">
            <View style={styles.panRow}>
              <Pressable
                style={({ pressed }) => [styles.panBtn, pressed && styles.controlBtnPressed]}
                onPress={() => panBy(panStep(), 0)}
                hitSlop={4}
              >
                <Text style={styles.panText}>▲</Text>
              </Pressable>
            </View>
            <View style={styles.panRow}>
              <Pressable
                style={({ pressed }) => [styles.panBtn, pressed && styles.controlBtnPressed]}
                onPress={() => panBy(0, -panStep())}
                hitSlop={4}
              >
                <Text style={styles.panText}>◀</Text>
              </Pressable>
              <View style={styles.panCenter} />
              <Pressable
                style={({ pressed }) => [styles.panBtn, pressed && styles.controlBtnPressed]}
                onPress={() => panBy(0, panStep())}
                hitSlop={4}
              >
                <Text style={styles.panText}>▶</Text>
              </Pressable>
            </View>
            <View style={styles.panRow}>
              <Pressable
                style={({ pressed }) => [styles.panBtn, pressed && styles.controlBtnPressed]}
                onPress={() => panBy(-panStep(), 0)}
                hitSlop={4}
              >
                <Text style={styles.panText}>▼</Text>
              </Pressable>
            </View>
          </View>

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
        </>
      )}
    </View>
  );
}

function staticImageSource({ key, center, markers, width, height, zoom }) {
  const params = new URLSearchParams({
    key,
    format: "png",
    zoom: String(zoom),
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
  mapSurface: { ...StyleSheet.absoluteFillObject },
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
    justifyContent: "center",
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
  controlStack: {
    position: "absolute",
    right: 10,
    top: 48,
    alignItems: "center",
    gap: 6,
    zIndex: 10,
  },
  controlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(15, 23, 42, 0.82)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  controlBtnPressed: { opacity: 0.75, transform: [{ scale: 0.94 }] },
  controlText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700", lineHeight: 20 },
  zoomBadge: {
    minWidth: 26,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(15, 23, 42, 0.82)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomBadgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  panPad: {
    position: "absolute",
    left: 10,
    bottom: 56,
    alignItems: "center",
    zIndex: 10,
  },
  panRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  panBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  panCenter: { width: 34, height: 34 },
  panText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
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
