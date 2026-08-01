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
import { useTripTracking } from "../../lib/tracking";
import { colors, space, tripStatusTone } from "../../lib/theme";
import {
  Button,
  Card,
  Detail,
  EmptyState,
  ErrorNotice,
  ScreenTitle,
  StatusPill,
  styles as ui,
} from "../../components/ui";

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

  // Location posting runs only while a trip is actually active.
  const tracking = useTripTracking(activeTrip?.trip_id ?? null);

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

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.base, paddingBottom: insets.bottom + space.xxl },
      ]}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {user?.isGuest ? (
        <View style={styles.guestBanner}>
          <Text style={styles.guestBannerTitle}>💡 Guest Preview Mode</Text>
          <Text style={styles.guestBannerText}>
            You are exploring the FleetOps driver app in demo mode. You can accept trips, update trip status, and file fuel reports in real-time.
          </Text>
        </View>
      ) : null}

      <View style={ui.rowBetween}>
        <ScreenTitle
          eyebrow={`Driver · ${user?.firstName ?? user?.first_name ?? "Guest"}${user?.isGuest ? " (Demo)" : ""}`}
          title="Today's work"
        />
      </View>

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
                  onAccept={() => respond(trip, true)}
                  onDecline={() => confirmDecline(trip)}
                />
              ))
            )}
          </View>

          {/* Fuel is reported against the active trip's vehicle, so the action
              is only offered when there is one. */}
          {activeTrip ? (
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
  );
}

function ActiveTripCard({ trip, tracking, busy, onAdvance }) {
  const nextStatus = getNextStatus(trip.trip_status);

  return (
    <Card>
      <View style={ui.rowBetween}>
        <Text style={ui.cardTitle}>Active trip</Text>
        <StatusPill label={trip.trip_status} tone={tripStatusTone(trip.trip_status)} />
      </View>
      <Detail label="Pickup" value={trip.origin} />
      <Detail label="Destination" value={trip.destination} />
      {trip.plate_number ? (
        <Detail label="Vehicle" value={trip.plate_number} mono />
      ) : null}
      {trip.start_time ? (
        <Detail
          label="Scheduled"
          value={new Date(trip.start_time).toLocaleString()}
        />
      ) : null}

      <TrackingRow tracking={tracking} />

      {nextStatus ? (
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

function PendingTripCard({ trip, busy, onAccept, onDecline }) {
  return (
    <Card>
      <View style={ui.rowBetween}>
        <Text style={ui.cardTitle}>#{trip.trip_id}</Text>
        <StatusPill label={trip.trip_status} tone={tripStatusTone(trip.trip_status)} />
      </View>
      <Detail label="Pickup" value={trip.origin} />
      <Detail label="Destination" value={trip.destination} />
      {trip.plate_number ? (
        <Detail label="Vehicle" value={trip.plate_number} mono />
      ) : null}
      {trip.start_time ? (
        <Detail
          label="Scheduled"
          value={new Date(trip.start_time).toLocaleString()}
        />
      ) : null}
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
    </Card>
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

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, gap: space.lg },
  section: { gap: space.md },
  sectionTitle: { color: colors.foreground, fontSize: 18, fontWeight: "600" },
  trackingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: space.xs,
  },
  trackingText: { color: colors.foregroundSecondary, fontSize: 13, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  buttonRow: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
  flex: { flex: 1 },
  guestBanner: {
    backgroundColor: "#EFF6FF",
    borderColor: "#93C5FD",
    borderWidth: 1,
    borderRadius: 8,
    padding: space.md,
    gap: space.xs,
  },
  guestBannerTitle: {
    color: "#1E40AF",
    fontSize: 14,
    fontWeight: "700",
  },
  guestBannerText: {
    color: "#1E3A8A",
    fontSize: 13,
    lineHeight: 18,
  },
});
