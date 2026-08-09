import { useCallback, useState } from "react";
import { useEffect } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../../lib/api";
import { useTheme } from "../../../lib/theme-context";
import { fonts, space } from "../../../lib/theme";
import { getTone } from "../../../lib/tripRef";
import {
  Card,
  EmptyState,
  ErrorNotice,
  ScreenTitle,
  SkeletonCard,
  StatusPill,
  styles as ui,
} from "../../../components/ui";
import { BrandBar } from "../../../components/logo";
import { Plate } from "../../../components/plate";

/**
 * Trip history: the driver's completed and cancelled trips, from
 * GET /api/mobile/driver/trips?status=completed.
 */
export default function History() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get(
        "/api/mobile/driver/trips?status=completed&limit=50"
      );
      setTrips(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Could not load your trip history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <ScreenTitle eyebrow="Driver" title="Trip history" />
        <ErrorNotice message={error} />

        {loading ? (
          <View style={styles.skeletons}>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </View>
        ) : trips.length === 0 ? (
          <EmptyState
            title="No completed trips"
            message="Trips you finish will appear here."
          />
        ) : (
          trips.map((trip) => <HistoryCard key={trip.trip_id} trip={trip} />)
        )}
      </ScrollView>
    </View>
  );
}

function HistoryCard({ trip }) {
  const { colors } = useTheme();
  const tone = useTripTone(trip.trip_status);
  return (
    <Card tone={tone}>
      <View style={ui.rowBetween}>
        <Text style={[styles.tripId, { color: colors.onSurface }]}>#{trip.trip_id}</Text>
        <StatusPill label={trip.trip_status} tone={tone} />
      </View>
      <Text style={[styles.route, { color: colors.onSurface }]} numberOfLines={1}>
        {trip.origin} → {trip.destination}
      </Text>
      <View style={styles.plateRow}>
        <Plate plate={trip.plate_number} />
        <Text style={[styles.time, { color: colors.onSurfaceVariant }]}>
          {trip.end_time ? new Date(trip.end_time).toLocaleString() : ""}
        </Text>
      </View>
    </Card>
  );
}

function useTripTone(status) {
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
  skeletons: { gap: space.base },
  tripId: { fontFamily: fonts.dataSemiBold, fontSize: 14 },
  route: { fontFamily: fonts.body, fontSize: 15 },
  plateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    marginTop: space.sm,
  },
  time: { fontFamily: fonts.data, fontSize: 12 },
});
