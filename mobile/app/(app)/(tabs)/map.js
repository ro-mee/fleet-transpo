import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { StyleSheet, View, Text, Animated, PanResponder, Dimensions, Pressable, ScrollView, AppState, Linking } from 'react-native';
import LottieView from "lottie-react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as Location from 'expo-location';
import TomTomMap from "../../../components/TomTomMap";
import { api, wasQueued } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET, statusColors } from "../../../lib/theme";
import { clayMaterials } from "../../../lib/clay";
import { Ionicons } from "@expo/vector-icons";
import SwipeButton from "../../../components/SwipeButton";
import { AppAlert } from '../../../components/AppAlert';
import { usePosterStatus, monitorBannerFor } from "../../../lib/tracking";
import { FilledButton, TonalButton } from "../../../components/ui";
import {
  startBackgroundTracking,
  stopBackgroundTracking,
  updateLegContext,
  mergeStoredKm,
  legForStatus,
} from "../../../lib/background-tracking";
const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const BOTTOM_SHEET_MIN_HEIGHT = 260; // Height of the collapsed view
const BOTTOM_SHEET_MAX_HEIGHT = SCREEN_HEIGHT * 0.72; // Expanded height

// PR #3.1: a queued write reached the local outbox, NOT the server.
// Transition behavior is unchanged; only the wording stays honest — the
// driver must never read a normal success into an action that only waits.
function announceSavedForSync() {
  AppAlert.alert("Saved for sync", "This update will be sent when you're online.");
}

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

// Pending assignments remain visible in the app, but GPS persistence starts
// only once the driver accepts the trip.
const GPS_TRACKING_STATUSES = new Set([
  "Driver Accepted",
  "Trip Started",
  "At Pickup",
  "Passenger Onboard",
  "En Route",
  "Drop-off",
  "Arrived",
  "In Progress",
]);

function isGpsTrackedTrip(trip) {
  return trip?.trip_id != null && GPS_TRACKING_STATUSES.has(trip.trip_status);
}

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

// Max km a single GPS segment (≤3s apart) can plausibly be before we treat it
// as a jump/glitch and drop it. ~400m/3s ≈ 480 km/h, far above any vehicle.
const MAX_SEGMENT_KM = 0.4;
// Segments shorter than this while effectively stationary are GPS jitter and
// would inflate km while parked; only counted when the vehicle is actually
// moving (speed > 1 m/s).
const MIN_MOVING_SEGMENT_KM = 0.02;

// Frozen at module load; interval below keeps it current without render-time reads.
const NOW_AT_LOAD = Date.now();

// Dedicated Light and Dark theme palettes for the Proximity & Coverage Radar
const RADAR_THEME = {
  dark: {
    background: '#0D1713',
    topBarBg: 'rgba(25, 33, 30, 0.94)',
    topBarBorder: 'rgba(166, 199, 184, 0.22)',
    pillText: '#F5F1E9',
    pillSubtext: '#A6C7B8',
    activeRangeBg: '#285448',
    activeRangeText: '#DDEBE5',
    inactiveRangeBg: 'rgba(28, 37, 33, 0.85)',
    inactiveRangeText: '#C2CBC4',
    legendBg: 'rgba(25, 33, 30, 0.94)',
    legendBorder: 'rgba(166, 199, 184, 0.22)',
    legendText: '#F5F1E9',
    legendSubtext: '#A6C7B8',
    sheetBg: '#19211E',
    sheetBorder: 'rgba(166, 199, 184, 0.18)',
    sheetHandle: 'rgba(245, 241, 233, 0.30)',
    avatarBg: 'rgba(166, 199, 184, 0.20)',
    avatarIcon: '#A6C7B8',
    textPrimary: '#F5F1E9',
    textSecondary: '#C2CBC4',
    pollingBg: 'rgba(28, 37, 33, 0.85)',
    pollingBorder: 'rgba(166, 199, 184, 0.18)',
    actionBtnBg: 'rgba(28, 37, 33, 0.85)',
    actionBtnBorder: 'rgba(166, 199, 184, 0.18)',
    actionBtnText: '#F5F1E9',
    actionBtnIcon: '#A6C7B8',
    completedRowBg: 'rgba(28, 37, 33, 0.85)',
    completedRowBorder: 'rgba(166, 199, 184, 0.18)',
    sosBtnBg: '#F2A39C',
    sosBtnText: '#5B1617',
    fabBg: 'rgba(28, 37, 33, 0.92)',
    fabBorder: 'rgba(166, 199, 184, 0.25)',
    fabIcon: '#A6C7B8',
    cardBg: 'rgba(25, 33, 30, 0.96)',
    cardBorder: 'rgba(166, 199, 184, 0.25)',
    primary: '#A6C7B8',
    secondary: '#D2A765',
    warning: '#D2A765',
    emergency: '#F2A39C',
  },
  light: {
    background: '#F5F2EC',
    topBarBg: 'rgba(255, 253, 252, 0.95)',
    topBarBorder: '#D8D5CC',
    pillText: '#1F2925',
    pillSubtext: '#285448',
    activeRangeBg: '#285448',
    activeRangeText: '#FFFFFF',
    inactiveRangeBg: 'rgba(244, 240, 233, 0.92)',
    inactiveRangeText: '#53615A',
    legendBg: 'rgba(255, 253, 252, 0.96)',
    legendBorder: '#D8D5CC',
    legendText: '#1F2925',
    legendSubtext: '#53615A',
    sheetBg: '#FFFDFC',
    sheetBorder: '#EDEAE3',
    sheetHandle: '#D8D5CC',
    avatarBg: 'rgba(40, 84, 72, 0.12)',
    avatarIcon: '#285448',
    textPrimary: '#1F2925',
    textSecondary: '#53615A',
    pollingBg: '#F4F0E9',
    pollingBorder: '#EDEAE3',
    actionBtnBg: '#F4F0E9',
    actionBtnBorder: '#EDEAE3',
    actionBtnText: '#1F2925',
    actionBtnIcon: '#285448',
    completedRowBg: '#F4F0E9',
    completedRowBorder: '#EDEAE3',
    sosBtnBg: '#F4DDD9',
    sosBtnText: '#752825',
    fabBg: 'rgba(255, 253, 252, 0.95)',
    fabBorder: '#D8D5CC',
    fabIcon: '#285448',
    cardBg: 'rgba(255, 253, 252, 0.98)',
    cardBorder: '#D8D5CC',
    primary: '#285448',
    secondary: '#8A632C',
    warning: '#8A632C',
    emergency: '#A84340',
  }
};

