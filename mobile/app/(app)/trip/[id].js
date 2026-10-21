import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import TripMapPreview from "../../../components/TripMapPreview";
import RouteTimeline from "../../../components/RouteTimeline";
import { api, wasQueued } from "../../../lib/api";
import { useDriverProfile } from "../../../lib/driver-profile";
import { captureCargoSession, isCurrentCargoSession } from "../../../lib/cargo-sync";
import { odometerStartRoute } from "../../../lib/trip-odometer";
import { useAuth } from "../../../lib/auth";
import { getCachedTrip, setCached, tripCacheKey, resolveDriverId } from "../../../lib/offline-cache";
import { useConnectivity } from "../../../lib/connectivity-context";
import { SyncNote, NeverSyncedCard } from "../../../components/OfflineStates";
import { tripStatusTone, TOUCH_TARGET } from "../../../lib/theme";
import { useTheme } from "../../../lib/theme-context";
import { AppAlert } from '../../../components/AppAlert';
import { detailPrimaryAction, readinessFor, completionTime, scheduledDeparture, passengerSummary } from "../../../lib/trip-detail";
import { resolveDriverWorkspace } from "../../../lib/driver-workspace";
import { workspaceModeLabel, workspaceBlockReason } from "../../../lib/cargo-view-model";
import { isCargoLoad, loadTitle, loadSubtitle, tripStatusLabel, cargoVerificationLabel } from "../../../lib/load-presentation";
import { usePreShift } from "../../../lib/use-pre-shift";
import { clayMaterials } from "../../../lib/clay";
import { ClayCard, ClayBadge, ClayButton } from "../../../components/clay";
import { CargoTripHandovers } from "../../../components/cargo/CargoTripHandovers";
import { useCoachMarkActions, useCoachMarkStatus, CoachMarkTarget } from "../../../components/coachmarks";

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
  const { triggerMilestone, dismiss } = useCoachMarkActions();
  const { activeMilestone } = useCoachMarkStatus();
  // Today's shift-wide baseline. Called here, at the top, because it is a hook
  // and the render below returns early for loading/not-found.
  const preShift = usePreShift();
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
  const { profile, serverConfirmed, reload: reloadProfile } = useDriverProfile();
  const [tripSession, setTripSession] = useState(null);
  const requestNumber = useRef(0);
  const tripConfirmed = isCurrentCargoSession(tripSession);
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

  // Lets CoachMarkTarget scroll a spotlighted control into the safe viewport
  // before measuring — without it a target below the fold measures fine but off
  // screen, and the guide would dim the page with nothing highlighted.
  const scrollRef = useRef(null);

  // Tick every 30s so the "start in X min" / START ROUTE gate refreshes.
  useEffect(() => {
    if (trip?.trip_status === "Trip Started") return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [trip?.trip_status]);

  const load = useCallback(async () => {
    const snapshot = captureCargoSession(user?.employeeId);
    if (!snapshot) return;
    const request = ++requestNumber.current;
    const current = () => request === requestNumber.current && isCurrentCargoSession(snapshot);
    setTripSession(null);
    // Reuse the newest saved copy from any schedule page or prior detail visit.
    let cachedTrip = null;
    let cachedSyncedAt = null;
    if (driverId) {
      const cached = await getCachedTrip(driverId, id);
      cachedTrip = cached?.data ?? null;
      cachedSyncedAt = cached?.syncedAt ?? null;
      if (cachedTrip && current()) {
        setTrip(cachedTrip);
        setLastSynced(cachedSyncedAt);
        setLoading(false);
      }
    }
    try {
      setLoadError(null);
      setNotFound(false);
      // Fetch this owned trip directly; list pagination must never hide details.
      const data = await api.get(`/api/mobile/driver/trips?trip_id=${encodeURIComponent(id)}`);
      if (!current()) return;
      const list = Array.isArray(data) ? data : [];
      const found = list.find((t) => String(t.trip_id) === String(id));
      if (found) {
        setTripSession(snapshot);
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
      if (current() && !cachedTrip && !offlineRef.current) {
        setLoadError(e.message || "Could not load this trip.");
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [id, driverId, user?.employeeId]);

  useEffect(() => {
    // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
    const t = setTimeout(load, 0);
    return () => { clearTimeout(t); requestNumber.current += 1; };
  }, [load]);

  const retry = () => {
    setLoading(true);
    setNotFound(false);
    setLoadError(null);
    Promise.allSettled([load(), reloadProfile()]);
  };

  const workspace = resolveDriverWorkspace({ driverType: profile?.driverType, trip });
  const canOperate = String(trip?.trip_id) === String(id) && workspace.tripReady === true && serverConfirmed && tripConfirmed && status === "online";
  const operationRef = useRef(null);
  useEffect(() => {
    operationRef.current = { profile, trip, canOperate, session: tripSession };
  }, [profile, trip, canOperate, tripSession]);
  const action = detailPrimaryAction(trip); // 'accept-start' | 'navigate' | 'closed'
  const isPreStart = action === "accept-start";
  const isTerminal = action === "closed";
  const isAccepted = trip?.trip_status === "Driver Accepted";
  const isCompleted = trip?.trip_status === "Completed";

  useEffect(() => {
    // Pre-start only. All three steps of this milestone target controls that
    // exist solely in the pre-start presentation — the readiness window, the
    // pre-trip requirement line, and the accept/start button. Firing it for an
    // underway trip spotlighted the "this trip is underway" line with copy about
    // when a trip CAN begin, then left steps 2 and 3 with no target at all: the
    // overlay hid while the milestone stayed active and could never complete.
    if (loading || !trip || isTerminal || !isPreStart || activeMilestone) return;
    // The reason tells step 3 what this button does HERE. In the pre_shift state
    // it opens the baseline check rather than starting the trip, and copy that
    // promised otherwise would be wrong in exactly the state this feature adds.
    //
    // Computed here rather than read from the `ready` object below: that object
    // is built after this function's early returns and is a fresh object on
    // every render, so it cannot be a dependency without both crashing the deps
    // array (TDZ) and re-firing this effect constantly. Its inputs are stable
    // primitives, so they are what this effect depends on — triggering once more
    // when the baseline resolves is the desired behaviour, not churn.
    const reason = readinessFor(trip, Date.now(), {
      preShiftPassed: preShift.loaded ? preShift.passed : true,
    }).unavailableReason;
    // This effect is pre-start only, so the step's isContinue branch cannot
    // originate from this call site.
    triggerMilestone("trip_readiness", { reason });
  }, [loading, trip, isTerminal, isPreStart, activeMilestone, triggerMilestone, preShift.loaded, preShift.passed]);

  // Pre-start only: the existing accept→start sequence. Active trips never
  // reach this — CONTINUE TO MAP navigates without writing status.
  const handleAcceptStart = async () => {
    if (!canOperate || resolveDriverWorkspace({ driverType: profile?.driverType, trip }).tripReady !== true) return;
    const photoRoute = odometerStartRoute(trip);
    if (photoRoute) { router.push(photoRoute); return; }
    // The guide explains how to start this trip and the driver just started it,
    // so retire it now. Accepting flips this screen out of its pre-start
    // presentation, which unmounts the controls every step targets — the overlay
    // would hide with the milestone still active. Now that a milestone cannot be
    // pre-empted, that would block every guide after it. Fire-and-forget: the
    // storage write must not delay the accept/start call.
    Promise.resolve(dismiss()).catch(() => {});
    setAccepting(true);
    try {
      let queued = false;
      if (!isAccepted) {
        const acceptRes = await api.put(`/api/trips/${id}/accept`, { accept: true }, { queueOnFailure: false, cargoActorId: user?.employeeId, signal: tripSession?.signal });
        queued = wasQueued(acceptRes);
      }
      const current = operationRef.current;
      if (!current?.canOperate || !isCurrentCargoSession(current.session) || String(current.trip?.trip_id) !== String(id) || resolveDriverWorkspace({ driverType: current.profile?.driverType, trip: current.trip }).tripReady !== true) return;
      const startRes = await api.put(`/api/trips/${id}/start`, { odometer: Number(trip?.current_mileage) || undefined }, { queueOnFailure: false, cargoActorId: user?.employeeId, signal: tripSession?.signal });
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
    } finally { setAccepting(false); }
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
      <Text style={[type.titleLg, { flexShrink: 1 }]}>{isCargoLoad(trip) ? "Cargo Assignment" : "Trip Details"}</Text>
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

  const ready = readinessFor(trip, now, {
    // An unresolved baseline must not block: `loaded` false means we do not yet
    // know (or could not find out), and readinessFor gates on what it is told.
    // Passing bare `preShift.passed` would report false while the fetch is in
    // flight and on every offline cold start, labelling a driver who already
    // did the check as still owing it.
    preShiftPassed: preShift.loaded ? preShift.passed : true,
  });

  // The primary action has three jobs now: start the trip, open the shift
  // baseline, or open this trip's pre-trip check. The two "open" states are real
  // actions, so they keep the enabled styling — only states the driver cannot
  // act on (window not open, no schedule) stay locked. A disabled button whose
  // label reads "START YOUR SHIFT" would be the worst of both.
  const ctaLabel = ready.startReady
    ? (isAccepted ? "START ROUTE" : "ACCEPT & START")
    : ready.unavailableReason === "pre_shift"
      ? "START YOUR SHIFT"
      : ready.unavailableReason === "inspection"
        ? "PRE-TRIP CHECK"
        : ready.unavailableReason === "window"
          ? `START ROUTE IN ${ready.minsToStart} MIN`
          : "START NOT YET SCHEDULED";
  const ctaNavigates =
    ready.unavailableReason === "pre_shift" || ready.unavailableReason === "inspection";
  const ctaActive = ready.startReady || ctaNavigates;
  const ctaDisabled = accepting || !ctaActive || !canOperate;

  const handlePrimary = () => {
    if (!canOperate) return;
    if (ready.unavailableReason === "pre_shift") {
      router.push({ pathname: "/inspection", params: { mode: "preshift" } });
      return;
    }
    const photoRoute = odometerStartRoute(trip);
    if (photoRoute) { router.push(photoRoute); return; }
    if (ready.unavailableReason === "inspection") {
      router.push({ pathname: "/inspection", params: { tripId: String(id) } });
      return;
    }
    handleAcceptStart();
  };
  const depMs = scheduledDeparture(trip);
  const depLabel = depMs != null
    ? new Date(depMs).toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + fmtTime(depMs)
    : null;
  const endMs = completionTime(trip);
  const pax = passengerSummary(trip);
  // Cargo rows name the consignment in kilograms — never a guest name and
  // never a "Passengers: 0" fabrication. Passenger rendering is unchanged.
  // Blocked mismatches render the STORED trip type so the driver can tell
  // Dispatch what the trip actually is; the driver-mode label lives only in
  // the workspace heading above. History/terminal rows already use stored.
  const blocked = !isTerminal && workspace.tripReady === false;
  const isCargo = isTerminal || blocked ? isCargoLoad(trip) : workspace.mode === "cargo";
  const displayTrip = isTerminal || blocked ? trip : { ...trip, load_type: profile?.driverType };
  const loadName = !isTerminal && workspace.mode === "unclassified" && !blocked ? "Driver type needs setup" : isCargo ? loadTitle(displayTrip) : pax.name || "Passenger not listed";
  const loadCount = isCargo
    ? loadSubtitle(displayTrip)
    : pax.count != null ? `${pax.count} ${pax.count === 1 ? "passenger" : "passengers"}` : "Passenger count not listed";
  const tone = tripStatusTone(trip.trip_status);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {headerBar(() => router.back())}

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {offline && lastSynced != null ? (
          // Cached trip offline: one inline note under the header — the global
          // banner owns "You're offline", this says what THIS screen shows.
          <SyncNote syncedAt={lastSynced} label="trip details" />
        ) : null}

        <Text style={[type.labelLg, { color: colors.onSurface, marginBottom: 8 }]}>{workspaceModeLabel(workspace)}</Text>
        {!isTerminal && workspace.tripReady !== true && <Text accessibilityRole="alert" style={[type.supporting, { color: colors.onSurfaceVariant, marginBottom: 16 }]}>{workspaceBlockReason(workspace)}</Text>}
        {!isTerminal && !canOperate && <ClayButton label="Refresh assignment" onPress={retry} />}
        {!isTerminal && workspace.tripReady === true && !canOperate && <Text accessibilityRole="alert" style={type.supporting}>Connect online and refresh your profile and current trip before continuing.</Text>}
        {/* Cargo uses the reference's compact assignment sheet; shared readiness
            and status actions below still own the actual start permissions. */}
        {isCargo ? (
          <ClayCard style={styles.card}>
            <View style={[styles.cardHeader, { flexWrap: "wrap", gap: 8 }]}>
              <ClayBadge text={tripStatusLabel(trip.trip_status, "Cargo")} tone={tone} />
              <Text style={[type.caption, { color: colors.primary }]}>{trip.booking_reference || `Trip #${id}`}</Text>
            </View>
            <View style={styles.cargoTitleRow}>
              <View style={[styles.cargoEmblem, { backgroundColor: colors.primary }]}>
                <Ionicons name="cube-outline" size={24} color={colors.onPrimary} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={type.cardTitle}>{loadName}</Text>
                <Text style={type.supporting}>{loadCount || "Declared weight not provided"}</Text>
              </View>
            </View>
            <RouteTimeline accent={colors.primary} stops={[
              { label: "Pickup", value: trip.origin || "Pickup not provided" },
              { label: "Delivery", value: trip.destination || "Delivery not provided" },
            ]} />
            <View style={styles.cargoFactRow}>
              <Ionicons name="time-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.caption}>SCHEDULED DEPARTURE</Text>
                <Text style={type.supporting}>{depLabel || "Not provided"}</Text>
              </View>
            </View>
            <View style={styles.cargoFactRow}>
              <Ionicons name="car-outline" size={20} color={colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.caption}>ASSIGNED VEHICLE</Text>
                <Text style={type.cardTitle}>{trip.model || "Vehicle model not provided"}</Text>
                <Text style={type.supporting}>{trip.plate_number || "Plate not provided"}</Text>
                {Number(trip.cargo_capacity_kg) > 0 ? <Text style={type.supporting}>{trip.cargo_capacity_kg} kg capacity</Text> : null}
              </View>
            </View>
            {isPreStart ? <View style={styles.cargoChecks}>
              <ClayBadge text={preShift.loaded ? preShift.passed ? "Pre-Shift ✓" : "Pre-Shift required" : "Pre-Shift unconfirmed"} tone={preShift.loaded && preShift.passed ? "success" : "neutral"} />
              <ClayBadge text={ready.preTripPassed ? "Pre-Trip ✓" : "Pre-Trip required"} tone={ready.preTripPassed ? "success" : "neutral"} />
            </View> : null}
          </ClayCard>
        ) : <ClayCard style={styles.card}>
          <View style={[styles.cardHeader, { flexWrap: "wrap", gap: 8 }]}>
            <ClayBadge
              text={String(tripStatusLabel(trip.trip_status, isTerminal || workspace.tripReady === false ? trip.load_type : profile?.driverType)).toUpperCase()}
              tone={tone}
            />
            <Text style={[type.caption, { color: colors.primary }]}>Trip #{String(id)}</Text>
          </View>
          <View>
            <Text style={[type.caption, { marginBottom: 2 }]}>Scheduled departure</Text>
            <Text style={type.cardTitle}>{depLabel || "Not provided"}</Text>
          </View>
        </ClayCard>}

        {isCargo && canOperate && !isTerminal && <ClayButton label={cargoVerificationLabel(trip)} onPress={() => router.push(`/trip/${id}/cargo`)} />}

        {isCargoLoad(trip) && <CargoTripHandovers tripId={String(id)} actorId={user?.employeeId} session={tripSession} confirmed={tripConfirmed && String(trip.trip_id) === String(id)} online={status === "online"} onRefreshTrip={retry} />}

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
                <Text style={type.caption}>END ODOMETER</Text>
                <Text style={[type.data, { color: colors.onSurface }]}>
                  {trip?.end_odometer != null && trip.end_odometer !== "" ? `${trip.end_odometer} km` : "Not recorded"}
                </Text>
              </View>
            </View>
            <View style={{ marginTop: 16, gap: 4 }}>
              <Text style={type.caption}>DISTANCE TRAVELLED</Text>
              <Text style={[type.data, { color: colors.onSurface }]}>
                {trip?.distance != null && trip.distance !== "" ? `${trip.distance} km` : "Not recorded"}
              </Text>
              {trip?.distance != null && trip.distance !== "" && (
                <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
                  {trip.distance_source === "odometer" ? "From odometer readings" : trip.distance_source === "gps-trail" ? "GPS distance" : trip.distance_source === "trip-distance" ? "Saved trip distance" : "Source not recorded"}
                </Text>
              )}
            </View>
          </ClayCard>
        ) : (
          <ClayCard style={styles.card}>
            <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={[type.label, { letterSpacing: 0.6 }]}>{isPreStart ? "START READINESS" : "TRIP IN PROGRESS"}</Text>
            </View>
            {isPreStart ? (
              ready.unavailableReason === "pre_shift" ? (
                // Baseline first, because it outranks the clock: it is the one
                // thing the driver can act on now, and the schedule is not. Both
                // step targets stay live here so the trip_readiness milestone can
                // still advance — this branch must not strand the guide.
                <>
                  <CoachMarkTarget targetId="trip.readiness" scrollRef={scrollRef}>
                    <View style={[styles.banner, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + "55" }]}>
                      <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceVariant} />
                      <Text style={[type.supporting, { flexShrink: 1 }]}>
                        {ready.earliestStart != null
                          ? `Window ${ready.windowOpen ? "is open" : `opens in ${ready.minsToStart} min`} (${fmtTime(ready.earliestStart)}).`
                          : "Start window isn't confirmed yet."}
                      </Text>
                    </View>
                  </CoachMarkTarget>
                  <CoachMarkTarget targetId="trip.pretrip_requirement" scrollRef={scrollRef}>
                    <View style={[styles.banner, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + "55" }]}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={colors.onSurfaceVariant} />
                      <Text style={[type.supporting, { flexShrink: 1 }]}>
                        Not completed today. Start your shift with the full vehicle safety check before any trip.
                      </Text>
                    </View>
                  </CoachMarkTarget>
                </>
              ) : ready.earliestStart != null ? (
                <>
                  <CoachMarkTarget targetId="trip.readiness" scrollRef={scrollRef}>
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
                  </CoachMarkTarget>
                  <CoachMarkTarget targetId="trip.pretrip_requirement" scrollRef={scrollRef}>
                    <View style={{ gap: 8 }}>
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
                          <Text style={[type.caption, { flexShrink: 1 }]}>Pre-shift and pre-trip checks must both be completed before starting.</Text>
                        </View>
                      ) : null}
                    </View>
                  </CoachMarkTarget>
                </>
              ) : (
                // No verified start window — say so instead of guessing one. Both steps
                // keep a live target so the milestone can always advance.
                <>
                  <CoachMarkTarget targetId="trip.readiness" scrollRef={scrollRef}>
                    <View style={[styles.banner, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + "55" }]}>
                      <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceVariant} />
                      <Text style={[type.supporting, { flexShrink: 1 }]}>
                        Start window isn&apos;t confirmed yet. Check with dispatch for your scheduled departure.
                      </Text>
                    </View>
                  </CoachMarkTarget>
                  <CoachMarkTarget targetId="trip.pretrip_requirement" scrollRef={scrollRef}>
                    <View style={[styles.banner, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + "55" }]}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={colors.onSurfaceVariant} />
                      <Text style={[type.supporting, { flexShrink: 1 }]}>
                        Complete the daily pre-shift check, then this trip&apos;s pre-trip check. The start button unlocks once safety is confirmed.
                      </Text>
                    </View>
                  </CoachMarkTarget>
                </>
              )
            ) : (
              /* Not a CoachMarkTarget: this is the underway branch, and
                 `trip_readiness` is a pre-start milestone — see the trigger
                 effect above. */
              <Text style={type.supporting}>
                This trip is underway. Continue to the map to track the route and progress.
              </Text>
            )}
          </ClayCard>
        )}

        {/* Route */}
        {!isCargo && <ClayCard style={styles.card}>
          <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
            <Ionicons name="navigate-outline" size={16} color={colors.primary} />
            <Text style={[type.label, { letterSpacing: 0.6 }]}>ROUTE</Text>
          </View>
          <RouteTimeline
            accent={colors.primary}
            stops={routeStops}
          />
        </ClayCard>}

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
            API has no phone field for this trip). Cargo rows name the
            consignment in kilograms instead; a missing weight renders no
            count line rather than a fabricated zero. */}
        {!isCargo && <ClayCard style={styles.card}>
          <View style={[styles.sectionHead, { borderBottomColor: colors.outlineVariant + "55" }]}>
            <Ionicons name="person-outline" size={16} color={colors.primary} />
            <Text style={[type.label, { letterSpacing: 0.6 }]}>{isCargo ? "CARGO" : "PASSENGER"}</Text>
          </View>
          <View style={styles.paxRow}>
            <Ionicons name="people-outline" size={18} color={colors.onSurfaceVariant} />
            <View style={{ flexShrink: 1 }}>
              <Text style={type.cardTitle}>{loadName}</Text>
              {loadCount != null ? (
                <Text style={type.supporting}>
                  {loadCount}
                </Text>
              ) : null}
            </View>
          </View>
        </ClayCard>}

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
          <CoachMarkTarget targetId="trip.primary_action">
            <Pressable
              style={({ pressed }) => [
                styles.cta,
                dark && { borderTopColor: "rgba(255,255,255,0.12)", borderBottomColor: "rgba(0,0,0,0.40)", shadowOpacity: 0.4 },
                mats.clayCta,
                {
                  backgroundColor: ctaActive ? colors.primary : colors.surfaceContainerHigh,
                  shadowColor: colors.shadow,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              onPress={handlePrimary}
              disabled={ctaDisabled}
              accessibilityRole="button"
              accessibilityLabel={
                ready.startReady
                  ? (isAccepted ? "Start route" : "Accept and start trip")
                  : ctaNavigates
                    ? ctaLabel
                    : "Start route not yet available"
              }
              accessibilityState={{ disabled: ctaDisabled, busy: !!accepting }}
            >
              {accepting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <>
                  <Text style={[type.labelLg, { color: ctaActive ? colors.onPrimary : colors.onSurfaceVariant, textAlign: "center", flexShrink: 1 }]}>
                    {workspace.tripReady === true ? ctaLabel : "TRIP ACTION UNAVAILABLE"}
                  </Text>
                  <Ionicons
                    name={ready.startReady ? "car-outline" : ctaNavigates ? "arrow-forward-outline" : "lock-closed-outline"}
                    size={19}
                    color={ctaActive ? colors.onPrimary : colors.onSurfaceVariant}
                  />
                </>
              )}
            </Pressable>
          </CoachMarkTarget>
        ) : (
          <CoachMarkTarget targetId="trip.primary_action">
            <Pressable
              style={({ pressed }) => [styles.cta, dark && { borderTopColor: "rgba(255,255,255,0.12)", borderBottomColor: "rgba(0,0,0,0.40)", shadowOpacity: 0.4 }, mats.clayCta, { backgroundColor: colors.primary, shadowColor: colors.shadow, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleContinue}
              disabled={accepting || workspace.tripReady !== true}
              accessibilityState={{ disabled: accepting || workspace.tripReady !== true }}
              accessibilityRole="button"
              accessibilityLabel="Continue to map"
            >
              <Text style={[type.labelLg, { color: colors.onPrimary }]}>{workspace.tripReady === true ? "CONTINUE TO MAP" : "TRIP ACTION UNAVAILABLE"}</Text>
              <Ionicons name="navigate-outline" size={19} color={colors.onPrimary} />
            </Pressable>
          </CoachMarkTarget>
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
  cargoTitleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cargoEmblem: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  cargoFactRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  cargoChecks: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
