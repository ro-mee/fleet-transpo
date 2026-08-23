import React, { useState, useCallback, useEffect, useRef } from "react";
import { StyleSheet, View, Text, Animated, PanResponder, Dimensions, Pressable, ScrollView, AppState, Linking } from 'react-native';
import LottieView from "lottie-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Location from 'expo-location';
import TomTomMap from "../../../components/TomTomMap";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET, statusColors } from "../../../lib/theme";
import { Ionicons } from "@expo/vector-icons";
import SwipeButton from "../../../components/SwipeButton";
import { AppAlert } from '../../../components/AppAlert';
import { FilledButton, TonalButton } from "../../../components/ui";
import {
  startBackgroundTracking,
  stopBackgroundTracking,
  updateLegContext,
  mergeStoredKm,
  legForStatus,
} from "../../../lib/background-tracking";
const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const BOTTOM_SHEET_MIN_HEIGHT = 220; // Height of the collapsed view
const BOTTOM_SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.7; // Expanded height

function getTripStatusStyle(status, colors) {
  return statusColors(colors, status);
}

// Statuses where the driver is still travelling to the pickup. Everything else
// (Passenger Onboard / En Route / Drop-off / Arrived / In Progress) is the
// second leg to the destination.
const HEADING_TO_PICKUP_STATUSES = [
  "Pending",
  "Approved",
  "Assigned",
  "Vehicle Assigned",
  "Driver Assigned",
  "Dispatched",
  "Driver Accepted",
  "Trip Started",
  "At Pickup",
];