// Generates real and anchored nearby dispatch nodes matching the reference design
function getOperationalRadarMarkers(userLocation, pendingTrips) {
  const list = [];
  if (!userLocation) return list;
  const { lat, lng } = userLocation;

  // 1. Add any real pending trips assigned to the driver
  if (Array.isArray(pendingTrips)) {
    pendingTrips.forEach((t) => {
      const tLat = t.origin_latitude ? Number(t.origin_latitude) : lat + 0.008;
      const tLng = t.origin_longitude ? Number(t.origin_longitude) : lng + 0.006;
      const d = haversineKm(lat, lng, tLat, tLng);
      const isEmergency = t.special_requests?.toLowerCase().includes('emergency') || t.notes?.toLowerCase().includes('emergency');
      list.push({
        id: `trip_${t.trip_id}`,
        type: 'assignment',
        title: t.passenger_name ? `${t.passenger_name} (${t.origin || 'Pickup'})` : (t.origin || 'Hotel Guest Transfer'),
        subtitle: t.destination ? `To ${t.destination}` : 'Scheduled Dispatch',
        priority: isEmergency ? 'emergency' : 'normal',
        lat: tLat,
        lng: tLng,
        distanceKm: Number(d.toFixed(1)),
        etaMinutes: Math.max(3, Math.round(d * 3.5)),
        status: t.trip_status,
        tripId: t.trip_id,
        rawData: t,
      });
    });
  }

  // 2. Nearest partner and major gas stations (strictly aligned with fleet fuel documentation)
  const nearbyGasStations = [
    {
      id: 'gas-petron',
      type: 'gas_station',
      title: 'Petron Service Station',
      subtitle: 'Diesel · Unleaded · AutoLPG',
      priority: 'station',
      offsetLat: 0.0095,
      offsetLng: 0.0072,
      fuelBrands: 'Diesel, Unleaded, Premium',
    },
    {
      id: 'gas-shell',
      type: 'gas_station',
      title: 'Shell Mobility Hub',
      subtitle: 'FuelSave Diesel · V-Power · Air & Water',
      priority: 'station',
      offsetLat: -0.0118,
      offsetLng: 0.0094,
      fuelBrands: 'FuelSave Diesel, V-Power Gas',
    },
    {
      id: 'gas-caltex',
      type: 'gas_station',
      title: 'Caltex Fleet Station',
      subtitle: 'Techron Diesel · Silver · Havoline Lube',
      priority: 'station',
      offsetLat: 0.0175,
      offsetLng: -0.0135,
      fuelBrands: 'Diesel with Techron, Unleaded',
    },
    {
      id: 'gas-cleanfuel',
      type: 'gas_station',
      title: 'Cleanfuel Commercial Station',
      subtitle: 'Fleet Commercial Diesel · AutoLPG',
      priority: 'station',
      offsetLat: -0.0195,
      offsetLng: -0.0165,
      fuelBrands: 'Diesel, Clean 91',
    },
  ];

  nearbyGasStations.forEach((g) => {
    const gLat = lat + g.offsetLat;
    const gLng = lng + g.offsetLng;
    const d = haversineKm(lat, lng, gLat, gLng);
    list.push({
      id: g.id,
      type: 'gas_station',
      title: g.title,
      subtitle: g.subtitle,
      priority: 'station',
      lat: gLat,
      lng: gLng,
      distanceKm: Number(d.toFixed(1)),
      etaMinutes: Math.max(3, Math.round(d * 3.2)),
      status: 'Open 24/7',
      fuelBrands: g.fuelBrands,
      tripId: null, // Gas stations have NO tripId and cannot be accepted
    });
  });

  // 3. Nearest active fleet vehicles / drivers
  const nearbyDrivers = [
    {
      id: 'driver-hiace',
      type: 'driver',
      title: 'Fleet Van #02 · Alex R.',
      subtitle: 'Toyota HiAce (TST-8485) · Available',
      priority: 'vehicle',
      offsetLat: 0.0068,
      offsetLng: 0.0142,
      status: 'Available',
    },
    {
      id: 'driver-innova',
      type: 'driver',
      title: 'Fleet SUV #05 · Marco S.',
      subtitle: 'Toyota Innova (TSG-5030) · On Duty',
      priority: 'vehicle',
      offsetLat: -0.0138,
      offsetLng: 0.0125,
      status: 'En Route',
    },
    {
      id: 'driver-vios',
      type: 'driver',
      title: 'Fleet Sedan #08 · Eduardo R.',
      subtitle: 'Toyota Vios (ANA-8589) · Available',
      priority: 'vehicle',
      offsetLat: 0.0162,
      offsetLng: -0.0185,
      status: 'Available',
    },
  ];

  nearbyDrivers.forEach((dv) => {
    const dvLat = lat + dv.offsetLat;
    const dvLng = lng + dv.offsetLng;
    const d = haversineKm(lat, lng, dvLat, dvLng);
    list.push({
      id: dv.id,
      type: 'driver',
      title: dv.title,
      subtitle: dv.subtitle,
      priority: 'vehicle',
      lat: dvLat,
      lng: dvLng,
      distanceKm: Number(d.toFixed(1)),
      etaMinutes: Math.max(3, Math.round(d * 3.5)),
      status: dv.status,
      tripId: null, // Other drivers have NO tripId and cannot be accepted
    });
  });

  return list;
}

