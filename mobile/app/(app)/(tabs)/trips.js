import { moderateScale } from '../../../lib/scaling';
import { useCallback, useState } from "react";
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
import { fonts } from "../../../lib/theme";
import { api } from "../../../lib/api";

function statusColor(status, colors) {
  const active = ["Trip Started", "En Route", "Arrived", "Driver Accepted", "In Progress", "READY", "Active", "Assigned"];
  if (active.includes(status)) return { bg: colors.secondary, fg: colors.onSecondary, border: colors.secondary };
  return { bg: colors.surfaceContainerHighest, fg: colors.onSurface, border: "transparent" };
}

function TripItem({ trip, router, colors }) {
  const isReady = ["Assigned", "Pending", "Approved", "Vehicle Assigned", "Driver Assigned"].includes(trip.trip_status);
  const displayStatus = isReady ? "READY" : "SCHEDULED";
  const sc = statusColor(displayStatus, colors);

  const depTime = trip.departure_time
    ? new Date(trip.departure_time).toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "10:30 AM";

  return (
    <Pressable
      onPress={() => router.push(`/trip/${trip.trip_id}`)}
      style={({ pressed }) => [
        styles.tripCard,
        {
          borderColor: displayStatus === "READY" ? sc.border : colors.outlineVariant,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusBadgeText, { color: sc.fg }]}>
              {displayStatus === "READY" ? "● READY" : "SCHEDULED"}
            </Text>
          </View>
          <Text style={[styles.tripIdText, { color: colors.onSurface }]}>ID: TRP-{trip?.trip_id ? String(trip.trip_id).substring(0, 4) : "0000"}</Text>
        </View>
        <Text style={[styles.timeText, { color: colors.onSurface }]}>{depTime}</Text>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="location-outline" size={16} color={colors.onSurface} />
        <View style={styles.infoTextContainer}>
          <Text style={[styles.infoLabel, { color: colors.onSurface }]}>PICKUP</Text>
          <Text style={[styles.infoValue, { color: colors.onSurface }]}>{trip?.origin ? String(trip.origin) : "TBD"}</Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="person-outline" size={16} color={colors.onSurface} />
        <View style={styles.infoTextContainer}>
          <Text style={[styles.infoLabel, { color: colors.onSurface }]}>PASSENGER</Text>
          <Text style={[styles.infoValue, { color: colors.onSurface }]}>{trip?.passenger_name ? String(trip.passenger_name) : "TBD"}</Text>
        </View>
      </View>

      <Pressable
        onPress={() => router.push(`/trip/${trip.trip_id}`)}
        style={[
          styles.actionBtn,
          { backgroundColor: displayStatus === "READY" ? colors.secondaryContainer : colors.surfaceContainerHigh },
        ]}
      >
        <Text
          style={[
            styles.actionBtnText,
            { color: displayStatus === "READY" ? colors.onSecondaryContainer : colors.onSurface },
          ]}
        >
          VIEW DETAILS
        </Text>
        <Ionicons
          name="arrow-forward"
          size={16}
          color={displayStatus === "READY" ? colors.onSecondaryContainer : colors.onSurface}
        />
      </Pressable>
    </Pressable>
  );
}

export default function TripsTab() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const router = useRouter();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

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

  const activeTrips = trips.filter(t => !["Completed", "Cancelled"].includes(t.trip_status));

  const today = new Date();
  const dateStr = today.toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });

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
            <Text style={[styles.progressLabel, { color: colors.onSurface }]}>TODAY'S PROGRESS</Text>
            <Text style={[styles.progressValue, { color: colors.onSurface }]}>{activeTrips.length ? String(activeTrips.length) : "0"} Trips Remaining</Text>
          </View>
          <View style={styles.progressBoxRight}>
            <Text style={[styles.progressLabel, { color: colors.onSurface }]}>TOTAL DISTANCE</Text>
            <Text style={[styles.progressValueGreen, { color: colors.secondary }]}>24.5 mi</Text>
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
        ) : activeTrips.length === 0 ? (
          <View style={{ alignItems: "center", marginTop: 60 }}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.onSurface} />
            <Text style={{ color: colors.onSurface, marginTop: 16 }}>No active trips for today.</Text>
          </View>
        ) : (
          <View>
            {activeTrips.map((trip) => (
              <TripItem key={trip.trip_id} trip={trip} router={router} colors={colors} />
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
    padding: 20,
    borderWidth: 1,
  },
  progressBox: { gap: 4 },
  progressBoxRight: { gap: 4, alignItems: "flex-end" },
  progressLabel: { fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 1, textTransform: "uppercase" },
  progressValue: { fontSize: 18, fontFamily: fonts.bodyMedium },
  progressValueGreen: { fontSize: 18, fontFamily: fonts.bodyMedium },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.bodyMedium },
  mapLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  mapLinkText: { fontSize: 12, fontFamily: fonts.body },
  tripCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 16,
    marginBottom: 8,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 0.5 },
  tripIdText: { fontSize: 12, fontFamily: fonts.data },
  timeText: { fontSize: 16, fontFamily: fonts.bodyMedium },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  infoTextContainer: { flex: 1, gap: 2 },
  infoLabel: { fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 0.5 },
  infoValue: { fontSize: 14, fontFamily: fonts.body },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
    marginTop: 4,
  },
  actionBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold },
});
