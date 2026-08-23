import { moderateScale } from '../../../lib/scaling';
import { useCallback, useState, useEffect } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, statusColorForTone } from "../../../lib/theme";
import { api } from "../../../lib/api";

// The trips list is a time-aware QUEUE, not a plain time sort.
// Priority (highest → lowest):
//   1. in-progress   (Trip Started ... In Progress) — the active trip
//   2. overdue       (pre-start, past its start window) — action required
//   3. ready         (pre-start, start window reached) — can START now
//   4. upcoming      (pre-start, window not yet reached)
//   5. completed
//   6. cancelled
// Within each bucket, trips sort by departure time ascending.
const IN_PROGRESS = ["Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"];
const PRE_START = ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched", "Driver Accepted"];

function bucketOf(trip, now) {
  const status = trip.trip_status;
  if (IN_PROGRESS.includes(status)) return "inProgress";
  if (status === "Completed") return "completed";
  if (status === "Cancelled") return "cancelled";
  if (!PRE_START.includes(status)) return "upcoming";

  const earliest = trip.earliest_start ? new Date(trip.earliest_start).getTime() : null;
  // earliest_start unknown (no schedule / no ETA) → fail-open to "ready" so the
  // driver is never blocked by absent data; the server still enforces the gate.
  if (earliest == null) return "ready";
  return now >= earliest ? "ready" : "upcoming";
}

// A pre-start trip past its scheduled departure is OVERDUE (needs action now).
function isOverdue(trip, now) {
  if (!PRE_START.includes(trip.trip_status)) return false;
  const dep = trip.departure_time ? new Date(trip.departure_time).getTime() : null;
  return dep != null && now > dep;
}

