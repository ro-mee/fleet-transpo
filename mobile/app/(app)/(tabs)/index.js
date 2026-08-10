import { useCallback, useState } from "react";
import { useEffect } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Modal,
  TextInput,
  Linking,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ACTIONS, canAction } from "../../../lib/rbac";
import { useTripTracking } from "../../../lib/tracking";
import TripMap from "../../../components/map";
import {
  getActiveStatuses,
  getTone,
  getNextStatus,
} from "../../../lib/tripRef";
import { useTheme } from "../../../lib/theme-context";
import { fonts, space } from "../../../lib/theme";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  SkeletonCard,
  StatusPill,
  styles as ui,
} from "../../../components/ui";
import { BrandBar } from "../../../components/logo";
import { Plate } from "../../../components/plate";
/**
 * Driver home. Answers three things at a glance: am I on a trip, what is
 * assigned next, and what do I do about it.
 *
 * Status grouping, tones, and the next-action chain come from the server
 * (GET /api/mobile/driver/ref) so the client never re-implements the state
 * machine.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

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
  const pendingTrips = trips.filter(
    (t) => !activeStatuses.includes(t.trip_status)
  );

  // Feature gates mirror the driver column of docs/rbac-model.md. The server
  // enforces each action per request; this only decides whether the UI offers
  // it, so the matrix never outruns RLS.
  const canManageTrip = canAction(user, ACTIONS.MANAGE_TRIP);
  const canReportLocation = canAction(user, ACTIONS.REPORT_LOCATION);
  const canReportFuel = canAction(user, ACTIONS.REPORT_FUEL);

  // Location posting runs only while a trip is actually active — and only for
  // a session that holds the report_location action.
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
    }
  }, []);

  // Reloads on every focus, so returning from the fuel screen shows current
  // work without a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await load();
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const respond = useCallback(
    async (trip, accept) => {
      setActingOn(trip.trip_id);
      try {
        await api.put(`/api/mobile/driver/trips/${trip.trip_id}/accept`, {
          accept,
        });
        await load();
      } catch (e) {
        setError(e.message || "Could not update the trip.");
      } finally {
        setActingOn(null);
      }
    },
    [load]
  );

  // Declining cannot be undone from the app, so it is confirmed first.
  const confirmDecline = useCallback(
    (trip) => {
      Alert.alert(
        "Decline this trip?",
        "Your dispatcher will need to reassign it. This cannot be undone from the app.",
        [
          { text: "Keep trip", style: "cancel" },
          {
            text: "Decline",
            style: "destructive",
            onPress: () => respond(trip, false),
          },
        ]
      );
    },
    [respond]
  );

  const updateStatus = useCallback(
    async (trip, status, extra = {}) => {
      setActingOn(trip.trip_id);
      try {
        await api.put(`/api/trips/${trip.trip_id}/status`, { status, ...extra });
        await load();
      } catch (e) {
        setError(e.message || "Could not update the trip status.");
      } finally {
        setActingOn(null);
      }
    },
    [load]
  );

  /**
   * Completing a trip is the one step a driver cannot walk back, and it stops
   * location sharing, so it is confirmed. End-odometer is captured here and
   * sent to the server, which validates it (src/lib/vehicles/odometer.js). The
   * intermediate steps are cheap to correct and go through without a prompt.
   */
  const advance = useCallback(
    (trip, next) => {
      if (next.status !== "Completed") {
        updateStatus(trip, next.status);
        return;
      }
      setOdometerInput("");
      setOdometerError(null);
      setCompletingTrip(trip);
    },
    [updateStatus]
  );

  const confirmComplete = useCallback(() => {
    const value = Number(odometerInput);
    if (!odometerInput.trim() || !Number.isFinite(value) || value < 0) {
      setOdometerError("Enter the ending odometer (km).");
      return;
    }
    const trip = completingTrip;
    setCompletingTrip(null);
    updateStatus(trip, "Completed", { end_odometer: value });
  }, [odometerInput, completingTrip, updateStatus]);

  const driverName = user?.firstName ?? user?.first_name ?? "";
  const firstName = driverName.split(" ")[0];

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl, paddingTop: Math.max(insets.top, space.xl) },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.greetingRow}>
          <View style={styles.greeting}>
            <Text style={[styles.dateLine, { color: colors.onSurfaceVariant }]}>
              {formatDate(new Date())}
            </Text>
            <Text style={[styles.greetingTitle, { color: colors.onBackground }]}>
              {greeting()}{firstName ? `, ${firstName}` : ""}
            </Text>
          </View>
          <Avatar initials={initialsOf(user)} />
        </View>

        <ErrorNotice message={error} onRetry={onRefresh} />

        {loading ? (
          <View style={styles.skeletons}>
            <SkeletonCard lines={4} />
            <SkeletonCard lines={3} />
          </View>
        ) : (
          <>
            {activeTrip ? (
              <ActiveTripCard
                trip={activeTrip}
                tracking={tracking}
                busy={actingOn === activeTrip.trip_id}
                canManage={canManageTrip}
                onAdvance={(next) => advance(activeTrip, next)}
              />
            ) : null}

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
                {pendingTrips.length > 0 ? "Assigned to you" : "Assignments"}
              </Text>

              {pendingTrips.length === 0 ? (
                <EmptyState
                  title="No trips waiting"
                  message="New assignments from your dispatcher will appear here. Pull down to refresh."
                />
              ) : (
                pendingTrips.map((trip) => (
                  <PendingTripCard
                    key={trip.trip_id}
                    trip={trip}
                    busy={actingOn === trip.trip_id}
                    canManage={canManageTrip}
                    onAccept={() => respond(trip, true)}
                    onDecline={() => confirmDecline(trip)}
                  />
                ))
              )}
            </View>

            {/* Fuel is reported against the active trip's vehicle, or falls back to
                their most recent trip. Offered to any session with the report_fuel action. */}
            {canReportFuel ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Fuel</Text>
                <Card>
                  <Text style={ui.bodyText}>
                    Report a fuel purchase for{" "}
                    {activeTrip?.plate_number ?? "your assigned vehicle"}.
                  </Text>
                  <Button
                    label="Add fuel report"
                    variant="secondary"
                    onPress={() => router.push("/fuel-report")}
                  />
                </Card>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Tools</Text>
              <View style={styles.buttonRow}>
                <Button
                  label="Report incident"
                  variant="outline"
                  onPress={() => router.push("/incidents")}
                  style={styles.flex}
                />
                <Button
                  label="Vehicle inspection"
                  variant="outline"
                  onPress={() => router.push("/inspection")}
                  style={styles.flex}
                />
              </View>
              <Button
                label="Emergency Call (Dispatch)"
                variant="secondary"
                onPress={() => {
                  const phone = process.env.EXPO_PUBLIC_DISPATCHER_PHONE;
                  if (!phone) {
                    Alert.alert("SOS Not Configured", "The dispatcher phone number is not set. Please contact IT.");
                    return;
                  }
                  Linking.openURL(`tel:${phone}`).catch(() => 
                    Alert.alert("Error", "Could not open the phone dialer.")
                  );
                }}
              />
            </View>
          </>
        )}
      </ScrollView>

      {/* Odometer capture modal — cross-platform replacement for the iOS-only
          Alert.prompt. Completing a trip is terminal, so it is confirmed. */}
      <Modal
        visible={!!completingTrip}
        transparent
        animationType="fade"
        onRequestClose={() => setCompletingTrip(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.outlineVariant }]} />
            <Text style={[styles.modalTitle, { color: colors.onSurface }]}>
              Complete this trip?
            </Text>
            <Text style={[styles.modalSubtitle, { color: colors.onSurfaceVariant }]}>
              Enter the ending odometer (km), then confirm. This closes the trip
              and stops location sharing.
            </Text>
            <TextInput
              value={odometerInput}
              onChangeText={setOdometerInput}
              keyboardType="decimal-pad"
              autoFocus
              placeholder="e.g. 45230"
              placeholderTextColor={colors.onSurfaceVariant}
              style={[
                styles.modalInput,
                { color: colors.onSurface, borderColor: colors.outlineVariant, backgroundColor: colors.background },
              ]}
            />
            {odometerError && (
              <Text style={[styles.errorText, { color: colors.error }]}>{odometerError}</Text>
            )}
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalCancelBtn, pressed && styles.pressed]}
                onPress={() => setCompletingTrip(null)}
              >
                <Text style={[styles.modalCancelText, { color: colors.onSurfaceVariant }]}>Not yet</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalConfirmBtn, pressed && styles.pressed]}
                onPress={confirmComplete}
                disabled={actingOn === completingTrip?.trip_id}
              >
                <Text style={styles.modalConfirmText}>Complete trip</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ActiveTripCard({ trip, tracking, busy, canManage, onAdvance }) {
  const { colors } = useTheme();
  const tone = useStatusTone(trip.trip_status);
  const nextStatus = useNextStatus(trip.trip_status);

  return (
    <View style={{ marginBottom: space.lg }}>
      {/* Expanded Hero Navigation Map */}
      <View style={{ borderRadius: 28, overflow: "hidden", elevation: 4 }}>
        <TripMap
          origin={
            trip.origin_latitude != null && trip.origin_longitude != null
              ? { latitude: trip.origin_latitude, longitude: trip.origin_longitude }
              : null
          }
          destination={
            trip.destination_latitude != null && trip.destination_longitude != null
              ? { latitude: trip.destination_latitude, longitude: trip.destination_longitude }
              : null
          }
          live={tracking?.latestFix}
          originName={trip.origin}
          destinationName={trip.destination}
          plateNumber={trip.plate_number}
          height={320}
          borderRadius={28}
        />
      </View>

      {/* Floating Driver Navigation Bottom Sheet Card */}
      <Card
        tone={tone}
        style={{
          marginTop: -28,
          borderRadius: 24,
          padding: 16,
          backgroundColor: colors.surface,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 6,
          borderWidth: 1,
          borderColor: colors.outlineVariant || "rgba(0,0,0,0.08)",
        }}
      >
        <View style={ui.rowBetween}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
            <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Active Trip #{trip.trip_id}</Text>
          </View>
          <StatusPill label={trip.trip_status} tone={tone} />
        </View>

        <RouteLine origin={trip.origin} destination={trip.destination} />

        <View style={styles.plateRow}>
          <Plate plate={trip.plate_number} size="lg" />
          <ScheduledBlock time={trip.start_time} />
        </View>

        <TrackingRow tracking={tracking} />

        {canManage && nextStatus ? (
          <Button
            label={nextStatus.label}
            onPress={() => onAdvance(nextStatus)}
            loading={busy}
            style={{ marginTop: space.sm, borderRadius: 16, height: 48 }}
          />
        ) : null}
      </Card>
    </View>
  );
}

