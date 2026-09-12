import { moderateScale } from '../../../lib/scaling';
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts } from "../../../lib/theme";
import { api, isTransportFailure } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { CACHE_KEYS, getCached, setCached, resolveDriverId } from "../../../lib/offline-cache";
import { offlineViewState } from "../../../lib/offline-ux";
import { SyncNote, NeverSyncedCard, SavedChip } from "../../../components/OfflineStates";
import { useConnectivity } from "../../../lib/connectivity-context";
import { SkeletonCard } from "../../../components/ui";
import { ClayCard, ClayBadge, ClayTile, ClayButton } from '../../../components/clay';

function getStatusTone(status) {
  if (["Completed"].includes(status)) return "success";
  if (["Cancelled"].includes(status)) return "danger";
  if (["Trip Started", "En Route", "Arrived", "Driver Accepted", "In Progress"].includes(status)) return "warning";
  if (["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(status)) return "info";
  return "neutral";
}

function TripItem({ trip, onPress }) {
  const { colors, type } = useTheme();
  const tone = getStatusTone(trip.trip_status);
  const depTime = trip.departure_time
    ? new Date(trip.departure_time).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--";

  return (
    <ClayCard
      onPress={() => onPress(trip)}
      variant="standard"
      accessibilityLabel={`Trip #${trip.trip_id}: ${trip.origin || "Origin"} to ${trip.destination || "Destination"}, status ${trip.trip_status}`}
      style={styles.cardSpacing}
    >
      {/* Header row */}
      <View style={styles.tripItemHeader}>
        <View style={styles.tripItemIdRow}>
          <Text style={[styles.tripItemId, { color: colors.primary }]}>
            TRIP #{trip.trip_id}
          </Text>
          <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
            {depTime}
          </Text>
        </View>
        <ClayBadge label={trip.trip_status} tone={tone} statusDot size="sm" />
      </View>

      {/* Route */}
      <View style={styles.tripRouteRow}>
        <View style={styles.routeItem}>
          <Ionicons name="radio-button-on" size={16} color={colors.primary} />
          <Text style={[type.bodyMd, styles.routeText, { color: colors.onSurface }]} numberOfLines={1}>
            {trip.origin || "Origin"}
          </Text>
        </View>
        <View style={[styles.routeArrow, { backgroundColor: colors.outlineVariant + '60' }]} />
        <View style={styles.routeItem}>
          <Ionicons name="location" size={16} color={colors.primary} />
          <Text style={[type.bodyMd, styles.routeText, { color: colors.onSurface }]} numberOfLines={1}>
            {trip.destination || "Destination"}
          </Text>
        </View>
      </View>

      {/* Footer info */}
      {(trip.vehicle_plate || trip.passenger_name) ? (
        <View style={[styles.tripFooter, { borderTopColor: colors.outlineVariant + '40' }]}>
          {trip.vehicle_plate ? (
            <View style={styles.tripMeta}>
              <Ionicons name="car-outline" size={15} color={colors.onSurfaceVariant} />
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                {trip.vehicle_plate}
              </Text>
            </View>
          ) : null}
          {trip.passenger_name ? (
            <View style={styles.tripMeta}>
              <Ionicons name="person-outline" size={15} color={colors.onSurfaceVariant} />
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                {trip.passenger_name}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </ClayCard>
  );
}


export default function TripsTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState("Active");
  // Offline Read Mode: shares the TRIPS_ALL cache with the Trips tab.
  const [lastSynced, setLastSynced] = useState(null);
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  // Unstable counts as online (the amber banner speaks for it) — only a fully
  // offline verdict switches the list to saved data.
  const { status } = useConnectivity();
  const offline = status === "offline";
  // 4-state decider keys off the SOURCE count — a filter yielding zero is a
  // separate concern handled in the empty branch below.
  const view = offlineViewState({ offline, syncedAt: lastSynced, itemCount: trips.length });

  const FILTERS = ["Active", "Completed", "All"];

  const load = useCallback(async () => {
    try {
      setError(null);
      // Cache first: show last-known trips instantly (offline included).
      if (driverId) {
        const cached = await getCached(driverId, CACHE_KEYS.TRIPS_ALL);
        if (cached) {
          setTrips(Array.isArray(cached.data) ? cached.data : []);
          setLastSynced(cached.syncedAt);
          setLoading(false);
        }
      }
      const data = await api.get("/api/mobile/driver/trips?status=all");
      const list = Array.isArray(data) ? data : [];
      setTrips(list);
      // Display-only: refresh the cache, never treat it as authority.
      if (driverId) await setCached(driverId, CACHE_KEYS.TRIPS_ALL, list);
      setLastSynced(Date.now());
    } catch (e) {
      // Transport failures belong to the global banner; offline with cache
      // keeps showing it, and the badge states its age.
      if (!isTransportFailure(e)) setError(e.message || "Could not load trips.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [driverId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = trips.filter((t) => {
    if (activeFilter === "Active") {
      return !["Completed", "Cancelled"].includes(t.trip_status);
    }
    if (activeFilter === "Completed") {
      return t.trip_status === "Completed";
    }
    return true;
  });

  const handleTripPress = (trip) => {
    router.push(`/trip/${trip.trip_id}`);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top Bar */}
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
        <Text style={[styles.topBarTitle, { color: colors.primary }]}>FleetOps</Text>
        <View>
          <Text style={[styles.pageTitle, { color: colors.onSurface }]}>My Trips</Text>
          <Text style={[styles.pageSub, { color: colors.onSurfaceVariant }]}>
            {trips.length} trip{trips.length !== 1 ? "s" : ""} assigned
          </Text>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={[styles.filterBar, { backgroundColor: colors.background }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map((f) => {
            const active = activeFilter === f;
            return (
              <ClayBadge
                key={f}
                label={f}
                active={active}
                tone={active ? "primary" : "neutral"}
                onPress={() => setActiveFilter(f)}
                accessibilityRole="button"
                accessibilityLabel={`Filter trips: ${f}`}
                style={styles.filterTab}
              />
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {view.showSyncNote && trips.length > 0 ? (
          // One note above the whole list — the badge states its age.
          <SyncNote syncedAt={lastSynced} label="trips" />
        ) : null}
        {loading ? (
          <>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={2} />
          </>
        ) : error ? (
          <View style={styles.centered}>
            <ClayTile icon="cloud-offline-outline" size="lg" color={colors.error} />
            <Text style={[styles.errorText, { color: colors.onSurface }]}>{error}</Text>
            <ClayButton label="Retry" onPress={load} variant="outline" size="sm" />
          </View>
        ) : filtered.length === 0 ? (
          view.state === "never-synced" ? (
            <NeverSyncedCard body="Connect once while online to save your trips for offline viewing." />
          ) : trips.length > 0 ? (
            // Filter artifact: the cache HAS trips — this empty is the filter's,
            // not the source's. Unchanged behavior, now explicit.
            <View style={styles.centered}>
              <ClayTile icon="trail-sign-outline" size="lg" />
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No Trips</Text>
              <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
                {activeFilter === "Active" ? "No active trips right now." : "No completed trips yet."}
              </Text>
            </View>
          ) : (
            <View style={styles.centered}>
              <ClayTile icon="trail-sign-outline" size="lg" />
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No Trips</Text>
              <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
                {view.state === "empty-confirmed"
                  ? // Offline confirmed-empty is a snapshot — "when last synced".
                    (offline ? "No trips were assigned when last synced." : "No trips yet.")
                  : "Trips couldn't be confirmed right now. Pull to refresh or try again."}
              </Text>
              {view.state === "empty-confirmed" && offline ? <SavedChip syncedAt={lastSynced} /> : null}
            </View>
          )
        ) : (
          filtered.map((trip) => (
            <TripItem key={trip.trip_id} trip={trip} onPress={handleTripPress} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(12),
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    gap: moderateScale(2),
  },
  topBarTitle: { fontSize: moderateScale(24), fontFamily: fonts.displayBold, lineHeight: moderateScale(32) },
  pageTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  pageSub: { fontSize: moderateScale(12), fontFamily: fonts.body, lineHeight: moderateScale(16) },
  filterBar: { },
  filterScroll: { paddingHorizontal: moderateScale(16), paddingVertical: moderateScale(10), gap: moderateScale(8) },
  filterTab: {
    minHeight: moderateScale(36),
  },
  scroll: { paddingHorizontal: moderateScale(16), paddingTop: moderateScale(16), gap: moderateScale(12) },
  cardSpacing: { marginBottom: moderateScale(4) },
  centered: { padding: moderateScale(48), alignItems: "center", gap: moderateScale(12) },
  errorText: { fontSize: moderateScale(16), fontFamily: fonts.body, lineHeight: moderateScale(24), textAlign: "center" },
  emptyTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  emptySub: { fontSize: moderateScale(14), fontFamily: fonts.body, lineHeight: moderateScale(20), textAlign: "center" },
  tripItemHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: moderateScale(8) },
  tripItemIdRow: { gap: moderateScale(2) },
  tripItemId: { fontSize: moderateScale(12), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(16), letterSpacing: 0.5, textTransform: "uppercase" },
  tripRouteRow: { gap: moderateScale(8) },
  routeItem: { flexDirection: "row", alignItems: "center", gap: moderateScale(8) },
  routeArrow: { height: 1, marginLeft: moderateScale(22) },
  routeText: { flex: 1, fontSize: moderateScale(15), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(22) },
  tripFooter: {
    flexDirection: "row",
    gap: moderateScale(16),
    paddingTop: moderateScale(10),
    borderTopWidth: 1,
  },
  tripMeta: { flexDirection: "row", alignItems: "center", gap: moderateScale(5) },
});