const BUCKET_ORDER = ["inProgress", "overdue", "ready", "upcoming", "completed", "cancelled"];
const BUCKET_LABEL = {
  inProgress: "IN PROGRESS",
  overdue: "OVERDUE · ACTION REQUIRED",
  ready: "READY",
  upcoming: "UPCOMING",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

function badgeColors(display, colors) {
  const toneMap = {
    "IN PROGRESS": "info",
    "OVERDUE · ACTION REQUIRED": "danger",
    "READY": "success",
    "UPCOMING": "warning",
    "COMPLETED": "success",
    "CANCELLED": "neutral",
  };
  return statusColorForTone(colors, toneMap[display] || "neutral");
}

function TripItem({ trip, display, now, router, colors }) {
  const bc = badgeColors(display, colors);
  const isReady = display === "READY";
  const isOverdue = display === "OVERDUE · ACTION REQUIRED";

  const depTime = trip.departure_time
    ? new Date(trip.departure_time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";

  return (
    <Pressable
      onPress={() => router.push(`/trip/${trip.trip_id}`)}
      style={({ pressed }) => [
        styles.tripCardShell,
        {
          borderColor: isReady || isOverdue ? bc.dot + '50' : colors.outlineVariant + '35',
          backgroundColor: isReady ? colors.secondaryContainer + '20' : colors.surfaceContainerLow,
          transform: [{ scale: pressed ? 0.98 : 1 }],
          opacity: pressed ? 0.92 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Trip ${trip.trip_id}: ${display}. Pickup ${trip?.origin || "TBD"}, destination ${trip?.destination || "TBD"}`}
    >
      <View style={[styles.tripCardInner, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant + '30' }]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.statusBadge, { backgroundColor: bc.bg }]}>
              <View style={[styles.badgeDot, { backgroundColor: bc.dot }]} />
              <Text style={[styles.statusBadgeText, { color: bc.fg }]}>{display}</Text>
            </View>
            <Text style={[styles.tripIdText, { color: colors.onSurfaceVariant }]}>TRP-{trip?.trip_id ? String(trip.trip_id).substring(0, 4) : "0000"}</Text>
          </View>
          <Text style={[styles.timeText, { color: colors.onSurface }]}>{depTime}</Text>
        </View>

        {/* Route Timeline */}
        <View style={styles.routeContainer}>
          <View style={styles.timelineCol}>
            <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
            <View style={[styles.timelineLine, { backgroundColor: colors.outlineVariant + '50' }]} />
            <View style={[styles.timelineDotDest, { borderColor: colors.secondary, backgroundColor: colors.secondaryContainer }]} />
          </View>
          <View style={styles.routeTextCol}>
            <View style={styles.stopInfo}>
              <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>PICKUP</Text>
              <Text style={[styles.infoValue, { color: colors.onSurface }]} numberOfLines={1}>
                {trip?.origin ? String(trip.origin) : "Pickup TBD"}
              </Text>
            </View>
            <View style={styles.stopInfo}>
              <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>DESTINATION</Text>
              <Text style={[styles.infoValue, { color: colors.onSurface }]} numberOfLines={1}>
                {trip?.destination ? String(trip.destination) : "Destination TBD"}
              </Text>
            </View>
          </View>
        </View>

        {/* Passenger & Details Row */}
        <View style={[styles.metaRow, { borderTopColor: colors.outlineVariant + '30' }]}>
          <View style={styles.passengerChip}>
            <Ionicons name="person-outline" size={14} color={colors.onSurfaceVariant} />
            <Text style={[styles.passengerText, { color: colors.onSurface }]} numberOfLines={1}>
              {trip?.passenger_name ? String(trip.passenger_name) : "Guest"}
            </Text>
            {trip?.passenger_count > 1 && (
              <Text style={[styles.paxCount, { color: colors.outline }]}>• {trip.passenger_count} pax</Text>
            )}
          </View>

          {trip?.vehicle_plate ? (
            <View style={[styles.vehiclePlateChip, { backgroundColor: colors.surfaceContainerHighest }]}>
              <Ionicons name="car-outline" size={12} color={colors.onSurfaceVariant} />
              <Text style={[styles.vehiclePlateText, { color: colors.onSurface }]}>{trip.vehicle_plate}</Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={() => {
            if (isReady || isOverdue) {
              router.push('/map');
            } else {
              router.push(`/trip/${trip.trip_id}`);
            }
          }}
          style={({ pressed }) => [
            styles.actionBtn,
            {
              backgroundColor: isReady || isOverdue ? colors.primary : colors.surfaceContainerHigh,
              borderColor: isReady || isOverdue ? 'transparent' : colors.outlineVariant + '50',
              borderWidth: isReady || isOverdue ? 0 : 1,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              opacity: pressed ? 0.9 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isReady || isOverdue ? `Start trip ${trip.trip_id}` : `View details for trip ${trip.trip_id}`}
        >
          <Text
            style={[
              styles.actionBtnText,
              { color: isReady || isOverdue ? colors.onPrimary : colors.onSurface },
            ]}
          >
            {isReady || isOverdue ? "START TRIP" : "VIEW DETAILS"}
          </Text>
          <View style={[styles.btnIconCapsule, { backgroundColor: isReady || isOverdue ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)' }]}>
            <Ionicons
              name={isReady || isOverdue ? "car-outline" : "chevron-forward"}
              size={15}
              color={isReady || isOverdue ? colors.onPrimary : colors.onSurface}
            />
          </View>
        </Pressable>
      </View>
    </Pressable>
  );
}

// Frozen at module load; the 30s interval below keeps it current without render-time reads.
const NOW_AT_LOAD = Date.now();

export default function TripsTab() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(NOW_AT_LOAD);

  // Live clock: re-evaluate the queue every 30s so READY/OVERDUE flip live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get("/api/mobile/driver/trips?status=all");
      setTrips(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Could not load trips.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Build the queue. "overdue" only ever applies to pre-start trips past their
  // departure, so it overrides the ready/upcoming bucket it would otherwise fall in.
  const queues = BUCKET_ORDER.map((b) => []);
  for (const trip of trips) {
    let b = bucketOf(trip, now);
    if (b === "ready" && isOverdue(trip, now)) b = "overdue";
    if (b === "upcoming" && isOverdue(trip, now)) b = "overdue";
    queues[BUCKET_ORDER.indexOf(b)].push(trip);
  }
  const depSort = (a, b) =>
    (a.departure_time ? new Date(a.departure_time).getTime() : 0) -
    (b.departure_time ? new Date(b.departure_time).getTime() : 0);
  queues.forEach((q) => q.sort(depSort));

  const remaining = queues[0].length + queues[1].length + queues[2].length + queues[3].length;
  const currentTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = new Date(now).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const sections = BUCKET_ORDER
    .map((bucket, i) => ({ bucket, label: BUCKET_LABEL[bucket], items: queues[i] }))
    .filter((s) => s.items.length > 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
      >
        <View style={[styles.progressCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <View style={styles.progressBox}>
            <Text style={[styles.progressLabel, { color: colors.onSurface }]}>CURRENT TIME</Text>
            <Text style={[styles.progressValue, { color: colors.primary }]}>{currentTime}</Text>
          </View>
          <View style={styles.progressBoxRight}>
            <Text style={[styles.progressLabel, { color: colors.onSurface }]}>TODAY&apos;S PROGRESS</Text>
            <Text style={[styles.progressValueGreen, { color: colors.secondary }]}>{String(remaining)} Trips Remaining</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{dateStr}</Text>
          <Pressable onPress={() => router.push('/map')} style={styles.mapLink}>
            <Text style={[styles.mapLinkText, { color: colors.primary }]}>View Map</Text>
            <Ionicons name="map-outline" size={16} color={colors.primary} />
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={{ alignItems: "center", marginTop: 60 }}>
            <Ionicons name="alert-circle-outline" size={48} color={colors.onSurface} />
            <Text style={{ color: colors.onSurface, marginTop: 16, textAlign: "center" }}>{error}</Text>
          </View>
        ) : sections.length === 0 ? (
          <View style={{ alignItems: "center", marginTop: 60 }}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.onSurface} />
            <Text style={{ color: colors.onSurface, marginTop: 16 }}>No trips assigned right now.</Text>
          </View>
        ) : (
          <View>
            {sections.map((section) => (
              <View key={section.bucket}>
                <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>{section.label}</Text>
                {section.items.map((trip) => (
                  <TripItem key={trip.trip_id} trip={trip} display={section.label} now={now} router={router} colors={colors} />
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
  scroll: { paddingHorizontal: 16, gap: 16 },
  progressCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
  },
  progressBox: { gap: 4 },
  progressBoxRight: { gap: 4, alignItems: "flex-end" },
  progressLabel: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.8, textTransform: "uppercase" },
  progressValue: { fontSize: 20, fontFamily: fonts.displayBold || fonts.bodySemiBold, letterSpacing: -0.3 },
  progressValueGreen: { fontSize: 20, fontFamily: fonts.displayBold || fonts.bodySemiBold, letterSpacing: -0.3 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold, letterSpacing: -0.2 },
  sectionLabel: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.8, textTransform: "uppercase", marginTop: 14, marginBottom: 8 },
  mapLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8 },
  mapLinkText: { fontSize: 13, fontFamily: fonts.bodySemiBold },
  tripCardShell: {
    borderRadius: 20,
    padding: 3,
    borderWidth: 1,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  tripCardInner: {
    borderRadius: 17,
    padding: 15,
    borderWidth: 1,
    gap: 13,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { fontSize: 10, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.5 },
  tripIdText: { fontSize: 12, fontFamily: fonts.dataSemiBold || fonts.data },
  timeText: { fontSize: 17, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold, letterSpacing: -0.2 },
  
  routeContainer: { flexDirection: "row", gap: 12, paddingVertical: 2 },
  timelineCol: { alignItems: "center", width: 14, paddingTop: 4, paddingBottom: 4 },
  timelineDot: { width: 8, height: 8, borderRadius: 4 },
  timelineLine: { width: 1.5, flex: 1, marginVertical: 3 },
  timelineDotDest: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  routeTextCol: { flex: 1, gap: 12 },
  stopInfo: { gap: 1 },
  infoLabel: { fontSize: 10, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6 },
  infoValue: { fontSize: 14, fontFamily: fonts.bodyMedium },
  
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 10 },
  passengerChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  passengerText: { fontSize: 13, fontFamily: fonts.bodyMedium },
  paxCount: { fontSize: 12, fontFamily: fonts.body },
  vehiclePlateChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  vehiclePlateText: { fontSize: 11, fontFamily: fonts.dataSemiBold },
  
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 46,
    borderRadius: 13,
    gap: 10,
    marginTop: 2,
  },
  actionBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold, letterSpacing: 0.3 },
  btnIconCapsule: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
});