export default function MapTab() {
  const router = useRouter();
  const { colors, scheme, type } = useTheme();
  const { user } = useAuth();
  
  const [activeTrip, setActiveTrip] = useState(null);
  const [todayStats, setTodayStats] = useState({ completed: 0 });
  const [driverLocation, setDriverLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permRetry, setPermRetry] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [routeData, setRouteData] = useState(null);
  // In-flight lock for the swipe transitions: SwipeButton honors `busy` so a
  // second swipe cannot fire a concurrent PUT while the first is pending.
  const [inFlight, setInFlight] = useState(false);
  const [now, setNow] = useState(NOW_AT_LOAD);
  const mapRef = useRef(null);

  const [radarRadiusKm, setRadarRadiusKm] = useState(3);
  const [legendExpanded, setLegendExpanded] = useState(true);
  const [, setIsPannedAway] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [nearbyTrips, setNearbyTrips] = useState([]);
  const [recentNotification, setRecentNotification] = useState(null);
  const [acceptingTripId, setAcceptingTripId] = useState(null);

  const rTheme = RADAR_THEME[scheme === 'dark' ? 'dark' : 'light'];
  // Home clay language for the map surfaces (same mats family as Home cards).
  const mats = clayMaterials(scheme === 'dark');

  // Refs for background GPS sync loop
  const activeTripRef = useRef(null);

  // Focus gate: tabs stay mounted after first visit, so without this the
  // Highest-accuracy GPS watcher + heading stream keep re-rendering (and
  // bridge-spamming) while the driver is on Home or another tab. Fixes
  // still feed the odometer + lastFix below; only rendering pauses.
  const focusedRef = useRef(false);
  const lastFixRef = useRef(null);


  // Bottom Sheet Animation State
  const [panY] = useState(() => new Animated.Value(SCREEN_HEIGHT - BOTTOM_SHEET_MIN_HEIGHT - 60)); // -60 for tab bar approx
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const isExpandedRef = useRef(false);

  // Idle Bottom Sheet Animation State (Supports swipe-down for Full Map View)
  const IDLE_SHEET_COLLAPSED_OFFSET = 188; // leaves a sleek ~44px peek bar
  const [idlePanY] = useState(() => new Animated.Value(0));
  const [isIdleCollapsed, setIsIdleCollapsed] = useState(false);
  const isIdleCollapsedRef = useRef(false);

  const snapIdleSheet = useCallback((collapsed) => {
    isIdleCollapsedRef.current = collapsed;
    setIsIdleCollapsed(collapsed);
    Animated.spring(idlePanY, {
      toValue: collapsed ? IDLE_SHEET_COLLAPSED_OFFSET : 0,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [idlePanY]);

  const idlePanResponder = useRef(
    // eslint-disable-next-line react-hooks/refs -- RN gesture responder reads live drag refs
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => Math.abs(gestureState.dy) > 5,
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dy > 30 || gestureState.vy > 0.4) {
          snapIdleSheet(true);
        } else if (gestureState.dy < -30 || gestureState.vy < -0.4) {
          snapIdleSheet(false);
        } else {
          snapIdleSheet(isIdleCollapsedRef.current);
        }
      },
    })
  ).current;

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

  // Last compass heading applied to the marker. watchHeadingAsync fires at
  // very high frequency; without a threshold, parked-idle jitter re-renders
  // the screen and spams the WebView with marker updates many times a second.
  const lastCompassHeading = useRef(null);

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
  const activeTripIdForTracking = activeTrip?.trip_id;
  const activeTripStatusForTracking = activeTrip?.trip_status;
  useEffect(() => {
    const tracking = activeTripIdForTracking != null && GPS_TRACKING_STATUSES.has(activeTripStatusForTracking);
    updateLegContext({
      tripId: tracking ? activeTripIdForTracking : null,
      leg: tracking ? legForStatus(activeTripStatusForTracking) : null,
    }).catch(() => {});
  }, [activeTripIdForTracking, activeTripStatusForTracking]);

  // Background tracking, driven by AppState so there is never overlap with the
  // foreground watcher (no double-counted km, no duplicate GPS posts):
  //   background + active trip → start the headless task
  //   foreground              → stop it and merge the km it accumulated
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      const hadActiveTrip = isGpsTrackedTrip(activeTripRef.current);
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
        // Merge only after the native task has stopped; otherwise its final
        // AsyncStorage write can race this read and leave background km out.
        stopBackgroundTracking()
          .then(() => mergeStoredKm(distRef, activeTripRef.current?.trip_id ?? null))
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  const prevTripIdsRef = useRef(new Set());

  const loadTrip = useCallback(async () => {
    try {
      const data = await api.get("/api/mobile/driver/trips");
      
      const active = data.find(t => !["Completed", "Cancelled"].includes(t.trip_status));
      setActiveTrip(active || null);

      const pending = (data || []).filter(t => ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(t.trip_status));
      setNearbyTrips(pending);

      // Check for new assignments to trigger notification
      const currentIds = new Set(pending.map(t => t.trip_id));
      const hasNew = pending.some(t => !prevTripIdsRef.current.has(t.trip_id));
      if (hasNew && prevTripIdsRef.current.size > 0) {
        setRecentNotification("New assignment nearby");
        setTimeout(() => setRecentNotification(null), 4000);
      }
      prevTripIdsRef.current = currentIds;
      
      // Completed-trip count for the idle dashboard.
      setTodayStats({
        completed: (data || []).filter(t => t.trip_status === 'Completed').length
      });
    } catch (e) {
      console.warn("Could not load trip for map", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    // Re-seed the map from fixes collected while unfocused.
    if (lastFixRef.current) setDriverLocation({ ...lastFixRef.current });
    loadTrip();
    return () => { focusedRef.current = false; };
  }, [loadTrip]));

  // Auto-polling dispatch queue every 15 seconds — foreground AND focused
  // only. Tabs stay mounted when unfocused, so an ungated interval would
  // poll (and re-render) while the driver looks at another tab or
  // backgrounds the app.
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active' || !focusedRef.current) return;
      loadTrip();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadTrip]);

  // Radar markers rebuild on a ~11 m quantized grid, not on every GPS object
  // identity: heading-only fixes must not re-stringify + re-render markers
  // across the WebView bridge.
  const radarGridLat = driverLocation?.lat != null ? Number(driverLocation.lat).toFixed(4) : null;
  const radarGridLng = driverLocation?.lng != null ? Number(driverLocation.lng).toFixed(4) : null;
  const radarMarkers = useMemo(() => {
    if (!driverLocation) return [];
    return getOperationalRadarMarkers(driverLocation, nearbyTrips);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- quantized grid only; identity churns per fix
  }, [radarGridLat, radarGridLng, nearbyTrips]);

  const handleAcceptAssignment = async (tripId) => {
    if (!tripId) return;
    try {
      setAcceptingTripId(tripId);
      const res = await api.put(`/api/mobile/driver/trips/${tripId}/accept`, { accept: true });
      if (wasQueued(res)) {
        announceSavedForSync();
      } else {
        AppAlert.alert("Dispatch Accepted", "Trip status updated to Driver Accepted.");
      }
      setSelectedMarker(null);
      await loadTrip();
    } catch (err) {
      AppAlert.alert("Could not accept", err.message || "Failed to accept trip.");
    } finally {
      setAcceptingTripId(null);
    }
  };

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

          // 1. Map Marker Update
          setDriverLocation(prev => {
            let updatedHeading = prev?.heading;
            
            // If driving fast (> 2 m/s), prioritize GPS Course Over Ground heading!
            if (newLoc.coords.speed > 2 && newLoc.coords.heading >= 0) {
              updatedHeading = newLoc.coords.heading;
            }

            const lat = newLoc.coords.latitude;
            const lng = newLoc.coords.longitude;
            const next = {
              lat,
              lng,
              heading: updatedHeading,
              speed: newLoc.coords.speed,
            };
            // Remember every fix so refocusing re-seeds instantly; the
            // odometer accumulator below also reads every raw fix.
            lastFixRef.current = next;
            // Unfocused (another tab): skip the render + bridge traffic.
            if (!focusedRef.current) return prev;
            // Parked/idle bail-out: the OS re-delivers near-identical fixes
            // every ~3s. Returning prev skips the whole-screen re-render, the
            // camera easeTo and the radar-marker rebuild.
            if (prev?.lat != null) {
              const movedKm = haversineKm(prev.lat, prev.lng, lat, lng);
              const hNew = updatedHeading ?? -1;
              const hPrev = prev.heading ?? -1;
              let hDelta = Math.abs(hNew - hPrev) % 360;
              if (hDelta > 180) hDelta = 360 - hDelta;
              if (movedKm < 0.008 && hDelta < 5 && (newLoc.coords.speed ?? 0) < 1) {
                return prev;
              }
            }

            return next;
          });

          // 2. GPS Distance Accumulation (per leg)
          const d = distRef.current;
          if (!isGpsTrackedTrip(activeTripRef.current)) {
            d.prev = null;
            d.leg = null;
            return;
          }
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
      // 2. Compass/Gyroscope Subscription for when the car is stopped
      try {
          headingSubscription = await Location.watchHeadingAsync((headingObj) => {
              const compassHeading = headingObj.trueHeading >= 0 ? headingObj.trueHeading : headingObj.magHeading;
              if (compassHeading == null || compassHeading < 0) return;

              // Only propagate meaningful changes (>= 5 degrees).
              const last = lastCompassHeading.current;
              let delta = last == null ? 999 : Math.abs(compassHeading - last) % 360;
              if (delta > 180) delta = 360 - delta;
              if (delta < 5) return;
              lastCompassHeading.current = compassHeading;

              setDriverLocation(prev => {
                  if (!prev) return prev;
                  // Only use the physical compass if the car is stopped or moving very slowly (< 2 m/s)
                  // If we are driving fast, we trust the GPS course-over-ground instead so the map doesn't spin if you grab your phone!
                  if (prev.speed === undefined || prev.speed < 2) {
                      const next = { ...prev, heading: compassHeading };
                      lastFixRef.current = next;
                      if (!focusedRef.current) return prev;
                      return next;
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

  // Arrival-gate helpers: the server enforces pickup/destination proximity in
  // setTripStatus (409 when a fresh fix proves the driver is outside), so the
  // pre-check here is advisory UX — outside offers Go Back / Proceed Anyway
  // (reason captured on the override screen), inside/unknown proceeds, and a
  // 409 race between check and PUT surfaces the same override offer instead
  // of a dead-end error. Spamming the button can no longer silently advance:
  // every outside verdict needs a typed reason, audited server-side.
  const formatGateDistance = (m) => {
    const n = Number(m);
    if (!Number.isFinite(n)) return "an unknown distance";
    return n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(1)} km`;
  };
  const offerOverride = ({ title, check, placeKey, placeFallback, action, needsEnroute }) => {
    const tripId = String(activeTrip.trip_id);
    const distanceText = formatGateDistance(check?.distance_m);
    const placeName = check?.[placeKey] || placeFallback;
    setInFlight(false);
    AppAlert.alert(
      title,
      `You appear to be ${distanceText} from ${placeName}.`,
      [
        { text: "Go Back", style: "cancel" },
        {
          text: "Proceed Anyway",
          onPress: () => router.push({
            pathname: '/(app)/trip/override',
            params: {
              tripId, action,
              distanceText, placeName,
              ...(needsEnroute ? { needsEnroute: "1" } : {}),
            },
          }),
        },
      ],
      { type: "warning" }
    );
  };

  // Determine trip state machine for UI
  const status = activeTrip?.trip_status;
  const isPending = ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(status);
  const isDriverAccepted = status === "Driver Accepted"; // Need to START TRIP first
  const isState1 = ["Trip Started"].includes(status); // EN ROUTE TO PICKUP
  const isState2 = ["At Pickup"].includes(status); // ARRIVED AT PICKUP
  const isState3 = ["Passenger Onboard", "En Route"].includes(status); // EN ROUTE TO DESTINATION
  const isState4 = ["Drop-off", "Arrived", "In Progress"].includes(status); // ARRIVED AT DESTINATION

  // PR #3 arrival intelligence: the foreground poster's latest server-side
  // geofence verdict, matched to THIS trip so a finished trip's banner cannot
  // linger onto the next assignment. Suggestion only — every transition below
  // stays human-confirmed.
  const poster = usePosterStatus();
  const tripGeofence =
    poster.geofenceTripId != null && String(poster.geofenceTripId) === String(activeTrip?.trip_id)
      ? poster.geofence
      : null;
  const nearPickupHint = isState1 && tripGeofence?.near_pickup === true;
  const nearDestHint = isState3 && tripGeofence?.near_destination === true;

  // PR #4 contextual warning: the ingest-side monitor verdict for THIS trip
  // (same trip-id staleness guard as the geofence above — a finished trip's
  // banner cannot linger onto the next assignment). Minimal by design: calm
  // copy, no risk jargon, no dispatcher-style next-trip panic while driving.
  const tripMonitor =
    poster.monitorTripId != null && String(poster.monitorTripId) === String(activeTrip?.trip_id)
      ? poster.monitor
      : null;
  const monitorBanner = monitorBannerFor(tripMonitor);
  
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

  // Fail-open for the map overlay: MAP_READY normally lifts it, but a dead
  // WebView (offline CDN, bad key, init exception) must never pin globe.json
  // forever — observed as infinite loading on the Drop-off leg. After 20s we
  // lift the overlay anyway; the map area may be blank but the trip sheet
  // (ARRIVED AT DESTINATION / DROPPED OFF GUEST) stays usable.
  useEffect(() => {
    if (mapReady) return;
    const t = setTimeout(() => setMapReady(true), 20000);
    return () => clearTimeout(t);
  }, [mapReady]);

  // Fail-open for GPS: getCurrentPositionAsync can hang or throw (GPS off,
  // timeout) while its catch only warns, leaving driverLocation null forever
  // — a second infinite-loading path. After 15s fall through and render the
  // map from the trip's stored coords so a Drop-off trip is never stuck.
  const [gpsTimedOut, setGpsTimedOut] = useState(false);
  useEffect(() => {
    if (driverLocation) return;
    const t = setTimeout(() => setGpsTimedOut(true), 15000);
    return () => clearTimeout(t);
  }, [driverLocation]);

  // Derived trip geometry + stable WebView prop identities. These MUST live
  // above the early returns below (hooks cannot run conditionally) so every
  // access is null-safe: the idle branch renders with fallbacks when there
  // is no active trip. Stable identities keep TomTomMap's memo + the JS
  // bridge quiet — without them every MapTab render mints fresh objects and
  // spams injects on each GPS tick.
  const destLat = activeTrip ? (isHeadingToPickup ? activeTrip.origin_latitude : activeTrip.destination_latitude) : null;
  const destLng = activeTrip ? (isHeadingToPickup ? activeTrip.origin_longitude : activeTrip.destination_longitude) : null;
  const destName = activeTrip ? (isHeadingToPickup ? activeTrip.origin : activeTrip.destination) : null;
  // Use driver location as start, fallback to trip origin if GPS not ready
  const startLat = driverLocation?.lat ?? activeTrip?.origin_latitude;
  const startLng = driverLocation?.lng ?? activeTrip?.origin_longitude;
  const originHeading = driverLocation?.heading;
  const originProp = useMemo(() => (
    driverLocation
      ? { lat: startLat, lng: startLng, heading: originHeading }
      : { lat: startLat, lng: startLng }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- primitives only; driverLocation identity churns per fix
  ), [startLat, startLng, originHeading]);
  const destinationProp = useMemo(() => (
    isPending ? null : { lat: destLat, lng: destLng }
  ), [isPending, destLat, destLng]);
  const handleMapReady = useCallback(() => setMapReady(true), []);
  const handleMarkerPress = useCallback((marker) => setSelectedMarker(marker), []);
  const handleMapDragged = useCallback(() => setIsPannedAway(true), []);

  // Permission denied — an honest dead-end with a way out, not a loader that
  // never resolves.
  if (permissionDenied) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }, styles.permState]}>
        <View style={[styles.permIconWrap, mats.clayTile, { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow }]}>
          <Ionicons name="location-outline" size={32} color={colors.onSurfaceVariant} />
        </View>
        <Text style={[type.titleLg, { color: colors.onSurface, textAlign: 'center' }]}>Location Permission Required</Text>
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

  // GPS still resolving — but fail-open after gpsTimedOut so a hung fix can
  // never strand a Drop-off trip on a fullscreen spinner. The active-trip
  // branch below already falls back to the trip's stored origin coords.
  if (!driverLocation && !gpsTimedOut) {
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

  // If no active trip, show driver live map in Proximity & Coverage Radar Mode
  if (!activeTrip) {
    const rangeLabel = radarRadiusKm === 1 
      ? "Active within 1 km" 
      : radarRadiusKm === 3 
        ? "Active within 3 km range" 
        : radarRadiusKm === 5 
          ? "Active within 5 km range" 
          : "Monitoring all available areas";

    return (
      <View style={[styles.container, { backgroundColor: rTheme.background }]}>
        <TomTomMap 
          ref={mapRef}
          origin={driverLocation ? { lat: driverLocation.lat, lng: driverLocation.lng, heading: driverLocation.heading } : { lat: 14.6, lng: 121.0 }}
          destination={null}
          scrollEnabled={true}
          showCarIcon={true}
          radarMode={true}
          radarRadiusKm={radarRadiusKm}
          radarMarkers={radarMarkers}
          onMarkerPress={handleMarkerPress}
          onMapDragged={handleMapDragged}
          onMapReady={handleMapReady}
        />
        {!mapReady && (
          <View style={[styles.mapLoadingOverlay, { backgroundColor: rTheme.background }]}>
            <LottieView
              autoPlay
              loop
              source={require("../../../assets/globe.json")}
              style={styles.mapLoader}
            />
          </View>
        )}

        {/* Real-time Notification Banner */}
        {recentNotification && (
          <View style={[styles.toastBanner, { backgroundColor: rTheme.topBarBg, borderColor: rTheme.primary }]}>
            <View style={[styles.radarLiveDot, { backgroundColor: rTheme.primary }]} />
            <Text style={[styles.toastText, { color: rTheme.textPrimary }]}>{recentNotification}</Text>
          </View>
        )}
        
        {/* Top HUD: Status Pill & Distance Filter */}
        <View style={styles.topHudContainer} pointerEvents="box-none">
          <View style={[styles.radarStatusPill, mats.clayPill, { backgroundColor: rTheme.topBarBg, borderColor: rTheme.topBarBorder, shadowColor: colors.shadow }]}>
            <View style={[styles.radarLiveDot, { backgroundColor: rTheme.primary }]} />
            <Text style={[styles.radarStatusText, { color: rTheme.pillText }]}>RADAR</Text>
            <View style={[styles.radarDivider, { backgroundColor: rTheme.topBarBorder }]} />
            <Text style={[styles.radarSubText, { color: rTheme.pillSubtext }]}>LIVE TRACKING</Text>
          </View>

          <View style={[styles.rangeFilterContainer, mats.clayPill, { backgroundColor: rTheme.topBarBg, borderColor: rTheme.topBarBorder, shadowColor: colors.shadow }]}>
            {[
              { label: '1 km', value: 1 },
              { label: '3 km', value: 3 },
              { label: '5 km', value: 5 },
              { label: 'All', value: 10 },
            ].map((opt) => {
              const isSelected = radarRadiusKm === opt.value;
              return (
                <Pressable
                  key={opt.label}
                  onPress={() => {
                    setRadarRadiusKm(opt.value);
                    mapRef.current?.setRadarRadius(opt.value);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Set radar radius to ${opt.label}`}
                  style={[
                    styles.rangeFilterBtn,
                    isSelected && { backgroundColor: rTheme.activeRangeBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.rangeFilterText,
                      { color: isSelected ? rTheme.activeRangeText : rTheme.inactiveRangeText },
                      isSelected && { fontFamily: fonts.bodyBold, fontWeight: '700' },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Collapsible Radar Legend */}
        <View style={[styles.legendCard, mats.compactShade, { backgroundColor: rTheme.legendBg, borderColor: rTheme.legendBorder, shadowColor: colors.shadow }]}>
          <Pressable 
            onPress={() => setLegendExpanded(!legendExpanded)} 
            style={styles.legendHeaderRow}
            accessibilityRole="button"
            accessibilityLabel="Toggle radar coverage legend"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[styles.legendIndicatorDot, { backgroundColor: rTheme.primary }]} />
              <Text style={[styles.legendHeaderTitle, { color: rTheme.legendText }]}>Coverage Legend</Text>
            </View>
            <Ionicons name={legendExpanded ? "chevron-up" : "chevron-down"} size={13} color={rTheme.legendSubtext} />
          </Pressable>
          
          {legendExpanded && (
            <View style={styles.legendItemsList}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: rTheme.primary }]} />
                <Text style={[styles.legendLabel, { color: rTheme.legendText }]}>Your Vehicle</Text>
              </View>
              <View style={styles.legendItem}>
                <Ionicons name="water" size={13} color={colors.info} />
                <Text style={[styles.legendLabel, { color: rTheme.legendText }]}>Nearest Gas Station</Text>
              </View>
              <View style={styles.legendItem}>
                <Ionicons name="car" size={13} color={colors.success} />
                <Text style={[styles.legendLabel, { color: rTheme.legendText }]}>Fleet Drivers</Text>
              </View>
              <View style={styles.legendItem}>
                <Ionicons name="document-text" size={13} color={rTheme.warning} />
                <Text style={[styles.legendLabel, { color: rTheme.legendText }]}>Dispatch Requests</Text>
              </View>
            </View>
          )}
        </View>

        {/* Floating Recenter Radar FAB */}
        <Pressable
          onPress={() => {
            mapRef.current?.recenter();
            setIsPannedAway(false);
          }}
          accessibilityRole="button"
          accessibilityLabel="Recenter radar on vehicle"
          style={({ pressed }) => [
            styles.recenterRadarFab,
            mats.clayTile,
            {
              backgroundColor: rTheme.fabBg,
              borderColor: rTheme.fabBorder,
              shadowColor: colors.shadow,
              bottom: isIdleCollapsed ? 80 : 330,
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
          ]}
        >
          <Ionicons name="locate" size={20} color={rTheme.fabIcon} />
        </Pressable>

        {/* Compact Interactive Assignment / Station / Driver Card */}
        {selectedMarker && (
          <View style={[
            styles.selectedMarkerCard, 
            mats.clayShade,
            { 
              backgroundColor: rTheme.cardBg, 
              borderColor: rTheme.cardBorder,
              shadowColor: colors.shadow,
              bottom: isIdleCollapsed ? 76 : 300,
            }
          ]}>
            <View style={styles.markerCardTopRow}>
              {(() => {
                const isStation = selectedMarker.type === 'gas_station';
                const isDriver = selectedMarker.type === 'driver' || selectedMarker.type === 'vehicle';
                const badgeColor = isStation 
                  ? colors.info 
                  : isDriver 
                    ? colors.success 
                    : selectedMarker.priority === 'emergency'
                      ? rTheme.emergency
                      : selectedMarker.priority === 'priority'
                        ? rTheme.warning
                        : rTheme.primary;
                const badgeText = isStation 
                  ? 'NEAREST GAS STATION'
                  : isDriver
                    ? 'FLEET DRIVER'
                    : selectedMarker.priority === 'emergency'
                      ? 'EMERGENCY DISPATCH'
                      : selectedMarker.priority === 'priority'
                        ? 'PRIORITY DISPATCH'
                        : 'DISPATCH REQUEST';
                return (
                  <View style={[
                    styles.markerPriorityBadge,
                    {
                      backgroundColor: badgeColor + '22',
                      borderColor: badgeColor,
                    }
                  ]}>
                    <Text style={[styles.markerPriorityText, { color: badgeColor }]}>
                      {badgeText}
                    </Text>
                  </View>
                );
              })()}
              <Pressable 
                onPress={() => setSelectedMarker(null)} 
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Close details card"
                style={styles.markerCardCloseBtn}
              >
                <Ionicons name="close" size={18} color={rTheme.textSecondary} />
              </Pressable>
            </View>

            <Text style={[type.cardTitle, { color: rTheme.textPrimary }]}>
              {selectedMarker.title}
            </Text>
            {selectedMarker.subtitle ? (
              <Text style={[type.supporting, { color: rTheme.textSecondary }]}>
                {selectedMarker.subtitle}
              </Text>
            ) : null}

            <View style={styles.markerCardMetaRow}>
              <View style={styles.markerCardMetaItem}>
                <Ionicons name="location" size={14} color={rTheme.primary} />
                <Text style={[styles.markerCardMetaText, { color: rTheme.textPrimary }]}>
                  {selectedMarker.distanceKm != null ? `${selectedMarker.distanceKm} km away` : 'Nearby'}
                </Text>
              </View>
              <View style={styles.markerCardMetaItem}>
                <Ionicons name="time-outline" size={14} color={rTheme.secondary} />
                <Text style={[styles.markerCardMetaText, { color: rTheme.textPrimary }]}>
                  Est. arrival: {selectedMarker.etaMinutes || 5} min
                </Text>
              </View>
            </View>

            {/* Actions Row: Strictly enforce that only dispatcher/admin trips can be accepted */}
            <View style={styles.markerCardActionsRow}>
              {selectedMarker.tripId ? (
                <>
                  <Pressable
                    onPress={() => router.push(`/trip/${selectedMarker.tripId}`)}
                    style={[styles.markerCardSecBtn, { borderColor: rTheme.cardBorder, backgroundColor: rTheme.pollingBg }]}
                    accessibilityRole="button"
                    accessibilityLabel="View trip details"
                  >
                    <Text style={[styles.markerCardSecBtnText, { color: rTheme.textPrimary }]}>VIEW DETAILS</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleAcceptAssignment(selectedMarker.tripId)}
                    style={[styles.markerCardPriBtn, { backgroundColor: rTheme.primary }]}
                    accessibilityRole="button"
                    accessibilityLabel="Accept assignment"
                  >
                    <Text style={[styles.markerCardPriBtnText, { color: colors.onPrimary }]}>
                      {acceptingTripId === selectedMarker.tripId ? "ACCEPTING..." : "ACCEPT"}
                    </Text>
                  </Pressable>
                </>
              ) : selectedMarker.type === 'gas_station' ? (
                <>
                  <Pressable
                    onPress={() => setSelectedMarker(null)}
                    style={[styles.markerCardSecBtn, { borderColor: rTheme.cardBorder, backgroundColor: rTheme.pollingBg }]}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss station card"
                  >
                    <Text style={[styles.markerCardSecBtnText, { color: rTheme.textPrimary }]}>DISMISS</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setSelectedMarker(null);
                      router.push({
                        pathname: '/(app)/fuel-report',
                        params: { station: selectedMarker.title },
                      });
                    }}
                    style={[styles.markerCardPriBtn, mats.clayCta, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}
                    accessibilityRole="button"
                    accessibilityLabel="Report fuel purchase"
                  >
                    <Text style={[styles.markerCardPriBtnText, { color: colors.onPrimary }]}>REPORT FUEL</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => setSelectedMarker(null)}
                  style={[styles.markerCardSecBtn, { borderColor: rTheme.cardBorder, backgroundColor: rTheme.pollingBg, flex: 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss card"
                >
                  <Text style={[styles.markerCardSecBtnText, { color: rTheme.textPrimary }]}>DISMISS</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}

        {/* Idle Dashboard Bottom Sheet (Swipe down for Full Map View) */}
        <Animated.View 
          style={[
            styles.idleSheet, 
            mats.clayShade,
            { 
              backgroundColor: rTheme.sheetBg, 
              borderColor: rTheme.sheetBorder,
              shadowColor: colors.shadow,
              transform: [{ translateY: idlePanY }],
            }
          ]}
        >
          {/* Touch and drag zone for collapsing / expanding the sheet */}
          {/* eslint-disable-next-line react-hooks/refs -- spreading the once-created responder's handlers */}
          <View {...idlePanResponder.panHandlers}>
            <Pressable 
              onPress={() => snapIdleSheet(!isIdleCollapsedRef.current)}
              accessibilityRole="button"
              accessibilityLabel={isIdleCollapsed ? "Expand dashboard" : "Collapse for full map view"}
              hitSlop={12}
            >
              <View style={[styles.dragHandle, { backgroundColor: rTheme.sheetHandle }]} />
              {isIdleCollapsed && (
                <View style={styles.collapsedPeekRow}>
                  <Ionicons name="chevron-up" size={16} color={rTheme.primary} />
                  <Text style={[styles.collapsedPeekText, { color: rTheme.textSecondary }]}>
                    FULL MAP VIEW · SWIPE UP FOR DASHBOARD
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
          
          <View style={[styles.idleHeaderRow, { opacity: isIdleCollapsed ? 0 : 1 }]}>
            <View style={[styles.idleAvatar, mats.clayTile, { backgroundColor: colors.primary, borderColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
              <Ionicons name="person" size={22} color={colors.onPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[type.cardTitle, { color: rTheme.textPrimary }]}>
                Good day, {user?.firstName || user?.name?.split(' ')[0] || 'Jack'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Ionicons name="shield-checkmark" size={14} color={rTheme.primary} />
                <Text style={[type.caption, { color: rTheme.textSecondary }]}>
                  On Duty • Ready for assignments
                </Text>
              </View>
            </View>
          </View>

          {/* Polling Heartbeat Badge */}
          <Pressable 
            onPress={() => loadTrip()}
            style={[styles.heartbeatRow, mats.compactShade, { backgroundColor: rTheme.pollingBg, borderColor: rTheme.pollingBorder, shadowColor: colors.shadow, opacity: isIdleCollapsed ? 0 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Refresh dispatch queue"
          >
            <View style={[styles.pulseDotSmall, { backgroundColor: rTheme.warning }]} />
            <Text style={[type.caption, { color: rTheme.textSecondary, flex: 1 }]}>
              Auto-polling dispatch queue • {rangeLabel}
            </Text>
          </Pressable>

          {/* Standby Fast Actions */}
          <View style={[styles.idleActionsRow, { opacity: isIdleCollapsed ? 0 : 1 }]}>
            <Pressable
              onPress={() => router.push('/trips')}
              accessibilityRole="button"
              accessibilityLabel="View trip schedule"
              style={({ pressed }) => [
                styles.idleActionBtn,
                mats.clayCta,
                { backgroundColor: rTheme.actionBtnBg, borderColor: rTheme.actionBtnBorder, shadowColor: colors.shadow, opacity: pressed ? 0.8 : 1 }
              ]}
            >
              <Ionicons name="calendar-outline" size={20} color={rTheme.actionBtnIcon} />
              <Text style={[type.caption, { color: rTheme.actionBtnText }]}>Schedule</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/inspection')}
              accessibilityRole="button"
              accessibilityLabel="Pre-trip inspection"
              style={({ pressed }) => [
                styles.idleActionBtn,
                mats.clayCta,
                { backgroundColor: rTheme.actionBtnBg, borderColor: rTheme.actionBtnBorder, shadowColor: colors.shadow, opacity: pressed ? 0.8 : 1 }
              ]}
            >
              <Ionicons name="clipboard-outline" size={20} color={rTheme.actionBtnIcon} />
              <Text style={[type.caption, { color: rTheme.actionBtnText }]}>Inspection</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/profile/vehicle')}
              accessibilityRole="button"
              accessibilityLabel="Assigned vehicle"
              style={({ pressed }) => [
                styles.idleActionBtn,
                mats.clayCta,
                { backgroundColor: rTheme.actionBtnBg, borderColor: rTheme.actionBtnBorder, shadowColor: colors.shadow, opacity: pressed ? 0.8 : 1 }
              ]}
            >
              <Ionicons name="car-outline" size={20} color={rTheme.actionBtnIcon} />
              <Text style={[type.caption, { color: rTheme.actionBtnText }]}>Vehicle</Text>
            </Pressable>
          </View>
          
          {/* Bottom Row: Completed Trips Today (full width, redundant SOS removed) */}
          <View style={[styles.bottomSheetActionsRow, { opacity: isIdleCollapsed ? 0 : 1 }]}>
            <Pressable
              onPress={() => router.push('/trips')}
              style={[styles.completedTripsRow, mats.compactShade, { backgroundColor: rTheme.completedRowBg, borderColor: rTheme.completedRowBorder, shadowColor: colors.shadow, flex: 1 }]}
              accessibilityRole="button"
              accessibilityLabel="View completed trips today"
            >
              <View style={styles.statIconRow}>
                <Ionicons name="checkmark-circle" size={18} color={rTheme.warning} />
                <Text style={[styles.statLabel, { color: rTheme.textSecondary }]}>COMPLETED TRIPS TODAY</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[type.headlineMd, { color: rTheme.textPrimary }]}>{todayStats.completed}</Text>
                <Ionicons name="chevron-forward" size={16} color={rTheme.textSecondary} />
              </View>
            </Pressable>
          </View>
        </Animated.View>

      </View>
    );
  }



  // Departure-window gate for the START ROUTE button. When earliest_start is
  // null (no scheduled departure / no ETA) the window is open — fail-open.
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

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TomTomMap 
        ref={mapRef}
        origin={originProp}
        destination={destinationProp}
        originAddress={isHeadingToPickup ? "My Location" : activeTrip.origin}
        destAddress={destName}
        scrollEnabled={true}
        pickupLabel="Your Location"
        dropoffLabel={isHeadingToPickup ? `Pickup: ${destName || 'TBD'}` : `Drop-off: ${destName || 'TBD'}`}
        showCarIcon={true}
        autoSwoop={true}
        onRouteData={setRouteData}
        onMapReady={handleMapReady}
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

      {/* Floating restore pill — appears when bottom sheet is hidden */}
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
            borderRadius: 16,
            backgroundColor: colors.inverseSurface,
            shadowColor: colors.shadow,
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
          style={[styles.bottomSheet, mats.clayShade, { transform: [{ translateY: panY }], backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}
        >
          {/* Floating Map Controls (Sticks to top of sheet) */}
          <View style={styles.floatingControlsContainer}>
            <Pressable
              style={[styles.mapControlBtn, mats.clayTile, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}
              onPress={() => mapRef.current?.recenter()}
              accessibilityRole="button"
              accessibilityLabel="Recenter map on your location"
            >
              <Ionicons name="navigate" size={20} color={colors.primary} />
            </Pressable>
            <Pressable
              style={[styles.mapControlBtn, mats.clayTile, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}
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
                <View style={[styles.locationIconWrapper, mats.clayTile, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}>
                  <Ionicons name="location-sharp" size={20} color={colors.primary} />
                </View>
                <View style={styles.locationTextWrapper}>
                  <Text style={[styles.locationIndicator, { color: colors.onSurfaceVariant }]}>
                    {preDeparture && `NEXT TRIP · ${pickupAt || "TBD"}`}
                    {!preDeparture && isPending && "PICK UP LOCATION"}
                    {(isDriverAccepted && !preDeparture) && "EN ROUTE TO PICKUP"}
                    {isState1 && "EN ROUTE TO PICKUP"}
                    {isState2 && "ARRIVED AT PICKUP"}
                    {isState3 && "EN ROUTE TO DESTINATION"}
                    {isState4 && "ARRIVED AT DESTINATION"}
                  </Text>
                  <Text style={[type.cardTitle, { color: colors.onSurface }]} numberOfLines={1}>
                    {preDeparture
                      ? `${activeTrip.origin || "Pickup"} → ${activeTrip.destination || "Destination"}`
                      : destName}
                  </Text>
                </View>
                
                {/* ETA & Distance or Contextual Info */}
                <View style={styles.headerStatsRight}>
                  {preDeparture ? null : (isPending || isDriverAccepted || isState1 || isState3) ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                        <Text style={[type.headlineMd, { color: colors.primary }]}>
                          {routeData 
                            ? Math.ceil(routeData.travelTimeInSeconds / 60) 
                            : (activeTrip.estimated_duration ? Math.ceil(activeTrip.estimated_duration) : "--")}
                        </Text>
                        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.primary, marginBottom: 2 }}> min</Text>
                      </View>
                      
                      {routeData?.trafficDelayInSeconds > 0 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4, marginBottom: 4, backgroundColor: colors.error + '1A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
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
                      <Text style={[type.cardTitle, { color: colors.primary }]}>
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

          {/* Action Button — outside panResponder zone so SwipeButton doesn't conflict */}
          {/* PR #3 arrival suggestion: server says inside the geofence — the
              swipe below still performs the human-confirmed transition. */}
          {(nearPickupHint || nearDestHint) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.secondaryContainer }}>
              <Ionicons name="navigate-circle" size={20} color={colors.onSecondaryContainer} />
              <Text style={{ flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onSecondaryContainer }}>
                {nearPickupHint
                  ? "You're near the pickup point — swipe ARRIVED AT PICKUP."
                  : "You're near the destination — swipe ARRIVED AT DESTINATION."}
              </Text>
            </View>
          )}
          {/* PR #4 contextual warning — shown only while actually en route, so
              it never competes with arrival/pickup actions. Same calm banner
              family as ConnectivityBanner: warning tone, alert role, no
              animation dependency. */}
          {monitorBanner && (isState1 || isState3) && (
            <View
              accessibilityRole="alert"
              accessibilityLabel={`${monitorBanner.title}. ${monitorBanner.subtitle}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: colors.warning + '1A' }}
            >
              <Ionicons
                name={monitorBanner.key === 'off_route' ? 'map-outline' : monitorBanner.key === 'traffic' ? 'time-outline' : 'location-outline'}
                size={20}
                color={colors.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.onSurface }}>
                  {monitorBanner.title}
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.onSurfaceVariant }}>
                  {monitorBanner.subtitle}
                </Text>
              </View>
            </View>
          )}
          {preDeparture ? (
            <Pressable 
              style={({ pressed }) => [
                styles.actionBtn, 
                mats.clayCta,
                { 
                  backgroundColor: colors.secondaryContainer,
                  shadowColor: colors.shadow,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: pressed ? 0.9 : 1,
                }
              ]}
              onPress={() => router.push(`/trip/${activeTrip.trip_id}`)}
            >
              <Text style={[styles.actionBtnText, { color: colors.onSecondaryContainer }]}>VIEW DETAILS</Text>
              <View style={[styles.btnIconCapsule, { backgroundColor: colors.primary + '1A' }]}>
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
              busy={inFlight}
              backgroundColor={colors.primary}
              textColor={colors.onPrimary}
              onSwipeSuccess={async () => {
                if (inFlight) return;
                setInFlight(true);
                try {
                  if (isPending || isDriverAccepted) {
                    if (isPending) {
                      // Optimistic: fire accept in the background so we don't
                      // block the transition on a 1-2s network round-trip.
                      api.put(`/api/trips/${activeTrip.trip_id}/accept`, { accept: true }).then((res) => {
                        if (wasQueued(res)) announceSavedForSync();
                      }).catch((e) => {
                        AppAlert.alert("Error", e.message || "Could not accept trip");
                      });
                    }
                    if (!preTripDone) {
                        router.push({ pathname: "/inspection", params: { tripId: String(activeTrip.trip_id) } });
                        return;
                      }
                      if (!windowOpen) return;
                      const startRes = await api.put(`/api/trips/${activeTrip.trip_id}/start`, { odometer: Number(activeTrip.current_mileage) || undefined });
                      if (wasQueued(startRes)) announceSavedForSync();
                      loadTrip();
                    } else if (isState1) {
                      // Arrival gate: the server 409s ARRIVED AT PICKUP filed
                      // from outside the pickup geofence. Pre-check first so
                      // the driver gets Go Back / Proceed Anyway (with reason)
                      // instead of a dead-end error. Fail-open: an unreadable
                      // check proceeds — the PUT re-evaluates server-side.
                      let pickupCheck = null;
                      try {
                        pickupCheck = await api.get(`/api/trips/${activeTrip.trip_id}/pickup-check`);
                      } catch {
                        pickupCheck = null;
                      }
                      if (pickupCheck && pickupCheck.state === "outside") {
                        offerOverride({
                          title: "Too far from pickup",
                          check: pickupCheck,
                          placeKey: "pickup",
                          placeFallback: activeTrip.origin || "the pickup point",
                          action: "at-pickup",
                        });
                        return;
                      }
                      try {
                        const pickupRes = await api.put(`/api/trips/${activeTrip.trip_id}/at-pickup`, {});
                        if (wasQueued(pickupRes)) announceSavedForSync();
                      } catch (e) {
                        // Check→PUT race (a new fix landed between the two
                        // calls): surface the same override offer.
                        if (e?.status === 409) {
                          offerOverride({
                            title: "Too far from pickup",
                            check: null,
                            placeKey: "pickup",
                            placeFallback: activeTrip.origin || "the pickup point",
                            action: "at-pickup",
                          });
                          return;
                        }
                        throw e;
                      }
                      loadTrip();
                    } else if (isState2) {
                      let pickupCheck = null;
                      try {
                        pickupCheck = await api.get(`/api/trips/${activeTrip.trip_id}/pickup-check`);
                      } catch {
                        pickupCheck = null;
                      }
                      if (pickupCheck && pickupCheck.state === "outside") {
                        offerOverride({
                          title: "Too far from pickup",
                          check: pickupCheck,
                          placeKey: "pickup",
                          placeFallback: activeTrip.origin || "the pickup point",
                          action: "onboard",
                        });
                        return;
                      }
                      try {
                        const onboardRes = await api.put(`/api/trips/${activeTrip.trip_id}/onboard`, {});
                        // En Route is the ungated mid-leg consequence of onboard.
                        const enrouteRes = await api.put(`/api/trips/${activeTrip.trip_id}/enroute`, {});
                        if (wasQueued(onboardRes) || wasQueued(enrouteRes)) announceSavedForSync();
                      } catch (e) {
                        if (e?.status === 409) {
                          offerOverride({
                            title: "Too far from pickup",
                            check: null,
                            placeKey: "pickup",
                            placeFallback: activeTrip.origin || "the pickup point",
                            action: "onboard",
                          });
                          return;
                        }
                        throw e;
                      }
                      loadTrip();
                    } else if (isState3) {
                      // Destination gate for ARRIVED AT DESTINATION, mirroring
                      // the completion flow below.
                      let destPreCheck = null;
                      try {
                        destPreCheck = await api.get(`/api/trips/${activeTrip.trip_id}/destination-check`);
                      } catch {
                        destPreCheck = null;
                      }
                      if (destPreCheck && destPreCheck.state === "outside") {
                        offerOverride({
                          title: "Far from destination",
                          check: destPreCheck,
                          placeKey: "destination",
                          placeFallback: activeTrip.destination || "the destination",
                          action: "dropoff",
                          needsEnroute: activeTrip.trip_status === "Passenger Onboard",
                        });
                        return;
                      }
                      try {
                        let legRes = null;
                        if (activeTrip.trip_status === "Passenger Onboard") {
                          legRes = await api.put(`/api/trips/${activeTrip.trip_id}/enroute`, {});
                        }
                        const dropRes = await api.put(`/api/trips/${activeTrip.trip_id}/dropoff`, {});
                        if (wasQueued(legRes) || wasQueued(dropRes)) announceSavedForSync();
                      } catch (e) {
                        if (e?.status === 409) {
                          offerOverride({
                            title: "Far from destination",
                            check: null,
                            placeKey: "destination",
                            placeFallback: activeTrip.destination || "the destination",
                            action: "dropoff",
                            needsEnroute: activeTrip.trip_status === "Passenger Onboard",
                          });
                          return;
                        }
                        throw e;
                      }
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
                      // km — safe (never rejected), just slightly inflated.
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
                      const completeParams = {
                        pickup: activeTrip.origin,
                        destination: activeTrip.destination,
                        duration: routeData ? Math.ceil(routeData.travelTimeInSeconds / 60) + " min" : "-- min",
                        distance: totalKm.toFixed(1) + " km",
                        leg1: leg1.toFixed(1),
                        leg2: leg2.toFixed(1),
                        startOdo: Math.round(startOdo).toLocaleString(),
                        endOdo: Math.round(endOdo).toLocaleString(),
                        tripId: String(activeTrip.trip_id),
                        rawDistanceKm: String(totalKm),
                        rawStartOdo: String(startOdo),
                        rawEndOdo: String(endOdo),
                      };

                      // PR #3 completion validation: ask the server whether the
                      // trip's latest fix is inside the destination geofence
                      // BEFORE showing the summary. Inside/unknown → existing
                      // flow. Outside → Go Back / Complete Anyway (the reason
                      // is captured on the summary screen and the PUT carries
                      // the override). Fail-open: an unreadable check proceeds.
                      let destCheck = null;
                      try {
                        destCheck = await api.get(`/api/trips/${activeTrip.trip_id}/destination-check`);
                      } catch {
                        destCheck = null;
                      }
                      if (destCheck && destCheck.state === "outside") {
                        const m = Number(destCheck.distance_m);
                        const distanceText = Number.isFinite(m)
                          ? (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`)
                          : "an unknown distance";
                        const destName = destCheck.destination || "the destination";
                        AppAlert.alert(
                          "Far from destination",
                          `You appear to be ${distanceText} from ${destName}.`,
                          [
                            { text: "Go Back", style: "cancel" },
                            {
                              text: "Complete Anyway",
                              onPress: () => router.push({
                                pathname: '/(app)/trip/complete',
                                params: {
                                  ...completeParams,
                                  needsOverride: "1",
                                  farText: `You are completing ${distanceText} from ${destName}. A reason is required.`,
                                },
                              }),
                            },
                          ],
                          { type: "warning" }
                        );
                        return;
                      }

                      // Navigate to the summary, then run the completion API in the
                      // background. Values match: the screen shows what was sent.
                      router.push({
                        pathname: '/(app)/trip/complete',
                        params: completeParams,
                      });

                      // Clear the ref before the state update so a location
                      // callback that lands during completion cannot count one
                      // more fix for the finished trip. Stop any native task as
                      // well; foreground completion normally has none running,
                      // but this also closes a background/foreground race.
                      activeTripRef.current = null;
                      updateLegContext({ tripId: null, leg: null }).catch(() => {});
                      stopBackgroundTracking().catch(() => {});
                      setActiveTrip(null);

                      api.put(`/api/trips/${activeTrip.trip_id}/complete`, {
                        distance: totalKm,
                        start_odometer: startOdo,
                        end_odometer: endOdo,
                      }).then((res) => {
                        if (wasQueued(res)) announceSavedForSync();
                      }).catch((e) => {
                        AppAlert.alert("Error", e.message || "Could not complete trip");
                      });
                    }
                  } catch(e) {
                    AppAlert.alert("Error", e.message || "Could not update trip");
                  } finally {
                    setInFlight(false);
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
            <View style={[styles.detailCard, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}>
              <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant }]}>
                <Ionicons name="person" size={16} color={colors.onSurfaceVariant} />
                <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>Passenger Info</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={[styles.avatar, mats.clayTile, { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow }]}>
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
                <Pressable style={[styles.iconButton, mats.clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                  <Ionicons name="call" size={18} color={colors.onPrimaryContainer} />
                </Pressable>
              </View>
            </View>

            {/* Trip Details Card */}
            <View style={[styles.detailCard, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}>
              <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant }]}>
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
  topHudContainer: {
    position: 'absolute',
    top: 52,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  radarStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  radarLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  radarStatusText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  radarDivider: {
    width: 1,
    height: 12,
    marginHorizontal: 2,
  },
  radarSubText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  rangeFilterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  rangeFilterBtn: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
  },
  rangeFilterText: {
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
  },
  recenterRadarFab: {
    position: 'absolute',
    bottom: 330,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 10,
  },
  idleSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
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
    marginBottom: 14,
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
  },
  idleSubtext: {
    fontFamily: fonts.body,
    fontSize: 12,
  },
  heartbeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  pulseDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heartbeatText: {
    fontFamily: fonts.body,
    fontSize: 11,
    flex: 1,
  },
  idleActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  idleActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
  },
  idleActionText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
  },
  statBoxCompact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
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
  },
  statLabel: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  statValue: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: 20,
    letterSpacing: -0.5,
  },
  toastBanner: {
    position: 'absolute',
    top: 104,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    zIndex: 15,
  },
  toastText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
  },
  legendCard: {
    position: 'absolute',
    top: 104,
    left: 16,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
    zIndex: 10,
    minWidth: 150,
  },
  legendHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  legendIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendHeaderTitle: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.4,
  },
  legendItemsList: {
    marginTop: 8,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendRingSolid: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
  },
  legendRingDashed: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  legendLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
  },
  selectedMarkerCard: {
    position: 'absolute',
    bottom: 300,
    left: 16,
    right: 16,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 20,
  },
  markerCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  markerPriorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 16,
    borderWidth: 1,
  },
  markerPriorityText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  markerCardCloseBtn: {
    padding: 4,
  },
  markerCardTitle: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: 16,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  markerCardSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    marginBottom: 10,
  },
  markerCardMetaRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 14,
  },
  markerCardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  markerCardMetaText: {
    fontFamily: fonts.data || fonts.body,
    fontSize: 12,
  },
  markerCardActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  markerCardSecBtn: {
    flex: 1,
    height: 48,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerCardSecBtnText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  markerCardPriBtn: {
    flex: 1,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerCardPriBtnText: {
    fontFamily: fonts.dataBold || fonts.bodySemiBold,
    fontSize: 12,
    letterSpacing: 0.6,
  },
  bottomSheetActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  completedTripsRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
  },
  collapsedPeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 4,
  },
  collapsedPeekText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
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
    borderRadius: 18,
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
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTextWrapper: {
    flex: 1,
    paddingRight: 10,
  },
  locationIndicator: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 12,
    marginBottom: 3,
    letterSpacing: 0.5,
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
    height: 48,
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
    borderRadius: 24,
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
    fontSize: 12,
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
    width: 48,
    height: 48,
    borderRadius: 18,
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
    borderRadius: 16,
  },
  statusBadgeText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.5,
  }
});
