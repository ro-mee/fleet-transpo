import { useCallback, useState, useEffect, useMemo, memo } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { api, isTransportFailure } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { CACHE_KEYS, getCached, setCached, resolveDriverId } from "../../../lib/offline-cache";
import { offlineViewState } from "../../../lib/offline-ux";
import { SyncNote, NeverSyncedCard, SavedChip } from "../../../components/OfflineStates";
import { useConnectivity } from "../../../lib/connectivity-context";
import { shouldAutoRetry, LIST_AUTO_RETRY_MS } from "../../../lib/connectivity-state";
import { groupTrips, bucketTone, OPEN_BUCKETS } from "../../../lib/trips-queue";
import RouteTimeline from "../../../components/RouteTimeline";
import RadarPulse from "../../../components/RadarPulse";
import { ClayCard, ClayBadge, ClayButton } from "../../../components/clay";

function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const TripCard = memo(function TripCard({ trip, display, router, colors, type }) {
  const when = formatWhen(trip.departure_time);
  const isOverdue = display === "OVERDUE · ACTION REQUIRED";
  const tone = trip.trip_status === 'Completed' ? 'primary' : bucketTone(display);
  const stops = useMemo(() => [
    { label: "Pickup", value: trip?.origin ? String(trip.origin) : null },
    { label: "Drop-off", value: trip?.destination ? String(trip.destination) : null },
  ], [trip?.origin, trip?.destination]);

  return (
    <ClayCard
      onPress={() => router.push(`/trip/${trip.trip_id}`)}
      variant="standard"
      accessibilityLabel={`Trip ${trip.trip_id}: ${display}. Pickup ${trip?.origin || "not provided"}, destination ${trip?.destination || "not provided"}. View details.`}
      style={styles.cardSpacing}
    >
      <View style={[styles.cardHeader, { flexWrap: "wrap", gap: 8 }]}>
        <ClayBadge label={display} tone={tone} statusDot />
        <Text style={[type.labelLg, { color: colors.onSurfaceVariant }]}>
          {when || "Departure time not set"}
        </Text>
      </View>

      <RouteTimeline
        accent={isOverdue ? colors.danger : colors.primary}
        stops={stops}
      />

      <View style={[styles.metaRow, { borderTopColor: colors.outlineVariant + "40" }]}>
        <View style={styles.metaLeft}>
          <Ionicons name="person-outline" size={16} color={colors.onSurfaceVariant} />
          <Text style={[type.supporting, { color: colors.onSurface, flexShrink: 1 }]}>
            {trip?.passenger_name ? String(trip.passenger_name) : trip?.passenger_count != null ? "Passengers" : "Passenger not listed"}
          </Text>
          {Number(trip?.passenger_count) > 1 ? (
            <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>· {trip.passenger_count} pax</Text>
          ) : null}
        </View>
        {trip?.vehicle_plate ? (
          <View style={[styles.plateChip, { backgroundColor: colors.surfaceContainerHigh }]}>
            <Ionicons name="car-outline" size={13} color={colors.onSurfaceVariant} />
            <Text style={[type.caption, { color: colors.onSurface }]}>{trip.vehicle_plate}</Text>
          </View>
        ) : null}
      </View>

      <ClayButton
        label="Details"
        onPress={() => router.push(`/trip/${trip.trip_id}`)}
        icon="chevron-forward"
        iconPosition="right"
        size="sm"
        style={styles.detailsBtn}
      />
    </ClayCard>
  );
});


// Frozen at module load; the 30s interval below keeps it current without render-time reads.
const NOW_AT_LOAD = Date.now();

