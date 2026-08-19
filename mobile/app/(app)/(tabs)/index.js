import { moderateScale } from '../../../lib/scaling';
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl, Modal, TextInput, Linking, ActivityIndicator, Animated, Easing,  } from 'react-native';
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

/**
 * Home Dashboard — premium dispatch floor.
 * Hero greeting panel, dominant active/next trip card, stat strip, quick
 * actions, and an SOS FAB. Same data + RBAC logic as the prior build; the
 * visual layer (hero gradient, floating cards, micro-motion) is upgraded.
 */
export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors, type } = useTheme();
  const { unreadCount } = useNotificationFeed();

  const [trips, setTrips] = useState([]);
  const [activeStatuses, setActiveStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [actingOn, setActingOn] = useState(null);
  const [completingTrip, setCompletingTrip] = useState(null);
  const [odometerInput, setOdometerInput] = useState("");
  const [odometerError, setOdometerError] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());

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
      const [data, active] = await Promise.all([
        api.get("/api/mobile/driver/trips"),
        getActiveStatuses(),
      ]);
      setTrips(Array.isArray(data) ? data : []);
      setActiveStatuses(active);
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
    }, [load])
  );

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
      AppAlert.alert("Error", e.message || "Action failed.");
    } finally {
      setActingOn(null);
    }
  };

  const handleTripAction = async (trip) => {
    if (!canManageTrip) return;
    const nextObj = await getNextStatus(trip.trip_status);
    if (!nextObj || !nextObj.status) {
      AppAlert.alert("No action available", "This trip cannot be progressed further.");
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
        AppAlert.alert("Error", e.message || "Could not start trip.");
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
    try {
      setOdometerError(null);
      await api.put(
        `/api/trips/${completingTrip.trip_id}/complete`,
        { end_odometer: val }
      );
      setCompletingTrip(null);
      setOdometerInput("");
      await load();
    } catch (e) {
      setOdometerError(e.message || "Could not complete trip.");
    }
  };

  const openMap = (trip) => {
    const lat = trip.destination_latitude;
    const lng = trip.destination_longitude;
    if (lat && lng) {
      Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
    }
  };

  const driverName = user?.firstName || user?.name?.split(" ")?.[0] || "Driver";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const nextTrip = activeTrip || pendingTrips[0];

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
  const heroAnim = useRef(new Animated.Value(0)).current;
  const tripAnim = useRef(new Animated.Value(0)).current;
  const statsAnim = useRef(new Animated.Value(0)).current;
  const quickAnim = useRef(new Animated.Value(0)).current;
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
        <View style={styles.brandRow}>
          <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
            <View style={styles.brandMarkInner} />
          </View>
          <Text style={[type.headlineMd, styles.topBarTitle, { color: colors.onBackground }]}>
            FleetOps
          </Text>
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
            <Text style={[type.labelLg, styles.avatarText, { color: "#FFFFFF" }]}>
              {(user?.firstName?.[0] || user?.name?.[0] || "D").toUpperCase()}
            </Text>
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
        {/* ─── Hero Greeting Panel ─── */}
        <Animated.View style={fade(heroAnim)}>
          <View style={[styles.hero, { backgroundColor: colors.primary }]}>
            <View style={styles.heroTopRow}>
              <Text style={styles.heroDate}>{todayLabel}</Text>
              <View style={[styles.statusChip, { backgroundColor: activeTrip ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.10)" }]}>
                {activeTrip ? <PulsingDot color="#FFFFFF" size={7} /> : <View style={styles.statusDotIdle} />}
                <Text style={styles.statusChipText}>
                        {activeTrip ? "On trip" : "Ready"}
                </Text>
              </View>
            </View>

            <Text style={styles.heroGreeting}>{greeting}, {driverName}</Text>
            <Text style={styles.heroSupport}>
              {activeTrip
                ? "Your active trip is ready below."
                : nextTrip
                  ? "Your next assignment is ready below."
                  : "You are ready for new assignments."}
            </Text>

            {vehiclePlate ? (
              <View style={styles.heroVehicle}>
                <View style={styles.heroVehicleIcon}>
                  <Ionicons name="car-sport-outline" size={20} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroVehicleLabel}>Assigned Vehicle</Text>
                  <Text style={styles.heroVehicleModel} numberOfLines={1}>{vehicleModel}</Text>
                </View>
                <Plate plate={vehiclePlate} />
              </View>
            ) : null}
          </View>
        </Animated.View>

        {error ? <ErrorNotice message={error} onRetry={load} /> : null}

        {/* ─── Trip Card / Empty ─── */}
        <Animated.View style={fade(tripAnim)}>
          {loading ? (
            <>
              <SkeletonCard lines={4} />
              <SkeletonCard lines={2} />
            </>
          ) : nextTrip ? (
            <View
              style={[
                styles.tripCard,
                {
                  backgroundColor: colors.surfaceContainerLow,
                  borderColor: colors.surfaceContainerHigh,
                },
              ]}
            >
              {/* Day strip — prominent, directly above the trip badge */}
              {tripDayLabel ? (
                <View style={[styles.dayStrip, { backgroundColor: colors.primary }]}>
                  <View style={styles.dayStripIcon}>
                    <Ionicons name="calendar-outline" size={16} color="#FFFFFF" />
                  </View>
                  <Text style={[type.labelLg, styles.dayStripText, { color: "#FFFFFF" }]}>
                    {activeTrip
                      ? "Trip in progress"
                      : tripDayLabel === "Today"
                        ? "Today's trip"
                        : tripDayLabel === "Tomorrow"
                          ? "Tomorrow's trip"
                          : tripDayLabel}
                  </Text>
                  {tripsToday > 0 ? (
                    <View style={styles.dayStripCount}>
                      <Ionicons name="car-outline" size={13} color="#FFFFFF" />
                      <Text style={[styles.dayStripCountText, { color: "#FFFFFF" }]}>
                        {tripsToday} {tripsToday === 1 ? "trip" : "trips"} today
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Header */}
              <View style={styles.tripHeader}>
                <View style={styles.tripHeaderLeft}>
                  <View
                    style={[
                      styles.tripBadge,
                      { backgroundColor: activeTrip ? colors.secondaryContainer : colors.surfaceContainerHigh },
                    ]}
                  >
                    {activeTrip ? (
                      <PulsingDot color={colors.onSecondaryContainer} size={6} />
                    ) : (
                      <View style={[styles.tripBadgeDot, { backgroundColor: colors.outline }]} />
                    )}
                    <Text
                      style={[
                        type.labelLg,
                        styles.tripBadgeText,
                        { color: activeTrip ? colors.onSecondaryContainer : colors.onSurfaceVariant },
                      ]}
                    >
                      {activeTrip ? "Active Trip" : "Next Trip"}
                    </Text>
                  </View>
                </View>
                {nextTrip.departure_time ? (
                  <View style={[styles.timePill, { backgroundColor: colors.surfaceContainerHigh }]}>
                    <Ionicons name="time-outline" size={14} color={colors.primary} />
                    <Text style={[styles.timePillText, { color: colors.onSurface }]}>
                      {new Date(nextTrip.departure_time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Route */}
              <View style={styles.routeViz}>
                <View style={[styles.routeLine, { borderColor: colors.outlineVariant }]} />

                <View style={styles.routeStop}>
                  <View style={[styles.routeDot, { borderColor: colors.outline, backgroundColor: colors.surfaceContainerLowest }]}>
                    <View style={[styles.routeDotInner, { backgroundColor: colors.outline }]} />
                  </View>
                  <View style={styles.routeStopInfo}>
                    <Text style={[type.label, styles.stopType, { color: colors.onSurfaceVariant }]}>Pickup</Text>
                    <Text style={[type.titleMd, styles.stopName, { color: colors.onSurface }]} numberOfLines={2}>
                      {nextTrip.origin || "Origin"}
                    </Text>
                  </View>
                </View>

                <View style={styles.routeStop}>
                  <View style={[styles.routeDot, styles.routeDotDest, { borderColor: colors.primary, backgroundColor: colors.primary }]}>
                    <Ionicons name="flag" size={10} color="#FFFFFF" />
                  </View>
                  <View style={styles.routeStopInfo}>
                    <Text style={[type.label, styles.stopType, { color: colors.onSurfaceVariant }]}>Drop-off</Text>
                    <Text style={[type.titleMd, styles.stopName, { color: colors.onSurface }]} numberOfLines={2}>
                      {nextTrip.destination || "Destination"}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.surfaceContainerHigh }]} />

              {/* Guest */}
              {nextTrip.passenger_name ? (
                <View style={styles.guestRow}>
                  <View style={[styles.guestAvatar, { backgroundColor: colors.surfaceVariant }]}>
                    <Ionicons name="person" size={18} color={colors.onSurfaceVariant} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.label, styles.guestLabel, { color: colors.onSurfaceVariant }]}>Guest</Text>
                    <Text style={[type.bodyMd, styles.guestName, { color: colors.onSurface }]}>
                      {nextTrip.passenger_name}
                    </Text>
                  </View>
                  {nextTrip.destination_latitude != null && nextTrip.destination_longitude != null ? (
                    <Pressable
                      onPress={() => openMap(nextTrip)}
                      style={({ pressed }) => [
                        styles.mapBtn,
                        { backgroundColor: colors.surfaceContainerHigh },
                        pressed && styles.pressed,
                      ]}
                      accessibilityLabel="Open in maps"
                    >
                      <Ionicons name="navigate-outline" size={18} color={colors.primary} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {/* CTA */}
              {canManageTrip ? (
                isPreStart && !startReady ? (
                  <Pressable
                    onPress={() => router.push(`/trip/${nextTrip.trip_id}`)}
                    style={({ pressed }) => [
                      styles.tripCta,
                      { backgroundColor: colors.secondaryContainer },
                      pressed && styles.ctaPressed,
                    ]}
                  >
                    <Text style={[type.labelLg, styles.tripCtaText, { color: colors.onSecondaryContainer }]}>
                      View Details
                    </Text>
                    <View style={[styles.ctaIcon, { backgroundColor: "rgba(0,0,0,0.08)" }]}>
                      <Ionicons name="chevron-forward" size={18} color={colors.onSecondaryContainer} />
                    </View>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => handleTripAction(nextTrip)}
                    disabled={!!actingOn}
                    style={({ pressed }) => [
                      styles.tripCta,
                      { backgroundColor: colors.primary },
                      pressed && styles.ctaPressed,
                    ]}
                  >
                    {actingOn === nextTrip.trip_id ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Text style={[type.labelLg, styles.tripCtaText, { color: "#FFFFFF" }]}>
                          {activeTrip ? "Continue Trip" : "Start Trip"}
                        </Text>
                        <View style={[styles.ctaIcon, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                          <Ionicons name={activeTrip ? "navigate" : "play"} size={18} color="#FFFFFF" />
                        </View>
                      </>
                    )}
                  </Pressable>
                )
              ) : null}

              <StatusPill status={nextTrip.trip_status} />
            </View>
          ) : (
            <View style={[styles.emptyCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainerHigh }]}>
              <View style={[styles.emptyMark, { backgroundColor: colors.surfaceContainerHigh }]}>
                <Ionicons name="checkmark-done" size={30} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[type.titleLg, styles.emptyTitle, { color: colors.onSurface }]}>All clear</Text>
              <Text style={[type.bodyMd, styles.emptyBody, { color: colors.onSurfaceVariant }]}>
                No trips assigned right now. Pull to refresh, or check back soon.
              </Text>
            </View>
          )}
        </Animated.View>

        {/* ─── Stats Strip ─── */}
        <Animated.View style={fade(statsAnim)}>
          <View style={styles.statsGrid}>
            <View style={[styles.statCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainerHigh }]}>
              <View style={[styles.statIcon, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name="list-outline" size={16} color={colors.onPrimaryContainer} />
              </View>
              <CountUpText value={trips.length} style={[type.displayLg, styles.statNumber, { color: colors.onSurface }]} />
              <Text style={[type.label, styles.statLabel, { color: colors.onSurfaceVariant }]}>Trips Today</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainerHigh }]}>
              <View style={[styles.statIcon, { backgroundColor: colors.secondaryContainer }]}>
                <Ionicons name="checkmark-outline" size={16} color={colors.onSecondaryContainer} />
              </View>
              <CountUpText value={completedTrips.length} style={[type.displayLg, styles.statNumber, { color: colors.secondary }]} />
              <Text style={[type.label, styles.statLabel, { color: colors.onSurfaceVariant }]}>Completed</Text>
            </View>
          </View>
        </Animated.View>

        {/* ─── Quick Actions ─── */}
        <Animated.View style={fade(quickAnim)}>
          <View style={styles.quickActions}>
            <Text style={[type.titleLg, styles.sectionTitle, { color: colors.onSurface }]}>
              Quick actions
            </Text>
            <Pressable
              onPress={() => router.push("/work-schedule")}
              style={({ pressed }) => [styles.scheduleAction, { backgroundColor: colors.primaryContainer }, pressed && styles.quickPressed]}
              accessibilityRole="button"
              accessibilityLabel="Open work schedule and leave requests"
            >
              <View style={[styles.scheduleIcon, { backgroundColor: colors.primary }]}>
                <Ionicons name="calendar-outline" size={22} color={colors.onPrimary} />
              </View>
              <View style={styles.scheduleCopy}>
                <Text style={[styles.scheduleTitle, { color: colors.onPrimaryContainer }]}>Work schedule</Text>
                <Text style={[styles.scheduleMeta, { color: colors.onPrimaryContainer + "B8" }]}>View shifts and request leave</Text>
              </View>
              <View style={[styles.scheduleArrow, { backgroundColor: colors.surfaceContainerLowest }]}>
                <Ionicons name="arrow-forward" size={17} color={colors.primary} />
              </View>
            </Pressable>
            <View style={styles.quickGrid}>
              <Pressable
                onPress={() => router.push("/inspection")}
                style={({ pressed }) => [styles.quickBtn, { backgroundColor: colors.surfaceContainerLow }, pressed && styles.quickPressed]}
              >
                <View style={[styles.quickIconWrapper, { backgroundColor: colors.primaryContainer }]}>
                  <Ionicons name="clipboard-outline" size={22} color={colors.onPrimaryContainer} />
                </View>
                <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                  Inspection
                </Text>
              </Pressable>

              {canReportFuel ? (
                <Pressable
                  onPress={() => router.push({ pathname: "/fuel-report", params: { tripId: activeTrip?.trip_id ? String(activeTrip.trip_id) : undefined } })}
                  style={({ pressed }) => [styles.quickBtn, { backgroundColor: colors.surfaceContainerLow }, pressed && styles.quickPressed]}
                >
                  <View style={[styles.quickIconWrapper, { backgroundColor: colors.secondaryContainer }]}>
                    <Ionicons name="water-outline" size={22} color={colors.onSecondaryContainer} />
                  </View>
                  <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                    Fuel report
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => router.push("/incidents")}
                style={({ pressed }) => [styles.quickBtn, { backgroundColor: colors.surfaceContainerLow }, pressed && styles.quickPressed]}
              >
                <View style={[styles.quickIconWrapper, { backgroundColor: colors.errorContainer }]}>
                  <Ionicons name="warning-outline" size={22} color={colors.onErrorContainer} />
                </View>
                <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                  Report issue
                </Text>
              </Pressable>

              <Pressable
                onPress={() => router.push("/submissions")}
                style={({ pressed }) => [styles.quickBtn, { backgroundColor: colors.surfaceContainerLow }, pressed && styles.quickPressed]}
              >
                <View style={[styles.quickIconWrapper, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <Ionicons name="document-text-outline" size={22} color={colors.info} />
                </View>
                <Text style={[type.labelLg, styles.quickBtnText, { color: colors.onSurface }]} numberOfLines={1}>
                  Submissions
                </Text>
              </Pressable>
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
        onRequestClose={() => setCompletingTrip(null)}
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
            />
            {odometerError ? (
              <Text style={[type.caption, styles.modalError, { color: colors.error }]}>
                {odometerError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => { setCompletingTrip(null); setOdometerInput(""); }}
                style={({ pressed }) => [styles.modalCancelBtn, { backgroundColor: colors.surfaceContainerLow }, pressed && styles.pressed]}
              >
                <Text style={[type.labelLg, styles.modalCancelText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitOdometer}
                style={({ pressed }) => [styles.modalConfirmBtn, { backgroundColor: colors.primary }, pressed && styles.ctaPressed]}
              >
                <Text style={[type.labelLg, styles.modalConfirmText, { color: "#FFFFFF" }]}>Complete</Text>
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

  // ── Hero ──
  hero: {
    borderRadius: moderateScale(24),
    padding: moderateScale(22),
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
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
    color: "#FFFFFF",
  },
  statusDotIdle: {
    width: moderateScale(7),
    height: moderateScale(7),
    borderRadius: moderateScale(4),
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  heroGreeting: {
    fontFamily: fonts.displayBold,
    fontSize: moderateScale(30),
    lineHeight: moderateScale(38),
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  heroDate: {
    fontFamily: fonts.bodyMedium,
    fontSize: moderateScale(14),
    color: "rgba(255,255,255,0.8)",
  },
  heroSupport: {
    fontFamily: fonts.body,
    fontSize: moderateScale(14),
    lineHeight: moderateScale(21),
    color: "rgba(255,255,255,0.78)",
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
    color: "rgba(255,255,255,0.65)",
  },
  heroVehicleModel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(15),
    color: "#FFFFFF",
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

  // ── Stats ──
  statsGrid: { flexDirection: "row", gap: moderateScale(14) },
  statCard: {
    flex: 1,
    borderRadius: moderateScale(18),
    borderWidth: 1,
    padding: moderateScale(16),
    flexDirection: "column",
    alignItems: "flex-start",
    gap: moderateScale(4),
  },
  statIcon: {
    width: moderateScale(30),
    height: moderateScale(30),
    borderRadius: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(6),
  },
  statNumber: { letterSpacing: -1, fontSize: moderateScale(32) },
  statLabel: { marginTop: moderateScale(2) },

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
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: moderateScale(12),
  },
  quickBtn: {
    width: "48%",
    minHeight: moderateScale(72),
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(10),
    padding: moderateScale(12),
    borderRadius: moderateScale(16),
  },
  quickPressed: { transform: [{ scale: 0.97 }], opacity: 0.88 },
  quickIconWrapper: {
    width: moderateScale(42),
    height: moderateScale(42),
    borderRadius: moderateScale(13),
    alignItems: "center",
    justifyContent: "center",
  },
  quickBtnText: {
    flex: 1,
    fontSize: moderateScale(13),
    lineHeight: moderateScale(18),
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
