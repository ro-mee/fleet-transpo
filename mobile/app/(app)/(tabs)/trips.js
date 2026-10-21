import { useState, useMemo, memo } from "react";
import {
  SectionList,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { useAuth } from "../../../lib/auth";
import { useDriverProfile } from "../../../lib/driver-profile";
import { resolveDriverId } from "../../../lib/offline-cache";
import { offlineViewState } from "../../../lib/offline-ux";
import { SyncNote, NeverSyncedCard, SavedChip } from "../../../components/OfflineStates";
import { useConnectivity } from "../../../lib/connectivity-context";
import { bucketTone, PRE_START, preTripChipLabel } from "../../../lib/trips-queue";
import { isCargoLoad, loadTitle, loadSubtitle } from "../../../lib/load-presentation";
import { resolveDriverWorkspace } from "../../../lib/driver-workspace";
import { workspaceModeLabel, workspaceBlockReason } from "../../../lib/cargo-view-model";
import RouteTimeline from "../../../components/RouteTimeline";
import { ClayCard, ClayBadge, ClayButton } from "../../../components/clay";
import { TRIP_TABS, scheduleDay, scheduleSections, tripDisplay } from "../../../lib/trips-schedule";
import { useTripSchedule } from "../../../lib/use-trip-schedule";
import { useScreenClock } from "../../../lib/use-screen-clock";

function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
}

const TripCard = memo(function TripCard({ trip, driverType, display, router, colors, type }) {
  const workspace = resolveDriverWorkspace({ driverType, trip });
  const historical = ["Completed", "Cancelled"].includes(trip.trip_status);
  const blocked = workspace.tripReady === false;
  const cargo = historical || blocked ? isCargoLoad(trip) : workspace.mode === "cargo";
  const displayTrip = historical || blocked ? trip : { ...trip, load_type: driverType };
  const when = formatWhen(historical ? (trip.trip_status === "Cancelled" ? trip.updated_at : trip.end_time) || trip.departure_time || trip.start_time : trip.departure_time);
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
        {/* Pre-start trips only. A Completed row has no pre_trip_status and no
            chip; the chip is a label, not a gate — the card stays tappable and
            trip detail owns enforcement. */}
        {PRE_START.includes(trip.trip_status) ? (
          <Text style={[type.caption, { color: trip.pre_trip_status === "Failed" ? colors.danger : colors.onSurfaceVariant }]}>
            {preTripChipLabel(trip.pre_trip_status)}
          </Text>
        ) : null}
      </View>

      <Text style={[type.labelLg, { color: colors.onSurface }]}>{workspaceModeLabel(workspace)}</Text>
      {workspace.tripReady === false && !["Completed", "Cancelled"].includes(trip.trip_status) && <Text accessibilityRole="alert" style={[type.supporting, { color: colors.onSurfaceVariant, marginTop: 8 }]}>{workspaceBlockReason(workspace)}</Text>}
      <RouteTimeline
        accent={isOverdue ? colors.danger : colors.primary}
        stops={stops}
      />

      <View style={[styles.metaRow, { borderTopColor: colors.outlineVariant + "40" }]}>
        <View style={styles.metaLeft}>
          <Ionicons name="person-outline" size={16} color={colors.onSurfaceVariant} />
          <Text style={[type.supporting, { color: colors.onSurface, flexShrink: 1 }]}>
            {!historical && workspace.mode === "unclassified" && !blocked ? "Driver type needs setup" : cargo ? loadTitle(displayTrip) : trip?.passenger_name ? String(trip.passenger_name) : trip?.passenger_count != null ? "Passengers" : "Passenger not listed"}
          </Text>
          {(() => {
            const subtitle = cargo
              ? loadSubtitle(displayTrip)
              : Number(trip?.passenger_count) > 1 ? `${trip.passenger_count} pax` : null;
            return subtitle ? (
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{cargo ? subtitle : `· ${subtitle}`}</Text>
            ) : null;
          })()}
        </View>
        {trip?.vehicle_plate ? (
          <View style={[styles.plateChip, { backgroundColor: colors.surfaceContainerHigh }]}>
            <Ionicons name="car-outline" size={13} color={colors.onSurfaceVariant} />
            <Text style={[type.caption, { color: colors.onSurface }]}>{trip.vehicle_plate}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.detailsLink}>
        <Text style={[type.labelLg, { color: colors.primary }]}>View details</Text>
        <Ionicons name="arrow-forward" size={18} color={colors.primary} />
      </View>
    </ClayCard>
  );
});


