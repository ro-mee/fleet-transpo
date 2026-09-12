import { moderateScale } from '../../../lib/scaling';
import React, { useState, useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Linking,
  Dimensions,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { api, wasQueued } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { AppAlert } from "../../../components/AppAlert";
import { useTripTracking } from "../../../lib/tracking";
import { getActiveStatuses, getNextStatus } from "../../../lib/tripRef";

import { useTheme } from "../../../lib/theme-context";
import TripMap from "../../../components/map";
import { Plate } from "../../../components/plate";
import { Avatar } from "../../../components/ui";
import { ClayCard, ClayBadge, ClayButton, ClayTile, ClayInput } from "../../../components/clay";


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
  const [error, setError] = useState(null);
  const [completingTrip, setCompletingTrip] = useState(null);
  const [odometerInput, setOdometerInput] = useState("");
  const [odometerError, setOdometerError] = useState(null);

  const activeTrip = trips.find((t) => activeStatuses.includes(t.trip_status));
  const tracking = useTripTracking(activeTrip?.trip_id ?? null);
  const nextAction = useNextStatus(activeTrip?.trip_status);

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
      Linking.openURL(gurl).catch(() => { });
    }
  };

  const advanceTrip = async (trip, next) => {
    setActingOn(trip.trip_id);
    try {
      const isComplete = next?.status === "Completed";
      const action = isComplete ? "complete" : next?.action || "start";
      const path =
        action === "accept"
          ? `/api/trips/${trip.trip_id}/accept`
          : action === "start"
            ? `/api/trips/${trip.trip_id}/start`
            : action === "at-pickup"
              ? `/api/trips/${trip.trip_id}/at-pickup`
              : action === "onboard"
                ? `/api/trips/${trip.trip_id}/onboard`
                : action === "enroute"
                  ? `/api/trips/${trip.trip_id}/enroute`
                  : action === "dropoff"
                    ? `/api/trips/${trip.trip_id}/dropoff`
                    : action === "complete"
                      ? `/api/trips/${trip.trip_id}/complete`
                      : `/api/trips/${trip.trip_id}/start`;
      const body =
        action === "accept"
          ? { accept: true }
          : action === "complete"
            ? { end_odometer: next.endOdometer }
            : action === "start"
              ? { odometer: Number(trip.current_mileage) || undefined }
              : {};
      const res = await api.put(path, body);
      // PR #3.1: queued reached the outbox, not the server — say so.
      if (wasQueued(res)) AppAlert.alert("Saved for sync", "This update will be sent when you're online.");
      setError(null);
      await load();
    } catch (e) {
      console.warn("Status update error:", e);
      setError(e.message || "Could not update the trip status.");
    } finally {
      setActingOn(null);
    }
  };

  // Completing a trip is the one step a driver cannot walk back, and it stops
  // location sharing, so it is confirmed. End-odometer is captured here and
  // sent to the server, which validates it (src/lib/vehicles/odometer.js).
  // The action itself comes from the server's nextStatus reference data, so
  // this button always matches the driver state machine.
  const handleAction = (trip) => {
    if (!nextAction) return;
    if (nextAction.status !== "Completed") {
      advanceTrip(trip, nextAction);
      return;
    }
    setOdometerInput("");
    setOdometerError(null);
    setCompletingTrip(trip);
  };

  const confirmComplete = () => {
    const value = Number(odometerInput);
    if (!odometerInput.trim() || !Number.isFinite(value) || value < 0) {
      setOdometerError("Enter the ending odometer (km).");
      return;
    }
    const trip = completingTrip;
    setCompletingTrip(null);
    advanceTrip(trip, { status: "Completed", endOdometer: value });
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
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
        <ClayCard variant="compact" style={styles.topGlassCard}>
          <View style={styles.driverRow}>
            <Avatar initials={driverInitials} />
            <View style={styles.driverInfo}>
              <Text style={[styles.driverNameText, { color: colors.onSurface }]}>
                {driverName}
              </Text>
              <Text style={[styles.driverStatusSub, { color: colors.onSurfaceVariant }]}>
                {activeTrip ? `Active Trip #${activeTrip.trip_id}` : "Not tracking"}
              </Text>
            </View>

            {activeTrip && (
              <ClayBadge label={activeTrip.trip_status} tone="info" statusDot size="sm" />
            )}
          </View>
        </ClayCard>
      </View>

      {/* Floating Bottom Sheet Trip Navigation Card */}
      {activeTrip ? (
        <ClayCard variant="hero" style={[styles.bottomSheet, { paddingBottom: insets.bottom + 80 }]}>
          <View style={styles.sheetHandle} />

          {/* Destination & Route Header */}
          <View style={styles.routeHeader}>
            <ClayTile icon="location" size="md" />
            <View style={styles.routeDetails}>
              <Text style={[styles.routeLabel, { color: colors.onSurfaceVariant }]}>
                Heading to Destination
              </Text>
              <Text style={[styles.destinationTitle, { color: colors.onSurface }]} numberOfLines={1}>
                {activeTrip.destination || "Destination unavailable"}
              </Text>
              <Text style={[styles.pickupSub, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                Pickup: {activeTrip.origin || "Pickup unavailable"}
              </Text>
            </View>
          </View>

          {/* Vehicle & Plate Bar */}
          <View style={styles.plateContainer}>
            <Plate plate={activeTrip.plate_number} size="lg" />
            <ClayButton
              label="Directions"
              icon="compass-outline"
              size="sm"
              onPress={() => handleOpenGoogleMaps(activeTrip.destination_latitude, activeTrip.destination_longitude)}
            />
          </View>

          {/* Action Button */}
          {nextAction && (
            <ClayButton
              label={nextAction.label}
              loading={actingOn === activeTrip.trip_id}
              onPress={() => handleAction(activeTrip)}
              size="lg"
              style={styles.primaryActionButton}
            />
          )}

          {error && (
            <Text style={[styles.errorText, { color: colors.error }]} numberOfLines={2}>
              {error}
            </Text>
          )}
        </ClayCard>
      ) : (
        <ClayCard variant="hero" style={[styles.bottomSheet, { paddingBottom: insets.bottom + 80 }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.destinationTitle, { color: colors.onSurface, textAlign: "center" }]}>
            No Active Trip En Route
          </Text>
          <Text style={[styles.pickupSub, { color: colors.onSurfaceVariant, textAlign: "center", marginTop: moderateScale(4) }]}>
            New trip assignments from your dispatcher will automatically plot your live GPS route here.
          </Text>
        </ClayCard>
      )}

      {/* Odometer capture modal — cross-platform replacement for the iOS-only
          Alert.prompt. Completing a trip is terminal, so it is confirmed. */}
      <Modal
        visible={!!completingTrip}
        transparent
        animationType="fade"
        onRequestClose={() => setCompletingTrip(null)}
      >
        <View style={styles.modalBackdrop}>
          <ClayCard variant="standard" style={styles.modalCard}>
            <View style={[styles.modalHandle, { backgroundColor: colors.outlineVariant }]} />
            <Text style={[styles.modalTitle, { color: colors.onSurface }]}>
              Complete this trip?
            </Text>
            <Text style={[styles.modalSubtitle, { color: colors.onSurfaceVariant }]}>
              Enter the ending odometer (km), then confirm. This closes the trip
              and stops location sharing.
            </Text>
            <ClayInput
              value={odometerInput}
              onChangeText={setOdometerInput}
              keyboardType="decimal-pad"
              autoFocus
              placeholder="e.g. 45230"
              error={odometerError}
            />
            <View style={styles.modalActions}>
              <ClayButton
                label="Not yet"
                variant="tonal"
                onPress={() => setCompletingTrip(null)}
                style={styles.modalActionBtn}
              />
              <ClayButton
                label="Complete trip"
                variant="primary"
                onPress={confirmComplete}
                loading={actingOn === completingTrip?.trip_id}
                style={styles.modalActionBtn}
              />
            </View>
          </ClayCard>
        </View>
      </Modal>

    </View>
  );
}

/** Loads the next driver action for a status from the server reference data. */
function useNextStatus(status) {
  const [next, setNext] = useState(null);
  useEffect(() => {
    let active = true;
    getNextStatus(status).then((n) => {
      if (active) setNext(n);
    });
    return () => {
      active = false;
    };
  }, [status]);
  return next;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: "relative",
  },
  topFloatingBar: {
    position: "absolute",
    top: 0,
    left: moderateScale(16),
    right: moderateScale(16),
    zIndex: 20,
  },
  topGlassCard: {
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(12),
    borderRadius: moderateScale(16),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: moderateScale(4) },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.08)",
  },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
  },
  driverInfo: {
    flex: 1,
  },
  driverNameText: {
    fontSize: moderateScale(16),
    fontFamily: "Inter_600SemiBold",
    lineHeight: moderateScale(22),
  },
  driverStatusSub: {
    fontSize: moderateScale(12),
    fontFamily: "Inter_400Regular",
    lineHeight: moderateScale(16),
    marginTop: 1,
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(12),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: moderateScale(-6) },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.05)",
    zIndex: 20,
  },
  sheetHandle: {
    width: moderateScale(36),
    height: moderateScale(4),
    borderRadius: moderateScale(2),
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    alignSelf: "center",
    marginBottom: moderateScale(16),
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(12),
    marginBottom: moderateScale(16),
  },
  routeDetails: {
    flex: 1,
  },
  routeLabel: {
    fontSize: moderateScale(10),
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  destinationTitle: {
    fontSize: moderateScale(16),
    fontWeight: "800",
    marginTop: moderateScale(2),
  },
  pickupSub: {
    fontSize: moderateScale(12),
    fontWeight: "500",
    marginTop: moderateScale(2),
  },
  plateContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: moderateScale(16),
    paddingTop: moderateScale(12),
    borderTopWidth: 1,
    borderTopColor: "rgba(0, 0, 0, 0.06)",
  },
  primaryActionButton: {
    height: moderateScale(52),
    borderRadius: moderateScale(20),
  },
  errorText: {
    fontSize: moderateScale(12),
    fontWeight: "600",
    textAlign: "center",
    marginTop: moderateScale(8),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: moderateScale(24),
  },
  modalCard: {
    width: "100%",
    maxWidth: moderateScale(420),
    borderRadius: moderateScale(24),
    padding: moderateScale(20),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: moderateScale(8) },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  modalHandle: {
    width: moderateScale(36),
    height: moderateScale(4),
    borderRadius: moderateScale(2),
    alignSelf: "center",
    marginBottom: moderateScale(16),
  },
  modalTitle: {
    fontSize: moderateScale(17),
    fontWeight: "800",
  },
  modalSubtitle: {
    fontSize: moderateScale(12),
    fontWeight: "500",
    lineHeight: moderateScale(18),
    marginTop: moderateScale(6),
    marginBottom: moderateScale(14),
  },
  modalActions: {
    flexDirection: "row",
    gap: moderateScale(10),
    marginTop: moderateScale(16),
  },
  modalActionBtn: {
    flex: 1,
  },
});
