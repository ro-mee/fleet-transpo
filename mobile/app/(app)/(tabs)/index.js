import { moderateScale } from '../../../lib/scaling';
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl, Modal, TextInput, ActivityIndicator } from 'react-native';
import { InteractionManager } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, wasQueued, isTransportFailure } from "../../../lib/api";
import { shouldAutoRetry, LIST_AUTO_RETRY_MS } from "../../../lib/connectivity-state";
import { CACHE_KEYS, getCached, setCached, resolveDriverId } from "../../../lib/offline-cache";
import { useConnectivity } from "../../../lib/connectivity-context";
import { SyncNote } from "../../../components/OfflineStates";
import { useAuth } from "../../../lib/auth";
import { ACTIONS, canAction } from "../../../lib/rbac";
import { useTripTracking, usePosterStatus, weatherChipFor } from "../../../lib/tracking";
import { useAmbientWeather } from "../../../lib/ambient-weather";
import DriverHomeHeader from "../../../components/home/DriverHomeHeader";
import {
  getActiveStatuses,
  getNextStatus,
} from "../../../lib/tripRef";
import { AppAlert } from '../../../components/AppAlert';
import { useTheme } from "../../../lib/theme-context";
import { useNotificationFeed } from "../../../context/notification-feed";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { SkeletonCard, ErrorNotice } from "../../../components/ui";
import { selectHomeTrips, homeVehicleImage } from "../../../lib/home-trips";
import { resolveVehicleContext } from "../../../lib/driver-context";
import { DriverHeroCard, HomeQuickActions, DriverTripCard, AssignmentsHeading } from "../../../components/home/DriverHomeCards";
import { QUICK_ACTION_ROUTES } from "../../../lib/prefetch-routes";
import {
  getIncidentDeadLetters,
  retryIncidentDeadLetters,
} from "../../../lib/sync";


/**
 * Driver Home: image-backed summary and shared current/next assignment cards.
 * Lifecycle actions, offline caching and tracking remain owned by this screen.
 */
