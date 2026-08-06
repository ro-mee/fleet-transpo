import { useCallback, useState } from "react";
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ACTIONS, canAction } from "../../lib/rbac";
import { useTripTracking } from "../../lib/tracking";
import {
  colors,
  fonts,
  space,
  tripStatusTone,
  type,
} from "../../lib/theme";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  ScreenTitle,
  StatusPill,
  styles as ui,
} from "../../components/ui";
import { BrandBar } from "../../components/logo";
import { Plate } from "../../components/plate";

const ACTIVE_STATUSES = [
  "Driver Accepted",
  "Trip Started",
  "En Route",
  "Arrived",
  "In Progress",
];

/**
 * Driver home. Answers three things at a glance: am I on a trip, what is
 * assigned next, and what do I do about it.
 *
 * The layout inherits the web dispatch floor: a brand bar, an eyebrowed page
 * title, then the one active trip as a paper slip with the vehicle rendered as
 * a physical plate.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [actingOn, setActingOn] = useState(null);

  const activeTrip = trips.find((t) => ACTIVE_STATUSES.includes(t.trip_status));
  const pendingTrips = trips.filter(
    (t) => !ACTIVE_STATUSES.includes(t.trip_status)
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
      const data = await api.get("/api/mobile/driver/trips");
      setTrips(Array.isArray(data) ? data : []);
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
    async (trip, status) => {
      setActingOn(trip.trip_id);
      try {
        await api.put(`/api/trips/${trip.trip_id}/status`, { status });
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
   * location sharing, so it is confirmed. The intermediate steps are cheap to
   * correct and go through without a prompt.
   */
  const advance = useCallback(
    (trip, next) => {
      if (next.status !== "Completed") {
        updateStatus(trip, next.status);
        return;
      }
      Alert.alert(
        "Complete this trip?",
        "This closes the trip and stops sharing your location. Report any fuel before completing.",
        [
          { text: "Not yet", style: "cancel" },
          {
            text: "Complete trip",
            onPress: () => updateStatus(trip, next.status),
          },
        ]
      );
    },
    [updateStatus]
  );

  const driverName = user?.firstName ?? user?.first_name ?? "";
  const eyebrow = `Driver · ${driverName}`;

  return (
    <View style={styles.flex}>
      <BrandBar right={<Avatar initials={initialsOf(user)} />} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <ScreenTitle eyebrow={eyebrow} title="Today's work" />

        <ErrorNotice message={error} onRetry={onRefresh} />

        {loading ? (
          <Text style={ui.bodyText}>Loading your trips…</Text>
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
              <Text style={styles.sectionTitle}>
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

            {/* Fuel is reported against the active trip's vehicle, so the action
                is only offered when there is one — and only to a session that
                holds the report_fuel action. */}
            {activeTrip && canReportFuel ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Fuel</Text>
                <Card>
                  <Text style={ui.bodyText}>
                    Report a fuel purchase for{" "}
                    {activeTrip.plate_number ?? "your current vehicle"}.
                  </Text>
                  <Button
                    label="Add fuel report"
                    variant="secondary"
                    onPress={() => router.push("/fuel-report")}
                  />
                </Card>
              </View>
            ) : null}

            <Button label="Sign out" variant="secondary" onPress={signOut} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ActiveTripCard({ trip, tracking, busy, canManage, onAdvance }) {
  const nextStatus = getNextStatus(trip.trip_status);

  return (
    <Card>
      <View style={ui.rowBetween}>
        <Text style={ui.eyebrow}>Active trip</Text>
        <StatusPill label={trip.trip_status} tone={tripStatusTone(trip.trip_status)} />
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
          style={{ marginTop: space.sm }}
        />
      ) : null}
    </Card>
  );
}

function PendingTripCard({ trip, busy, canManage, onAccept, onDecline }) {
  return (
    <Card>
      <View style={ui.rowBetween}>
        <Text style={styles.tripId}>#{trip.trip_id}</Text>
        <StatusPill label={trip.trip_status} tone={tripStatusTone(trip.trip_status)} />
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
            variant="secondary"
            onPress={onDecline}
            disabled={busy}
            style={styles.flex}
          />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * A trip has an inherent direction, so the stops are joined by a dashed rail —
 * a signal marking on paper, like a dispatch board.
 */
function RouteLine({ origin, destination }) {
  return (
    <View style={styles.route}>
      <View style={styles.routeRail}>
        <View style={[styles.routeDot, styles.routeDotStart]} />
        <View style={styles.routeStem} />
        <View style={[styles.routeDot, styles.routeDotEnd]} />
      </View>
      <View style={styles.routeText}>
        <Text style={styles.routeStop} numberOfLines={2}>
          {origin}
        </Text>
        <Text style={styles.routeStop} numberOfLines={2}>
          {destination}
        </Text>
      </View>
    </View>
  );
}

function ScheduledBlock({ time }) {
  if (!time) return null;
  return (
    <View style={styles.timeBlock}>
      <Text style={ui.eyebrow}>Scheduled</Text>
      <Text style={styles.timeValue}>{formatTime(time)}</Text>
    </View>
  );
}

/**
 * Live-location state, shown only when something is worth reporting. Labels name
 * the state in text, not by colour alone.
 */
function TrackingRow({ tracking }) {
  if (tracking.error) {
    return (
      <View style={styles.trackingRow}>
        <View style={[styles.statusDot, { backgroundColor: colors.warning }]} />
        <Text style={styles.trackingText}>{tracking.error}</Text>
      </View>
    );
  }
  if (!tracking.posting) return null;
  return (
    <View style={styles.trackingRow}>
      <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
      <Text style={styles.trackingText}>
        Location shared
        {tracking.lastSentAt
          ? ` · last sent ${tracking.lastSentAt.toLocaleTimeString()}`
          : ""}
      </Text>
    </View>
  );
}

/**
 * The next step a driver can take, labelled by outcome rather than by the raw
 * status value. Statuses come from DRIVER_ALLOWED_STATUSES in
 * src/app/api/trips/[id]/status/route.js.
 */
function getNextStatus(current) {
  const flow = {
    "Driver Accepted": { status: "Trip Started", label: "Start trip" },
    "Trip Started": { status: "En Route", label: "Mark en route" },
    "En Route": { status: "Arrived", label: "Mark arrived" },
    Arrived: { status: "Completed", label: "Complete trip" },
  };
  return flow[current] ?? null;
}

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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg },
  section: { gap: space.md },
  sectionTitle: { ...type.sectionTitle },
  tripId: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 0.5,
    color: colors.foreground,
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
    color: colors.foreground,
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
  routeDotStart: { backgroundColor: colors.primary },
  routeDotEnd: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  routeStem: {
    flex: 1,
    marginVertical: 3,
    borderLeftWidth: 1.5,
    borderLeftColor: colors.border,
    borderStyle: "dashed",
  },
  routeText: { flex: 1, gap: 18, paddingVertical: 2 },
  routeStop: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
    color: colors.foreground,
  },
  trackingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: space.xs,
  },
  trackingText: {
    color: colors.foregroundSecondary,
    fontSize: 13,
    fontFamily: fonts.body,
    flex: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  buttonRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  flex: { flex: 1 },
});
