import { moderateScale } from '../../../lib/scaling';
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl, Modal, TextInput, ActivityIndicator, Animated, Easing, Image } from 'react-native';
import LottieView from 'lottie-react-native';
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { ACTIONS, canAction } from "../../../lib/rbac";
import { useTripTracking } from "../../../lib/tracking";
import {
  getActiveStatuses,
  getNextStatus,
} from "../../../lib/tripRef";
import { AppAlert } from '../../../components/AppAlert';
import { useTheme } from "../../../lib/theme-context";
import { useNotificationFeed } from "../../../context/notification-feed";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { StatusPill, SkeletonCard, ErrorNotice, PulsingDot, CountUpText } from "../../../components/ui";
import { Plate } from "../../../components/plate";
import { onLaunchComplete } from "../../../lib/launch";
import {
  getIncidentDeadLetters,
  retryIncidentDeadLetters,
} from "../../../lib/sync";

/**
 * Dark ink for light surfaces (the white hero CTA pill) that stays legible in
 * every palette — colors.primary becomes a light tint in dark mode, so it can
 * never sit on a white pill. Matches the dark-palette onPrimary value.
 */
const ON_LIGHT_INK = "#103A30";

/**
 * Home Dashboard — premium dispatch floor.
 * Hero greeting panel, dominant active/next trip card, stat strip, quick
 * actions, and an SOS FAB. Same data + RBAC logic as the prior build; the
 * visual layer (hero gradient, floating cards, micro-motion) is upgraded.
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

  // Keep the GPS-age caption ticking without reading Date.now() during render.
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0);
    return () => clearTimeout(first);
  }, []);

  const activeTrip = trips.find((t) => activeStatuses.includes(t.trip_status));
  const pendingTrips = trips.filter((t) => !activeStatuses.includes(t.trip_status));
  const completedTrips = trips.filter((t) => t.trip_status === "Completed");

  const canManageTrip = canAction(user, ACTIONS.MANAGE_TRIP);
  const canReportLocation = canAction(user, ACTIONS.REPORT_LOCATION);
  const canReportFuel = canAction(user, ACTIONS.REPORT_FUEL);

  const tracking = useTripTracking(
    canReportLocation ? activeTrip?.trip_id ?? null : null
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const [data, active, me] = await Promise.all([
        api.get("/api/mobile/driver/trips"),
        getActiveStatuses(),
        api.get("/api/driver/me"),
      ]);
      setTrips(Array.isArray(data) ? data : []);
      setActiveStatuses(active);
      setDriverProfile(me);
    } catch (e) {
      setError(e.message || "Could not load your trips.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  // Tick so the START ROUTE gate flips when a Driver Accepted trip's departure
  // window opens. Re-renders every 30s while that trip is on the card.
  useEffect(() => {
    if (activeTrip?.trip_status !== "Driver Accepted") return;
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, [activeTrip?.trip_status]);

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
      await api.put(path, body);
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
        await api.put(`/api/trips/${trip.trip_id}/accept`, { accept: true });
        await api.put(`/api/trips/${trip.trip_id}/start`, { odometer: Number(trip.current_mileage) || undefined });
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
      await api.put(
        `/api/trips/${completingTrip.trip_id}/complete`,
        { end_odometer: val }
      );
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
    setCompletingTrip(null);
    setOdometerInput("");
    setOdometerError(null);
  };

  const driverName = user?.firstName || user?.name?.split(" ")?.[0] || "Driver";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const nextTrip = activeTrip || pendingTrips[0];

  // GPS posting health for the active trip, shown as a subtle status chip.
  // Relative seconds are recomputed on render — the card re-renders often
  // enough (focus, polling, actions) to keep a caption honest.
  const lastSentAgeS = tracking.lastSentAt
    ? (nowMs ? Math.max(0, Math.round((nowMs - new Date(tracking.lastSentAt).getTime()) / 1000)) : 0)
    : null;
  const trackingChipText = tracking.error
    ? "Location not sending — will retry"
    : `Location updated ${lastSentAgeS}s ago`;

  // Departure-window gate for the card CTA. A trip that has NOT yet STARTED
  // (still Assigned, Driver Accepted, etc.) and is not ready shows VIEW DETAILS
  // instead of START TRIP; it flips to START TRIP only when the window is
  // provably open AND the pre-trip inspection has passed. START TRIP / CONTINUE
  // TRIP for trips already in progress stays as-is.
  const isPreStart =
    ["Driver Accepted", "Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(
      nextTrip?.trip_status
    );
  const earliestStart = nextTrip?.earliest_start
    ? new Date(nextTrip.earliest_start).getTime()
    : null;
  const windowOpen = earliestStart != null && nowMs >= earliestStart;
  const startReady =
    isPreStart && windowOpen && nextTrip?.pre_trip_status === "Passed";

  // ── Section entrance motion (runs once after first load) ──
  const [heroAnim] = useState(() => new Animated.Value(0));
  const [tripAnim] = useState(() => new Animated.Value(0));
  const [statsAnim] = useState(() => new Animated.Value(0));
  const [quickAnim] = useState(() => new Animated.Value(0));
  const didIntro = useRef(false);
  const [launchComplete, setLaunchComplete] = useState(false);

  useEffect(() => {
    return onLaunchComplete(() => setLaunchComplete(true));
  }, []);

  useEffect(() => {
    if (!loading && launchComplete && !didIntro.current) {
      didIntro.current = true;
      Animated.stagger(110, [
        Animated.timing(heroAnim, { toValue: 1, duration: 460, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        Animated.timing(tripAnim, { toValue: 1, duration: 460, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        Animated.timing(statsAnim, { toValue: 1, duration: 460, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
        Animated.timing(quickAnim, { toValue: 1, duration: 460, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }),
      ]).start();
    }
  }, [loading, launchComplete, heroAnim, tripAnim, statsAnim, quickAnim]);

  const fade = (a) => ({
    opacity: a,
    transform: [
      { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
      { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
    ],
  });

  const vehicle = activeTrip || pendingTrips[0];
  const vehicleModel = vehicle?.vehicle_model || "Vehicle";
  const vehiclePlate = vehicle?.vehicle_plate;

  const todayLabel = new Date().toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  // Which day the next/active trip falls on — TODAY / TOMORROW / dated label.
  let tripDayLabel = null;
  if (nextTrip?.departure_time) {
    const dep = new Date(nextTrip.departure_time);
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const depStart = new Date(dep.getFullYear(), dep.getMonth(), dep.getDate());
    const diffDays = Math.round((depStart - todayStart) / 86400000);
    if (diffDays === 0) tripDayLabel = "Today";
    else if (diffDays === 1) tripDayLabel = "Tomorrow";
    else if (diffDays === -1) tripDayLabel = "Yesterday";
    else
      tripDayLabel = dep.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
  }

  // Number of the driver's trips scheduled for today.
  const now = new Date();
  const tripsToday = trips.filter((t) => {
    if (!t.departure_time) return false;
    const d = new Date(t.departure_time);
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }).length;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ─── Top App Bar ─── */}
      <View
        style={[
          styles.topBar,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top,
          },
        ]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: moderateScale(10) }}>
          <Pressable
            onPress={() => router.push("/profile")}
            style={({ pressed }) => [
              styles.avatar,
              {
                backgroundColor: colors.primary,
                borderColor: colors.surfaceContainerHigh,
              },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[type.labelLg, styles.avatarText, { color: colors.onPrimary }]}>
              {(user?.firstName?.[0] || user?.name?.[0] || "D").toUpperCase()}
            </Text>
          </Pressable>
          <View>
            <Text style={[type.titleLg, { color: colors.onSurface, fontSize: 16, lineHeight: 22 }]}>Hi, {driverName}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: moderateScale(14) }}>
          <Pressable
            onPress={() => router.push("/notifications")}
            style={({ pressed }) => [styles.iconBtn, { backgroundColor: colors.surfaceContainer }, pressed && styles.pressed]}
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={20} color={colors.onSurfaceVariant} />
            {unreadCount > 0 && (
              <View style={[styles.bellBadge, { backgroundColor: colors.error, borderColor: colors.surfaceContainer }]}>
                <Text style={[styles.bellBadgeText, { color: colors.onError }]}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

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
          <Pressable onPress={() => router.push("/profile")} style={[styles.suspendedBanner, { backgroundColor: colors.errorContainer, paddingTop: insets.top + 16 }]}>
            <View style={styles.suspendedBannerContent}>
              <Ionicons name="alert-circle" size={24} color={colors.onErrorContainer} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.suspendedTitle, { color: colors.onErrorContainer }]}>Account Suspended</Text>
                <Text style={[styles.suspendedDesc, { color: colors.onErrorContainer }]}>Your driver license may be expired or missing. Tap here to upload a new license.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.onErrorContainer} />
            </View>
          </Pressable>
        )}

        {/* ─── Hero / Trip Detail Panel ─── */}
        <Animated.View style={fade(heroAnim)}>
          <View style={[styles.heroShell, { borderColor: colors.primary + '35' }]}>
            <View style={[styles.hero, { backgroundColor: colors.primary }]}>
              <View style={styles.heroSpecularGleam} pointerEvents="none" />
              <View style={styles.heroCarLineContainer} pointerEvents="none">
                <View style={styles.heroAuraGlow} />
                <Image
                  source={require('../../../assets/tsts.png')}
                  style={styles.heroCarLineImage}
                  resizeMode="contain"
                />
              </View>

              <View style={styles.heroContentLayer}>
                {loading ? (
                  <>
                    <SkeletonCard lines={4} />
                    <SkeletonCard lines={2} />
                  </>
                ) : nextTrip ? (
                  <>
                    <View style={styles.heroTopRow}>
                      <Text style={[styles.heroDate, { color: `${colors.onPrimary}CC` }]}>{todayLabel}</Text>
                      <View style={[styles.statusChip, { backgroundColor: activeTrip ? `${colors.onPrimary}38` : `${colors.onPrimary}24` }]}>
                        {activeTrip ? <PulsingDot color={colors.onPrimary} size={7} /> : <View style={[styles.statusDotIdle, { backgroundColor: `${colors.onPrimary}B3` }]} />}
                        <Text style={[styles.statusChipText, { color: colors.onPrimary }]}>
                          {activeTrip ? "On trip" : "Ready"}
                        </Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: moderateScale(4) }}>
                      <Text style={[styles.heroGreeting, { fontSize: moderateScale(26), color: colors.onPrimary }]} numberOfLines={2}>
                        {activeTrip ? "Trip in progress" : (tripDayLabel ? tripDayLabel + "'s trip" : "Next trip")}
                      </Text>
                      {nextTrip.departure_time ? (
                        <Text style={[styles.heroSupport, { color: colors.onPrimary }]}>
                          {new Date(nextTrip.departure_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      ) : null}
                    </View>

                    <View style={[styles.routeViz, { marginTop: moderateScale(22) }]}>
                      <View style={[styles.routeLine, { borderColor: `${colors.onPrimary}4D` }]} />
                      <View style={styles.routeStop}>
                        <View style={[styles.routeDot, { borderColor: `${colors.onPrimary}99`, backgroundColor: `${colors.onPrimary}1A` }]}>
                          <View style={[styles.routeDotInner, { backgroundColor: `${colors.onPrimary}99` }]} />
                        </View>
                        <View style={styles.routeStopInfo}>
                          <Text style={[type.label, styles.stopType, { color: `${colors.onPrimary}B3` }]}>Pickup</Text>
                          <Text style={[type.titleMd, styles.stopName, { color: colors.onPrimary }]} numberOfLines={2}>
                            {nextTrip.origin || "Origin"}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.routeStop}>
                        <View style={[styles.routeDot, styles.routeDotDest, { borderColor: colors.onPrimary, backgroundColor: colors.onPrimary }]}>
                          <Ionicons name="flag" size={10} color={colors.primary} />
                        </View>
                        <View style={styles.routeStopInfo}>
                          <Text style={[type.label, styles.stopType, { color: `${colors.onPrimary}B3` }]}>Drop-off</Text>
                          <Text style={[type.titleMd, styles.stopName, { color: colors.onPrimary }]} numberOfLines={2}>
                            {nextTrip.destination || "Destination"}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {vehiclePlate ? (
                      <View style={styles.heroVehicle}>
                        <View style={styles.heroVehicleIcon}>
                          <Ionicons name="car-sport-outline" size={20} color={colors.onPrimary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.heroVehicleLabel, { color: `${colors.onPrimary}A6` }]}>Assigned Vehicle</Text>
                          <Text style={[styles.heroVehicleModel, { color: colors.onPrimary }]} numberOfLines={1}>{vehicleModel}</Text>
                        </View>
                        <Plate plate={vehiclePlate} />
                      </View>
                    ) : null}

                    {canManageTrip ? (
                      <Pressable
                        onPress={() => isPreStart && !startReady ? router.push(`/trip/${nextTrip.trip_id}`) : handleTripAction(nextTrip)}
                        disabled={!!actingOn}
                        style={({ pressed }) => [
                          styles.tripCta,
                          { backgroundColor: isPreStart && !startReady ? "rgba(255,255,255,0.15)" : "#FFFFFF", marginTop: moderateScale(20) },
                          pressed && styles.ctaPressed,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={activeTrip ? "Continue trip" : "Start trip"}
                      >
                        {actingOn === nextTrip.trip_id ? (
                          <ActivityIndicator color={ON_LIGHT_INK} />
                        ) : (
                          <>
                            <Text style={[type.labelLg, styles.tripCtaText, { color: isPreStart && !startReady ? colors.onPrimary : ON_LIGHT_INK }]}>
                              {isPreStart && !startReady ? "View Details" : (activeTrip ? "Continue Trip" : "Start Trip")}
                            </Text>
                            <View style={[styles.ctaIcon, { backgroundColor: isPreStart && !startReady ? `${colors.onPrimary}1A` : colors.primary + "1A" }]}>
                              <Ionicons name={isPreStart && !startReady ? "chevron-forward" : (activeTrip ? "navigate" : "play")} size={18} color={isPreStart && !startReady ? colors.onPrimary : ON_LIGHT_INK} />
                            </View>
                          </>
                        )}
                      </Pressable>
                    ) : null}

                    {/* GPS posting health — subtle caption chip, warning-toned on failure */}
                    {activeTrip && canReportLocation && (tracking.error || tracking.lastSentAt) ? (
                      <View style={[styles.trackingChip, { backgroundColor: tracking.error ? colors.errorContainer : colors.surfaceContainerHigh }]}>
                        <Ionicons
                          name={tracking.error ? "alert-circle" : "location"}
                          size={12}
                          color={tracking.error ? colors.onErrorContainer : colors.onSurfaceVariant}
                        />
                        <Text
                          style={[type.caption, { color: tracking.error ? colors.onErrorContainer : colors.onSurfaceVariant }]}
                          accessibilityLabel={`Location status. ${trackingChipText}`}
                        >
                          {trackingChipText}
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <View style={styles.heroTopRow}>
                      <Text style={[styles.heroDate, { color: `${colors.onPrimary}CC` }]}>{todayLabel}</Text>
                      <View style={[styles.statusChip, { backgroundColor: `${colors.onPrimary}24` }]}>
                        <View style={[styles.statusDotIdle, { backgroundColor: `${colors.onPrimary}B3` }]} />
                        <Text style={[styles.statusChipText, { color: colors.onPrimary }]}>Ready</Text>
                      </View>
                    </View>
                    <Text style={[styles.heroGreeting, { color: colors.onPrimary }]}>All clear</Text>
                    <Text style={[styles.heroSupport, { color: colors.onPrimary }]}>
                      You are ready for new assignments.
                    </Text>
                  </>
                )}
              </View>
            </View>
          </View>
        </Animated.View>

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

        <Animated.View style={fade(heroAnim)}>
            <View style={[styles.quickCard, { backgroundColor: colors.surface, borderColor: colors.surfaceContainerHigh }]}>
              <View style={styles.quickGrid}>
                <Pressable
                  onPress={() => router.push("/work-schedule")}
                  style={({ pressed }) => [styles.quickBtn, pressed && styles.quickPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Open work schedule and leave requests"
                >
                  <View style={styles.quickIconWrapper}>
                    <Ionicons name="calendar" size={24} color={colors.primary} />
                  </View>
                  <Text style={[type.label, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                    Schedule
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => router.push("/incidents")}
                  style={({ pressed }) => [styles.quickBtn, pressed && styles.quickPressed]}
                >
                  <View style={styles.quickIconWrapper}>
                    <Ionicons name="warning" size={24} color={colors.primary} />
                  </View>
                  <Text style={[type.label, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                    Report
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => router.push("/submissions")}
                  style={({ pressed }) => [styles.quickBtn, pressed && styles.quickPressed]}
                >
                  <View style={styles.quickIconWrapper}>
                    <Ionicons name="document-text" size={24} color={colors.primary} />
                  </View>
                  <Text style={[type.label, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                    Forms
                  </Text>
                </Pressable>

                {canReportFuel ? (
                  <Pressable
                    onPress={() => router.push({ pathname: "/fuel-report", params: { tripId: activeTrip?.trip_id ? String(activeTrip.trip_id) : undefined } })}
                    style={({ pressed }) => [styles.quickBtn, pressed && styles.quickPressed]}
                  >
                    <View style={styles.quickIconWrapper}>
                      <Ionicons name="water" size={24} color={colors.primary} />
                    </View>
                    <Text style={[type.label, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                      Fuel
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
        </Animated.View>

        {error ? <ErrorNotice message={error} onRetry={load} /> : null}

        {/* ─── Stats Strip (KPI Fleet Overview) ─── */}
        <Animated.View style={fade(statsAnim)}>
          <View style={styles.statsGrid}>
            {/* Trips Today KPI Card with Bottom-Left Route / Car Line Art */}
            <View style={[styles.statCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainerHigh }]}>
              <View style={styles.statTopRow}>
                <View style={[styles.statIcon, { backgroundColor: colors.primaryContainer }]}>
                  <Ionicons name="car-sport" size={16} color={colors.onPrimaryContainer} />
                </View>
                <View style={[styles.statLiveBadge, { backgroundColor: colors.primary + '14', borderColor: colors.primary + '30' }]}>
                  <View style={[styles.statLiveDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.statLiveText, { color: colors.primary }]}>DISPATCH</Text>
                </View>
              </View>

              <View style={styles.statDataBlock}>
                <CountUpText value={trips.length} style={[type.displayLg, styles.statNumber, { color: colors.onSurface }]} />
                <Text style={[type.label, styles.statLabel, { color: colors.onSurfaceVariant }]}>Trips Today</Text>
              </View>

              {/* Bottom-left Car Line Illustration overlay inspired by live tracking trajectory */}
              <View style={styles.carLineContainer} pointerEvents="none">
                <Image
                  source={require('../../../assets/car line.png')}
                  style={[
                    styles.carLineImage,
                    { tintColor: colors.primary, opacity: 0.85 }
                  ]}
                  resizeMode="contain"
                />
              </View>
            </View>

            {/* Completed KPI Card */}
            <View style={[styles.statCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainerHigh }]}>
              <View style={styles.statTopRow}>
                <View style={[styles.statIcon, { backgroundColor: colors.secondaryContainer }]}>
                  <Ionicons name="checkmark-done" size={16} color={colors.onSecondaryContainer} />
                </View>
                <View style={[styles.statLiveBadge, { backgroundColor: colors.secondary + '14', borderColor: colors.secondary + '30' }]}>
                  <Text style={[styles.statLiveText, { color: colors.secondary }]}>ARCHIVED</Text>
                </View>
              </View>

              <View style={styles.statDataBlock}>
                <CountUpText value={completedTrips.length} style={[type.displayLg, styles.statNumber, { color: colors.secondary }]} />
                <Text style={[type.label, styles.statLabel, { color: colors.onSurfaceVariant }]}>Completed</Text>
              </View>

              {/* Subtle accent corner track curve */}
              <View style={[styles.carLineContainer, styles.carLineCompleted]} pointerEvents="none">
                <Image
                  source={require('../../../assets/car line.png')}
                  style={[
                    styles.carLineImage,
                    { tintColor: colors.secondary, opacity: 0.35 }
                  ]}
                  resizeMode="contain"
                />
              </View>
            </View>
          </View>
        </Animated.View>


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

  // ── Top bar ──
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(10),
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(10) },
  brandMark: {
    width: moderateScale(26),
    height: moderateScale(26),
    borderRadius: moderateScale(9),
    alignItems: "center",
    justifyContent: "center",
  },
  brandMarkInner: {
    width: moderateScale(10),
    height: moderateScale(10),
    borderRadius: moderateScale(3),
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  topBarTitle: { letterSpacing: -0.5 },
  iconBtn: {
    width: moderateScale(38),
    height: moderateScale(38),
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
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  avatarText: { letterSpacing: 0.5 },
  pressed: { opacity: 0.75 },

  // ── Scroll ──
  scroll: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(14),
    gap: moderateScale(18),
  },

  // ── Hero (Double-Bezel Hardware Architecture) ──
  heroShell: {
    borderRadius: moderateScale(26),
    padding: moderateScale(2),
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  hero: {
    borderRadius: moderateScale(24),
    padding: moderateScale(22),
    overflow: "hidden",
    position: "relative",
  },
  heroSpecularGleam: {
    position: "absolute",
    top: 0,
    left: moderateScale(20),
    right: moderateScale(20),
    height: 1,
    backgroundColor: "rgba(255,255,255,0.35)",
    zIndex: 3,
  },
  heroAuraGlow: {
    position: "absolute",
    right: moderateScale(25),
    top: moderateScale(10),
    width: moderateScale(150),
    height: moderateScale(140),
    borderRadius: moderateScale(75),
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  heroCarLineContainer: {
    position: "absolute",
    right: moderateScale(8),
    top: moderateScale(8),
    width: moderateScale(185),
    height: moderateScale(120),
    opacity: 0.48,
    zIndex: 0,
  },
  heroCarLineImage: {
    width: "100%",
    height: "100%",
    tintColor: "#FFFFFF",
  },
  heroContentLayer: {
    zIndex: 2,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: moderateScale(14),
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(5),
    borderRadius: 999,
  },
  statusChipText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  statusDotIdle: {
    width: moderateScale(7),
    height: moderateScale(7),
    borderRadius: moderateScale(4),
  },
  heroGreeting: {
    fontFamily: fonts.displayBold,
    fontSize: moderateScale(30),
    lineHeight: moderateScale(38),
    letterSpacing: -0.5,
  },
  heroDate: {
    fontFamily: fonts.bodyMedium,
    fontSize: moderateScale(14),
  },
  heroSupport: {
    fontFamily: fonts.body,
    fontSize: moderateScale(14),
    lineHeight: moderateScale(21),
    marginTop: moderateScale(4),
  },
  heroVehicle: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    marginTop: moderateScale(18),
    paddingTop: moderateScale(14),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.22)",
    zIndex: 2,
  },
  heroVehicleIcon: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  heroVehicleLabel: {
    fontFamily: fonts.data,
    fontSize: 10,
    letterSpacing: 1,
  },
  heroVehicleModel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(15),
    marginTop: 1,
  },

  // ── Trip card ──
  tripCard: {
    borderRadius: moderateScale(20),
    borderWidth: 1,
    padding: moderateScale(18),
    gap: moderateScale(14),
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  tripHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tripHeaderLeft: { flexDirection: "row", alignItems: "center" },
  dayStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(10),
    borderRadius: moderateScale(14),
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(10),
  },
  dayStripIcon: {
    width: moderateScale(28),
    height: moderateScale(28),
    borderRadius: moderateScale(9),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  dayStripText: { flex: 1, letterSpacing: 0.3, fontSize: moderateScale(15) },
  dayStripCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(5),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(5),
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  dayStripCountText: {
    fontFamily: fonts.dataSemiBold,
    fontSize: moderateScale(12),
    letterSpacing: 0.3,
  },
  tripBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(7),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(6),
    borderRadius: 999,
  },
  tripBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  tripBadgeText: { letterSpacing: 0.3 },
  timePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(7),
    borderRadius: 999,
  },
  timePillText: {
    fontFamily: fonts.dataSemiBold,
    fontSize: moderateScale(14),
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.5,
  },
  routeViz: {
    gap: moderateScale(22),
    marginLeft: moderateScale(4),
    position: "relative",
  },
  routeLine: {
    position: "absolute",
    left: moderateScale(11),
    top: moderateScale(20),
    bottom: moderateScale(20),
    width: 0,
    borderLeftWidth: 2,
    borderStyle: "dashed",
  },
  routeStop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(16),
    position: "relative",
    zIndex: 1,
  },
  routeDot: {
    width: moderateScale(26),
    height: moderateScale(26),
    borderRadius: moderateScale(13),
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: moderateScale(2),
  },
  routeDotDest: { borderWidth: 0 },
  routeDotInner: {
    width: moderateScale(9),
    height: moderateScale(9),
    borderRadius: moderateScale(5),
  },
  routeStopInfo: { flex: 1, paddingTop: moderateScale(2) },
  stopType: { marginBottom: moderateScale(1) },
  stopName: { marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth },
  guestRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(12) },
  guestAvatar: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  guestLabel: {},
  guestName: {},
  mapBtn: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
  },
  tripCta: {
    height: moderateScale(56),
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(10),
    paddingHorizontal: moderateScale(18),
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  ctaPressed: { transform: [{ scale: 0.98 }], opacity: 0.94 },
  tripCtaText: { letterSpacing: 0.2, flexShrink: 1 },
  trackingChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: moderateScale(6),
    marginTop: moderateScale(10),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(4),
    borderRadius: 999,
  },
  ctaIcon: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── Empty ──
  emptyCard: {
    borderRadius: moderateScale(20),
    borderWidth: 1,
    padding: moderateScale(30),
    alignItems: "center",
    gap: moderateScale(10),
  },
  emptyMark: {
    width: moderateScale(56),
    height: moderateScale(56),
    borderRadius: moderateScale(18),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(2),
  },
  emptyTitle: { lineHeight: moderateScale(28), textAlign: "center", includeFontPadding: false },
  emptyBody: { textAlign: "center" },

  // ── Stats (KPI Cards with Trajectory Art) ──
  statsGrid: { flexDirection: "row", gap: moderateScale(14) },
  statCard: {
    flex: 1,
    borderRadius: moderateScale(20),
    borderWidth: 1,
    padding: moderateScale(16),
    flexDirection: "column",
    alignItems: "flex-start",
    position: "relative",
    overflow: "hidden",
    minHeight: moderateScale(140),
    justifyContent: "space-between",
  },
  statTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    zIndex: 2,
  },
  statIcon: {
    width: moderateScale(32),
    height: moderateScale(32),
    borderRadius: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
  },
  statLiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(4),
    paddingHorizontal: moderateScale(7),
    paddingVertical: moderateScale(3),
    borderRadius: moderateScale(6),
    borderWidth: 1,
  },
  statLiveDot: {
    width: moderateScale(5),
    height: moderateScale(5),
    borderRadius: moderateScale(2.5),
  },
  statLiveText: {
    fontFamily: fonts.dataSemiBold,
    fontSize: moderateScale(9),
    letterSpacing: 0.6,
  },
  statDataBlock: {
    zIndex: 2,
    marginTop: moderateScale(8),
  },
  statNumber: {
    letterSpacing: -1,
    fontSize: moderateScale(32),
    lineHeight: moderateScale(36),
  },
  statLabel: {
    marginTop: moderateScale(2),
    fontFamily: fonts.bodyMedium,
    fontSize: moderateScale(12),
  },
  carLineContainer: {
    position: "absolute",
    left: moderateScale(-8),
    bottom: moderateScale(-6),
    width: moderateScale(130),
    height: moderateScale(65),
    zIndex: 1,
  },
  carLineCompleted: {
    right: moderateScale(-14),
    left: undefined,
    transform: [{ scaleX: -1 }],
  },
  carLineImage: {
    width: "100%",
    height: "100%",
  },

  // ── Quick actions ──
  quickActions: { gap: moderateScale(12) },
  scheduleAction: {
    minHeight: moderateScale(76),
    borderRadius: moderateScale(18),
    padding: moderateScale(12),
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
  },
  scheduleIcon: {
    width: moderateScale(46),
    height: moderateScale(46),
    borderRadius: moderateScale(14),
    alignItems: "center",
    justifyContent: "center",
  },
  scheduleCopy: { flex: 1, gap: moderateScale(3) },
  scheduleTitle: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(14) },
  scheduleMeta: { fontFamily: fonts.body, fontSize: moderateScale(11) },
  scheduleArrow: {
    width: moderateScale(32),
    height: moderateScale(32),
    borderRadius: moderateScale(16),
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {},
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
    minHeight: TOUCH_TARGET - 10,
    paddingHorizontal: moderateScale(12),
    borderRadius: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
  },
  quickCard: {
    borderRadius: moderateScale(20),
    borderWidth: 1,
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(8),
  },
  quickGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  quickBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    gap: moderateScale(6),
  },
  quickPressed: { transform: [{ scale: 0.97 }], opacity: 0.88 },
  quickIconWrapper: {
    width: moderateScale(40),
    height: moderateScale(40),
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtnText: {
    fontSize: moderateScale(11),
    textAlign: "center",
  },

  // ── SOS FAB ──
  // ── Modal ──
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
  modalConfirmText: {},
});