// Distance in km between two lat/lng pairs (haversine).
function haversineKm(latA, lonA, latB, lonB) {
  const R = 6371;
  const p1 = (latA * Math.PI) / 180;
  const p2 = (latB * Math.PI) / 180;
  const dp = ((latB - latA) * Math.PI) / 180;
  const dl = ((lonB - lonA) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Max km a single GPS segment (â‰¤3s apart) can plausibly be before we treat it
// as a jump/glitch and drop it. ~400m/3s â‰ˆ 480 km/h, far above any vehicle.
const MAX_SEGMENT_KM = 0.4;
// Segments shorter than this while effectively stationary are GPS jitter and
// would inflate km while parked; only counted when the vehicle is actually
// moving (speed > 1 m/s).
const MIN_MOVING_SEGMENT_KM = 0.02;

// Frozen at module load; interval below keeps it current without render-time reads.
const NOW_AT_LOAD = Date.now();

export default function MapTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();
  
  const [activeTrip, setActiveTrip] = useState(null);
  const [todayStats, setTodayStats] = useState({ completed: 0 });
  const [driverLocation, setDriverLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permRetry, setPermRetry] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [routeData, setRouteData] = useState(null);
  const [now, setNow] = useState(NOW_AT_LOAD);
  const mapRef = useRef(null);

  // Refs for background GPS sync loop
  const activeTripRef = useRef(null);
  const lastGpsSync = useRef(0);

  // Bottom Sheet Animation State
  const [panY] = useState(() => new Animated.Value(SCREEN_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT - 60)); // -60 for tab bar approx
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const isExpandedRef = useRef(false);

  const snapTo = useCallback((expanded) => {
    isExpandedRef.current = expanded;
    setIsExpanded(expanded);
    setIsMinimized(false);
    Animated.spring(panY, {
      toValue: expanded ? SCREEN_HEIGHT - BOTTOM_SHEET_MAX_HEIGHT - 60 : SCREEN_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT - 60,
      tension: 50,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [panY]);

  const snapToMinimized = useCallback((minimize) => {
    setIsMinimized(minimize);
    if (minimize) {
      isExpandedRef.current = false;
      setIsExpanded(false);
    }
    Animated.spring(panY, {
      toValue: minimize ? SCREEN_HEIGHT + 20 : SCREEN_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT - 60,
      tension: 50,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [panY]);

  const panResponder = useRef(
    // eslint-disable-next-line react-hooks/refs -- RN gesture responder reads live drag refs; created once via lazy state
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => Math.abs(gestureState.dy) > 5,
      onPanResponderGrant: () => {
        panY.extractOffset();
      },
      onPanResponderMove: Animated.event([null, { dy: panY }], { useNativeDriver: false }),
      onPanResponderRelease: (evt, gestureState) => {
        panY.flattenOffset();
        if (gestureState.dy < -50 || gestureState.vy < -0.5) {
          snapTo(true);
        } else if (gestureState.dy > 50 || gestureState.vy > 0.5) {
          snapTo(false);
        } else {
          snapTo(isExpandedRef.current);
        }
      },
    })
  ).current;

  const lastTripId = useRef(null);

  // GPS distance accumulator for the two legs of the trip.
  //   leg1 = km driven to the pickup
  //   leg2 = km driven from pickup to the destination
  // Held in a ref so it survives re-renders and the watcher closure can read and
  // mutate it without the interval/callback being torn down.
  const distRef = useRef({ leg1: 0, leg2: 0, prev: null, leg: null });

  useEffect(() => {
    activeTripRef.current = activeTrip;
    // Reset route data only when it's a completely new trip
    if (activeTrip?.trip_id !== lastTripId.current) {
      setRouteData(null);
      lastTripId.current = activeTrip?.trip_id;
      // A new trip resets the accumulated leg distances so a previous trip's km
      // never bleeds into the next one.
      distRef.current = { leg1: 0, leg2: 0, prev: null, leg: null };
    }
  }, [activeTrip]);

  // Keep the background task's trip/leg context in sync so it accumulates the
  // correct leg (and posts to the right trip endpoint) when the app is
  // backgrounded. Runs on every active trip or status change.
  useEffect(() => {
    updateLegContext({
      tripId: activeTrip?.trip_id ?? null,
      leg: legForStatus(activeTrip?.trip_status),
    }).catch(() => {});
  }, [activeTrip?.trip_id, activeTrip?.trip_status]);

  // Background tracking, driven by AppState so there is never overlap with the
  // foreground watcher (no double-counted km, no duplicate GPS posts):
  //   background + active trip â†’ start the headless task
  //   foreground              â†’ stop it and merge the km it accumulated
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      const hadActiveTrip = Boolean(activeTripRef.current);
      const isLeavingActive = prev.match(/active/) && next.match(/inactive|background/);
      const isReturning = next === "active";

      if (isLeavingActive && hadActiveTrip) {
        updateLegContext({
          tripId: activeTripRef.current?.trip_id ?? null,
          leg: legForStatus(activeTripRef.current?.trip_status),
        }).then(() => startBackgroundTracking()).catch(() => {});
      } else if (isReturning) {
        // Clear the straddling fix synchronously so a foreground watcher tick
        // that fires before the merge resolves cannot double-count the gap
        // between the last foreground fix and the backgrounded stretch.
        distRef.current.prev = null;
        stopBackgroundTracking().catch(() => {});
        mergeStoredKm(distRef).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  const loadTrip = useCallback(async () => {
    try {
      const data = await api.get("/api/mobile/driver/trips");
      
      const active = data.find(t => !["Completed", "Cancelled"].includes(t.trip_status));
      setActiveTrip(active || null);
      
      // Completed-trip count for the idle dashboard.
      setTodayStats({
        completed: data.filter(t => t.trip_status === 'Completed').length
      });
    } catch (e) {
      console.warn("Could not load trip for map", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadTrip(); }, [loadTrip]));

  // Location pipeline: request permission once (or on retry), then stream
  // fixes. Re-runs wholesale when permRetry changes so "Try Again" can recover
  // from a denial without remounting the screen.
  useEffect(() => {
    let subscription = null;
    let headingSubscription = null;
    let cancelled = false;
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLoading(false);
        return;
      }
      setPermissionDenied(false);

      // Get initial location with highest accuracy so it doesn't calculate the route from a wrong/approximate spot!
      let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setDriverLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading });

      // Subscribe to real-time updates (every 5 meters or 3 seconds)
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, distanceInterval: 5, timeInterval: 3000 },
        (newLoc) => {
          
          // 1. Backend GPS Tracking Sync (Every 30 seconds)
          const now = Date.now();
          if (now - lastGpsSync.current >= 30000) {
            lastGpsSync.current = now;
            const endpoint = activeTripRef.current 
              ? `/api/mobile/driver/trips/${activeTripRef.current.trip_id}/gps`
              : `/api/mobile/driver/gps`; // Generic endpoint for idle tracking
              
            api.post(endpoint, {
              latitude: newLoc.coords.latitude,
              longitude: newLoc.coords.longitude,
              speed: newLoc.coords.speed,
              heading: newLoc.coords.heading,
              altitude: newLoc.coords.altitude,
              accuracy: newLoc.coords.accuracy,
            }).catch(e => console.warn("Background GPS sync failed:", e));
          }

          // 2. Map Marker Update
          setDriverLocation(prev => {
            let updatedHeading = prev?.heading;
            
            // If driving fast (> 2 m/s), prioritize GPS Course Over Ground heading!
            if (newLoc.coords.speed > 2 && newLoc.coords.heading >= 0) {
              updatedHeading = newLoc.coords.heading;
            }

            return { 
              lat: newLoc.coords.latitude, 
              lng: newLoc.coords.longitude,
              heading: updatedHeading,
              speed: newLoc.coords.speed
            };
          });

          // 3. GPS Distance Accumulation (per leg)
          const d = distRef.current;
          const leg = HEADING_TO_PICKUP_STATUSES.includes(activeTripRef.current?.trip_status) ? "leg1" : "leg2";
          const lat = newLoc.coords.latitude;
          const lng = newLoc.coords.longitude;

          // When the leg changes (pickup reached, or drop-off done), drop the
          // straddling fix so the transition gap is not counted twice.
          if (d.leg && d.leg !== leg) d.prev = null;
          d.leg = leg;

          if (d.prev) {
            const seg = haversineKm(d.prev.lat, d.prev.lng, lat, lng);
            const speed = newLoc.coords.speed ?? 0;
            // Only count plausible segments: not a >400m/3s jump (glitch) and
            // not GPS jitter while parked (short segment with ~0 speed).
            if (seg > 0 && seg <= MAX_SEGMENT_KM && (speed > 1 || seg > MIN_MOVING_SEGMENT_KM)) {
              d[leg] += seg;
            }
          }
          d.prev = { lat, lng };
        }
      );
      // 3. Compass/Gyroscope Subscription for when the car is stopped
      try {
          headingSubscription = await Location.watchHeadingAsync((headingObj) => {
              const compassHeading = headingObj.trueHeading >= 0 ? headingObj.trueHeading : headingObj.magHeading;
              
              setDriverLocation(prev => {
                  if (!prev) return prev;
                  // Only use the physical compass if the car is stopped or moving very slowly (< 2 m/s)
                  // If we are driving fast, we trust the GPS course-over-ground instead so the map doesn't spin if you grab your phone!
                  if (prev.speed === undefined || prev.speed < 2) {
                      return { ...prev, heading: compassHeading };
                  }
                  return prev;
              });
          });
      } catch (e) {
          console.warn("Compass not available on this device", e);
      }

    })().catch((error) => {
      console.warn("Location unavailable:", error.message);
    });
    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
      if (headingSubscription) headingSubscription.remove();
    };
  }, [permRetry]);

  // "Try Again" on the permission-denied state: clear the flag and re-run the
  // location effect via the retry counter.
  const retryLocationPermission = () => {
    setPermissionDenied(false);
    setPermRetry((c) => c + 1);
  };

  // Determine trip state machine for UI
  const status = activeTrip?.trip_status;
  const isPending = ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(status);
  const isDriverAccepted = status === "Driver Accepted"; // Need to START TRIP first
  const isState1 = ["Trip Started"].includes(status); // EN ROUTE TO PICKUP
  const isState2 = ["At Pickup"].includes(status); // ARRIVED AT PICKUP
  const isState3 = ["Passenger Onboard", "En Route"].includes(status); // EN ROUTE TO DESTINATION
  const isState4 = ["Drop-off", "Arrived", "In Progress"].includes(status); // ARRIVED AT DESTINATION
  
  const isHeadingToPickup = isPending || isDriverAccepted || isState1 || isState2;

  // Countdown tick: re-renders every 30s while a pre-start trip is showing,
  // so the departure-window gate flips when the window opens.
  // Stable primitive dep: re-run only when the pre-start status itself changes.
  const activeTripStatus = activeTrip?.trip_status;

  useEffect(() => {
    if (!activeTripStatus || !["Assigned", "Pending", "Approved", "Vehicle Assigned", "Driver Assigned", "Dispatched", "Driver Accepted"].includes(activeTripStatus)) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [activeTripStatus]);

  // Permission denied â€” an honest dead-end with a way out, not a loader that
  // never resolves.
  if (permissionDenied) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }, styles.permState]}>
        <View style={[styles.permIconWrap, { backgroundColor: colors.surfaceContainerHigh }]}>
          <Ionicons name="location-outline" size={32} color={colors.onSurfaceVariant} />
        </View>
        <Text style={[styles.permTitle, { color: colors.onSurface }]}>Location Permission Required</Text>
        <Text style={[styles.permMessage, { color: colors.onSurfaceVariant }]}>
          Location permission is required to show your position and track trips.
        </Text>
        <FilledButton
          label="Open Settings"
          onPress={() => Linking.openSettings()}
          style={styles.permAction}
        />
        <TonalButton
          label="Try Again"
          onPress={retryLocationPermission}
          style={styles.permAction}
        />
      </View>
    );
  }

  if (!driverLocation) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <LottieView
          autoPlay
          loop
          source={require("../../../assets/globe.json")}
          style={styles.mapLoader}
        />
      </View>
    );
  }

  // If no active trip, just show driver location with Idle Dashboard
  if (!activeTrip) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <TomTomMap 
          origin={{ lat: driverLocation.lat, lng: driverLocation.lng, heading: driverLocation.heading }}
          destination={null}
          scrollEnabled={true}
          showCarIcon={true}
          onMapReady={() => setMapReady(true)}
        />
        {(!activeTrip || !mapReady) && (
          <View style={[styles.mapLoadingOverlay, { backgroundColor: colors.background }]}>
            <LottieView
              autoPlay
              loop
              source={require("../../../assets/globe.json")}
              style={styles.mapLoader}
            />
          </View>
        )}
        
        {/* Floating Explore Pill */}
        <View style={[styles.statusPill, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + '60' }]}>
          <View style={[styles.statusDot, { backgroundColor: colors.secondary }]} />
          <Text style={[styles.statusPillText, { color: colors.onSurface }]}>ONLINE & WAITING</Text>
        </View>

        {/* Idle Dashboard Bottom Sheet */}
        <View style={[styles.idleSheet, { backgroundColor: colors.surface, borderColor: colors.outlineVariant + '30' }]}>
          <View style={styles.idleHeaderRow}>
            <View style={[styles.idleAvatar, { backgroundColor: colors.primaryContainer }]}>
              <Ionicons name="person" size={22} color={colors.onPrimaryContainer} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.idleGreeting, { color: colors.onSurface }]}>
                Good day, {user?.firstName || user?.name?.split(' ')[0] || 'Driver'}
              </Text>
              <Text style={[styles.idleSubtext, { color: colors.onSurfaceVariant }]}>
                You are on duty â€¢ Waiting for assignments
              </Text>
            </View>
          </View>
          
          <View style={styles.statsGrid}>
            <View style={[styles.statBox, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '30' }]}>
              <View style={styles.statIconRow}>
                <Ionicons name="checkmark-done-circle" size={18} color={colors.secondary} />
                <Text style={[styles.statLabel, { color: colors.onSurfaceVariant }]}>COMPLETED TRIPS</Text>
              </View>
              <Text style={[styles.statValue, { color: colors.onSurface }]}>{todayStats.completed}</Text>
            </View>
          </View>
        </View>

      </View>
    );
  }



  // Departure-window gate for the START ROUTE button. When earliest_start is
  // null (no scheduled departure / no ETA) the window is open â€” fail-open.
  const earliestStart = activeTrip?.earliest_start
    ? new Date(activeTrip.earliest_start).getTime()
    : null;
  const windowOpen = earliestStart == null || now >= earliestStart;
  const preTripDone = activeTrip?.pre_trip_status === "Passed";
  const pickupAt = activeTrip?.departure_time
    ? new Date(activeTrip.departure_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const preStart = isPending || isDriverAccepted;
  const preDeparture = preStart && earliestStart != null && !windowOpen;

  const destLat = isHeadingToPickup ? activeTrip.origin_latitude : activeTrip.destination_latitude;
  const destLng = isHeadingToPickup ? activeTrip.origin_longitude : activeTrip.destination_longitude;


  const destName = isHeadingToPickup ? activeTrip.origin : activeTrip.destination;

  // Use driver location as start, fallback to trip origin if GPS not ready
  const startLat = driverLocation?.lat || activeTrip.origin_latitude;
  const startLng = driverLocation?.lng || activeTrip.origin_longitude;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TomTomMap 
        ref={mapRef}
        origin={{ lat: startLat, lng: startLng, heading: driverLocation?.heading }}
        destination={isPending ? null : { lat: destLat, lng: destLng }}
        originAddress={isHeadingToPickup ? "My Location" : activeTrip.origin}
        destAddress={destName}
        scrollEnabled={true}
        pickupLabel="Your Location"
        dropoffLabel={isHeadingToPickup ? `Pickup: ${destName || 'TBD'}` : `Drop-off: ${destName || 'TBD'}`}
        showCarIcon={true}
        autoSwoop={true}
        onRouteData={setRouteData}
        onMapReady={() => setMapReady(true)}
      />
      {!mapReady && (
        <View style={[styles.mapLoadingOverlay, { backgroundColor: colors.background }]}>
          <LottieView
            autoPlay
            loop
            source={require("../../../assets/globe.json")}
            style={styles.mapLoader}
          />
        </View>
      )}

      {/* Floating restore pill â€” appears when bottom sheet is hidden */}
      {activeTrip && isMinimized && (
        <Pressable
          onPress={() => snapToMinimized(false)}
          accessibilityRole="button"
          accessibilityLabel="Show trip information"
          style={({ pressed }) => [{
            position: 'absolute',
            bottom: 88,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 20,
            paddingVertical: 12,
            borderRadius: 40,
            backgroundColor: colors.inverseSurface,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.22,
            shadowRadius: 16,
            elevation: 12,
            opacity: pressed ? 0.85 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          }]}
        >
          <Ionicons name="chevron-up" size={16} color={colors.inversePrimary} />
          <Text style={{ color: colors.inverseOnSurface, fontFamily: fonts.bodySemiBold, fontSize: 13 }}>
            SHOW TRIP INFO
          </Text>
        </Pressable>
      )}
      
      {activeTrip && (
        <Animated.View 
          style={[styles.bottomSheet, { transform: [{ translateY: panY }], backgroundColor: colors.surface }]}
        >
          {/* Floating Map Controls (Sticks to top of sheet) */}
          <View style={styles.floatingControlsContainer}>
            <Pressable 
              style={[styles.mapControlBtn, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}
              onPress={() => mapRef.current?.recenter()}
              accessibilityRole="button"
              accessibilityLabel="Recenter map on your location"
            >
              <Ionicons name="navigate" size={20} color={colors.primary} />
            </Pressable>
            <Pressable 
              style={[styles.mapControlBtn, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}
              onPress={() => {
                mapRef.current?.overview();
                snapToMinimized(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Show full route overview"
            >
              <Ionicons name="scan-outline" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* eslint-disable-next-line react-hooks/refs -- spreading the once-created responder's handlers */}
      <View {...panResponder.panHandlers} style={{ backgroundColor: 'transparent' }}>
            <Pressable onPress={() => snapTo(!isExpandedRef.current)}>
              {/* Drag Handle */}
              <View style={[styles.dragHandle, { backgroundColor: colors.outlineVariant }]} />

              {/* Location Header */}
              <View style={styles.sheetHeader}>
                <View style={[styles.locationIconWrapper, { backgroundColor: colors.primary }]}>
                  <Ionicons name="location-sharp" size={24} color={colors.onPrimary} />
                </View>
                <View style={styles.locationTextWrapper}>
                  <Text style={[styles.locationIndicator, { color: colors.onSurfaceVariant }]}>
                    {preDeparture && `NEXT TRIP Â· ${pickupAt || "TBD"}`}
                    {!preDeparture && isPending && "PICK UP LOCATION"}
                    {(isDriverAccepted && !preDeparture) && "EN ROUTE TO PICKUP"}
                    {isState1 && "EN ROUTE TO PICKUP"}
                    {isState2 && "ARRIVED AT PICKUP"}
                    {isState3 && "EN ROUTE TO DESTINATION"}
                    {isState4 && "ARRIVED AT DESTINATION"}
                  </Text>
                  <Text style={[styles.locationName, { color: colors.onSurface }]} numberOfLines={1}>
                    {preDeparture
                      ? `${activeTrip.origin || "Pickup"} â†’ ${activeTrip.destination || "Destination"}`
                      : destName}
                  </Text>
                </View>
                
                {/* ETA & Distance or Contextual Info */}
                <View style={styles.headerStatsRight}>
                  {preDeparture ? null : (isPending || isDriverAccepted || isState1 || isState3) ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                        <Text style={[styles.headerEtaValue, { color: colors.primary }]}>
                          {routeData 
                            ? Math.ceil(routeData.travelTimeInSeconds / 60) 
                            : (activeTrip.estimated_duration ? Math.ceil(activeTrip.estimated_duration) : "--")}
                        </Text>
                        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.primary, marginBottom: 2 }}> min</Text>
                      </View>
                      
                      {routeData?.trafficDelayInSeconds > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4, marginBottom: 4, backgroundColor: 'rgba(248,113,113,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
                          <Ionicons name="warning" size={10} color={colors.error} />
                          <Text style={{ fontFamily: fonts.dataSemiBold, fontSize: 10, color: colors.error }}>
                            +{Math.ceil(routeData.trafficDelayInSeconds / 60)} min
                          </Text>
                        </View>
                      )}

                      <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant }]}>
                        {routeData 
                          ? (routeData.lengthInMeters / 1000).toFixed(1) + " km" 
                          : (activeTrip.estimated_distance ? Number(activeTrip.estimated_distance).toFixed(1) + " km" : "-- km")}
                      </Text>
                    </>
                  ) : (
                    <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: colors.primary }}>
                        {activeTrip.passenger_count || 1} {activeTrip.passenger_count === 1 ? 'Guest' : 'Guests'}
                      </Text>
                      <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant, marginTop: 4, maxWidth: 80, textAlign: 'right' }]} numberOfLines={2}>
                        {isState2 ? 'Waiting at pickup' : 'Ready for drop-off'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
            </Pressable>
          </View>

          {/* Action Button â€” outside panResponder zone so SwipeButton doesn't conflict */}
          {preDeparture ? (
            <Pressable 
              style={({ pressed }) => [
                styles.actionBtn, 
                { 
                  backgroundColor: colors.secondaryContainer,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: pressed ? 0.9 : 1,
                }
              ]}
              onPress={() => router.push(`/trip/${activeTrip.trip_id}`)}
            >
              <Text style={[styles.actionBtnText, { color: colors.onSecondaryContainer }]}>VIEW DETAILS</Text>
              <View style={[styles.btnIconCapsule, { backgroundColor: 'rgba(4,107,94,0.15)' }]}>
                <Ionicons name="chevron-forward" size={18} color={colors.onSecondaryContainer} />
              </View>
            </Pressable>
          ) : (
            <SwipeButton
              title={
                // Single clock gate: label AND disabled state both derive from
                // earliest_start/windowOpen so they can never disagree.
                (isPending || isDriverAccepted) && !preTripDone ? "START TRIP" :
                (isPending || isDriverAccepted) && preTripDone && !windowOpen ? `OPENS AT ${new Date(earliestStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toUpperCase()}` :
                (isPending || isDriverAccepted) && preTripDone && windowOpen ? "START ROUTE" :
                isState1 ? "ARRIVED AT PICKUP" :
                isState2 ? "PICKED UP GUEST" :
                isState3 ? "ARRIVED AT DESTINATION" :
                isState4 ? "DROPPED OFF GUEST" : "SWIPE TO CONFIRM"
              }
              disabled={(isPending || isDriverAccepted) && preTripDone && !windowOpen}
              backgroundColor={colors.primary}
              textColor={colors.onPrimary}
              onSwipeSuccess={async () => {
                try {
                  if (isPending || isDriverAccepted) {
                    if (isPending) {
                      // Optimistic: fire accept in the background so we don't
                      // block the transition on a 1-2s network round-trip.
                      api.put(`/api/trips/${activeTrip.trip_id}/accept`, { accept: true }).catch((e) => {
                        AppAlert.alert("Error", e.message || "Could not accept trip");
                      });
                    }
                    if (!preTripDone) {
                        router.push({ pathname: "/inspection", params: { tripId: String(activeTrip.trip_id) } });
                        return;
                      }
                      if (!windowOpen) return;
                      await api.put(`/api/trips/${activeTrip.trip_id}/start`, { odometer: Number(activeTrip.current_mileage) || undefined });
                      loadTrip();
                    } else if (isState1) {
                      await api.put(`/api/trips/${activeTrip.trip_id}/at-pickup`, {});
                      loadTrip();
                    } else if (isState2) {
                      await api.put(`/api/trips/${activeTrip.trip_id}/onboard`, {});
                      await api.put(`/api/trips/${activeTrip.trip_id}/enroute`, {});
                      loadTrip();
                    } else if (isState3) {
                      if (activeTrip.trip_status === "Passenger Onboard") {
                        await api.put(`/api/trips/${activeTrip.trip_id}/enroute`, {});
                      }
                      await api.put(`/api/trips/${activeTrip.trip_id}/dropoff`, {});
                      loadTrip();
                    } else if (isState4) {
                      // Sum the GPS-accumulated km from both legs. If the watcher
                      // never captured any (e.g. app was backgrounded the whole
                      // time), fall back to the estimated route distance.
                      let leg1 = distRef.current.leg1;
                      let leg2 = distRef.current.leg2;
                      let totalKm = leg1 + leg2;
                      if (totalKm <= 0) {
                        totalKm = Number(activeTrip.estimated_distance) || (routeData ? (routeData.lengthInMeters / 1000) : 0);
                      }

                      // Re-fetch the LIVE vehicle mileage before computing the
                      // odometer so the derived end reading is always >= the
                      // server's current mileage (a stale base would otherwise be
                      // rejected as "below recorded mileage"). In the normal case
                      // live == loaded mileage, so distance = endOdo - startOdo
                      // equals totalKm exactly. If another device advanced the
                      // mileage mid-trip, the derived distance includes that extra
                      // km â€” safe (never rejected), just slightly inflated.
                      let freshMileage = null;
                      try {
                        const fresh = await api.get("/api/mobile/driver/trips");
                        const ft = fresh?.find((t) => String(t.trip_id) === String(activeTrip.trip_id));
                        freshMileage = ft ? Number(ft.current_mileage) : null;
                      } catch {
                        freshMileage = null;
                      }
                      const startOdo = Number(freshMileage) || Number(activeTrip.current_mileage) || 0;
                      const endOdo = startOdo + totalKm;

                      // Navigate to the summary, then run the completion API in the
                      // background. Values match: the screen shows what was sent.
                      router.push({
                        pathname: '/(app)/trip/complete',
                        params: {
                          pickup: activeTrip.origin,
                          destination: activeTrip.destination,
                          duration: routeData ? Math.ceil(routeData.travelTimeInSeconds / 60) + " min" : "-- min",
                          distance: totalKm.toFixed(1) + " km",
                          leg1: leg1.toFixed(1),
                          leg2: leg2.toFixed(1),
                          startOdo: Math.round(startOdo).toLocaleString(),
                          endOdo: Math.round(endOdo).toLocaleString()
                        }
                      });

                      setActiveTrip(null);

                      api.put(`/api/trips/${activeTrip.trip_id}/complete`, {
                        distance: totalKm,
                        start_odometer: startOdo,
                        end_odometer: endOdo,
                      }).catch((e) => {
                        AppAlert.alert("Error", e.message || "Could not complete trip");
                      });
                    }
                  } catch(e) {
                    AppAlert.alert("Error", e.message || "Could not update trip");
                  }
                }}
              />
            )}

          {/* Expanded Content */}
          <ScrollView 
            style={{ flex: 1, marginTop: 24 }}
            showsVerticalScrollIndicator={false}
            pointerEvents={isExpanded ? 'auto' : 'none'}
            contentContainerStyle={{ paddingBottom: 24, gap: 16 }}
          >
            {/* Passenger Card */}
            <View style={[styles.detailCard, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + '40' }]}>
              <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '40' }]}>
                <Ionicons name="person" size={16} color={colors.onSurfaceVariant} />
                <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>Passenger Info</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={[styles.avatar, { backgroundColor: colors.surfaceContainerHigh }]}>
                  <Text style={[styles.avatarText, { color: colors.onSurface }]}>
                    {(activeTrip.passenger_name || 'G')[0].toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailTitle, { color: colors.onSurface }]}>{activeTrip.passenger_name || 'Guest'}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <Ionicons name="people" size={14} color={colors.outline} />
                    <Text style={[styles.detailSub, { color: colors.outline }]}>{activeTrip.passenger_count || 1} Pax</Text>
                  </View>
                </View>
                <Pressable style={[styles.iconButton, { backgroundColor: colors.primaryContainer }]}>
                  <Ionicons name="call" size={18} color={colors.onPrimaryContainer} />
                </Pressable>
              </View>
            </View>

            {/* Trip Details Card */}
            <View style={[styles.detailCard, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + '40' }]}>
              <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant + '40' }]}>
                <Ionicons name="document-text" size={16} color={colors.onSurfaceVariant} />
                <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>Trip Details</Text>
              </View>
              <View style={[styles.cardBody, { flexDirection: 'column', gap: 12, alignItems: 'stretch' }]}>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.outline }]}>TRIP ID</Text>
                  <Text style={[styles.detailValue, { color: colors.onSurface }]}>TRP-{activeTrip.trip_id}</Text>
                </View>
                <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: colors.outlineVariant + '20', paddingTop: 12 }]}>
                  <Text style={[styles.detailLabel, { color: colors.outline }]}>STATUS</Text>
                  {(() => {
                    const sc = getTripStatusStyle(activeTrip.trip_status, colors);
                    return (
                      <View style={[styles.statusBadge, { backgroundColor: sc.bg, flexDirection: 'row', alignItems: 'center', gap: 5 }]}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sc.dot }} />
                        <Text style={[styles.statusBadgeText, { color: sc.fg }]}>{activeTrip.trip_status}</Text>
                      </View>
                    );
                  })()}
                </View>
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  permState: {
    padding: 24,
    gap: 12,
  },
  permIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  permTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 18,
    textAlign: 'center',
  },
  permMessage: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  permAction: {
    alignSelf: 'stretch',
    maxWidth: 320,
  },
  mapLoader: {
    width: 180,
    height: 180,
  },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  statusPill: {
    position: 'absolute',
    top: 56,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
  },
  idleSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 40,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  idleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  idleAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idleGreeting: {
    fontFamily: fonts.displaySemiBold || fonts.bodySemiBold,
    fontSize: 17,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  idleSubtext: {
    fontFamily: fonts.body,
    fontSize: 13,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statBox: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  statIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  statLabel: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  statValue: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: 22,
    letterSpacing: -0.5,
  },
  bottomSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: SCREEN_HEIGHT,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 16,
  },
  floatingControlsContainer: {
    position: 'absolute',
    top: -58,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  mapControlBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 16,
    opacity: 0.4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  locationIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTextWrapper: {
    flex: 1,
    paddingRight: 10,
  },
  locationIndicator: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    marginBottom: 3,
    letterSpacing: 0.6,
  },
  locationName: {
    fontFamily: fonts.displaySemiBold || fonts.bodySemiBold,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  divider: {
    height: 1,
    width: '100%',
    opacity: 0.4,
    marginBottom: 16,
  },
  headerStatsRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: 70,
  },
  headerEtaValue: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: 22,
    letterSpacing: -0.5,
  },
  headerDistValue: {
    fontFamily: fonts.data || fonts.body,
    fontSize: 13,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 54,
    borderRadius: 18,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  actionBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    letterSpacing: 0.5,
  },
  btnIconCapsule: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  cardHeaderTitle: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  cardBody: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
  },
  detailTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },
  detailSub: {
    fontFamily: fonts.body,
    fontSize: 13,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  detailValue: {
    fontFamily: fonts.data || fonts.bodySemiBold,
    fontSize: 14,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
  }
});
