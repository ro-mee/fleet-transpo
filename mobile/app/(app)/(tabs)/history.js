import { moderateScale } from '../../../lib/scaling';
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl, ActivityIndicator,  } from 'react-native';
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET, statusColorForTone } from "../../../lib/theme";
import { api } from "../../../lib/api";
import { StatusPill } from "../../../components/ui";
import { AppAlert } from '../../../components/AppAlert';

const STATUS_ORDER = [
  "Pending",
  "Approved",
  "Assigned",
  "Vehicle Assigned",
  "Driver Assigned",
  "Dispatched",
  "Driver Accepted",
  "Trip Started",
  "En Route",
  "Arrived",
  "Completed",
  "Cancelled",
];

function statusColor(status, colors) {
  const tone =
    ["Completed"].includes(status) ? "success"
    : ["Cancelled"].includes(status) ? "danger"
    : ["Trip Started", "En Route", "Arrived", "Driver Accepted", "In Progress"].includes(status) ? "warning"
    : ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(status) ? "info"
    : "neutral";
  return statusColorForTone(colors, tone);
}

function TripItem({ trip, colors, onPress }) {
  const sc = statusColor(trip.trip_status, colors);
  const depTime = trip.departure_time
    ? new Date(trip.departure_time).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--";

  return (
    <Pressable
      onPress={() => onPress(trip)}
      style={({ pressed }) => [
        styles.tripItem,
        {
          backgroundColor: colors.surfaceContainerLowest,
          borderColor: colors.outlineVariant,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {/* Header row */}
      <View style={styles.tripItemHeader}>
        <View style={styles.tripItemIdRow}>
          <Text style={[styles.tripItemId, { color: colors.onSurfaceVariant }]}>
            TRIP #{trip.trip_id}
          </Text>
          <Text style={[styles.tripItemTime, { color: colors.onSurfaceVariant }]}>
            {depTime}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.statusBadgeText, { color: sc.fg }]}>{trip.trip_status}</Text>
        </View>
      </View>

      {/* Route */}
      <View style={styles.tripRouteRow}>
        <View style={styles.routeItem}>
          <Ionicons name="radio-button-on" size={14} color={colors.outline} />
          <Text style={[styles.routeText, { color: colors.onSurface }]} numberOfLines={1}>
            {trip.origin || "Origin"}
          </Text>
        </View>
        <View style={[styles.routeArrow, { backgroundColor: colors.outlineVariant }]} />
        <View style={styles.routeItem}>
          <Ionicons name="location" size={14} color={colors.primary} />
          <Text style={[styles.routeText, { color: colors.onSurface }]} numberOfLines={1}>
            {trip.destination || "Destination"}
          </Text>
        </View>
      </View>

      {/* Footer info */}
      {(trip.vehicle_plate || trip.passenger_name) ? (
        <View style={[styles.tripFooter, { borderTopColor: colors.surfaceContainerHigh }]}>
          {trip.vehicle_plate ? (
            <View style={styles.tripMeta}>
              <Ionicons name="car-outline" size={14} color={colors.onSurfaceVariant} />
              <Text style={[styles.tripMetaText, { color: colors.onSurfaceVariant }]}>
                {trip.vehicle_plate}
              </Text>
            </View>
          ) : null}
          {trip.passenger_name ? (
            <View style={styles.tripMeta}>
              <Ionicons name="person-outline" size={14} color={colors.onSurfaceVariant} />
              <Text style={[styles.tripMetaText, { color: colors.onSurfaceVariant }]}>
                {trip.passenger_name}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function TripsTab() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState("Active");

  const FILTERS = ["Active", "Completed", "All"];

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get("/api/mobile/driver/trips");
      setTrips(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Could not load trips.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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
    AppAlert.alert(
      `Trip #${trip.trip_id}`,
      `Status: ${trip.trip_status}\n\nFrom: ${trip.origin || "—"}\nTo: ${trip.destination || "—"}`,
      [{ text: "OK" }]
    );
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
      <View style={[styles.filterBar, { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map((f) => {
            const active = activeFilter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[
                  styles.filterTab,
                  {
                    backgroundColor: active ? colors.primaryContainer : "transparent",
                    borderColor: active ? colors.primary : colors.outlineVariant,
                  },
                ]}
              >
                <Text style={[styles.filterText, { color: active ? colors.primary : colors.onSurfaceVariant }]}>
                  {f}
                </Text>
              </Pressable>
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
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.centered}>
            <Ionicons name="cloud-offline-outline" size={48} color={colors.outline} />
            <Text style={[styles.errorText, { color: colors.onSurface }]}>{error}</Text>
            <Pressable
              onPress={load}
              style={[styles.retryBtn, { borderColor: colors.primary }]}
            >
              <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
            </Pressable>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="route" size={48} color={colors.outline} />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No Trips</Text>
            <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
              {activeFilter === "Active" ? "No active trips right now." : "No completed trips yet."}
            </Text>
          </View>
        ) : (
          filtered.map((trip) => (
            <TripItem key={trip.trip_id} trip={trip} colors={colors} onPress={handleTripPress} />
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
  filterBar: { borderBottomWidth: 1 },
  filterScroll: { paddingHorizontal: moderateScale(16), paddingVertical: moderateScale(10), gap: moderateScale(8) },
  filterTab: { paddingHorizontal: moderateScale(16), paddingVertical: moderateScale(6), borderRadius: moderateScale(999), borderWidth: 1 },
  filterText: { fontSize: moderateScale(12), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(16) },
  scroll: { paddingHorizontal: moderateScale(16), paddingTop: moderateScale(16), gap: moderateScale(12) },
  centered: { padding: moderateScale(48), alignItems: "center", gap: moderateScale(12) },
  errorText: { fontSize: moderateScale(16), fontFamily: fonts.body, lineHeight: moderateScale(24), textAlign: "center" },
  retryBtn: { paddingHorizontal: moderateScale(24), paddingVertical: moderateScale(10), borderRadius: moderateScale(999), borderWidth: 1 },
  retryText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold },
  emptyTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  emptySub: { fontSize: moderateScale(14), fontFamily: fonts.body, lineHeight: moderateScale(20), textAlign: "center" },
  tripItem: {
    borderRadius: moderateScale(12),
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  tripItemHeader: { padding: moderateScale(16), gap: moderateScale(6) },
  tripItemIdRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  tripItemId: { fontSize: moderateScale(12), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(16), letterSpacing: 0.5, textTransform: "uppercase" },
  tripItemTime: { fontSize: moderateScale(12), fontFamily: fonts.body, lineHeight: moderateScale(16) },
  statusBadge: { alignSelf: "flex-start", paddingHorizontal: moderateScale(10), paddingVertical: moderateScale(3), borderRadius: moderateScale(999) },
  statusBadgeText: { fontSize: moderateScale(12), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(16) },
  tripRouteRow: { paddingHorizontal: moderateScale(16), paddingBottom: moderateScale(16), gap: moderateScale(6) },
  routeItem: { flexDirection: "row", alignItems: "center", gap: moderateScale(8) },
  routeArrow: { height: 1, marginLeft: moderateScale(22) },
  routeText: { flex: 1, fontSize: moderateScale(16), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(24) },
  tripFooter: {
    flexDirection: "row",
    gap: moderateScale(16),
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(10),
    borderTopWidth: 1,
  },
  tripMeta: { flexDirection: "row", alignItems: "center", gap: moderateScale(4) },
  tripMetaText: { fontSize: moderateScale(12), fontFamily: fonts.body, lineHeight: moderateScale(16) },
});
