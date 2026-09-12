import { moderateScale } from '../../../lib/scaling';
import { useCallback, useEffect, useMemo, useState, memo } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl, Modal, TextInput, ActivityIndicator, InteractionManager } from 'react-native';
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
import { usePosterStatus } from "../../../lib/tracking";
import { useAmbientWeather } from "../../../lib/ambient-weather";
import DriverHomeHeader from "../../../components/home/DriverHomeHeader";
import {
  getActiveStatuses,
  getNextStatus,
} from "../../../lib/tripRef";
import { AppAlert } from '../../../components/AppAlert';
import { useTheme } from "../../../lib/theme-context";
import { useNotificationFeed } from "../../../context/notification-feed";
import { TOUCH_TARGET } from "../../../lib/theme";
import { SkeletonCard, ErrorNotice } from "../../../components/ui";
import { selectHomeTrips, homeVehicleImage, HOME_UPCOMING_LIMIT } from "../../../lib/home-trips";
import { resolveVehicleContext } from "../../../lib/driver-context";
import { DriverHeroCard, HomeQuickActions, DriverTripCard, AssignmentsHeading } from "../../../components/home/DriverHomeCards";
import {
  getIncidentDeadLetters,
  retryIncidentDeadLetters,
} from "../../../lib/sync";
import { QUICK_ACTION_ROUTES } from "../../../lib/prefetch-routes";
import { shouldRevalidateHome } from "../../../lib/home-revalidate";


/**
 * Driver Home: image-backed summary and shared current/next assignment cards.
 * Lifecycle actions, offline caching and tracking remain owned by this screen.
 */

