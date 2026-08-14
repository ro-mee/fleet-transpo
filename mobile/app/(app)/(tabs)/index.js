import { moderateScale } from '../../../lib/scaling';
import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ACTIONS, canAction } from "../../../lib/rbac";
import { useTripTracking } from "../../../lib/tracking";
import {
  getActiveStatuses,
  getNextStatus,
} from "../../../lib/tripRef";
import { useTheme } from "../../../lib/theme-context";
import { fonts, space, radius, TOUCH_TARGET } from "../../../lib/theme";
import { StatusPill, SkeletonCard, ErrorNotice } from "../../../components/ui";
import { Plate } from "../../../components/plate";

/**
 * Home Dashboard — matches Stitch "Home Dashboard" screen exactly.
 * Greeting, assigned vehicle, next trip card with route visualization,
 * stats grid, and SOS FAB.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors, type } = useTheme();

  const [trips, setTrips] = useState([]);
  const [activeStatuses, setActiveStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [actingOn, setActingOn] = useState(null);
  const [completingTrip, setCompletingTrip] = useState(null);
  const [odometerInput, setOdometerInput] = useState("");
  const [odometerError, setOdometerError] = useState(null);

  const activeTrip = trips.find((t) => activeStatuses.includes(t.trip_status));
  const pendingTrips = trips.filter((t) => !activeStatuses.includes(t.trip_status));
  const completedTrips = trips.filter((t) => t.trip_status === "Completed");

  const canManageTrip = canAction(user, ACTIONS.MANAGE_TRIP);
  const canReportLocation = canAction(user, ACTIONS.REPORT_LOCATION);
  const canReportFuel = canAction(user, ACTIONS.REPORT_FUEL);

  const tracking = useTripTracking(
    canReportLocation ? activeTrip?.trip_id ?? null : null
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const [data, active] = await Promise.all([
        api.get("/api/mobile/driver/trips"),
        getActiveStatuses(),
      ]);
      setTrips(Array.isArray(data) ? data : []);
      setActiveStatuses(active);
    } catch (e) {
      setError(e.message || "Could not load your trips.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const doAction = async (trip, nextObj) => {
    setActingOn(trip.trip_id);
    try {
      const action = nextObj?.action || "start";
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
                    : `/api/trips/${trip.trip_id}/start`;
      const body = action === "accept" ? { accept: true } : {};
      await api.put(path, body);
      await load();
    } catch (e) {
      Alert.alert("Error", e.message || "Action failed.");
    } finally {
      setActingOn(null);
    }
  };

  const handleTripAction = async (trip) => {
    if (!canManageTrip) return;
    const nextObj = await getNextStatus(trip.trip_status);
    if (!nextObj || !nextObj.status) {
      Alert.alert("No action available", "This trip cannot be progressed further.");
      return;
    }
    if (nextObj.status === "Completed") {
      setCompletingTrip(trip);
      return;
    }
    doAction(trip, nextObj);
  };

  const submitOdometer = async () => {
    const val = parseFloat(odometerInput);
    if (!val || isNaN(val) || val <= 0) {
      setOdometerError("Enter a valid odometer reading.");
      return;
    }
    try {
      setOdometerError(null);
      await api.put(
        `/api/trips/${completingTrip.trip_id}/complete`,
        { end_odometer: val }
      );
      setCompletingTrip(null);
      setOdometerInput("");
      await load();
    } catch (e) {
      setOdometerError(e.message || "Could not complete trip.");
    }
  };

  const openMap = (trip) => {
    const lat = trip.destination_lat;
    const lng = trip.destination_lng;
    if (lat && lng) {
      Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
    }
  };

  const driverName = user?.name?.split(" ")?.[0] || "Driver";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const nextTrip = activeTrip || pendingTrips[0];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ─── Top App Bar ─── */}
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: colors.surface,
            borderBottomColor: colors.outlineVariant,
            paddingTop: insets.top,
          },
        ]}
      >
        <Text style={[type.headlineMd, styles.topBarTitle, { color: colors.primary }]}>FleetOps</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: moderateScale(16) }}>
          <Pressable onPress={() => router.push("/notifications")}>
            <Ionicons name="notifications-outline" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
          <View style={[styles.avatar, { backgroundColor: colors.secondaryContainer }]}>
            <Text style={[type.titleMd, styles.avatarText, { color: colors.onSecondaryContainer }]}>
              {(user?.name?.[0] || "D").toUpperCase()}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ─── Greeting ─── */}
        <View style={styles.greeting}>
          <Text style={[type.headlineLg, styles.greetingTitle, { color: colors.onSurface }]}>
            {greeting}, {driverName}
          </Text>
          <View style={styles.statusRow}>
            <Text style={[type.bodyMd, styles.statusLabel, { color: colors.onSurfaceVariant }]}>
              Current Status:
            </Text>
            <View
              style={[
                styles.statusChip,
                { backgroundColor: activeTrip ? colors.secondary : colors.secondaryContainer },
              ]}
            >
              <View style={[styles.statusDot, { backgroundColor: activeTrip ? colors.onSecondary : colors.onSecondaryContainer }]} />
              <Text style={[type.labelLg, styles.statusChipText, { color: activeTrip ? colors.onSecondary : colors.onSecondaryContainer }]}>
                {activeTrip ? "ON TRIP" : "READY"}
              </Text>
            </View>
          </View>
        </View>

        {/* ─── Assigned Vehicle Card ─── */}
        {activeTrip?.vehicle_plate || pendingTrips[0]?.vehicle_plate ? (
          <View
            style={[
              styles.vehicleCard,
              {
                backgroundColor: colors.surfaceContainerLow,
                borderColor: colors.surfaceContainerHigh,
              },
            ]}
          >
            <View style={[styles.vehicleIcon, { backgroundColor: colors.secondaryContainer }]}>
              <Ionicons name="car-outline" size={24} color={colors.onSecondaryContainer} />
            </View>
            <View style={styles.vehicleInfo}>
              <Text style={[type.labelMd, styles.vehicleLabel, { color: colors.onSurfaceVariant }]}>
                Assigned Vehicle
              </Text>
              <View style={styles.vehicleNameRow}>
                <Text style={[type.titleLg, styles.vehicleName, { color: colors.onSurface }]}>
                  {(activeTrip || pendingTrips[0])?.vehicle_model || "Vehicle"}
                </Text>
                <Text style={[type.bodyMd, styles.vehiclePlate, { color: colors.outline }]}>
                  {(activeTrip || pendingTrips[0])?.vehicle_plate}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {error ? <ErrorNotice message={error} onRetry={load} /> : null}

        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : nextTrip ? (
          /* ─── Next Trip Card ─── */
          <View
            style={[
              styles.tripCard,
              { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.surfaceContainer },
            ]}
          >
            {/* Trip Header */}
            <View style={[styles.tripHeader, { backgroundColor: colors.primary }]}>
              <Text style={[type.labelLg, styles.tripHeaderLabel, { color: colors.onPrimary }]}>
                {activeTrip ? "Active Trip" : "Next Trip"}
              </Text>
              {nextTrip.departure_time ? (
                <Text style={[type.titleLg, styles.tripHeaderTime, { color: colors.onPrimary }]}>
                  {new Date(nextTrip.departure_time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              ) : null}
            </View>

            {/* Route Visualization */}
            <View style={styles.tripBody}>
              <View style={styles.routeViz}>
                <View style={[styles.routeLine, { backgroundColor: colors.outlineVariant }]} />

                {/* Origin */}
                <View style={styles.routeStop}>
                  <View style={[styles.routeDot, { borderColor: colors.outline, backgroundColor: colors.surfaceContainerLowest }]}>
                    <View style={[styles.routeDotInner, { backgroundColor: colors.outline }]} />
                  </View>
                  <View style={styles.routeStopInfo}>
                    <Text style={[type.labelMd, styles.stopType, { color: colors.onSurfaceVariant }]}>PICKUP</Text>
                    <Text style={[type.titleMd, styles.stopName, { color: colors.onSurface }]}>
                      {nextTrip.origin || "Origin"}
                    </Text>
                  </View>
                </View>

                {/* Destination */}
                <View style={styles.routeStop}>
                  <View style={[styles.routeDot, { borderColor: colors.primary, backgroundColor: colors.surfaceContainerLowest }]}>
                    <Ionicons name="location" size={10} color={colors.primary} />
                  </View>
                  <View style={styles.routeStopInfo}>
                    <Text style={[type.labelMd, styles.stopType, { color: colors.onSurfaceVariant }]}>DROP-OFF</Text>
                    <Text style={[type.titleMd, styles.stopName, { color: colors.onSurface }]}>
                      {nextTrip.destination || "Destination"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Divider */}
              <View style={[styles.divider, { backgroundColor: colors.surfaceContainerHigh }]} />

              {/* Guest info */}
              {nextTrip.passenger_name ? (
                <View style={styles.guestRow}>
                  <View style={[styles.guestAvatar, { backgroundColor: colors.surfaceVariant }]}>
                    <Ionicons name="person" size={20} color={colors.onSurfaceVariant} />
                  </View>
                  <View>
                    <Text style={[type.labelMd, styles.guestLabel, { color: colors.onSurfaceVariant }]}>Guest</Text>
                    <Text style={[type.bodyMd, styles.guestName, { color: colors.onSurface }]}>
                      {nextTrip.passenger_name}
                    </Text>
                  </View>
                </View>
              ) : null}

              {/* CTA */}
              {canManageTrip ? (
                <Pressable
                  onPress={() => handleTripAction(nextTrip)}
                  disabled={!!actingOn}
                  style={({ pressed }) => [
                    styles.tripCta,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
                  ]}
                >
                  {actingOn === nextTrip.trip_id ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <>
                      <Ionicons
                        name={activeTrip ? "navigate" : "play"}
                        size={20}
                        color={colors.onPrimary}
                      />
                      <Text style={[type.labelLg, styles.tripCtaText, { color: colors.onPrimary }]}>
                        {activeTrip ? "Continue Trip" : "Start Trip"}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : null}

              {/* Status pill */}
              <StatusPill status={nextTrip.trip_status} />
            </View>
          </View>
        ) : (
          /* ─── Empty State ─── */
          <View style={[styles.emptyCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }]}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.outline} />
            <Text style={[type.titleLg, styles.emptyTitle, { color: colors.onSurface }]}>All Clear</Text>
            <Text style={[type.bodyMd, styles.emptyBody, { color: colors.onSurfaceVariant }]}>
              No trips assigned. Check back soon or pull to refresh.
            </Text>
          </View>
        )}

        {/* ─── Stats Grid ─── */}
        <View style={styles.statsGrid}>
          <View
            style={[
              styles.statCard,
              { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainer },
            ]}
          >
            <Text style={[type.displayLg, styles.statNumber, { color: colors.primary }]}>{trips.length}</Text>
            <Text style={[type.labelMd, styles.statLabel, { color: colors.onSurfaceVariant }]}>
              Total Trips Today
            </Text>
          </View>
          <View
            style={[
              styles.statCard,
              { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainer },
            ]}
          >
            <Text style={[type.displayLg, styles.statNumber, { color: colors.secondary }]}>
              {completedTrips.length}
            </Text>
            <Text style={[type.labelMd, styles.statLabel, { color: colors.onSurfaceVariant }]}>Completed</Text>
          </View>
        </View>

        {/* ─── Quick Actions ─── */}
        <View style={styles.quickActions}>
          <Text style={[type.labelMd, styles.sectionTitle, { color: colors.onSurfaceVariant }]}>
            Quick Actions
          </Text>
          <View style={styles.quickGrid}>
            <Pressable
              onPress={() => router.push("/inspection")}
              style={({ pressed }) => [
                styles.quickBtn,
                {
                  backgroundColor: colors.surfaceContainerLow,
                  borderColor: colors.outlineVariant,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="clipboard-outline" size={24} color={colors.primary} />
              <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]}>
                Pre-Shift Check
              </Text>
            </Pressable>

            {canReportFuel ? (
              <Pressable
                onPress={() => router.push("/fuel-report")}
                style={({ pressed }) => [
                  styles.quickBtn,
                  {
                    backgroundColor: colors.surfaceContainerLow,
                    borderColor: colors.outlineVariant,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons name="water-outline" size={24} color={colors.secondary} />
                <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]}>
                  Log Fuel
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => router.push("/incidents")}
              style={({ pressed }) => [
                styles.quickBtn,
                {
                  backgroundColor: colors.surfaceContainerLow,
                  borderColor: colors.outlineVariant,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="warning-outline" size={24} color={colors.error} />
              <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]}>
                Report Issue
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.push("/submissions")}
              style={({ pressed }) => [
                styles.quickBtn,
                {
                  backgroundColor: colors.surfaceContainerLow,
                  borderColor: colors.outlineVariant,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="document-text-outline" size={24} color={colors.onSurfaceVariant} />
              <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]}>
                My Logs
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* ─── SOS FAB ─── */}
      <Pressable
        onPress={() => router.push("/incidents")}
        style={[
          styles.sosFab,
          { backgroundColor: colors.error, bottom: insets.bottom + 88 },
        ]}
      >
        <Ionicons name="warning" size={24} color={colors.onError} />
        <Text style={[type.labelLg, styles.sosText, { color: colors.onError }]}>SOS</Text>
      </Pressable>

      {/* ─── Odometer Modal ─── */}
      <Modal
        visible={!!completingTrip}
        transparent
        animationType="fade"
        onRequestClose={() => setCompletingTrip(null)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant },
            ]}
          >
            <Text style={[type.titleLg, styles.modalTitle, { color: colors.onSurface }]}>
              Complete Trip
            </Text>
            <Text style={[type.bodyMd, styles.modalBody, { color: colors.onSurfaceVariant }]}>
              Enter the ending odometer reading to finalize this trip.
            </Text>
            <TextInput
              style={[
                type.bodyMd,
                styles.modalInput,
                {
                  borderColor: odometerError ? colors.error : colors.outline,
                  color: colors.onSurface,
                  backgroundColor: colors.surfaceContainerLow,
                },
              ]}
              placeholder="Odometer km"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={odometerInput}
              onChangeText={setOdometerInput}
            />
            {odometerError ? (
              <Text style={[type.caption, styles.modalError, { color: colors.error }]}>
                {odometerError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => { setCompletingTrip(null); setOdometerInput(""); }}
                style={[styles.modalCancelBtn, { borderColor: colors.outline }]}
              >
                <Text style={[type.labelLg, styles.modalCancelText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitOdometer}
                style={[styles.modalConfirmBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[type.labelLg, styles.modalConfirmText, { color: colors.onPrimary }]}>Complete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(12),
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    height: moderateScale(64) + 0, // will be expanded by paddingTop
  },
  topBarTitle: {
  },
  avatar: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
  },
  scroll: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(16),
    gap: moderateScale(16),
  },
  greeting: { gap: moderateScale(4) },
  greetingTitle: {
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(8), marginTop: moderateScale(2) },
  statusLabel: { },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(4),
    borderRadius: moderateScale(999),
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statusDot: {
    width: moderateScale(8),
    height: moderateScale(8),
    borderRadius: moderateScale(4),
  },
  statusChipText: {
  },
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(16),
    padding: moderateScale(16),
    borderRadius: moderateScale(12),
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  vehicleIcon: {
    width: moderateScale(48),
    height: moderateScale(48),
    borderRadius: moderateScale(24),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  vehicleInfo: { flex: 1 },
  vehicleLabel: { letterSpacing: 0.5, textTransform: "uppercase", marginBottom: moderateScale(2) },
  vehicleNameRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(8), flexWrap: "wrap" },
  vehicleName: { },
  vehiclePlate: { },
  tripCard: {
    borderRadius: moderateScale(12),
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: moderateScale(2) },
    elevation: 3,
  },
  tripHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(12),
  },
  tripHeaderLabel: {
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  tripHeaderTime: {
  },
  tripBody: {
    padding: moderateScale(16),
    gap: moderateScale(12),
  },
  routeViz: {
    gap: moderateScale(24),
    marginLeft: moderateScale(8),
    position: "relative",
  },
  routeLine: {
    position: "absolute",
    left: moderateScale(11),
    top: moderateScale(16),
    bottom: moderateScale(16),
    width: moderateScale(2),
  },
  routeStop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(16),
    position: "relative",
    zIndex: 1,
  },
  routeDot: {
    width: moderateScale(24),
    height: moderateScale(24),
    borderRadius: moderateScale(12),
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: moderateScale(2),
  },
  routeDotInner: {
    width: moderateScale(8),
    height: moderateScale(8),
    borderRadius: moderateScale(4),
  },
  routeStopInfo: { flex: 1 },
  stopType: { letterSpacing: 0.5, textTransform: "uppercase" },
  stopName: { marginTop: 1 },
  divider: { height: 1, marginVertical: moderateScale(2) },
  guestRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(12) },
  guestAvatar: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  guestLabel: { },
  guestName: { },
  tripCta: {
    height: moderateScale(56),
    borderRadius: moderateScale(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
    marginTop: moderateScale(4),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tripCtaText: { letterSpacing: 0.1 },
  emptyCard: {
    borderRadius: moderateScale(12),
    borderWidth: 1,
    padding: moderateScale(32),
    alignItems: "center",
    gap: moderateScale(8),
  },
  emptyTitle: { },
  emptyBody: { textAlign: "center" },
  statsGrid: { flexDirection: "row", gap: moderateScale(16) },
  statCard: {
    flex: 1,
    borderRadius: moderateScale(12),
    borderWidth: 1,
    padding: moderateScale(16),
    alignItems: "center",
    justifyContent: "center",
    height: moderateScale(96),
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  statNumber: { letterSpacing: -1 },
  statLabel: { textAlign: "center", marginTop: moderateScale(2) },
  quickActions: { gap: moderateScale(12) },
  sectionTitle: {
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: moderateScale(12) },
  quickBtn: {
    width: "47%",
    borderRadius: moderateScale(12),
    borderWidth: 1,
    padding: moderateScale(16),
    alignItems: "center",
    gap: moderateScale(8),
    minHeight: TOUCH_TARGET,
  },
  quickBtnText: { textAlign: "center" },
  sosFab: {
    position: "absolute",
    right: moderateScale(16),
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(32),
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  sosText: {
    marginTop: -2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: moderateScale(24),
  },
  modalCard: {
    width: "100%",
    borderRadius: moderateScale(16),
    padding: moderateScale(24),
    borderWidth: 1,
    gap: moderateScale(12),
  },
  modalTitle: {
  },
  modalBody: {
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: moderateScale(8),
    padding: moderateScale(12),
    marginTop: moderateScale(8),
  },
  modalError: {
    marginTop: -4,
  },
  modalActions: { flexDirection: "row", gap: moderateScale(12), marginTop: moderateScale(4) },
  modalCancelBtn: {
    flex: 1,
    height: moderateScale(48),
    borderRadius: moderateScale(8),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: { },
  modalConfirmBtn: {
    flex: 1,
    height: moderateScale(48),
    borderRadius: moderateScale(8),
    alignItems: "center",
    justifyContent: "center",
  },
  modalConfirmText: { },
});
