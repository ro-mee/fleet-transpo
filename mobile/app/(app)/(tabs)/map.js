import React, { useState, useCallback, useEffect, useRef } from "react";
import { StyleSheet, View, ActivityIndicator, Text, Animated, PanResponder, Dimensions, Pressable, ScrollView, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Location from 'expo-location';
import TomTomMap from "../../../components/TomTomMap";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { Ionicons } from "@expo/vector-icons";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const BOTTOM_SHEET_MIN_HEIGHT = 220; // Height of the collapsed view
const BOTTOM_SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.7; // Expanded height

export default function MapTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();
  
  const [activeTrip, setActiveTrip] = useState(null);
  const [todayStats, setTodayStats] = useState({ completed: 0, distance: 0 });
  const [driverLocation, setDriverLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [routeData, setRouteData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const mapRef = useRef(null);

  // Refs for background GPS sync loop
  const activeTripRef = useRef(null);
  const lastGpsSync = useRef(0);

  // Bottom Sheet Animation State
  const panY = useRef(new Animated.Value(SCREEN_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT - 60)).current; // -60 for tab bar approx
  const [isExpanded, setIsExpanded] = useState(false);

  const isExpandedRef = useRef(false);

  const snapTo = useCallback((expanded) => {
    isExpandedRef.current = expanded;
    setIsExpanded(expanded);
    Animated.spring(panY, {
      toValue: expanded ? SCREEN_HEIGHT - BOTTOM_SHEET_MAX_HEIGHT - 60 : SCREEN_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT - 60,
      tension: 50,
      friction: 8,
      useNativeDriver: false, // Keep false to match JS-driven PanResponder
    }).start();
  }, [panY]);

  const panResponder = useRef(
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

  useEffect(() => {
    activeTripRef.current = activeTrip;
    // Reset route data only when it's a completely new trip
    if (activeTrip?.trip_id !== lastTripId.current) {
      setRouteData(null);
      lastTripId.current = activeTrip?.trip_id;
    }
  }, [activeTrip]);

  const [actingOn, setActingOn] = useState(null);
  
  // Distance trackers for the two legs of the trip
  const [recordedLeg1, setRecordedLeg1] = useState(0);
  const [recordedLeg2, setRecordedLeg2] = useState(0);

  const loadTrip = useCallback(async () => {
    try {
      const data = await api.get("/api/mobile/driver/trips");
      
      const active = data.find(t => !["Completed", "Cancelled"].includes(t.trip_status));
      setActiveTrip(active || null);
      
      // Calculate today's stats for the idle dashboard
      const completedCount = data.filter(t => t.trip_status === 'Completed').length;
      setTodayStats({ 
        completed: completedCount, 
        distance: completedCount > 0 ? (completedCount * 8.4).toFixed(1) : 0 // Rough estimate until actual distance tracking is implemented
      });
    } catch (e) {
      console.warn("Could not load trip for map", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadTrip(); }, [loadTrip]));

  useEffect(() => {
    let subscription = null;
    let headingSubscription = null;
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      
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

    })();
    return () => {
      if (subscription) subscription.remove();
      if (headingSubscription) headingSubscription.remove();
    };
  }, []);

  if (loading || !driverLocation) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 12, color: colors.onSurfaceVariant, fontFamily: fonts.bodyMedium }}>Acquiring GPS Signal...</Text>
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
        />
        
        {/* Floating Explore Pill */}
        <View style={{ position: 'absolute', top: 60, alignSelf: 'center', backgroundColor: 'rgba(30,41,59,0.85)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' }} />
          <Text style={{ fontFamily: fonts.labelMd, color: '#f8fafc', fontSize: 13, letterSpacing: 0.5 }}>ONLINE & WAITING</Text>
        </View>

        {/* Idle Dashboard Bottom Sheet */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, paddingBottom: 40, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowColor: "#000", shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 20 }}>
          
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryContainer, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="person" size={24} color={colors.onPrimaryContainer} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodyLg, fontSize: 18, color: colors.onSurface, fontWeight: 'bold', marginBottom: 4 }}>Good day, {user?.full_name?.split(' ')[0] || 'Driver'}</Text>
              <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.outline }}>You have no assigned trips yet.</Text>
            </View>
          </View>
          
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1, backgroundColor: colors.surfaceContainer, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.outlineVariant + '40' }}>
              <Ionicons name="checkmark-done-circle" size={20} color={colors.primary} style={{ marginBottom: 8 }} />
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 20, color: colors.onSurface, marginBottom: 2 }}>{todayStats.completed}</Text>
              <Text style={{ fontFamily: fonts.labelSm, fontSize: 11, color: colors.outline, textTransform: 'uppercase' }}>Trips Today</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: colors.surfaceContainer, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.outlineVariant + '40' }}>
              <Ionicons name="speedometer" size={20} color={colors.primary} style={{ marginBottom: 8 }} />
              <Text style={{ fontFamily: fonts.bodyBold, fontSize: 20, color: colors.onSurface, marginBottom: 2 }}>{todayStats.distance} km</Text>
              <Text style={{ fontFamily: fonts.labelSm, fontSize: 11, color: colors.outline, textTransform: 'uppercase' }}>Distance</Text>
            </View>
          </View>
        </View>

      </View>
    );
  }

  // Determine trip state machine for UI
  const status = activeTrip.trip_status;
  const isPending = ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(status);
  const isDriverAccepted = status === "Driver Accepted"; // Need to START TRIP first
  const isState1 = ["Trip Started"].includes(status); // EN ROUTE TO PICKUP
  const isState2 = ["At Pickup"].includes(status); // ARRIVED AT PICKUP
  const isState3 = ["Passenger Onboard", "En Route"].includes(status); // EN ROUTE TO DESTINATION
  const isState4 = ["Drop-off", "Arrived", "In Progress"].includes(status); // ARRIVED AT DESTINATION
  
  const isHeadingToPickup = isPending || isDriverAccepted || isState1 || isState2;

  // Countdown tick: re-renders every 30s while a Driver Accepted trip is
  // showing, so the START ROUTE gate flips when the departure window opens.
  useEffect(() => {
    if (activeTrip?.trip_status !== "Driver Accepted") return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [activeTrip?.trip_status]);

  // Departure-window gate for the START ROUTE button. When earliest_start is
  // null (no scheduled departure / no ETA) the window is open — fail-open.
  const earliestStart = activeTrip?.earliest_start
    ? new Date(activeTrip.earliest_start).getTime()
    : null;
  const windowOpen = earliestStart == null || now >= earliestStart;
  const preTripDone = activeTrip?.pre_trip_status === "Passed";
  const minsToStart = earliestStart != null
    ? Math.max(0, Math.ceil((earliestStart - now) / 60000))
    : 0;
  const windowOpenAt = earliestStart != null
    ? new Date(earliestStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const destLat = isHeadingToPickup ? activeTrip.origin_latitude : activeTrip.destination_latitude;
  const destLng = isHeadingToPickup ? activeTrip.origin_longitude : activeTrip.destination_longitude;

  // Track the initial distance of each leg so we have the total km driven at the end
  useEffect(() => {
    if (!routeData || !activeTrip) return;
    const distKm = routeData.lengthInMeters / 1000;
    
    // We only capture it once per leg when the distance is meaningful (> 0.1km)
    if (isHeadingToPickup && recordedLeg1 === 0 && distKm > 0.1) {
      setRecordedLeg1(distKm);
    } else if (!isHeadingToPickup && recordedLeg2 === 0 && distKm > 0.1) {
      setRecordedLeg2(distKm);
    }
  }, [routeData, isHeadingToPickup, activeTrip, recordedLeg1, recordedLeg2]);
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
      />
      
      {activeTrip && (
        <Animated.View 
          style={[styles.bottomSheet, { transform: [{ translateY: panY }], backgroundColor: colors.surface }]}
        >
          {/* Floating Map Controls (Sticks to top of sheet) */}
          <View style={styles.floatingControlsContainer}>
            <Pressable 
              style={[styles.mapControlBtn, { backgroundColor: colors.surface }]}
              onPress={() => mapRef.current?.recenter()}
            >
              <Ionicons name="navigate" size={20} color={colors.primary} />
            </Pressable>
            <Pressable 
              style={[styles.mapControlBtn, { backgroundColor: colors.surface }]}
              onPress={() => mapRef.current?.overview()}
            >
              <Ionicons name="map-outline" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

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
                    {isPending && "PICK UP DESTINATION"}
                    {(isDriverAccepted || isState1) && "EN ROUTE TO PICKUP"}
                    {isState2 && "ARRIVED AT PICKUP"}
                    {isState3 && "EN ROUTE TO DESTINATION"}
                    {isState4 && "ARRIVED AT DESTINATION"}
                  </Text>
                  <Text style={[styles.locationName, { color: colors.onSurface }]} numberOfLines={1}>
                    {destName}
                  </Text>
                </View>
                
                {/* ETA & Distance or Contextual Info */}
                <View style={styles.headerStatsRight}>
                  {(isPending || isDriverAccepted || isState1 || isState3) ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                        <Text style={[styles.headerEtaValue, { color: '#93c5fd' }]}>
                          {routeData 
                            ? Math.ceil(routeData.travelTimeInSeconds / 60) 
                            : (activeTrip.estimated_duration ? Math.ceil(activeTrip.estimated_duration) : "--")}
                        </Text>
                        <Text style={{ fontFamily: fonts.bodyBold, fontSize: 14, color: '#93c5fd', marginBottom: 2 }}> min</Text>
                      </View>
                      
                      {routeData?.trafficDelayInSeconds > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4, marginBottom: 4, backgroundColor: 'rgba(248,113,113,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
                          <Ionicons name="warning" size={10} color="#fca5a5" />
                          <Text style={{ fontFamily: fonts.labelMd, fontSize: 10, color: '#fca5a5', fontWeight: 'bold' }}>
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
                      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: '#93c5fd' }}>
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

          {/* Action Button */}
          {isPending ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable 
                style={[styles.actionBtn, { flex: 1, backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant }]}
                onPress={async () => {
                   try {
                     await api.put(`/api/trips/${activeTrip.trip_id}/accept`, { accept: false, reason: "Declined by driver on Map" });
                     loadTrip();
                   } catch(e) { Alert.alert("Error", "Could not decline trip"); }
                }}
              >
                <Text style={[styles.actionBtnText, { color: colors.onSurface }]}>DECLINE</Text>
                <Ionicons name="close-circle-outline" size={22} color={colors.onSurface} />
              </Pressable>
              
              <Pressable 
                style={[styles.actionBtn, { flex: 1, backgroundColor: colors.primary }]}
                onPress={async () => {
                   try {
                     await api.put(`/api/trips/${activeTrip.trip_id}/accept`, { accept: true });
                     loadTrip();
                   } catch(e) { Alert.alert("Error", "Could not accept trip"); }
                }}
              >
                <Text style={[styles.actionBtnText, { color: colors.onPrimary }]}>ACCEPT</Text>
                <Ionicons name="checkmark-circle-outline" size={22} color={colors.onPrimary} />
              </Pressable>
            </View>
          ) : (
            <Pressable 
              style={[styles.actionBtn, { backgroundColor: (isDriverAccepted && !preTripDone) || (isDriverAccepted && !windowOpen) ? colors.surfaceContainerHigh : colors.primary }]}
              onPress={async () => {
                try {
                  if (isDriverAccepted) {
                    if (!preTripDone) {
                      router.push({ pathname: "/inspection", params: { tripId: String(activeTrip.trip_id) } });
                      return;
                    }
                    if (!windowOpen) return;
                    await api.put(`/api/trips/${activeTrip.trip_id}/start`, {});
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
                    // Combine the distance from both legs, fallback to estimated distance if somehow 0
                    let totalKm = recordedLeg1 + recordedLeg2;
                    if (totalKm === 0) {
                      totalKm = Number(activeTrip.estimated_distance) || (routeData ? (routeData.lengthInMeters / 1000) : 0);
                    }
                    
                    const startOdo = Number(activeTrip.start_odometer) || Number(activeTrip.current_mileage) || 0;
                    const endOdo = startOdo + totalKm;
                    
                    await api.put(`/api/trips/${activeTrip.trip_id}/complete`, { 
                      distance: totalKm,
                      start_odometer: startOdo,
                      end_odometer: endOdo 
                    });
                    
                    setActiveTrip(null);
                    setRecordedLeg1(0);
                    setRecordedLeg2(0);
                    
                    router.push({
                      pathname: '/(app)/trip/complete',
                      params: {
                        pickup: activeTrip.origin,
                        destination: activeTrip.destination,
                        duration: routeData ? Math.ceil(routeData.travelTimeInSeconds / 60) + " min" : "-- min",
                        distance: totalKm.toFixed(1) + " km",
                        startOdo: Math.round(startOdo).toLocaleString(),
                        endOdo: Math.round(endOdo).toLocaleString()
                      }
                    });
                  }
                } catch(e) {
                  Alert.alert("Error", e.message || "Could not update trip");
                }
              }}
            >
              <Text style={[styles.actionBtnText, { color: isDriverAccepted && (!preTripDone || !windowOpen) ? colors.onSurface : colors.onPrimary }]}>
                {isDriverAccepted && !preTripDone && "PRE-TRIP CHECK"}
                {isDriverAccepted && preTripDone && !windowOpen && `START IN ${minsToStart} MIN`}
                {isDriverAccepted && preTripDone && windowOpen && "START ROUTE"}
                {isState1 && "ARRIVED AT PICKUP"}
                {isState2 && "PICKED UP GUEST"}
                {isState3 && "ARRIVED AT DESTINATION"}
                {isState4 && "DROPPED OFF GUEST"}
              </Text>
              <Ionicons name="checkmark-circle-outline" size={22} color={colors.onPrimary} />
            </Pressable>
          )}
          </View>

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
                  <View style={[styles.statusBadge, { backgroundColor: colors.secondaryContainer }]}>
                    <Text style={[styles.statusBadgeText, { color: colors.onSecondaryContainer }]}>{activeTrip.trip_status}</Text>
                  </View>
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
    justifyContent: "center"
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
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 20,
  },
  floatingControlsContainer: {
    position: 'absolute',
    top: -64,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    pointerEvents: 'box-none',
  },
  mapControlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 14,
    marginBottom: 20,
    opacity: 0.3,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
  },
  locationIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTextWrapper: {
    flex: 1,
    paddingRight: 12,
  },
  locationIndicator: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  locationName: {
    fontFamily: fonts.bodyBold,
    fontSize: 18,
  },
  divider: {
    height: 1,
    width: '100%',
    opacity: 0.5,
    marginBottom: 20,
  },
  headerStatsRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: 70,
  },
  headerEtaValue: {
    fontFamily: fonts.bodyBold,
    fontSize: 22,
    marginBottom: 2,
  },
  headerDistValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.5,
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
    fontFamily: fonts.labelMd,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardBody: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.titleLg,
    fontSize: 20,
    fontWeight: '600',
  },
  detailTitle: {
    fontFamily: fonts.bodyLg,
    fontSize: 16,
    fontWeight: '600',
  },
  detailSub: {
    fontFamily: fonts.labelMd,
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
    fontFamily: fonts.labelSm,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontFamily: fonts.labelMd,
    fontSize: 14,
    fontWeight: '500',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontFamily: fonts.labelMd,
    fontSize: 12,
    fontWeight: '600',
  }
});