// Populated-state upcoming list (own component so Home's manual memos keep
// compiling under the strict preserve-manual-memoization rule): first card
// NEXT TRIP, the rest UPCOMING, plus a "+N more" footer reusing the same
// /trips destination as the section heading.
const UpcomingTripList = memo(function UpcomingTripList({ trips, extra, confirmed, offline, nowMs, canManage, busy, onAction, onDetails, onMore }) {
  const { colors, type } = useTheme();
  return <>
    {trips.map((trip, i) => <DriverTripCard key={trip.trip_id} trip={trip} variant={i === 0 ? 'next' : 'upcoming'} confirmed={confirmed}
      offline={offline} nowMs={nowMs} canManage={canManage} busy={busy}
      onAction={onAction} onDetails={onDetails} />)}
    {extra > 0 ? <Pressable onPress={onMore} accessibilityRole="button" accessibilityLabel={`Show ${extra} more trips in full schedule`}
      style={({ pressed }) => [{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, pressed && { opacity: 0.72 }]}>
      <Text style={[type.labelLg, { color: colors.primary }]}>+{extra} more · View Full Schedule</Text>
      <Ionicons name="chevron-forward" color={colors.primary} size={16} />
    </Pressable> : null}
  </>;
});

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
  const [nowMs, setNowMs] = useState(Date.now);
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

  // Keep the GPS-age caption ticking on a calm 30s cadence without an immediate mount duplicate render.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const { current: activeTrip, upcoming } = selectHomeTrips(trips, activeStatuses);
  const visibleUpcoming = upcoming.slice(0, HOME_UPCOMING_LIMIT);
  const hiddenUpcomingCount = Math.max(0, upcoming.length - HOME_UPCOMING_LIMIT);

  const canManageTrip = canAction(user, ACTIONS.MANAGE_TRIP);
  const canReportLocation = canAction(user, ACTIONS.REPORT_LOCATION);
  const canReportFuel = canAction(user, ACTIONS.REPORT_FUEL);

  // Weather chip and tracking status: consumes the layout poster's pub/sub
  // without mounting a redundant continuous Location watcher.
  const poster = usePosterStatus();
  const tripWeather =
    poster.weatherTripId != null && String(poster.weatherTripId) === String(activeTrip?.trip_id)
      ? poster.weather
      : null;
  const { chip: rawWeatherChip } = useAmbientWeather(tripWeather);
  // Stable chip identity: the hook builds a fresh object per call, which
  // would defeat the header memo below on every parent render.
  const weatherChip = useMemo(
    () => rawWeatherChip,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field-wise identity; the object itself is always new
    [rawWeatherChip?.icon, rawWeatherChip?.temperature, rawWeatherChip?.label]
  );

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
      if (!shouldRevalidateHome(tripsSyncedAt)) {
        getIncidentDeadLetters().then((list) => setDeadLetterCount(list.length)).catch(() => {});
        return;
      }
      const task = InteractionManager.runAfterInteractions(() => {
        load();
      });
      getIncidentDeadLetters().then((list) => setDeadLetterCount(list.length)).catch(() => {});
      return () => task?.cancel?.();
    }, [load, tripsSyncedAt])
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

  const doAction = useCallback(async (trip, nextObj) => {
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
  }, [load]);

  const handleTripAction = useCallback(async (trip) => {
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
  }, [canManageTrip, doAction, load]);

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
  // GPS posting health for the active trip, shown as a subtle status chip.
  // Consumes the layout poster's pub/sub directly without a duplicate watcher.
  const lastSentAgeS = poster.lastSentAt
    ? (nowMs ? Math.max(0, Math.round((nowMs - new Date(poster.lastSentAt).getTime()) / 1000)) : 0)
    : null;
  const trackingChipText = poster.error
    ? "Location not sending — will retry"
    : `Location updated ${lastSentAgeS}s ago`;

  const vehicleContext = resolveVehicleContext({ trips, me: driverProfile, activeStatuses });
  const vehicleRow = activeTrip?.vehicle_id === vehicleContext?.vehicleId ? activeTrip : driverProfile?.assignedVehicle;
  const assignedVehicle = driverProfile?.assignedVehicle;
  const matchingAssignment = vehicleContext && String(assignedVehicle?.vehicleId ?? assignedVehicle?.vehicle_id) === String(vehicleContext.vehicleId);
  // Stable identities for the memoized hero: without these every tick mints
  // a fresh vehicle literal + closures and the memo never hits.
  const vehicle = useMemo(() => (
    vehicleContext
      ? { plate: vehicleContext.plate, model: vehicleRow?.vehicle_model || vehicleRow?.model, imageUri: homeVehicleImage(vehicleRow) ?? (matchingAssignment ? homeVehicleImage(assignedVehicle) : null) }
      : null
  // eslint-disable-next-line react-hooks/exhaustive-deps -- vehicleContext/rows are stable across ticks; recompute only when the underlying rows change
  ), [vehicleContext?.vehicleId, vehicleContext?.plate, vehicleRow, assignedVehicle, matchingAssignment]);
  const completed = driverProfile?.performance?.total_trips;
  const goProfile = useCallback(() => router.push('/profile'), [router]);
  const goNotifications = useCallback(() => router.push('/notifications'), [router]);
  const goTrips = useCallback(() => router.push('/trips'), [router]);
  const goHistory = useCallback(() => router.push('/history'), [router]);
  const goVehicle = useCallback(() => router.push('/profile/vehicle'), [router]);
  const goDetails = useCallback((trip) => router.push(`/trip/${trip.trip_id}`), [router]);
  const goSchedule = useCallback(() => router.push('/work-schedule'), [router]);
  const goSubmissions = useCallback(() => router.push('/submissions'), [router]);
  const goIncidents = useCallback(() => router.push('/incidents'), [router]);
  const goFuelReport = useCallback(
    () => router.push({ pathname: '/fuel-report', params: { tripId: activeTrip?.trip_id ? String(activeTrip.trip_id) : undefined } }),
    [router, activeTrip]
  );
  const shortcuts = useMemo(() => [
    { label: 'My Schedule', icon: 'calendar', action: goSchedule },
    { label: 'Activity Log', icon: 'pulse', action: goSubmissions },
    { label: 'Report Incident', icon: 'shield-checkmark', action: goIncidents },
    ...(canReportFuel ? [{ label: 'Fuel', icon: 'speedometer', action: goFuelReport }] : []),
  ], [goSchedule, goSubmissions, goIncidents, goFuelReport, canReportFuel]);

  // Prefetch quick-action destination bundles while Home is idle
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      QUICK_ACTION_ROUTES.forEach((r) => {
        try {
          router.prefetch?.(r);
        } catch {}
      });
    });
    return () => task?.cancel?.();
  }, [router]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <DriverHomeHeader driverName={driverName}
        initial={(user?.firstName?.[0] || user?.name?.[0] || 'D').toUpperCase()}
        weather={weatherChip} unreadCount={unreadCount} topInset={insets.top}
        onProfile={goProfile} onNotifications={goNotifications} />

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
          onTrips={goTrips}
          onHistory={goHistory} onVehicle={goVehicle}
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
        {loading ? <><SkeletonCard lines={4} /><SkeletonCard lines={4} /></> : (!activeTrip && upcoming.length === 0 ? <>
          {/* Preserved empty state — intentionally unchanged: heading, null
              cards, and all confirmed/offline/not-synced copy stay exactly as
              they were. Dynamic layout below only runs with trip data. */}
          <AssignmentsHeading onPress={goTrips} />
          <DriverTripCard trip={activeTrip} current variant="current" confirmed={tripsSyncedAt != null}
            offline={offline} nowMs={nowMs} canManage={canManageTrip} busy={!!actingOn}
            trackingText={activeTrip && canReportLocation && (poster.error || poster.lastSentAt) ? trackingChipText : null}
            onAction={handleTripAction} onDetails={goDetails} />
          <DriverTripCard trip={upcoming[0] ?? null} variant="next" confirmed={tripsSyncedAt != null}
            offline={offline} nowMs={nowMs} canManage={canManageTrip} busy={!!actingOn}
            onAction={handleTripAction} onDetails={goDetails} />
        </> : <>
          {activeTrip ? <DriverTripCard trip={activeTrip} current variant="current" confirmed={tripsSyncedAt != null}
            offline={offline} nowMs={nowMs} canManage={canManageTrip} busy={!!actingOn}
            trackingText={activeTrip && canReportLocation && (poster.error || poster.lastSentAt) ? trackingChipText : null}
            onAction={handleTripAction} onDetails={goDetails} /> : null}
          <AssignmentsHeading onPress={goTrips} title="Upcoming Trips" />
          <UpcomingTripList trips={visibleUpcoming} extra={hiddenUpcomingCount} confirmed={tripsSyncedAt != null}
            offline={offline} nowMs={nowMs} canManage={canManageTrip} busy={!!actingOn}
            onAction={handleTripAction} onDetails={goDetails} onMore={goTrips} />
        </>)}

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