export default function TripsTab() {
  const [tab, setTab] = useState("today");
  const { now } = useScreenClock();
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  const { profile } = useDriverProfile();
  const day = scheduleDay(now);
  return <TripsSchedule key={`${driverId}:${tab}:${day}`} {...{ tab, setTab, now, day, driverId, profile }} />;
}

function TripsSchedule({ tab, setTab, now, day, driverId, profile }) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stackTabs = width < 480 && fontScale > 1.25;
  const { colors, type } = useTheme();
  const router = useRouter();
  const { status } = useConnectivity();
  const offline = status === "offline";
  const { trips, loading, refreshing, loadingMore, error, lastSynced, confirmed, hasMore, refresh, loadMore } = useTripSchedule({ driverId, tab, day, offline });
  const sections = useMemo(() => scheduleSections(trips, tab, now).map(({ bucket, label, items }) => ({ key: bucket, label, data: items })), [trips, tab, now]);
  const count = sections.reduce((total, section) => total + section.data.length, 0);
  const selected = TRIP_TABS.find((item) => item.id === tab);
  const view = offlineViewState({ offline, syncedAt: confirmed ? lastSynced : null, itemCount: trips.length });
  const dateStr = new Date(now).toLocaleDateString("en-US", { timeZone: "Asia/Manila", weekday: "long", month: "long", day: "numeric" });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <SectionList
        sections={loading ? [] : sections}
        keyExtractor={(trip) => String(trip.trip_id)}
        renderItem={({ item }) => <TripCard trip={item} driverType={profile?.driverType} display={tab === "upcoming" ? "UPCOMING" : tripDisplay(item, now)} router={router} colors={colors} type={type} />}
        renderSectionHeader={({ section }) => <Text style={[type.labelLg, styles.sectionTitle, { color: colors.onSurfaceVariant }]}>{section.label}</Text>}
        stickySectionHeadersEnabled={false}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={5}
        // Keep clay shadows visible as rows leave the render window on Android.
        removeClippedSubviews={false}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 168 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
        ListHeaderComponent={<View style={[styles.listHeader, { paddingBottom: !loading && count > 0 ? 4 : 12 }]}>
        <ClayCard variant="hero" style={styles.pageHeader}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={type.titleLg}>Trips</Text>
              <Text style={type.supporting}>{dateStr}</Text>
            </View>
            <ClayButton label={null} icon="calendar-outline" variant="tonal" onPress={() => router.push("/work-schedule")} accessibilityLabel="View my work schedule" style={styles.calendarButton} />
          </View>
          <View accessibilityRole="tablist" style={[styles.segmented, stackTabs && { flexDirection: "column" }, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + "30" }]}>
            {TRIP_TABS.map((item) => {
              const active = tab === item.id;
              return (
                <Pressable key={item.id} accessibilityRole="tab" accessibilityLabel={`${item.label} trips`} accessibilityState={{ selected: active }} aria-selected={active} onPress={() => setTab(item.id)}
                  style={({ pressed }) => [styles.segment, active && { backgroundColor: colors.surface, borderColor: colors.primary }, pressed && { opacity: 0.75 }]}>
                  <Text style={[type.labelLg, styles.segmentLabel, { color: active ? colors.primary : colors.onSurfaceVariant }]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ClayCard>

        {lastSynced && (offline || !confirmed) && count > 0 ? <SyncNote syncedAt={lastSynced} label="trips" /> : null}
        {!confirmed && lastSynced && count > 0 ? <Text style={type.supporting}>Showing saved assignments. Refresh to confirm the full schedule for this date.</Text> : null}

        {error && !(offline && !lastSynced) ? (
          <ClayCard variant="compact" style={styles.errorCard}>
            <Text accessibilityRole="alert" style={type.cardTitle}>{count ? "Couldn’t update trips" : "Couldn’t load trips"}</Text>
            <Text style={type.supporting}>{error}</Text>
            <ClayButton label="Try again" variant="tonal" onPress={refresh} loading={refreshing} />
          </ClayCard>
        ) : null}

        {!loading && count > 0 ? (
              <View style={styles.listHeading}>
                <Text style={type.cardTitle}>{tab === "today" ? "Your day" : tab === "upcoming" ? "Coming up" : "Trip history"}</Text>
                <Text style={type.supporting}>{count}{hasMore ? "+" : ""} trip{count === 1 ? "" : "s"}{offline || !confirmed ? " saved" : ""}</Text>
              </View>
        ) : null}
        </View>}
        ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 32 }} />
          : !error || offline ? (
            view.state === "never-synced" || (!confirmed && offline) ? <NeverSyncedCard body="Connect while online to save this part of your trip schedule for offline viewing." /> : (
              <ClayCard variant="standard" style={styles.emptyCard}>
                <View style={[styles.statusIconWrap, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <Ionicons name={tab === "history" ? "time-outline" : "calendar-outline"} size={28} color={colors.primary} />
                </View>
                <Text style={[type.cardTitle, { textAlign: "center" }]}>{confirmed ? offline ? "No trips in this saved view" : selected.empty : "Trips couldn’t be confirmed"}</Text>
                <Text style={[type.supporting, { textAlign: "center", maxWidth: 280 }]}>{confirmed ? offline ? "This view was empty when last synced. Reconnect to check for updates." : selected.body : "Refresh to check your assignments."}</Text>
                {offline && confirmed ? <SavedChip syncedAt={lastSynced} /> : !confirmed ? <ClayButton label="Try again" variant="tonal" onPress={refresh} loading={refreshing} /> : null}
              </ClayCard>
            )
          ) : null}
        ListFooterComponent={!loading && hasMore ? (
          <View style={{ gap: 8, paddingTop: 12 }}>
            <ClayButton label={tab === "history" ? "Load older trips" : "Load more trips"} variant="tonal" onPress={loadMore} loading={loadingMore} disabled={offline || refreshing} />
            {offline ? <Text style={[type.supporting, { textAlign: "center" }]}>Reconnect to load more trips.</Text> : null}
          </View>
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16 },
  listHeader: { gap: 12 },
  pageHeader: { gap: 16, padding: 16 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  calendarButton: { width: 48, minHeight: 48, paddingHorizontal: 0 },
  segmented: { flexDirection: "row", padding: 4, borderRadius: 18, borderWidth: 1, gap: 4 },
  segment: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 10, paddingHorizontal: 2, borderRadius: 14, borderBottomWidth: 2, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  segmentLabel: { fontSize: 13, textAlign: "center", flexShrink: 1, maxWidth: "100%" },
  listHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 4, paddingVertical: 4 },
  sectionTitle: { marginTop: 8, marginBottom: 10, paddingHorizontal: 4 },
  errorCard: { gap: 12, padding: 16 },
  emptyCard: { minHeight: 240, padding: 24, gap: 16, alignItems: "center", justifyContent: "center" },
  cardSpacing: { marginBottom: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, borderTopWidth: 1, paddingTop: 8 },
  metaLeft: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  plateChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16 },
  detailsLink: { minHeight: 44, marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statusIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