function PendingTripCard({ trip, busy, canManage, onAccept, onDecline }) {
  const { colors } = useTheme();
  const tone = useStatusTone(trip.trip_status);

  return (
    <Card>
      <View style={ui.rowBetween}>
        <Text style={[styles.tripId, { color: colors.onSurface }]}>#{trip.trip_id}</Text>
        <StatusPill label={trip.trip_status} tone={tone} />
      </View>

      <RouteLine origin={trip.origin} destination={trip.destination} />

      <View style={styles.plateRow}>
        <Plate plate={trip.plate_number} />
        <ScheduledBlock time={trip.start_time} />
      </View>

      {canManage ? (
        <View style={styles.buttonRow}>
          <Button
            label="Accept"
            onPress={onAccept}
            loading={busy}
            style={styles.flex}
          />
          <Button
            label="Decline"
            variant="outline"
            onPress={onDecline}
            disabled={busy}
            style={styles.flex}
          />
        </View>
      ) : null}
    </Card>
  );
}

/** Loads the tone for a trip status from the server reference data. */
function useStatusTone(status) {
  const [tone, setTone] = useState("neutral");
  useEffect(() => {
    let active = true;
    getTone(status).then((t) => {
      if (active) setTone(t);
    });
    return () => {
      active = false;
    };
  }, [status]);
  return tone;
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

/**
 * A trip has an inherent direction, so the stops are joined by a dashed rail —
 * a signal marking on paper, like a dispatch board.
 */
function RouteLine({ origin, destination }) {
  const { colors } = useTheme();
  return (
    <View style={styles.route}>
      <View style={styles.routeRail}>
        <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
        <View style={[styles.routeStem, { borderLeftColor: colors.outlineVariant }]} />
        <View style={[styles.routeDot, { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary }]} />
      </View>
      <View style={styles.routeText}>
        <Text style={[styles.routeStop, { color: colors.onSurface }]} numberOfLines={2}>
          {origin}
        </Text>
        <Text style={[styles.routeStop, { color: colors.onSurface }]} numberOfLines={2}>
          {destination}
        </Text>
      </View>
    </View>
  );
}

function ScheduledBlock({ time }) {
  const { colors } = useTheme();
  if (!time) return null;
  return (
    <View style={styles.timeBlock}>
      <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Scheduled</Text>
      <Text style={[styles.timeValue, { color: colors.onSurface }]}>{formatTime(time)}</Text>
    </View>
  );
}

/**
 * Live-location state, shown only when something is worth reporting. Labels name
 * the state in text, not by colour alone.
 */
function TrackingRow({ tracking }) {
  const { colors } = useTheme();
  if (tracking.error) {
    return (
      <View style={styles.trackingRow}>
        <View style={[styles.statusDot, { backgroundColor: colors.warning }]} />
        <Text style={[styles.trackingText, { color: colors.onSurfaceVariant }]}>{tracking.error}</Text>
      </View>
    );
  }
  if (!tracking.posting) return null;
  return (
    <View style={styles.trackingRow}>
      <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
      <Text style={[styles.trackingText, { color: colors.onSurfaceVariant }]}>
        Location shared
        {tracking.lastSentAt
          ? ` · last sent ${tracking.lastSentAt.toLocaleTimeString()}`
          : ""}
      </Text>
    </View>
  );
}

/**
 * The next step a driver can take comes from the server reference data
 * (GET /api/mobile/driver/ref), not a client-side chain.
 */
function initialsOf(user) {
  const first = user?.firstName ?? user?.first_name ?? "";
  const last = user?.lastName ?? user?.last_name ?? "";
  const initials = `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
  return initials || "?";
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(d) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
  skeletons: { gap: space.base },
  greetingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.xs,
  },
  greeting: { gap: space.xs },
  dateLine: {
    fontFamily: fonts.data,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  greetingTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  section: { gap: space.md },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  tripId: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.5,
  },
  plateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.xs,
  },
  timeBlock: { alignItems: "flex-start", gap: 2, marginLeft: "auto" },
  timeValue: {
    fontFamily: fonts.data,
    fontSize: 13,
    lineHeight: 18,
    fontVariant: ["tabular-nums"],
  },
  route: {
    flexDirection: "row",
    gap: space.md,
    paddingVertical: space.xs,
  },
  routeRail: {
    width: 12,
    alignItems: "center",
    paddingVertical: 2,
  },
  routeDot: { width: 9, height: 9, borderRadius: 5 },
  routeStem: {
    flex: 1,
    marginVertical: 3,
    borderLeftWidth: 1.5,
    borderStyle: "dashed",
  },
  routeText: { flex: 1, gap: 18, paddingVertical: 2 },
  routeStop: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },
  trackingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    marginTop: space.xs,
  },
  trackingText: {
    fontSize: 13,
    fontFamily: fonts.body,
    flex: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  buttonRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  errorText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 12,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    lineHeight: 24,
  },
  modalSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14,
  },
  modalInput: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(0, 0, 0, 0.05)",
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: "700",
  },
  modalConfirmBtn: {
    flex: 1.4,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#2563EB",
  },
  modalConfirmText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
