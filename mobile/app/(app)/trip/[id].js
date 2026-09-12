import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TripMapPreview from "../../../components/TripMapPreview";
import RouteTimeline from "../../../components/RouteTimeline";
import { api, wasQueued } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { CACHE_KEYS, getCached, setCached, tripCacheKey, resolveDriverId } from "../../../lib/offline-cache";
import { useConnectivity } from "../../../lib/connectivity-context";
import { SyncNote, NeverSyncedCard } from "../../../components/OfflineStates";
import { tripStatusTone, TOUCH_TARGET } from "../../../lib/theme";
import { useTheme } from "../../../lib/theme-context";
import { AppAlert } from '../../../components/AppAlert';
import { detailPrimaryAction, readinessFor, completionTime, scheduledDeparture, passengerSummary } from "../../../lib/trip-detail";
import { clayMaterials } from "../../../lib/clay";
import { ClayCard, ClayBadge, ClayButton } from "../../../components/clay";

// Scheme-aware clay material (clayMaterials) — the old local copy baked in
// light-mode edge strips that read as a harsh gray line in dark mode.

// Frozen at module load; the 30s interval below keeps it current without render-time reads.
const NOW_AT_LOAD = Date.now();

const fmtTime = (ms) =>
  ms == null ? null : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function TripDetailsScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");
  const dark = scheme === "dark";

  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [now, setNow] = useState(NOW_AT_LOAD);
  // Honest absence states: the fetch answered but this trip isn't among the
  // driver's loaded assignments / the fetch failed with nothing cached.
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);
  // Offline Read Mode: last server confirmation for this trip's data.
  const [lastSynced, setLastSynced] = useState(null);
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  // Unstable counts as online (the amber banner speaks for it); only a fully
  // offline verdict switches this screen to saved data.
  const { status } = useConnectivity();
  const offline = status === "offline";
  // Ref so load() can read the current verdict without it being a dependency
  // (a status flip must not re-identity the callback and re-fire the fetch).
  const offlineRef = useRef(offline);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);

  // Tick every 30s so the "start in X min" / START ROUTE gate refreshes.
  useEffect(() => {
    if (trip?.trip_status === "Trip Started") return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [trip?.trip_status]);

  const load = useCallback(async () => {
    // Offline Read Mode: list-cache-first. The shared TRIPS_ALL snapshot is
    // the primary source; the per-trip key covers trips opened before that
    // list was ever cached.
    let cachedTrip = null;
    let cachedSyncedAt = null;
    if (driverId) {
      const listCached = await getCached(driverId, CACHE_KEYS.TRIPS_ALL);
      const inList = Array.isArray(listCached?.data)
        ? listCached.data.find((t) => String(t.trip_id) === String(id))
        : null;
      if (inList) {
        cachedTrip = inList;
        cachedSyncedAt = listCached.syncedAt;
      } else {
        const singleCached = await getCached(driverId, tripCacheKey(id));
        if (singleCached?.data) {
          cachedTrip = singleCached.data;
          cachedSyncedAt = singleCached.syncedAt;
        }
      }
      if (cachedTrip) {
        setTrip(cachedTrip);
        setLastSynced(cachedSyncedAt);
        setLoading(false);
      }
    }
    try {
      setLoadError(null);
      setNotFound(false);
      // limit=100 widens coverage past the default page cap. This is the only
      // trip source — the old /api/trips/{id} fallback required
      // trips:read_all (drivers get 403), so it could never succeed here.
      const data = await api.get("/api/mobile/driver/trips?status=all&limit=100");
      const list = Array.isArray(data) ? data : [];
      // Display-only: refresh both the shared list and this trip's key.
      if (driverId) await setCached(driverId, CACHE_KEYS.TRIPS_ALL, list);
      const found = list.find((t) => String(t.trip_id) === String(id));
      if (found) {
        setTrip(found);
        if (driverId) await setCached(driverId, tripCacheKey(id), found);
        setLastSynced(Date.now());
      } else if (!cachedTrip) {
        // Online, but this trip is not among the driver's assignments. Never
        // fabricate a shell — the render branch states the absence plainly.
        setNotFound(true);
      }
      // A cached copy stays visible with its sync note even when the fresh
      // list omits it; the driver keeps the last-known data they had.
    } catch (e) {
      // Offline with NO cached copy → the never-synced card. Online failure
      // with no cache → error + retry. With a cached copy → keep showing it;
      // the connectivity banner owns transport failures.
      if (!cachedTrip && !offlineRef.current) {
        setLoadError(e.message || "Could not load this trip.");
      }
    } finally {
      setLoading(false);
    }
  }, [id, driverId]);

  useEffect(() => {
    // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const retry = () => {
    setLoading(true);
    setNotFound(false);
    setLoadError(null);
    load();
  };

  const action = detailPrimaryAction(trip); // 'accept-start' | 'navigate' | 'closed'
  const isPreStart = action === "accept-start";
  const isTerminal = action === "closed";
  const isAccepted = trip?.trip_status === "Driver Accepted";
  const isCompleted = trip?.trip_status === "Completed";

  // Pre-start only: the existing accept→start sequence. Active trips never
  // reach this — CONTINUE TO MAP navigates without writing status.
  const handleAcceptStart = async () => {
    setAccepting(true);
    try {
      let queued = false;
      if (!isAccepted) {
        const acceptRes = await api.put(`/api/trips/${id}/accept`, { accept: true });
        queued = wasQueued(acceptRes);
      }
      const startRes = await api.put(`/api/trips/${id}/start`, { odometer: Number(trip?.current_mileage) || undefined });
      // PR #3.1: queued reached the outbox, not the server — say so.
      if (queued || wasQueued(startRes)) {
        AppAlert.alert("Saved for sync", "This update will be sent when you're online.");
      }
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

  // Active trips: navigation only.
  const handleContinue = () => router.replace("/map");

  // Stable stops identity for the memoized RouteTimeline: the screen
  // re-renders on a 30 s clock with the same trip object.
  const routeStops = useMemo(() => [
    { label: "Pickup", value: trip?.origin ? String(trip.origin) : null, time: fmtTime(scheduledDeparture(trip)) },
    { label: "Drop-off", value: trip?.destination ? String(trip.destination) : null },
  ], [trip]);

  // Render function (not a nested component) so the header doesn't remount
  // on every state tick.
  const headerBar = (onClose) => (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={({ pressed }) => [styles.backBtn, mats.clayTile, { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow, opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="arrow-back" size={22} color={colors.primary} />
      </Pressable>
      <Text style={type.titleLg}>Trip Details</Text>
      <View style={{ width: TOUCH_TARGET }} />
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!trip) {
    // Honest absence states — never a fabricated trip shell.
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {headerBar(() => router.back())}
        <View style={styles.scroll}>
          {offline ? (
            <NeverSyncedCard title="Trip not saved for offline" body="Connect once while online to view this trip's details." />
          ) : notFound ? (
            <ClayCard style={styles.absent}>
              <Ionicons name="help-circle-outline" size={40} color={colors.onSurfaceVariant} />
              <Text style={[type.cardTitle, { textAlign: "center" }]}>This trip isn&apos;t in your loaded assignments.</Text>
              <Text style={[type.supporting, { textAlign: "center" }]}>
                It may have been reassigned or removed by dispatch. Pull to refresh if you were expecting it.
              </Text>
              <ClayButton label="Try Again" variant="primary" onPress={retry} />
            </ClayCard>
          ) : (
            <ClayCard style={styles.absent}>
              <Ionicons name="alert-circle-outline" size={40} color={colors.onSurfaceVariant} />
              <Text style={[type.cardTitle, { textAlign: "center" }]}>{loadError || "This trip couldn't be loaded."}</Text>
              <ClayButton label="Try Again" variant="primary" onPress={retry} />
            </ClayCard>
          )}
        </View>
      </View>
    );
  }

  const ready = readinessFor(trip, now);
  const depMs = scheduledDeparture(trip);
  const depLabel = depMs != null
    ? new Date(depMs).toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + fmtTime(depMs)
    : null;
  const endMs = completionTime(trip);
  const pax = passengerSummary(trip);
  const tone = tripStatusTone(trip.trip_status);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {headerBar(() => router.back())}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {offline && lastSynced != null ? (
          // Cached trip offline: one inline note under the header — the global
          // banner owns "You're offline", this says what THIS screen shows.
          <SyncNote syncedAt={lastSynced} label="trip details" />
        ) : null}

        {/* Summary card */}
        <ClayCard style={styles.card}>
          <View style={[styles.cardHeader, { flexWrap: "wrap", gap: 8 }]}>
            <ClayBadge
              text={String(trip.trip_status).toUpperCase()}
              tone={tone}
            />
            <Text style={[type.caption, { color: colors.primary }]}>Trip #{String(id)}</Text>
          </View>
          <View>
            <Text style={[type.caption, { marginBottom: 2 }]}>Scheduled departure</Text>
            <Text style={type.cardTitle}>{depLabel || "Not provided"}</Text>
          </View>
        </ClayCard>

        {/* Readiness panel (pre-start) or completion summary (terminal) */}
        {isTerminal ? (
          <ClayCard style={styles.card}>
            <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
              <Ionicons name={isCompleted ? "flag-outline" : "close-circle-outline"} size={16} color={isCompleted ? colors.primary : colors.error} />
              <Text style={[type.label, { letterSpacing: 0.6 }]}>{isCompleted ? "COMPLETION SUMMARY" : "TRIP CANCELLED"}</Text>
            </View>
            <View style={[styles.pairRow, { flexWrap: "wrap", gap: 10 }]}>
              <View style={styles.pair}>
                <Text style={type.caption}>{isCompleted ? "COMPLETED AT" : "STATUS"}</Text>
                <Text style={[type.headlineMd, { color: isCompleted ? colors.primary : colors.error }]}>
                  {isCompleted ? (fmtTime(endMs) || "Time not recorded") : "Cancelled"}
                </Text>
              </View>
            </View>
            <View style={[styles.meterRow, mats.compactShade, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
              <View style={styles.pair}>
                <Text style={type.caption}>START ODOMETER</Text>
                <Text style={[type.data, { color: colors.onSurface }]}>
                  {trip?.start_odometer != null && trip.start_odometer !== "" ? `${trip.start_odometer} km` : "Not recorded"}
                </Text>
              </View>
              <View style={[styles.pair, { alignItems: "flex-end" }]}>
                <Text style={type.caption}>VEHICLE MILEAGE</Text>
                <Text style={[type.data, { color: colors.onSurface }]}>
                  {trip?.current_mileage != null && trip.current_mileage !== "" ? `${trip.current_mileage} km` : "Not recorded"}
                </Text>
              </View>
            </View>
          </ClayCard>
        ) : (
          <ClayCard style={styles.card}>
            <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={[type.label, { letterSpacing: 0.6 }]}>{isPreStart ? "START READINESS" : "TRIP IN PROGRESS"}</Text>
            </View>
            {isPreStart ? (
              ready.earliestStart != null ? (
                <>
                  <View style={[styles.pairRow, { flexWrap: "wrap", gap: 10 }]}>
                    <View style={styles.pair}>
                      <Text style={type.caption}>EARLIEST START</Text>
                      <Text style={[type.headlineMd, { color: ready.windowOpen ? colors.secondary : colors.onSurface }]}>
                        {fmtTime(ready.earliestStart)}
                      </Text>
                    </View>
                    {ready.recommended != null ? (
                      <View style={[styles.pair, { alignItems: "flex-end" }]}>
                        <Text style={type.caption}>RECOMMENDED</Text>
                        <Text style={type.headlineMd}>{fmtTime(ready.recommended)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.banner,
                      {
                        backgroundColor: ready.windowOpen ? colors.secondaryContainer : colors.surfaceContainerHighest,
                        borderColor: ready.windowOpen ? colors.secondary : colors.outlineVariant + "55",
                      },
                    ]}
                  >
                    <Ionicons
                      name={ready.windowOpen ? "checkmark-circle" : "hourglass-outline"}
                      size={18}
                      color={ready.windowOpen ? colors.onSecondaryContainer : colors.onSurfaceVariant}
                    />
                    <Text style={[type.supporting, { flexShrink: 1, color: ready.windowOpen ? colors.onSecondaryContainer : colors.onSurface }]}>
                      {ready.windowOpen
                        ? ready.preTripPassed ? "Departure window is open. Ready to start." : "Departure window is open. Pre-trip inspection is still required."
                        : `Window opens in ${ready.minsToStart} min (${fmtTime(ready.earliestStart)}).`}
                    </Text>
                  </View>
                  {!ready.preTripPassed ? (
                    <View style={styles.hintRow}>
                      <Ionicons name="information-circle-outline" size={14} color={colors.error} />
                      <Text style={[type.caption, { flexShrink: 1 }]}>Pre-trip inspection must be completed before starting.</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                // No verified start window — say so instead of guessing one.
                <View style={[styles.banner, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + "55" }]}>
                  <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceVariant} />
                  <Text style={[type.supporting, { flexShrink: 1 }]}>
                    Start window isn&apos;t confirmed yet. Check with dispatch for your scheduled departure.
                  </Text>
                </View>
              )
            ) : (
              <Text style={type.supporting}>
                This trip is underway. Continue to the map to track the route and progress.
              </Text>
            )}
          </ClayCard>
        )}

        {/* Route */}
        <ClayCard style={styles.card}>
          <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
            <Ionicons name="navigate-outline" size={16} color={colors.primary} />
            <Text style={[type.label, { letterSpacing: 0.6 }]}>ROUTE</Text>
          </View>
          <RouteTimeline
            accent={colors.primary}
            stops={routeStops}
          />
        </ClayCard>

        {/* Map panel — static route preview only; interactive navigation
            lives on the Live Map tab. */}
        <ClayCard style={styles.card}>
          <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
            <Ionicons name="map-outline" size={16} color={colors.primary} />
            <Text style={[type.label, { letterSpacing: 0.6 }]}>ROUTE MAP</Text>
          </View>
          <TripMapPreview key={`${trip.trip_id}:${trip.origin_latitude}:${trip.origin_longitude}:${trip.destination_latitude}:${trip.destination_longitude}:${offline}`}
            trip={trip} offline={offline} airport={/\b(airport|NAIA)\b/i.test(trip.destination || '')} />
        </ClayCard>

        {/* Passenger — supplied facts only, no VIP tier, no call action (the
            API has no phone field for this trip). */}
        <ClayCard style={styles.card}>
          <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
            <Ionicons name="person-outline" size={16} color={colors.primary} />
            <Text style={[type.label, { letterSpacing: 0.6 }]}>PASSENGER</Text>
          </View>
          <View style={styles.paxRow}>
            <Ionicons name="people-outline" size={18} color={colors.onSurfaceVariant} />
            <View style={{ flexShrink: 1 }}>
              <Text style={type.cardTitle}>{pax.name || "Passenger not listed"}</Text>
              <Text style={type.supporting}>
                {pax.count != null ? `${pax.count} ${pax.count === 1 ? "passenger" : "passengers"}` : "Passenger count not listed"}
              </Text>
            </View>
          </View>
        </ClayCard>

        {/* Notes */}
        {trip?.special_requests ? (
          <ClayCard style={styles.card}>
            <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
              <Ionicons name="document-text-outline" size={16} color={colors.primary} />
              <Text style={[type.label, { letterSpacing: 0.6 }]}>SPECIAL REQUESTS</Text>
            </View>
            <Text style={[type.supporting, { color: colors.onSurface }]}>
              {trip.special_requests}
            </Text>
          </ClayCard>
        ) : null}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.bottomBar, { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant + "55", paddingBottom: Math.max(insets.bottom, 16) }]}>
        {isTerminal ? (
          <View
            style={[
              styles.finishedBanner,
              {
                backgroundColor: isCompleted ? colors.primaryContainer + "35" : colors.surfaceContainerHigh,
                borderColor: isCompleted ? colors.primary + "40" : colors.outlineVariant + "55",
              },
            ]}
          >
            <Ionicons
              name={isCompleted ? "checkmark-circle" : "close-circle"}
              size={20}
              color={isCompleted ? colors.primary : colors.onSurfaceVariant}
            />
            <View style={{ flex: 1 }}>
              <Text style={type.labelLg}>{isCompleted ? "Trip Completed" : "Trip Cancelled"}</Text>
              <Text style={type.caption}>
                {isCompleted
                  ? "Telemetry and route logs are archived."
                  : "This trip was cancelled and is closed for dispatch."}
              </Text>
            </View>
          </View>
        ) : isPreStart ? (
          <Pressable
            style={({ pressed }) => [
              styles.cta,
              dark && { borderTopColor: "rgba(255,255,255,0.12)", borderBottomColor: "rgba(0,0,0,0.40)", shadowOpacity: 0.4 },
              mats.clayCta,
              {
                backgroundColor: ready.startReady ? colors.primary : colors.surfaceContainerHigh,
                shadowColor: colors.shadow,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            onPress={handleAcceptStart}
            disabled={accepting || !ready.startReady}
            accessibilityRole="button"
            accessibilityLabel={ready.startReady
              ? (isAccepted ? "Start route" : "Accept and start trip")
              : "Start route not yet available"}
            accessibilityState={{ disabled: accepting || !ready.startReady, busy: !!accepting }}
          >
            {accepting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <>
                <Text style={[type.labelLg, { color: ready.startReady ? colors.onPrimary : colors.onSurfaceVariant, textAlign: "center", flexShrink: 1 }]}>
                  {ready.startReady
                    ? (isAccepted ? "START ROUTE" : "ACCEPT & START")
                    : ready.unavailableReason === "inspection"
                      ? "PRE-TRIP CHECK REQUIRED"
                      : ready.unavailableReason === "window"
                        ? `START ROUTE IN ${ready.minsToStart} MIN`
                        : "START NOT YET SCHEDULED"}
                </Text>
                <Ionicons
                  name={ready.startReady ? "car-outline" : "lock-closed-outline"}
                  size={19}
                  color={ready.startReady ? colors.onPrimary : colors.onSurfaceVariant}
                />
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.cta, dark && { borderTopColor: "rgba(255,255,255,0.12)", borderBottomColor: "rgba(0,0,0,0.40)", shadowOpacity: 0.4 }, mats.clayCta, { backgroundColor: colors.primary, shadowColor: colors.shadow, opacity: pressed ? 0.85 : 1 }]}
            onPress={handleContinue}
            disabled={accepting}
            accessibilityRole="button"
            accessibilityLabel="Continue to map"
          >
            <Text style={[type.labelLg, { color: colors.onPrimary }]}>CONTINUE TO MAP</Text>
            <Ionicons name="navigate-outline" size={19} color={colors.onPrimary} />
          </Pressable>
        )}
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
    paddingBottom: 12,
  },
  backBtn: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  scroll: { padding: 16, paddingBottom: 26, gap: 16 },
  card: {
    borderRadius: 24,
    padding: 16,
    gap: 14,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, paddingBottom: 10 },
  pairRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  pair: { gap: 2, flexShrink: 1 },
  meterRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 12,
    gap: 12,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  paxRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  absent: { alignItems: "center", gap: 12, marginTop: 48, padding: 16, borderRadius: 24 },
  bottomBar: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  cta: { minHeight: 48, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 10, borderTopWidth: 2, borderTopColor: '#FFFFFF55', borderBottomWidth: 3, borderBottomColor: '#00000028', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 7, elevation: 5 },
  finishedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
});
