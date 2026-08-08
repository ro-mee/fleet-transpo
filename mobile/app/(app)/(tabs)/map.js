import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Linking,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useTripTracking } from "../../../lib/tracking";
import { getActiveStatuses, getTone, getNextStatus } from "../../../lib/tripRef";
import { useTheme } from "../../../lib/theme-context";
import { space, fonts } from "../../../lib/theme";
import TripMap from "../../../components/map";
import { Plate } from "../../../components/plate";
import { Avatar, Button, StatusPill, EmptyState, styles as ui } from "../../../components/ui";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function FullMapTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

  const [trips, setTrips] = useState([]);
  const [activeStatuses, setActiveStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState(null);

  const activeTrip = trips.find((t) => activeStatuses.includes(t.trip_status));
  const tracking = useTripTracking(activeTrip?.trip_id ?? null);

  const load = useCallback(async () => {
    try {
      const [data, active] = await Promise.all([
        api.get("/api/mobile/driver/trips"),
        getActiveStatuses(),
      ]);
      setTrips(Array.isArray(data) ? data : []);
      setActiveStatuses(active);
    } catch (e) {
      console.warn("Could not load trips for live map:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const driverName = user?.firstName ?? user?.first_name ?? "Driver";
  const driverInitials = driverName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  const handleOpenGoogleMaps = (destLat, destLng) => {
    if (destLat && destLng) {
      const gurl = `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`;
      Linking.openURL(gurl).catch(() => {});
    }
  };

  const advanceTrip = async (trip, next) => {
    setActingOn(trip.trip_id);
    try {
      await api.put(`/api/mobile/driver/trips/${trip.trip_id}/status`, {
        status: next.status,
      });
      await load();
    } catch (e) {
      console.warn("Status update error:", e);
    } finally {
      setActingOn(null);
    }
  };

  const liveFix = tracking?.latestFix && Number.isFinite(Number(tracking.latestFix.latitude)) && Number.isFinite(Number(tracking.latestFix.longitude))
    ? { latitude: Number(tracking.latestFix.latitude), longitude: Number(tracking.latestFix.longitude) }
    : (tracking?.latestFix && Number.isFinite(Number(tracking.latestFix.lat)) && Number.isFinite(Number(tracking.latestFix.lng))
      ? { latitude: Number(tracking.latestFix.lat), longitude: Number(tracking.latestFix.lng) }
      : null);

  const originCoords = liveFix
    ? liveFix
    : (activeTrip?.origin_latitude != null && activeTrip?.origin_longitude != null
      ? { latitude: Number(activeTrip.origin_latitude), longitude: Number(activeTrip.origin_longitude) }
      : (activeTrip?.routes?.origin_latitude != null
        ? { latitude: Number(activeTrip.routes.origin_latitude), longitude: Number(activeTrip.routes.origin_longitude) }
        : null));

  const destCoords = activeTrip?.destination_latitude != null && activeTrip?.destination_longitude != null
    ? { latitude: Number(activeTrip.destination_latitude), longitude: Number(activeTrip.destination_longitude) }
    : (activeTrip?.routes?.destination_latitude != null
      ? { latitude: Number(activeTrip.routes.destination_latitude), longitude: Number(activeTrip.routes.destination_longitude) }
      : null);

  return (
    <View style={styles.container}>
      {/* 100% Full-Screen Background Map */}
      <View style={StyleSheet.absoluteFillObject}>
        <TripMap
          origin={originCoords}
          destination={destCoords}
          live={tracking?.latestFix}
          height={SCREEN_HEIGHT}
          borderRadius={0}
        />
      </View>

      {/* Floating Top Navigation Header Bar */}
      <View style={[styles.topFloatingBar, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.topGlassCard, { backgroundColor: colors.surface }]}>
          <View style={styles.driverRow}>
            <Avatar initials={driverInitials} />
            <View style={styles.driverInfo}>
              <Text style={[styles.driverNameText, { color: colors.onSurface }]}>
                {driverName}
              </Text>
              <Text style={[styles.driverStatusSub, { color: colors.onSurfaceVariant }]}>
                {activeTrip ? `Active Trip #${activeTrip.trip_id}` : "Fleet GPS Ready"}
              </Text>
            </View>

            {activeTrip && (
              <StatusPill label={activeTrip.trip_status} tone="info" />
            )}
          </View>
        </View>
      </View>

      {/* Floating Bottom Sheet Trip Navigation Card */}
      {activeTrip ? (
        <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 80, backgroundColor: colors.surface }]}>
          <View style={styles.sheetHandle} />

          {/* Destination & Route Header */}
          <View style={styles.routeHeader}>
            <View style={styles.routeIconBox}>
              <Text style={styles.routeIcon}>📍</Text>
            </View>
            <View style={styles.routeDetails}>
              <Text style={[styles.routeLabel, { color: colors.onSurfaceVariant }]}>
                Heading to Destination
              </Text>
              <Text style={[styles.destinationTitle, { color: colors.onSurface }]} numberOfLines={1}>
                {activeTrip.destination || "Coco Hotel & Resort"}
              </Text>
              <Text style={[styles.pickupSub, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                Pickup: {activeTrip.origin || "Origin Location"}
              </Text>
            </View>
          </View>

          {/* Vehicle & Plate Bar */}
          <View style={styles.plateContainer}>
            <Plate plate={activeTrip.plate_number} size="lg" />
            <Pressable
              style={({ pressed }) => [styles.navQuickBtn, pressed && styles.navQuickBtnPressed]}
              onPress={() => handleOpenGoogleMaps(activeTrip.destination_latitude, activeTrip.destination_longitude)}
            >
              <Text style={styles.navQuickIcon}>🧭</Text>
              <Text style={styles.navQuickText}>Directions</Text>
            </Pressable>
          </View>

          {/* Action Button */}
          <Button
            label={activeTrip.trip_status === "Assigned" ? "Start Trip" : activeTrip.trip_status === "Trip Started" ? "Arrive at Destination" : "Complete Trip"}
            loading={actingOn === activeTrip.trip_id}
            onPress={() => advanceTrip(activeTrip, { status: activeTrip.trip_status === "Assigned" ? "Trip Started" : "Completed" })}
            style={styles.primaryActionButton}
          />
        </View>
      ) : (
        <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 80, backgroundColor: colors.surface }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.destinationTitle, { color: colors.onSurface, textAlign: "center" }]}>
            No Active Trip En Route
          </Text>
          <Text style={[styles.pickupSub, { color: colors.onSurfaceVariant, textAlign: "center", marginTop: 4 }]}>
            New trip assignments from your dispatcher will automatically plot your live GPS route here.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F172A",
    position: "relative",
  },
  topFloatingBar: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    zIndex: 20,
  },
  topGlassCard: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.08)",
  },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  driverInfo: {
    flex: 1,
  },
  driverNameText: {
    fontSize: 15,
    fontWeight: "700",
  },
  driverStatusSub: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.08)",
    zIndex: 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    alignSelf: "center",
    marginBottom: 16,
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  routeIconBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  routeIcon: {
    fontSize: 20,
  },
  routeDetails: {
    flex: 1,
  },
  routeLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  destinationTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginTop: 2,
  },
  pickupSub: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  plateContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.06)",
  },
  navQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2563EB",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    gap: 6,
  },
  navQuickBtnPressed: {
    opacity: 0.85,
  },
  navQuickIcon: {
    fontSize: 14,
  },
  navQuickText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  primaryActionButton: {
    height: 52,
    borderRadius: 20,
  },
});
