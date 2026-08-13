import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import TomTomMap from "../../../components/TomTomMap";
import { api } from "../../../lib/api";
import { fonts } from "../../../lib/theme";
import { useTheme } from "../../../lib/theme-context";

export default function TripDetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/api/mobile/driver/trips");
      const found = data.find((t) => String(t.trip_id) === String(id));
      setTrip(found || { trip_id: id, trip_status: "Scheduled" });
    } catch (e) {
      setTrip({ trip_id: id, trip_status: "Scheduled" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await api.put(`/api/trips/${id}/accept`, { accept: true }).catch(() => {});
      router.replace("/map");
    } catch (e) {
      Alert.alert("Error", "Could not accept trip.");
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const depTime = trip?.departure_time
    ? new Date(trip.departure_time).toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "10:00 AM";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.onSurface }]}>Trip Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <View>
            <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>STATUS</Text>
            <View style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: colors.secondary }]} />
              <Text style={[styles.statusText, { color: colors.onSurface }]}>{trip?.trip_status ? String(trip.trip_status) : "Scheduled"}</Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>TRIP ID</Text>
            <Text style={[styles.idText, { color: colors.primary }]}>#TRP-{id ? String(id).substring(0, 4) : "0000"}</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant }]}>
            <Ionicons name="person-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>Passenger Information</Text>
          </View>
          <View style={styles.passengerBody}>
            <View style={[styles.avatar, { backgroundColor: colors.surfaceContainerHigh }]}>
              <Ionicons name="person" size={24} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.passengerInfo}>
              <Text style={[styles.passengerName, { color: colors.onSurface }]}>{trip?.passenger_name ? String(trip.passenger_name) : "Alex Mercer"}</Text>
              <View style={styles.passengerStats}>
                <Ionicons name="people" size={14} color={colors.onSurfaceVariant} />
                <Text style={[styles.statText, { color: colors.onSurfaceVariant }]}>{trip?.passenger_count || 1} Passengers</Text>
                <Text style={[styles.statDivider, { color: colors.outlineVariant }]}>|</Text>
                <Ionicons name="star" size={14} color="#10b981" />
                <Text style={[styles.statText, { color: colors.onSurfaceVariant }]}>4.9</Text>
              </View>
            </View>
            <Pressable style={[styles.callBtn, { backgroundColor: colors.primary }]}>
              <Ionicons name="call" size={20} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant }]}>
            <Ionicons name="swap-vertical" size={16} color={colors.onSurfaceVariant} />
            <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>Route Details</Text>
          </View>
          <View style={styles.routeBody}>
            <View style={styles.timeline}>
              <View style={[styles.timelineDotBlue, { backgroundColor: colors.primary, borderColor: colors.primaryContainer }]} />
              <View style={[styles.timelineLine, { backgroundColor: colors.outlineVariant }]} />
              <View style={[styles.timelineDotGreen, { backgroundColor: colors.secondary, borderColor: colors.secondaryContainer }]} />
            </View>
            <View style={styles.routeStops}>
              <View style={styles.stopBox}>
                <Text style={[styles.stopLabel, { color: colors.onSurface }]}>Pickup • {depTime}</Text>
                <Text style={[styles.stopName, { color: colors.onSurface }]}>{trip?.origin ? String(trip.origin) : "Grand Plaza Hotel"}</Text>
              </View>
              <View style={styles.stopBox}>
                <Text style={[styles.stopLabel, { color: colors.onSurface }]}>Destination</Text>
                <Text style={[styles.stopName, { color: colors.onSurface }]}>{trip?.destination ? String(trip.destination) : "NAIA Terminal 2"}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.mapPreview}>
          <TomTomMap 
            origin={{ lat: trip?.origin_latitude, lng: trip?.origin_longitude }}
            destination={{ lat: trip?.destination_latitude, lng: trip?.destination_longitude }}
            originAddress={trip?.origin}
            destAddress={trip?.destination}
            pickupLabel={trip?.origin ? String(trip.origin) : "Pickup"}
            dropoffLabel={trip?.destination ? String(trip.destination) : "Destination"}
            style={styles.mapImage}
            scrollEnabled={false}
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant }]}>
            <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>Extra Notes</Text>
          </View>
          <Text style={[styles.notesText, { color: colors.onSurface }]}>
            {trip?.special_requests || "No extra notes for this trip."}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.actionRow}>
          <Pressable style={[styles.declineBtn, { borderColor: colors.outline }]} onPress={() => router.back()}>
            <Ionicons name="close" size={20} color={colors.onSurface} />
            <Text style={[styles.declineText, { color: colors.onSurface }]}>DECLINE</Text>
          </Pressable>
          <Pressable style={[styles.acceptBtn, { backgroundColor: colors.primary }]} onPress={handleAccept} disabled={accepting}>
            {accepting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <React.Fragment>
                <Ionicons name="checkmark" size={20} color={colors.onPrimary} />
                <Text style={[styles.acceptText, { color: colors.onPrimary }]}>ACCEPT</Text>
              </React.Fragment>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: fonts.displayBold },
  scroll: { padding: 16, gap: 12 },
  statusCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  labelText: { fontSize: 10, fontFamily: fonts.bodySemiBold, marginBottom: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 16, fontFamily: fonts.bodyMedium },
  idText: { fontSize: 14, fontFamily: fonts.displayBold },
  
  card: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, paddingBottom: 12, marginBottom: 12 },
  cardHeaderTitle: { fontSize: 12, fontFamily: fonts.bodySemiBold },
  passengerBody: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  passengerInfo: { flex: 1, gap: 4 },
  passengerName: { fontSize: 16, fontFamily: fonts.bodyMedium },
  passengerStats: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 12, fontFamily: fonts.body },
  statDivider: { fontSize: 12, marginHorizontal: 2 },
  callBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },

  routeBody: { flexDirection: "row", gap: 16 },
  timeline: { alignItems: "center", width: 16 },
  timelineDotBlue: { width: 16, height: 16, borderRadius: 8, borderWidth: 4 },
  timelineLine: { width: 2, flex: 1, marginVertical: 4 },
  timelineDotGreen: { width: 16, height: 16, borderRadius: 8, borderWidth: 4 },
  routeStops: { flex: 1, gap: 24 },
  stopBox: { gap: 2 },
  stopLabel: { fontSize: 10, fontFamily: fonts.bodySemiBold },
  stopName: { fontSize: 16, fontFamily: fonts.bodyMedium },

  mapPreview: { height: 120, borderRadius: 12, overflow: "hidden" },
  notesText: { fontSize: 14, fontFamily: fonts.bodyMedium, lineHeight: 20 },

  bottomBar: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  actionRow: { flexDirection: "row", gap: 12 },
  declineBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 24, borderWidth: 1 },
  declineText: { fontSize: 14, fontFamily: fonts.bodySemiBold, letterSpacing: 0.5 },
  acceptBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 24 },
  acceptText: { fontSize: 14, fontFamily: fonts.bodySemiBold, letterSpacing: 0.5 },
});