// Frozen at module load so the GPS-age caption never calls Date.now() during render.
const NOW_MS_AT_LOAD = Date.now();

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors, type } = useTheme();
  const { unreadCount } = useNotificationFeed();

  const [trips, setTrips] = useState([]);
  const [activeStatuses, setActiveStatuses] = useState([]);
  const [driverProfile, setDriverProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [actingOn, setActingOn] = useState(null);
  const [completingTrip, setCompletingTrip] = useState(null);
  const [odometerInput, setOdometerInput] = useState("");
  const [odometerError, setOdometerError] = useState(null);
  const [odometerSaving, setOdometerSaving] = useState(false);
  const [nowMs, setNowMs] = useState(NOW_MS_AT_LOAD);
  // Incident reports that permanently failed to deliver offline. Surfaced
  // globally — a driver must not have to open Activity Logs to learn that an
  // emergency report never reached dispatch.
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const [retryingDead, setRetryingDead] = useState(false);
  // Offline Read Mode: per-source server confirmation. The hero's "All clear"
  // is a claim about TRIP ASSIGNMENTS specifically, so it keys off
  // tripsSyncedAt (HOME_TRIPS) alone — a cached DRIVER_ME profile proves
  // nothing about assignments and must never green-light the claim.
  const [tripsSyncedAt, setTripsSyncedAt] = useState(null);
  const [meSyncedAt, setMeSyncedAt] = useState(null);
  const driverId = resolveDriverId(user);
  // Unstable counts as online (the amber banner speaks for it) — only a fully
  // offline verdict switches the dashboard to saved data.
  const { status } = useConnectivity();
  const offline = status === "offline";

  // Keep the GPS-age caption ticking without reading Date.now() during render.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);

  const { current: activeTrip, next: upcomingTrip, secondNext, upcoming } = selectHomeTrips(trips, activeStatuses);

  const canManageTrip = canAction(user, ACTIONS.MANAGE_TRIP);
  const canReportLocation = canAction(user, ACTIONS.REPORT_LOCATION);
  const canReportFuel = canAction(user, ACTIONS.REPORT_FUEL);

  const tracking = useTripTracking(
    canReportLocation ? activeTrip?.trip_id ?? null : null
  );

  // Weather chip: the poster's current-conditions payload for THIS trip —
  // same trip-id staleness guard as the geofence/monitor verdicts, so a
  // finished trip's weather cannot linger onto the next assignment. When
  // there is no live trip (idle, between assignments), the ambient fetch
  // takes over so the chip stays visible — null (no chip) only when there
  // is no truthful payload at all.
  const poster = usePosterStatus();
  const tripWeather =
    poster.weatherTripId != null && String(poster.weatherTripId) === String(activeTrip?.trip_id)
      ? poster.weather
      : null;
  const { chip: weatherChip } = useAmbientWeather(tripWeather);

  const load = useCallback(async () => {
    // Offline Read Mode: show last-known home data instantly (offline
    // included), then revalidate. Statuses are local constants — no fetch.
    if (driverId) {
      const [tripsC, meC] = await Promise.all([
        getCached(driverId, CACHE_KEYS.HOME_TRIPS),
        getCached(driverId, CACHE_KEYS.DRIVER_ME),
      ]);
      if (tripsC) {
        setTrips(Array.isArray(tripsC.data) ? tripsC.data : []);
        setTripsSyncedAt(tripsC.syncedAt ?? Date.now());
      }
      if (meC?.data) {
        setDriverProfile(meC.data);
        setMeSyncedAt(meC.syncedAt ?? Date.now());
      }
      try {
        setActiveStatuses(await getActiveStatuses());
      } catch {}
      if (tripsC || meC) {
        setLoading(false);
      }
    }
    // Cold-start tolerance: one automatic retry for transient failures
    // (transport blip, mid-rotation 401, 429 burst, cold 5xx) before
    // bothering the driver — this is the retry they used to tap manually.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        setError(null);
        const [data, active, me] = await Promise.all([
          api.get("/api/mobile/driver/trips"),
          getActiveStatuses(),
          api.get("/api/driver/me"),
        ]);
        const list = Array.isArray(data) ? data : [];
        setTrips(list);
        setActiveStatuses(active);
        setDriverProfile(me);
        // Display-only: refresh the cache, never treat it as authority.
        // Confirmed empty counts too — the server answered; stamp it, so the
        // hero's "All clear" claim stays honest offline.
        if (driverId) {
          await setCached(driverId, CACHE_KEYS.HOME_TRIPS, list);
          if (me) await setCached(driverId, CACHE_KEYS.DRIVER_ME, me);
        }
        setTripsSyncedAt(Date.now());
        if (me) setMeSyncedAt(Date.now());
        return;
      } catch (e) {
        if (attempt === 0 && shouldAutoRetry(e)) {
          await new Promise((r) => setTimeout(r, LIST_AUTO_RETRY_MS));
          continue;
        }
        // PR #3.1 dedup: transport failures already speak through the global
        // connectivity banner — don't double them into an inline ErrorNotice.
        // Offline with cache → it stays on screen; the badge states its age.
        // Genuine errors (auth, validation, 5xx) still surface here.
        if (!isTransportFailure(e)) setError(e.message || "Could not load your trips.");
        return;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [driverId]);

  useFocusEffect(
    useCallback(() => {
      load();
      getIncidentDeadLetters().then((list) => setDeadLetterCount(list.length)).catch(() => {});
    }, [load])
  );

  const onRetryDeadLetters = async () => {
    setRetryingDead(true);
    try {
      await retryIncidentDeadLetters();
      const list = await getIncidentDeadLetters();
      setDeadLetterCount(list.length);
    } finally {
      setRetryingDead(false);
    }
  };

  const doAction = async (trip, nextObj) => {
    setActingOn(trip.trip_id);
    try {
      const action = nextObj?.action || "start";
      const path =
        action === "accept"
          ? `/api/trips/${trip.trip_id}/accept`
          : action === "start"
            ? `/api/trips/${trip.trip_id}/start`
            : action === "at-pickup"
              ? `/api/trips/${trip.trip_id}/at-pickup`
              : action === "onboard"
                ? `/api/trips/${trip.trip_id}/onboard`
                : action === "enroute"
                  ? `/api/trips/${trip.trip_id}/enroute`
                  : action === "dropoff"
                    ? `/api/trips/${trip.trip_id}/dropoff`
                    : `/api/trips/${trip.trip_id}/start`;
      const body = action === "accept" ? { accept: true } : {};
      const res = await api.put(path, body);
      // PR #3.1: queued reached the outbox, not the server — say so.
      if (wasQueued(res)) AppAlert.alert("Saved for sync", "This update will be sent when you're online.");
      await load();
    } catch (e) {
      AppAlert.alert("Unable to Update Status", e.message || "Please check your network connection and try again.");
    } finally {
      setActingOn(null);
    }
  };

  const handleTripAction = async (trip) => {
    if (!canManageTrip) return;
    const nextObj = await getNextStatus(trip.trip_status);
    if (!nextObj || !nextObj.status) {
      AppAlert.alert("Trip Completed or Paused", "No further action is required for this trip at this time.");
      return;
    }
    if (nextObj.status === "Completed") {
      setCompletingTrip(trip);
      return;
    }
    // A pre-start trip (e.g. Assigned) that is ready in its departure window
    // must accept FIRST, then start — the start endpoint only allows the
    // one-hop Driver Accepted → Trip Started transition. getNextStatus alone
    // returns just "accept", which would leave the trip only half-way.
    const isPreStartTrip =
      trip.trip_status === "Assigned" ||
      trip.trip_status === "Pending" ||
      trip.trip_status === "Approved" ||
      trip.trip_status === "Vehicle Assigned" ||
      trip.trip_status === "Driver Assigned" ||
      trip.trip_status === "Dispatched" ||
      trip.trip_status === "Driver Accepted";
    if (isPreStartTrip && nextObj.action === "accept" && trip.pre_trip_status === "Passed") {
      setActingOn(trip.trip_id);
      try {
        const acceptRes = await api.put(`/api/trips/${trip.trip_id}/accept`, { accept: true });
        const startRes = await api.put(`/api/trips/${trip.trip_id}/start`, { odometer: Number(trip.current_mileage) || undefined });
        if (wasQueued(acceptRes) || wasQueued(startRes)) {
          AppAlert.alert("Saved for sync", "This update will be sent when you're online.");
        }
        await load();
      } catch (e) {
        AppAlert.alert("Unable to Start Trip", e.message || "Please confirm your pre-trip inspection and try again.");
      } finally {
        setActingOn(null);
      }
      return;
    }
    doAction(trip, nextObj);
  };

  const submitOdometer = async () => {
    const val = parseFloat(odometerInput);
    if (!val || isNaN(val) || val <= 0) {
      setOdometerError("Enter a valid odometer reading.");
      return;
    }
    // Guard against rolling the odometer backwards: a trip's end reading must
    // never undercut the vehicle's recorded mileage.
    const recorded = Number(completingTrip?.current_mileage);
    if (!isNaN(recorded) && recorded > 0 && val < recorded) {
      setOdometerError(`Odometer cannot be lower than the recorded ${Math.round(recorded).toLocaleString()} km.`);
      return;
    }
    try {
      setOdometerError(null);
      setOdometerSaving(true);
      const completeRes = await api.put(
        `/api/trips/${completingTrip.trip_id}/complete`,
        { end_odometer: val }
      );
      if (wasQueued(completeRes)) {
        AppAlert.alert("Saved for sync", "This update will be sent when you're online.");
      }
      setCompletingTrip(null);
      setOdometerInput("");
      await load();
    } catch (e) {
      setOdometerError(e.message || "Could not complete trip.");
    } finally {
      setOdometerSaving(false);
    }
  };

  const closeOdometerModal = () => {
    if (odometerSaving) return;
    setCompletingTrip(null);
    setOdometerInput("");
    setOdometerError(null);
  };

  // Greeting uses the first name only. firstName comes straight from
  // employees.first_name (and older sessions use `name`), so take the first
  // token rather than trusting the field to hold a single name.
  const driverName = String(user?.firstName || user?.name || "Driver").trim().split(/\s+/)[0] || "Driver";
  // GPS posting health for the active trip, shown as a subtle status chip.
  // Relative seconds are recomputed on render — the card re-renders often
  // enough (focus, polling, actions) to keep a caption honest.
  const lastSentAgeS = tracking.lastSentAt
    ? (nowMs ? Math.max(0, Math.round((nowMs - new Date(tracking.lastSentAt).getTime()) / 1000)) : 0)
    : null;
  const trackingChipText = tracking.error
    ? "Location not sending — will retry"
    : `Location updated ${lastSentAgeS}s ago`;

  const vehicleContext = resolveVehicleContext({ trips, me: driverProfile, activeStatuses });
  const vehicleRow = activeTrip?.vehicle_id === vehicleContext?.vehicleId ? activeTrip : driverProfile?.assignedVehicle;
  const assignedVehicle = driverProfile?.assignedVehicle;
  const matchingAssignment = vehicleContext && String(assignedVehicle?.vehicleId ?? assignedVehicle?.vehicle_id) === String(vehicleContext.vehicleId);
  const vehicle = vehicleContext ? { plate: vehicleContext.plate, model: vehicleRow?.vehicle_model || vehicleRow?.model, imageUri: homeVehicleImage(vehicleRow) ?? (matchingAssignment ? homeVehicleImage(assignedVehicle) : null) } : null;
  const completed = driverProfile?.performance?.total_trips;
  const shortcuts = [
    { label: 'My Schedule', icon: 'calendar', action: () => router.push('/work-schedule') },
    { label: 'Activity Log', icon: 'pulse', action: () => router.push('/submissions') },
    { label: 'Report Incident', icon: 'shield-checkmark', action: () => router.push('/incidents') },
    ...(canReportFuel ? [{ label: 'Fuel', icon: 'speedometer', action: () => router.push({ pathname: '/fuel-report', params: { tripId: activeTrip?.trip_id ? String(activeTrip.trip_id) : undefined } }) }] : []),
  ];
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      QUICK_ACTION_ROUTES.forEach((r) => { try { router.prefetch?.(r); } catch {} });
    });
    return () => task?.cancel?.();
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <DriverHomeHeader driverName={driverName}
        initial={(user?.firstName?.[0] || user?.name?.[0] || 'D').toUpperCase()}
        weather={weatherChip} unreadCount={unreadCount} topInset={insets.top}
        onProfile={() => router.push('/profile')} onNotifications={() => router.push('/notifications')} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {driverProfile?.driverStatus === "Suspended" && (
          <Pressable accessibilityRole="button" onPress={() => router.push("/profile")} style={[styles.deadBanner, { backgroundColor: colors.errorContainer }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
              <Ionicons name="alert-circle" size={24} color={colors.onErrorContainer} />
              <View style={{ flex: 1 }}>
                <Text style={[type.labelLg, { color: colors.onErrorContainer }]}>Account Suspended</Text>
                <Text style={[type.supporting, { color: colors.onErrorContainer }]}>Your driver license may be expired or missing. Tap here to upload a new license.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onErrorContainer} />
            </View>
          </Pressable>
        )}

        {/* ─── Hero / Trip Detail Panel ─── */}
        {offline && trips.length > 0 && tripsSyncedAt != null ? (
          // Saved dashboard: one note above the hero. Cached trips + a fresh
          // enough saved snapshot is data worth explaining; the global banner
          // owns the "You're offline" announcement itself.
          <View style={styles.syncNoteWrap}>
            <SyncNote syncedAt={Math.min(tripsSyncedAt ?? Infinity, meSyncedAt ?? Infinity)} label="dashboard" />
          </View>
        ) : null}
        {loading ? <SkeletonCard lines={4} /> : <DriverHeroCard
          upcoming={upcoming.length} capped={trips.length >= 50}
          completed={completed} vehicle={vehicle}
          confirmed={tripsSyncedAt != null} profileConfirmed={meSyncedAt != null}
          offline={offline} onTrips={() => router.push('/trips')}
          onHistory={() => router.push('/history')} onVehicle={() => router.push('/profile/vehicle')}
        />}

        {/* Unsent incident reports — quarantined offline, surfaced globally */}
        {deadLetterCount > 0 && (
          <Pressable
            onPress={() => router.push("/submissions")}
            accessibilityRole="button"
            accessibilityLabel={`${deadLetterCount} unsent incident report${deadLetterCount > 1 ? "s" : ""}. Tap to review.`}
            style={({ pressed }) => [
              styles.deadBanner,
              { backgroundColor: colors.errorContainer, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Ionicons name="cloud-offline" size={18} color={colors.error} />
            <View style={styles.deadBannerText}>
              <Text style={[type.label, { color: colors.onSurface }]}>
                {deadLetterCount} unsent report{deadLetterCount > 1 ? "s" : ""} — dispatch not notified
              </Text>
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                Sent while offline and could not be delivered. Tap to retry.
              </Text>
            </View>
            <Pressable
              onPress={onRetryDeadLetters}
              disabled={retryingDead}
              accessibilityRole="button"
              accessibilityLabel="Retry sending unsent reports"
              hitSlop={8}
              style={({ pressed }) => [
                styles.deadRetryBtn,
                { backgroundColor: colors.error, opacity: retryingDead ? 0.6 : pressed ? 0.9 : 1 },
              ]}
            >
              <Text style={[type.label, { color: colors.onError }]}>
                {retryingDead ? "SENDING" : "RETRY"}
              </Text>
            </Pressable>
          </Pressable>
        )}

        <HomeQuickActions actions={shortcuts} />
        {error ? <ErrorNotice message={error} onRetry={load} /> : null}
        <AssignmentsHeading onPress={() => router.push('/trips')} />
        {loading ? <><SkeletonCard lines={4} /><SkeletonCard lines={4} /></> : <>
          <DriverTripCard trip={activeTrip} current variant="current" confirmed={tripsSyncedAt != null}
            offline={offline} nowMs={nowMs} canManage={canManageTrip} busy={!!actingOn}
            trackingText={activeTrip && canReportLocation && (tracking.error || tracking.lastSentAt) ? trackingChipText : null}
            onAction={handleTripAction} onDetails={trip => router.push(`/trip/${trip.trip_id}`)} />
          <DriverTripCard trip={upcomingTrip} variant="next" confirmed={tripsSyncedAt != null}
            offline={offline} nowMs={nowMs} canManage={canManageTrip} busy={!!actingOn}
            onAction={handleTripAction} onDetails={trip => router.push(`/trip/${trip.trip_id}`)} />
          {/* No active trip and 2+ scheduled: keep the second visible too —
              the first carries NEXT TRIP, this one THEN; neither claims to be
              the current trip. Chronological (server) order is preserved. */}
          {!activeTrip && secondNext ? <DriverTripCard trip={secondNext} variant="then" confirmed={tripsSyncedAt != null}
            offline={offline} nowMs={nowMs} canManage={canManageTrip} busy={!!actingOn}
            onAction={handleTripAction} onDetails={trip => router.push(`/trip/${trip.trip_id}`)} /> : null}
        </>}

      </ScrollView>

      {/* ─── SOS FAB ─── */}
      {/* ─── Odometer Modal ─── */}
      <Modal
        visible={!!completingTrip}
        transparent
        animationType="fade"
        onRequestClose={closeOdometerModal}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.surfaceContainerHigh },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name="speedometer-outline" size={22} color={colors.primary} />
              </View>
              <Text style={[type.titleLg, styles.modalTitle, { color: colors.onSurface }]}>
                Complete Trip
              </Text>
            </View>
            <Text style={[type.bodyMd, styles.modalBody, { color: colors.onSurfaceVariant }]}>
              Enter the ending odometer reading to finalize this trip.
            </Text>
            {completingTrip?.current_mileage != null && Number(completingTrip.current_mileage) > 0 ? (
              <Text style={[type.caption, styles.modalRecorded, { color: colors.onSurfaceVariant }]} accessibilityLabel={`Recorded mileage: ${Math.round(Number(completingTrip.current_mileage)).toLocaleString()} kilometers`}>
                Recorded: {Math.round(Number(completingTrip.current_mileage)).toLocaleString()} km
              </Text>
            ) : null}
            <TextInput
              style={[
                type.bodyMd,
                styles.modalInput,
                {
                  borderColor: odometerError ? colors.error : colors.outlineVariant,
                  color: colors.onSurface,
                  backgroundColor: colors.surfaceContainerLow,
                },
              ]}
              placeholder="Odometer km"
              placeholderTextColor={colors.outline}
              keyboardType="numeric"
              value={odometerInput}
              onChangeText={setOdometerInput}
              editable={!odometerSaving}
            />
            {odometerError ? (
              <Text style={[type.caption, styles.modalError, { color: colors.error }]}>
                {odometerError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={closeOdometerModal}
                disabled={odometerSaving}
                accessibilityRole="button"
                accessibilityState={{ disabled: odometerSaving }}
                style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceContainerLow }, pressed && !odometerSaving && styles.pressed, odometerSaving && { opacity: 0.5 }]}
              >
                <Text style={[type.labelLg, styles.modalCancelText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitOdometer}
                disabled={odometerSaving}
                accessibilityRole="button"
                accessibilityState={{ disabled: odometerSaving, busy: odometerSaving }}
                style={({ pressed }) => [styles.modalConfirmBtn, { backgroundColor: colors.primary }, pressed && !odometerSaving && styles.ctaPressed, odometerSaving && { opacity: 0.6 }]}
              >
                {odometerSaving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : null}
                <Text style={[type.labelLg, styles.modalConfirmText, { color: colors.onPrimary }]}>
                  {odometerSaving ? "Completing..." : "Complete"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
root: { flex: 1 },
topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(10),
  },
iconBtn: {
    width: 48,
    height: 48,
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
  },
bellBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: moderateScale(18),
    height: moderateScale(18),
    borderRadius: moderateScale(9),
    paddingHorizontal: moderateScale(4),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
bellBadgeText: {
    fontFamily: fonts.displayBold,
    fontSize: moderateScale(10),
    lineHeight: moderateScale(13),
  },
avatar: {
    width: 48,
    height: 48,
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
avatarText: { letterSpacing: 0.5 },
pressed: { opacity: 0.75 },
scroll: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(10),
    gap: moderateScale(12),
  },
syncNoteWrap: { paddingHorizontal: moderateScale(4) },
ctaPressed: { transform: [{ scale: 0.98 }], opacity: 0.94 },
deadBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(10),
    borderRadius: moderateScale(16),
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(12),
  },
deadBannerText: { flex: 1, gap: 2 },
deadRetryBtn: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: moderateScale(12),
    borderRadius: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
  },
modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: moderateScale(24),
  },
modalCard: {
    width: "100%",
    borderRadius: moderateScale(20),
    padding: moderateScale(22),
    borderWidth: 1,
    gap: moderateScale(12),
  },
modalHeader: { flexDirection: "row", alignItems: "center", gap: moderateScale(12) },
modalIcon: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(13),
    alignItems: "center",
    justifyContent: "center",
  },
modalTitle: {},
modalBody: {},
modalRecorded: { marginTop: -moderateScale(4) },
modalInput: {
    borderWidth: 1,
    borderRadius: moderateScale(12),
    padding: moderateScale(13),
    marginTop: moderateScale(6),
  },
modalError: { marginTop: -4 },
modalActions: { flexDirection: "row", gap: moderateScale(12), marginTop: moderateScale(8) },
modalCancelBtn: {
    flex: 1,
    height: moderateScale(50),
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
modalCancelText: {},
modalConfirmBtn: {
    flex: 1,
    height: moderateScale(50),
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
modalConfirmText: {}
});
