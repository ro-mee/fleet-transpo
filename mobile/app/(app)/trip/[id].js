import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TomTomMap from "../../../components/TomTomMap";
import { api } from "../../../lib/api";
import { fonts, statusColors } from "../../../lib/theme";
import { useTheme } from "../../../lib/theme-context";
import { AppAlert } from '../../../components/AppAlert';

function getTripStatusStyle(status, colors) {
  return statusColors(colors, status);
}

export default function TripDetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tick every 30s so the "start in X min" / START ROUTE gate refreshes.
  useEffect(() => {
    if (trip?.trip_status === "Trip Started") return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [trip?.trip_status]);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/api/mobile/driver/trips?status=all");
      const found = Array.isArray(data) ? data.find((t) => String(t.trip_id) === String(id)) : null;
      if (found) {
        setTrip(found);
      } else {
        // Fallback fetch specific trip if not in driver active/completed batch
        const single = await api.get(`/api/trips/${id}`).catch(() => null);
        setTrip(single || { trip_id: id, trip_status: "Completed" });
      }
    } catch (e) {
      setTrip({ trip_id: id, trip_status: "Completed" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const PRE_START = ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched", "Driver Accepted"];
  const isPreStart = PRE_START.includes(trip?.trip_status);
  const isAccepted = trip?.trip_status === "Driver Accepted";
  const isCompleted = trip?.trip_status === "Completed";
  const isCancelled = trip?.trip_status === "Cancelled";
  const isFinished = isCompleted || isCancelled;

  const handleAction = async () => {
    if (isFinished) return;
    setAccepting(true);
    try {
      if (!isAccepted) {
        await api.put(`/api/trips/${id}/accept`, { accept: true });
      }
      await api.put(`/api/trips/${id}/start`, { odometer: Number(trip?.current_mileage) || undefined });
      router.replace("/map");
    } catch (e) {
      const msg = e.message || "Could not update trip.";
      const buttons = String(msg).toLowerCase().includes("inspection")
        ? [
            { text: "PRE-TRIP CHECK", onPress: () => router.push({ pathname: "/inspection", params: { tripId: String(id) } }) },
            { text: "Cancel", style: "cancel" },
          ]
        : [{ text: "OK" }];
      AppAlert.alert("Cannot Start Trip", msg, buttons, { type: 'error' });
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

  const earliestStart = trip?.earliest_start
    ? new Date(trip.earliest_start).getTime()
    : null;
  const recommended = trip?.recommended_departure
    ? new Date(trip.recommended_departure).getTime()
    : null;
  const preTripPassed = trip?.pre_trip_status === "Passed";
  const windowOpen = earliestStart != null && now >= earliestStart;
  const startReady = isPreStart && windowOpen && preTripPassed;
  const minsToStart = earliestStart != null
    ? Math.max(0, Math.ceil((earliestStart - now) / 60000))
    : null;
  const fmt = (ms) =>
    ms == null ? null : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.onSurface }]}>Trip Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        {(() => {
          const sc = getTripStatusStyle(trip?.trip_status, colors);
          return (
            <View style={[styles.statusCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
              <View>
                <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>STATUS</Text>
                <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                  <View style={[styles.statusDot, { backgroundColor: sc.dot }]} />
                  <Text style={[styles.statusText, { color: sc.fg }]}>{trip?.trip_status ? String(trip.trip_status) : "Scheduled"}</Text>
                </View>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>TRIP ID</Text>
                <Text style={[styles.idText, { color: colors.primary }]}>#TRP-{id ? String(id).substring(0, 4) : "0000"}</Text>
              </View>
            </View>
          );
        })()}

        {/* Start Timing Card for Pre-Start / In-Progress OR Completion Telemetry Summary for Finished Trips */}
        {isFinished ? (
          <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
            <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '30' }]}>
              <Ionicons name="flag-outline" size={16} color={isCompleted ? colors.primary : colors.error} />
              <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>
                {isCompleted ? "COMPLETION SUMMARY" : "TRIP CANCELLATION LOG"}
              </Text>
            </View>

            <View style={styles.timingRow}>
              <View>
                <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>SCHEDULED DEPARTURE</Text>
                <Text style={[styles.timingBig, { color: colors.onSurface }]}>
                  {depTime}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>
                  {isCompleted ? "ARRIVAL / COMPLETED" : "STATUS"}
                </Text>
                <Text style={[styles.timingBig, { color: isCompleted ? colors.primary : colors.error }]}>
                  {isCompleted
                    ? (trip?.updated_at || trip?.completed_at ? new Date(trip.updated_at || trip.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Completed")
                    : "Cancelled"}
                </Text>
              </View>
            </View>

            {/* Bento metric row for mileage & odometer */}
            <View style={[styles.timingBanner, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + '30' }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>START ODOMETER</Text>
                <Text style={[styles.statText, { color: colors.onSurface, fontFamily: fonts.dataSemiBold, fontSize: 13 }]}>
                  {trip?.start_mileage ? `${trip.start_mileage} km` : "Logged"}
                </Text>
              </View>
              <View style={{ width: 1, height: 24, backgroundColor: colors.outlineVariant + '40', marginHorizontal: 8 }} />
              <View style={{ flex: 1, alignItems: "flex-end" }}>
                <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>END ODOMETER</Text>
                <Text style={[styles.statText, { color: colors.onSurface, fontFamily: fonts.dataSemiBold, fontSize: 13 }]}>
                  {trip?.current_mileage ? `${trip.current_mileage} km` : "Recorded"}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
            <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '30' }]}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>START TIMING</Text>
            </View>
            {earliestStart != null ? (
              <>
                <View style={styles.timingRow}>
                  <View>
                    <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>EARLIEST START</Text>
                    <Text style={[styles.timingBig, { color: windowOpen ? colors.secondary : colors.onSurface }]}>
                      {fmt(earliestStart)}
                    </Text>
                  </View>
                  {recommended != null ? (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.labelText, { color: colors.onSurfaceVariant }]}>RECOMMENDED</Text>
                      <Text style={[styles.timingBig, { color: colors.onSurface }]}>{fmt(recommended)}</Text>
                    </View>
                  ) : null}
                </View>
                <View
                  style={[
                    styles.timingBanner,
                    {
                      backgroundColor: windowOpen
                        ? colors.secondaryContainer
                        : colors.surfaceContainerHighest,
                      borderColor: windowOpen ? colors.secondary : colors.outlineVariant + '40',
                    },
                  ]}
                >
                  <Ionicons
                    name={windowOpen ? "checkmark-circle" : "hourglass-outline"}
                    size={18}
                    color={windowOpen ? colors.onSecondaryContainer : colors.onSurfaceVariant}
                  />
                  <Text style={[styles.timingBannerText, { color: windowOpen ? colors.onSecondaryContainer : colors.onSurface }]}>
                    {windowOpen
                      ? "Departure window is open. Ready to start."
                      : minsToStart != null
                        ? `Window opens in ${minsToStart} min (${fmt(earliestStart)}).`
                        : `Earliest departure ${fmt(earliestStart)}.`}
                  </Text>
                </View>
                {!preTripPassed ? (
                  <View style={styles.hintRow}>
                    <Ionicons name="information-circle-outline" size={14} color={colors.error} />
                    <Text style={[styles.timingHint, { color: colors.onSurfaceVariant }]}>
                      Pre-trip inspection must be completed before starting.
                    </Text>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={[styles.timingHint, { color: colors.onSurfaceVariant }]}>
                Schedule window will appear once departure time is confirmed.
              </Text>
            )}
          </View>
        )}

        {/* Passenger Information */}
        <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '30' }]}>
            <Ionicons name="person-outline" size={16} color={colors.primary} />
            <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>PASSENGER INFORMATION</Text>
          </View>
          <View style={styles.passengerBody}>
            <View style={[styles.avatar, { backgroundColor: colors.primaryContainer }]}>
              <Text style={[styles.avatarText, { color: colors.onPrimaryContainer }]}>
                {(trip?.passenger_name || "G")[0]?.toUpperCase()}
              </Text>
            </View>
            <View style={styles.passengerInfo}>
              <Text style={[styles.passengerName, { color: colors.onSurface }]}>{trip?.passenger_name ? String(trip.passenger_name) : "Guest"}</Text>
              <View style={styles.passengerStats}>
                <Ionicons name="people-outline" size={14} color={colors.onSurfaceVariant} />
                <Text style={[styles.statText, { color: colors.onSurfaceVariant }]}>{trip?.passenger_count || 1} Pax</Text>
                <Text style={[styles.statDivider, { color: colors.outlineVariant }]}>•</Text>
                <Ionicons name="star" size={13} color={colors.warning} />
                <Text style={[styles.statText, { color: colors.onSurfaceVariant }]}>VIP Guest</Text>
              </View>
            </View>
            <Pressable style={({ pressed }) => [styles.callBtn, { backgroundColor: colors.surfaceContainerHighest, opacity: pressed ? 0.8 : 1 }]}>
              <Ionicons name="call-outline" size={18} color={colors.primary} />
            </Pressable>
          </View>
        </View>

        {/* Route Details */}
        <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '30' }]}>
            <Ionicons name="navigate-outline" size={16} color={colors.primary} />
            <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>ROUTE DETAILS</Text>
          </View>
          <View style={styles.routeBody}>
            <View style={styles.timeline}>
              <View style={[styles.timelineDotBlue, { backgroundColor: colors.primary }]} />
              <View style={[styles.timelineLine, { backgroundColor: colors.outlineVariant + '50' }]} />
              <View style={[styles.timelineDotGreen, { borderColor: colors.secondary, backgroundColor: colors.secondaryContainer }]} />
            </View>
            <View style={styles.routeStops}>
              <View style={styles.stopBox}>
                <Text style={[styles.stopLabel, { color: colors.onSurfaceVariant }]}>PICKUP • {depTime}</Text>
                <Text style={[styles.stopName, { color: colors.onSurface }]}>{trip?.origin ? String(trip.origin) : "Origin TBD"}</Text>
              </View>
              <View style={styles.stopBox}>
                <Text style={[styles.stopLabel, { color: colors.onSurfaceVariant }]}>DESTINATION</Text>
                <Text style={[styles.stopName, { color: colors.onSurface }]}>{trip?.destination ? String(trip.destination) : "Destination TBD"}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Map Preview Card with Pickup & Drop-Off Waypoints */}
        <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40', padding: 0, overflow: 'hidden' }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '30', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }]}>
            <Ionicons name="map-outline" size={16} color={colors.primary} />
            <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>ROUTE MAP OVERVIEW</Text>
          </View>
          
          <View style={styles.mapPreview}>
            <TomTomMap 
              key={`${trip?.trip_id}-${trip?.origin}-${trip?.destination}`}
              origin={trip?.origin_latitude ? { lat: Number(trip.origin_latitude), lng: Number(trip.origin_longitude) } : undefined}
              destination={trip?.destination_latitude ? { lat: Number(trip.destination_latitude), lng: Number(trip.destination_longitude) } : undefined}
              originAddress={trip?.origin || "Manila, Philippines"}
              destAddress={trip?.destination || "Pasay, Metro Manila"}
              pickupLabel={trip?.origin ? `Pickup: ${trip.origin}` : "Pickup Location"}
              dropoffLabel={trip?.destination ? `Drop-off: ${trip.destination}` : "Drop-off Location"}
              style={styles.mapImage}
              scrollEnabled={true}
            />
          </View>

          {/* Quick Route Leg Summary Footer */}
          <View style={styles.mapFooterSummary}>
            <View style={styles.mapFooterCol}>
              <View style={[styles.dotIndicator, { backgroundColor: colors.primary }]} />
              <Text style={[styles.mapFooterText, { color: colors.onSurface }]} numberOfLines={1}>
                {trip?.origin || "Pickup Location"}
              </Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color={colors.outline} style={{ marginHorizontal: 8 }} />
            <View style={styles.mapFooterCol}>
              <View style={[styles.dotIndicator, { backgroundColor: colors.secondary }]} />
              <Text style={[styles.mapFooterText, { color: colors.onSurface }]} numberOfLines={1}>
                {trip?.destination || "Drop-off Location"}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {trip?.special_requests ? (
          <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
            <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '30' }]}>
              <Ionicons name="document-text-outline" size={16} color={colors.primary} />
              <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>SPECIAL REQUESTS</Text>
            </View>
            <Text style={[styles.notesText, { color: colors.onSurface }]}>
              {trip.special_requests}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Bottom Bar */}
      {isFinished ? (
        <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant + '30', paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View
            style={[
              styles.finishedBanner,
              {
                backgroundColor: isCompleted ? colors.primaryContainer + '35' : colors.surfaceContainerHigh,
                borderColor: isCompleted ? colors.primary + '40' : colors.outlineVariant + '50',
              },
            ]}
          >
            <Ionicons
              name={isCompleted ? "checkmark-circle" : "close-circle"}
              size={20}
              color={isCompleted ? colors.primary : colors.onSurfaceVariant}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.finishedBannerTitle, { color: colors.onSurface }]}>
                {isCompleted ? "Trip Completed" : "Trip Cancelled"}
              </Text>
              <Text style={[styles.finishedBannerSub, { color: colors.onSurfaceVariant }]}>
                {isCompleted
                  ? "Telemetry and route logs are archived."
                  : "This trip was cancelled and is closed for dispatch."}
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant + '30', paddingBottom: Math.max(insets.bottom, 16) }]}>
          {isPreStart ? (
            <Pressable
              style={({ pressed }) => [
                styles.acceptBtn,
                {
                  backgroundColor: startReady ? colors.primary : colors.surfaceContainerHigh,
                  width: '100%',
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
              onPress={handleAction}
              disabled={accepting || !startReady}
              accessibilityRole="button"
              accessibilityLabel={startReady ? (isAccepted ? "Start route" : "Accept and start trip") : "Start route not yet available"}
            >
              {accepting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <React.Fragment>
                  <Text style={[styles.acceptText, { color: startReady ? colors.onPrimary : colors.onSurfaceVariant }]}>
                    {startReady
                      ? (isAccepted ? "START ROUTE" : "ACCEPT & START")
                      : !preTripPassed
                        ? "PRE-TRIP CHECK REQUIRED"
                        : minsToStart != null
                          ? `START ROUTE IN ${minsToStart} MIN`
                          : "START ROUTE"}
                  </Text>
                  <View style={[styles.btnIconCapsule, { backgroundColor: startReady ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)' }]}>
                    <Ionicons name={startReady ? "car-outline" : "lock-closed-outline"} size={17} color={startReady ? colors.onPrimary : colors.onSurfaceVariant} />
                  </View>
                </React.Fragment>
              )}
            </Pressable>
          ) : (
            <Pressable 
              style={({ pressed }) => [
                styles.acceptBtn, 
                { 
                  backgroundColor: colors.primary, 
                  width: '100%', 
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: pressed ? 0.9 : 1 
                }
              ]} 
              onPress={handleAction} 
              disabled={accepting}
              accessibilityRole="button"
              accessibilityLabel="Continue to map"
            >
              {accepting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <React.Fragment>
                  <Text style={[styles.acceptText, { color: colors.onPrimary }]}>CONTINUE TO MAP</Text>
                  <View style={[styles.btnIconCapsule, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                    <Ionicons name="navigate-outline" size={17} color={colors.onPrimary} />
                  </View>
                </React.Fragment>
              )}
            </Pressable>
          )}
        </View>
      )}
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
    paddingBottom: 14,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  headerTitle: { fontSize: 17, fontFamily: fonts.displayBold },
  scroll: { padding: 16, gap: 12 },
  statusCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  labelText: { fontSize: 10, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 6 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 13, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.3 },
  idText: { fontSize: 15, fontFamily: fonts.dataSemiBold || fonts.displayBold },
  
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, paddingBottom: 10, marginBottom: 12 },
  cardHeaderTitle: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6 },
  passengerBody: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.displayBold, fontSize: 18 },
  passengerInfo: { flex: 1, gap: 3 },
  passengerName: { fontSize: 15, fontFamily: fonts.bodySemiBold },
  passengerStats: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 12, fontFamily: fonts.body },
  statDivider: { fontSize: 12, marginHorizontal: 2 },
  callBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },

  routeBody: { flexDirection: "row", gap: 14, paddingVertical: 2 },
  timingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  timingBig: { fontSize: 20, fontFamily: fonts.displayBold, letterSpacing: -0.3 },
  timingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  timingBannerText: { flex: 1, fontSize: 13, fontFamily: fonts.bodyMedium },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  timingHint: { fontSize: 12, fontFamily: fonts.body },

  timeline: { alignItems: "center", width: 14, paddingTop: 4, paddingBottom: 4 },
  timelineDotBlue: { width: 8, height: 8, borderRadius: 4 },
  timelineLine: { width: 1.5, flex: 1, marginVertical: 3 },
  timelineDotGreen: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  routeStops: { flex: 1, gap: 14 },
  stopBox: { gap: 1 },
  stopLabel: { fontSize: 10, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6 },
  stopName: { fontSize: 15, fontFamily: fonts.bodyMedium },

  mapPreview: { height: 220, overflow: "hidden" },
  mapFooterSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  mapFooterCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dotIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mapFooterText: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    flex: 1,
  },
  notesText: { fontSize: 13, fontFamily: fonts.body, lineHeight: 20 },

  bottomBar: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  acceptBtn: { 
    flexDirection: "row", 
    alignItems: "center", 
    justifyContent: "center", 
    gap: 12, 
    height: 52, 
    borderRadius: 16,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  acceptText: { fontSize: 15, fontFamily: fonts.bodySemiBold, letterSpacing: 0.5 },
  btnIconCapsule: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  finishedBannerTitle: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: 14,
    marginBottom: 2,
  },
  finishedBannerSub: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
  },
});