export default function TripsTab() {
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();
  const router = useRouter();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(NOW_AT_LOAD);
  // Offline Read Mode: last time this list was confirmed by the server.
  const [lastSynced, setLastSynced] = useState(null);
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  // Unstable counts as online (the amber banner speaks for it) — only a fully
  // offline verdict switches the list to saved data.
  const { status } = useConnectivity();
  const offline = status === "offline";
  // 4-state decider: itemCount is the SOURCE count (never filtered — this
  // screen has no filters, but the rule is uniform).
  const view = offlineViewState({ offline, syncedAt: lastSynced, itemCount: trips.length });

  // Live clock: re-evaluate the queue every 30s so READY/OVERDUE flip live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    // Offline Read Mode: show last-known trips instantly (offline included),
    // then revalidate against the server below.
    if (driverId) {
      const cached = await getCached(driverId, CACHE_KEYS.TRIPS_ALL);
      if (cached) {
        setTrips(Array.isArray(cached.data) ? cached.data : []);
        setLastSynced(cached.syncedAt);
        setLoading(false);
      }
    }
    // Same cold-start tolerance as Home: one automatic retry for transient
    // failures before surfacing anything to the driver.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        setError(null);
        const data = await api.get("/api/mobile/driver/trips?status=all");
        const list = Array.isArray(data) ? data : [];
        setTrips(list);
        // Display-only: refresh the cache, never treat it as authority.
        if (driverId) await setCached(driverId, CACHE_KEYS.TRIPS_ALL, list);
        setLastSynced(Date.now());
        return;
      } catch (e) {
        if (attempt === 0 && shouldAutoRetry(e)) {
          await new Promise((r) => setTimeout(r, LIST_AUTO_RETRY_MS));
          continue;
        }
        // Same PR #3.1 dedup as Home: the banner owns transport failures.
        // Offline with cache → keep showing it; the badge states its age.
        if (!isTransportFailure(e)) setError(e.message || "Could not load trips.");
        return;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [driverId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Build the queue (bucketing lives in lib/trips-queue.js — vitest-covered).
  const sections = groupTrips(trips, now);

  // Open assignments = every non-terminal bucket present. Honest count: the
  // list may span multiple dates, so this is "from your loaded assignments",
  // never a "today" claim. The server caps the response (limit 50 default),
  // so a full page means the true count may be higher.
  const openCount = sections
    .filter((s) => OPEN_BUCKETS.includes(s.bucket))
    .reduce((n, s) => n + s.items.length, 0);
  const capped = trips.length >= 50;
  const dateStr = new Date(now).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 96 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
      >
        <ClayCard variant="hero" style={styles.summary}>
          <View style={styles.summaryText}>
            <Text style={type.titleLg}>Trips</Text>
            <Text style={[type.supporting, { marginTop: 2 }]}>{dateStr}</Text>
          </View>
          <View style={[styles.summaryCount, { borderTopColor: colors.outlineVariant + "40" }]}>
            <Text style={[type.headlineMd, { color: colors.primary }]}>{openCount}{capped ? "+" : ""}</Text>
            <Text style={[type.caption, { flexShrink: 1 }]}>open assignment{openCount === 1 ? "" : "s"} from your loaded trips — these may span multiple dates</Text>
          </View>
        </ClayCard>

        {view.showSyncNote && trips.length > 0 ? (
          // One note for the whole queue, not per bucket.
          <SyncNote syncedAt={lastSynced} label="trips" />
        ) : null}

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : error ? (
          <ClayCard variant="standard" style={styles.emptyCard}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.onSurfaceVariant} />
            <Text style={[type.cardTitle, { textAlign: "center" }]}>Couldn’t load trips</Text>
            <Text style={[type.supporting, { textAlign: "center" }]}>{error}</Text>
          </ClayCard>
        ) : sections.length === 0 ? (
          view.state === "never-synced" ? (
            <NeverSyncedCard body="Connect once while online to save your trips for offline viewing." />
          ) : (
            <ClayCard variant="standard" style={styles.emptyCard}>
              {view.state === "empty-confirmed" && !offline ? (
                <RadarPulse size={38} color={colors.primary} icon="radio-outline" />
              ) : (
                <Ionicons
                  name={view.state === "empty-unconfirmed" ? "alert-circle-outline" : "checkmark-circle-outline"}
                  size={40}
                  color={colors.onSurfaceVariant}
                />
              )}
              <View style={{ alignItems: "center", gap: 4, paddingHorizontal: 20 }}>
                <Text style={[type.cardTitle, { textAlign: "center" }]}>
                  {view.state === "empty-confirmed"
                    ? (offline ? "No trips were assigned when last synced." : "No trips assigned right now")
                    : "Trips couldn’t be confirmed right now"}
                </Text>
                <Text style={[type.supporting, { textAlign: "center", maxWidth: 280 }]}>
                  {view.state === "empty-confirmed"
                    ? (offline ? "Your offline queue is clear." : "Your vehicle is active on standby. New dispatch assignments will appear here automatically.")
                    : "Pull to refresh or try again."}
                </Text>
              </View>
              {view.state === "empty-confirmed" && offline ? <SavedChip syncedAt={lastSynced} /> : null}
            </ClayCard>
          )
        ) : (
          <View>
            {sections.map((section) => (
              <View key={section.bucket}>
                <Text style={[type.sectionTitle, { color: colors.onSurfaceVariant, textTransform: "uppercase", marginTop: 2, marginBottom: 8 }]}>{section.label}</Text>
                {section.items.map((trip) => (
                  <TripCard key={trip.trip_id} trip={trip} display={section.label} router={router} colors={colors} type={type} />
                ))}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  summary: { padding: 14, gap: 10 },
  summaryText: { flexShrink: 1, gap: 2 },
  summaryCount: { borderTopWidth: 1, paddingTop: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  emptyCard: { padding: 20, gap: 12, marginTop: 24, alignItems: "center" },
  cardSpacing: { marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, borderTopWidth: 1, paddingTop: 8 },
  metaLeft: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  plateChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16 },
  detailsBtn: { marginTop: 4 },
});

