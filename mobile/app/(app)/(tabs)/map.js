import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { StyleSheet, View, Text, Animated, PanResponder, Dimensions, Pressable, ScrollView, AppState, Linking, Image, ActivityIndicator, RefreshControl } from 'react-native';
import LottieView from "lottie-react-native";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import * as Location from 'expo-location';
import TomTomMap from "../../../components/TomTomMap";
import { METEOCON_ASSETS } from "../../../components/WeatherChip";
import { api, wasQueued } from "../../../lib/api";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAmbientWeather } from "../../../lib/ambient-weather";
import { useAuth } from "../../../lib/auth";
import { resolveDriverId } from "../../../lib/offline-cache";
import { ClayCard } from "../../../components/clay/ClayCard";
import { useConnectivity } from "../../../lib/connectivity-context";
import { getDynamicBottomOffset } from "../../../components/CurvedPillTabBar";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET, statusColors } from "../../../lib/theme";
import { clayMaterials } from "../../../lib/clay";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useDuty } from "../../../lib/use-duty";
import { useDriverProfile } from "../../../lib/driver-profile";
import SwipeButton from "../../../components/SwipeButton";
import { AppAlert } from '../../../components/AppAlert';
import { usePosterStatus, monitorBannerFor } from "../../../lib/tracking";
import { FilledButton, TonalButton } from "../../../components/ui";
import {
  useCoachMarkActions,
  useCoachMarkStatus,
  useCoachMarkState,
  CoachMarkTarget,
} from "../../../components/coachmarks";
import MapIntroPractice from "../../../components/MapIntroPractice";
import { accumulateFix, createAccumulator, haversineKm } from "../../../lib/gps-odometer";
import { isCargoLoad, loadTitle, loadSubtitle, tripStatusLabel, tripActionLabel } from "../../../lib/load-presentation";
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

// Leg assignment ("leg1" = driving to the pickup, "leg2" = to the destination)
// is owned by legForStatus() in lib/background-tracking — the same function that
// seeds the background task's context. A second copy of the status list here
// was how the foreground and background legs could disagree about which bucket
// a kilometre belonged to.

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

// Poll churn guard: the 15 s refetch builds fresh objects every time, and a new
// identity alone re-renders the whole screen plus every memo'd downstream prop
// (radar markers, WebView origin/destination, intro layers). Keep the previous
// reference when the payload is deep-equal so an unchanged poll is a render
// no-op. Serialized comparison is drift-proof against new server fields; the
// lists are a driver's own trips (a few KB), so the stringify is far cheaper
// than the render it prevents.
function samePayload(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// Haversine and the segment acceptance rules live in lib/gps-odometer — the
// same module the background task uses. Keeping a second copy here is exactly
// how the foreground and background odometers drifted apart.

function driverLocationFromFix(location) {
  const lat = Number(location?.coords?.latitude);
  const lng = Number(location?.coords?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const heading = Number(location?.coords?.heading);
  const speed = Number(location?.coords?.speed);
  return {
    lat,
    lng,
    heading: Number.isFinite(heading) && heading >= 0 ? heading : undefined,
    speed: Number.isFinite(speed) ? speed : undefined,
  };
}

// Max km a single GPS segment can plausibly be before we treat it as a
// jump/glitch, and the minimum that counts as movement rather than parked
// jitter, now live in lib/gps-odometer (shared with the background task).

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

// Generates real and anchored nearby dispatch nodes matching the reference design.
//
// DATA PROVENANCE — read before changing anything here.
//
//   assignment markers → REAL server data (the driver's own pending trips from
//     GET /api/mobile/driver/trips). Rendered in every build. A trip whose
//     pickup coordinates are unresolved is SKIPPED, never placed at a guessed
//     offset: a fabricated pin on a real dispatch is worse than no pin,
//     because the driver taps it and gets a distance to a place that is not
//     where the trip actually starts.
//
//   gas_station / driver markers → DEMO DATA. These are hard-coded brand
//     strings at fixed offsets from the driver's live position. They are not
//     from any API, they are not near any real station, and they are not near
//     any real colleague. `DEMO_ENTITY_MODE` (below) is the ONLY thing allowed
//     to switch them on, and it is off in production.
const DEMO_ENTITY_MODE = __DEV__;

function getOperationalRadarMarkers(userLocation, pendingTrips) {
  const list = [];
  if (!userLocation) return list;
  const { lat, lng } = userLocation;

  // 1. Real pending trips assigned to this driver. Always rendered.
  if (Array.isArray(pendingTrips)) {
    pendingTrips.forEach((t) => {
      // No coordinates = no marker. Previously this fell back to
      // `lat + 0.008`, which put a real dispatch pin roughly 900 m from
      // wherever the driver happened to be standing and reported a distance
      // and ETA to it.
      if (t.origin_latitude == null || t.origin_longitude == null) return;
      const tLat = Number(t.origin_latitude);
      const tLng = Number(t.origin_longitude);
      if (!Number.isFinite(tLat) || !Number.isFinite(tLng)) return;
      const d = haversineKm(lat, lng, tLat, tLng);
      const isEmergency = t.special_requests?.toLowerCase().includes('emergency') || t.notes?.toLowerCase().includes('emergency');
      list.push({
        id: `trip_${t.trip_id}`,
        type: 'assignment',
        title: isCargoLoad(t) ? `${loadTitle(t)} (${t.origin || 'Pickup'})` : t.passenger_name ? `${t.passenger_name} (${t.origin || 'Pickup'})` : (t.origin || 'Hotel Guest Transfer'),
        subtitle: t.destination ? `To ${t.destination}` : 'Scheduled Dispatch',
        priority: isEmergency ? 'emergency' : 'normal',
        lat: tLat,
        lng: tLng,
        distanceKm: Number(d.toFixed(1)),
        // Client estimate (haversine km × 20 km/h), NOT a routed ETA. Labelled
        // "Est. arrival" in the card, and deliberately absent in production
        // where no assignment pin is shown without coordinates anyway.
        etaMinutes: Math.max(3, Math.round(d * 3.5)),
        etaSource: 'client-estimate',
        status: t.trip_status,
        tripId: t.trip_id,
        rawData: t,
      });
    });
  }

  // ─── DEMO DATA BELOW THIS LINE — not server-backed ────────────────────────
  // 2. Nearest partner and major gas stations (strictly aligned with fleet fuel documentation)
  if (!DEMO_ENTITY_MODE) return list;

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

  // 3. Nearest active fleet vehicles / drivers — DEMO, same gate as above.
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

export const MAP_EMPTY_STATES = {
  off_duty: {
    key: "off_duty",
    statusPill: "OFF DUTY",
    title: "You’re Off Duty",
    description: "Live trip tracking becomes available when you start your shift.",
    iconType: "off_duty",
  },
  rest_day: {
    key: "rest_day",
    statusPill: "REST DAY",
    title: "Today is Your Rest Day",
    description: "No operational map or trip tracking is needed today.",
    iconType: "rest_day",
  },
  on_leave: {
    key: "on_leave",
    statusPill: "ON LEAVE",
    title: "You’re Currently on Leave",
    description: "Live trip tracking will be available when you return to active duty.",
    iconType: "on_leave",
  },
};

export function resolveMapEmptyState({ duty, profile, user, paramStatus, activeTrip } = {}) {
  // Direct override via route query parameters for tests & previews
  if (paramStatus) {
    const clean = String(paramStatus).toLowerCase().trim().replace(/[-_\s]+/g, "");
    if (clean === "offduty") return "off_duty";
    if (clean === "restday") return "rest_day";
    if (clean === "onleave" || clean === "leave") return "on_leave";
  }

  // Active in-progress trip always displays operational map
  if (activeTrip != null) return null;

  // 1. Evaluate "Currently on Leave"
  const isLeave =
    profile?.driverStatus === "On Leave" ||
    user?.driver_status === "On Leave" ||
    user?.status === "On Leave" ||
    (duty?.loaded && duty?.today?.blocked && duty?.today?.reason?.toLowerCase().includes("leave"));
  if (isLeave) return "on_leave";

  // 2. Evaluate "Rest Day"
  const isRestDay =
    profile?.driverStatus === "Rest Day" ||
    (duty?.loaded && duty?.today?.blocked && duty?.today?.reason?.toLowerCase().includes("rest day"));
  if (isRestDay) return "rest_day";

  // 3. Evaluate "Off Duty"
  const isOffDuty =
    profile?.driverStatus === "Off Duty" ||
    user?.driver_status === "Off Duty" ||
    user?.status === "Off Duty" ||
    (duty?.loaded && !duty.checkedIn);
  if (isOffDuty) return "off_duty";

  // Active operational state (on duty)
  return null;
}

export default function MapTab() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors, scheme, type } = useTheme();
  const insets = useSafeAreaInsets();
  const { triggerMilestone, notifyInteraction } = useCoachMarkActions();
  const { activeMilestone, mapIntroPending, mapIntroAwaitingTap } =
    useCoachMarkStatus();
  // The Map screen is the tour's own screen, so it does have to follow the step
  // index — but it no longer re-renders for a target re-measuring mid-step.
  const { currentStepIndex } = useCoachMarkState();
  const { status: connectivity } = useConnectivity();
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  const duty = useDuty();
  const { profile } = useDriverProfile();
  const [activeTrip, setActiveTrip] = useState(null);

  const emptyStateKey = useMemo(() => {
    return resolveMapEmptyState({
      duty,
      profile,
      user,
      paramStatus: params?.status || params?.empty_state || params?.mode,
      activeTrip,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field-level identity prevents churn on fresh object references
  }, [
    duty?.loaded,
    duty?.checkedIn,
    duty?.today?.blocked,
    duty?.today?.reason,
    profile?.driverStatus,
    user?.driver_status,
    user?.status,
    params?.status,
    params?.empty_state,
    params?.mode,
    activeTrip,
  ]);

  const { chip: rawWeatherChip, weather: weatherDetails } = useAmbientWeather(null, driverId);
  // Stable chip identity: the hook builds a fresh object per call, which
  // would re-render the standby card on every parent render (same memo
  // discipline as the Home header chip).
  const weather = useMemo(
    () => rawWeatherChip,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field-wise identity; the object itself is always new
    [rawWeatherChip?.icon, rawWeatherChip?.temperature, rawWeatherChip?.label, rawWeatherChip?.isNight]
  );
  // Same Meteocons art as the Home chip (the model now carries semantic keys,
  // not Ionicons names) — hoisted so no new object is built inside the JSX.
  const weatherArt = weather ? METEOCON_ASSETS[weather.icon] : null;
  const standbyBottom = getDynamicBottomOffset(insets.bottom) + 64 + 16;
  const [driverLocation, setDriverLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permRetry, setPermRetry] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [routeData, setRouteData] = useState(null);
  // True when the WebView reported ROUTE_UNAVAILABLE: the last routeData (if
  // any) is retained for context but must NOT be presented as a live ETA.
  const [routeStale, setRouteStale] = useState(false);
  // Contract with TomTomMap.js WebView messages:
  //   ROUTE_CALCULATED  → fresh traffic-aware live route
  //   ROUTE_REFRESHING  → recalculation started (keep old numbers, not stale)
  //   ROUTE_UNAVAILABLE → TomTom failed; stop presenting old numbers as live
  const handleRouteMessage = useCallback((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ROUTE_CALCULATED") {
      setRouteData({
        travelTimeInSeconds: msg.travelTimeInSeconds,
        lengthInMeters: msg.lengthInMeters,
        trafficDelayInSeconds: msg.trafficDelayInSeconds,
        noTrafficTravelTimeInSeconds: msg.noTrafficTravelTimeInSeconds ?? null,
        calculatedAt: msg.calculatedAt || Date.now(),
        source: "tomtom-live",
        trafficAware: true,
      });
      setRouteStale(false);
    } else if (msg.type === "ROUTE_UNAVAILABLE") {
      setRouteStale(true);
    }
  }, []);
  // In-flight lock for the swipe transitions: SwipeButton honors `busy` so a
  // second swipe cannot fire a concurrent PUT while the first is pending.
  const [inFlight, setInFlight] = useState(false);
  const [now, setNow] = useState(NOW_AT_LOAD);
  const mapRef = useRef(null);

  const radarRadiusKm = 5;
  const [legendExpanded, setLegendExpanded] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [nearbyTrips, setNearbyTrips] = useState([]);
  const [recentNotification, setRecentNotification] = useState(null);
  const [acceptingTripId, setAcceptingTripId] = useState(null);
  const [coverageVisibility, setCoverageVisibility] = useState({
    vehicle: true,
    gas_station: false,
    driver: false,
    assignment: true,
  });

  const toggleCoverage = useCallback((key) => {
    setCoverageVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
    // Clearing a selection owned by the layer being hidden must happen OUTSIDE
    // the updater. Calling setState from inside another setState's updater is a
    // side effect during React's render phase: StrictMode invokes updaters
    // twice (so it fires twice) and concurrent rendering warns on it. The
    // handler is bound to a render that already holds the current selection, so
    // reading it here is correct and side-effect free. `coverageVisibility[key]`
    // is the PRE-toggle value, so "hiding" means it is currently true.
    if (coverageVisibility[key] && selectedMarker) {
      const ownedByHiddenLayer =
        (key === 'gas_station' && selectedMarker.type === 'gas_station') ||
        (key === 'driver' && (selectedMarker.type === 'driver' || selectedMarker.type === 'vehicle')) ||
        (key === 'assignment' && selectedMarker.type === 'assignment');
      if (ownedByHiddenLayer) setSelectedMarker(null);
    }
  }, [coverageVisibility, selectedMarker]);

  const showAllCoverage = useCallback(() => {
    setCoverageVisibility({
      vehicle: true,
      gas_station: true,
      driver: true,
      assignment: true,
    });
  }, []);

  const rTheme = RADAR_THEME[scheme === 'dark' ? 'dark' : 'light'];
  // Home clay language for the map surfaces (same mats family as Home cards).
  const mats = clayMaterials(scheme === 'dark');
  const isDark = scheme === 'dark';

  const emptyTheme = useMemo(() => {
    if (isDark) {
      return {
        bgColors: ['#06130E', '#030A07', '#020504'],
        bgLocations: [0, 0.45, 1],
        waveBorderColor: 'rgba(52, 211, 153, 0.12)',
        wave1Colors: ['rgba(20, 83, 62, 0.35)', 'rgba(6, 40, 29, 0.10)', 'transparent'],
        wave2Colors: ['rgba(16, 185, 129, 0.14)', 'rgba(5, 46, 32, 0.06)', 'transparent'],
        wave3Colors: ['rgba(52, 211, 153, 0.12)', 'rgba(4, 28, 20, 0.04)', 'transparent'],
        brandTitle: '#FFFFFF',
        brandSubtitle: 'rgba(255, 255, 255, 0.55)',
        bellBg: 'rgba(255, 255, 255, 0.06)',
        bellBorder: 'rgba(255, 255, 255, 0.12)',
        bellIcon: '#FFFFFF',
        haloBg: 'rgba(16, 185, 129, 0.16)',
        haloShadow: '#10B981',
        cardColors: ['#103C2E', '#0A251C'],
        cardBorder: 'rgba(52, 211, 153, 0.45)',
        cardShadow: '#34D399',
        iconColor: '#FFFFFF',
        pillBg: 'rgba(16, 185, 129, 0.12)',
        pillBorder: 'rgba(52, 211, 153, 0.28)',
        pillDot: '#34D399',
        pillText: '#E6FFFA',
        title: '#FFFFFF',
        description: '#94A3B8',
        spinner: '#34D399',
      };
    }
    return {
      bgColors: ['#F0FDF4', '#F4F7F5', '#EAEFEA'],
      bgLocations: [0, 0.5, 1],
      waveBorderColor: 'rgba(40, 84, 72, 0.08)',
      wave1Colors: ['rgba(40, 84, 72, 0.10)', 'rgba(40, 84, 72, 0.03)', 'transparent'],
      wave2Colors: ['rgba(16, 185, 129, 0.08)', 'rgba(40, 84, 72, 0.02)', 'transparent'],
      wave3Colors: ['rgba(52, 211, 153, 0.07)', 'rgba(40, 84, 72, 0.02)', 'transparent'],
      brandTitle: '#17382F',
      brandSubtitle: '#285448',
      bellBg: '#FFFFFF',
      bellBorder: 'rgba(40, 84, 72, 0.14)',
      bellIcon: '#17382F',
      haloBg: 'rgba(40, 84, 72, 0.08)',
      haloShadow: '#285448',
      cardColors: ['#FFFFFF', '#E8F5EE'],
      cardBorder: 'rgba(40, 84, 72, 0.22)',
      cardShadow: 'rgba(40, 84, 72, 0.18)',
      iconColor: '#17382F',
      pillBg: '#DCFCE7',
      pillBorder: 'rgba(22, 101, 52, 0.20)',
      pillDot: '#16A34A',
      pillText: '#166534',
      title: '#17382F',
      description: '#53615A',
      spinner: '#285448',
    };
  }, [isDark]);

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
  const distRef = useRef(createAccumulator());

  // Last compass heading applied to the marker. watchHeadingAsync fires at
  // very high frequency; without a threshold, parked-idle jitter re-renders
  // the screen and spams the WebView with marker updates many times a second.
  const lastCompassHeading = useRef(null);

  useEffect(() => {
    activeTripRef.current = activeTrip;
    // Reset route data only when it's a completely new trip (leg changes are
    // handled by the routeLegKey effect below, which also covers the
    // pickup → destination switch inside one trip_id).
    if (activeTrip?.trip_id !== lastTripId.current) {
      setRouteData(null);
      setRouteStale(false);
      lastTripId.current = activeTrip?.trip_id;
      // A new trip resets the accumulated leg distances so a previous trip's km
      // never bleeds into the next one.
      distRef.current = createAccumulator();
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
        distRef.current.pending = null;
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

      // Pick the trip the map should be driving BEFORE anything else. The
      // server returns rows ordered by `scheduled_departure ASC NULLS LAST`,
      // so a plain "first non-terminal row" wins on a PENDING assignment that
      // happens to sort ahead of the trip the driver is actually mid-way
      // through — the map then rendered the wrong route, the wrong status
      // header and the wrong swipe action, and the GPS leg accumulator was
      // re-pointed at a trip the driver had not started. A GPS-tracked trip
      // always wins; only when there is none do we fall back to pre-start.
      const list = Array.isArray(data) ? data : [];
      const active = list.find(isGpsTrackedTrip) || list.find((t) => !["Completed", "Cancelled"].includes(t.trip_status));
      // Bail out on identical payloads (see samePayload): every poll mints new
      // objects, and without this the screen re-renders every 15 s forever.
      setActiveTrip((prev) => {
        const next = active || null;
        return samePayload(prev, next) ? prev : next;
      });

      const pending = list.filter((t) => ["Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned", "Dispatched"].includes(t.trip_status));
      setNearbyTrips((prev) => (samePayload(prev, pending) ? prev : pending));

      // Check for new assignments to trigger notification
      const currentIds = new Set(pending.map(t => t.trip_id));
      const hasNew = pending.some(t => !prevTripIdsRef.current.has(t.trip_id));
      if (hasNew && prevTripIdsRef.current.size > 0) {
        setRecentNotification("New assignment nearby");
        setTimeout(() => setRecentNotification(null), 4000);
      }
      prevTripIdsRef.current = currentIds;
      
    } catch (e) {
      console.warn("Could not load trip for map", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // `duty` is a fresh object every render (useDuty spreads state), so it must
  // never appear in a dep array — only the stable `refresh` callback.
  const dutyRefresh = duty?.refresh;
  const [emptyRefreshing, setEmptyRefreshing] = useState(false);
  const handleEmptyRefresh = useCallback(async () => {
    setEmptyRefreshing(true);
    try {
      await Promise.allSettled([
        dutyRefresh?.(),
        loadTrip(),
      ]);
    } finally {
      setEmptyRefreshing(false);
    }
  }, [dutyRefresh, loadTrip]);

  useEffect(() => {
    if (
      focusedRef.current &&
      !loading &&
      activeTrip &&
      isGpsTrackedTrip(activeTrip) &&
      !mapIntroPending &&
      !mapIntroAwaitingTap &&
      activeMilestone !== "map_intro"
    ) {
      triggerMilestone("live_trip");
    }
  }, [
    loading,
    activeTrip,
    triggerMilestone,
    activeMilestone,
    mapIntroPending,
    mapIntroAwaitingTap,
  ]);

  const handleMapPracticeSuccess = useCallback(
    (data) => notifyInteraction("map.trip_practice", data),
    [notifyInteraction]
  );

  // The local practice only mounts once the Map-intro configuration reaches
  // its first swipe step. It is deliberately absent from the real trip action
  // path, so the production SwipeButton and its API callbacks remain intact.
  const mapIntroPractice = useMemo(() => {
    if (activeMilestone !== "map_intro" || currentStepIndex < 3) return null;
    return (
      <View style={styles.mapIntroPractice} pointerEvents="box-none">
        <CoachMarkTarget targetId="map.trip_practice" style={styles.mapIntroPracticeTarget}>
          <MapIntroPractice onStageSuccess={handleMapPracticeSuccess} />
        </CoachMarkTarget>
      </View>
    );
  }, [activeMilestone, currentStepIndex, handleMapPracticeSuccess]);

  // Active trips do not render the standby radar Layers button. Keep the
  // first Map tour usable without pretending that the route sheet has a
  // production Layers action; this small read-only preview is tutorial-only.
  const mapIntroActiveLayers = useMemo(() => {
    if (activeMilestone !== "map_intro" || currentStepIndex !== 2 || !activeTrip) return null;
    return (
      <CoachMarkTarget targetId="map.layers" radius={16} style={styles.mapIntroActiveLayersTarget}>
        <View
          pointerEvents="none"
          style={[
            styles.mapIntroActiveLayers,
            mats.clayTile,
            {
              backgroundColor: colors.surfaceContainerLow,
              borderColor: colors.outlineVariant,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <Ionicons name="layers-outline" size={20} color={colors.primary} />
          <Text style={[styles.mapIntroActiveLayersText, { color: colors.onSurface }]}>Map layers</Text>
        </View>
      </CoachMarkTarget>
    );
  }, [activeMilestone, currentStepIndex, activeTrip, mats.clayTile, colors]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    // Re-seed the map from fixes collected while unfocused. Functional set
    // with an equality bail-out so a re-run with an unchanged fix does not
    // mint a new object and re-render for nothing.
    if (lastFixRef.current) {
      const seed = lastFixRef.current;
      setDriverLocation((prev) => (
        prev?.lat === seed.lat && prev?.lng === seed.lng && prev?.heading === seed.heading && prev?.speed === seed.speed
          ? prev
          : { ...seed }
      ));
    }
    if (!emptyStateKey) {
      loadTrip();
    }
    dutyRefresh?.();
    return () => { focusedRef.current = false; };
  }, [loadTrip, emptyStateKey, dutyRefresh]));

  // Auto-polling dispatch queue every 15 seconds — foreground AND focused
  // only. Tabs stay mounted when unfocused, so an ungated interval would
  // poll (and re-render) while the driver looks at another tab or
  // backgrounds the app. Suppressed when in an empty state.
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active' || !focusedRef.current || emptyStateKey) return;
      loadTrip();
    }, 15000);
    return () => clearInterval(timer);
  }, [loadTrip, emptyStateKey]);

  // Radar markers rebuild on a ~11 m quantized grid, not on every GPS object
  // identity: heading-only fixes must not re-stringify + re-render markers
  // across the WebView bridge.
  //
  // The `__DEV__` gate that used to sit here returned [] for EVERY marker,
  // including the driver's own real pending assignments — so a production
  // build rendered an empty radar and the coverage legend described layers
  // that could never appear. The dev-only concern (fabricated gas stations and
  // fleet drivers) is now handled INSIDE getOperationalRadarMarkers by
  // DEMO_ENTITY_MODE, so real data is not collaterally suppressed.
  const radarGridLat = driverLocation?.lat != null ? Number(driverLocation.lat).toFixed(4) : null;
  const radarGridLng = driverLocation?.lng != null ? Number(driverLocation.lng).toFixed(4) : null;
  const radarMarkers = useMemo(() => {
    if (!driverLocation) return [];
    return getOperationalRadarMarkers(driverLocation, nearbyTrips);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- quantized grid only; identity churns per fix
  }, [radarGridLat, radarGridLng, nearbyTrips]);

  const filteredRadarMarkers = useMemo(() => {
    return radarMarkers.filter((m) => {
      if (m.type === 'gas_station') return coverageVisibility.gas_station;
      if (m.type === 'driver' || m.type === 'vehicle') return coverageVisibility.driver;
      if (m.type === 'assignment') return coverageVisibility.assignment;
      return true;
    });
  }, [radarMarkers, coverageVisibility]);

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
    if (emptyStateKey) return;
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

      // Seed the marker from a cached fix when available. The fresh request can
      // be slow or fail on some Android devices; that must not leave the map
      // without a vehicle while the watcher is being established.
      let loc = null;
      try {
        loc = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
      } catch (error) {
        console.warn('[Map] Fresh location unavailable:', error?.message || error);
      }
      let initialFix = driverLocationFromFix(loc);
      if (!initialFix) {
        try {
          loc = await Location.getLastKnownPositionAsync({
            maxAge: 5 * 60 * 1000,
            requiredAccuracy: 1000,
          });
        } catch (error) {
          console.warn('[Map] Last known location unavailable:', error?.message || error);
        }
        initialFix = driverLocationFromFix(loc);
      }
      if (initialFix) {
        lastFixRef.current = initialFix;
        setDriverLocation(initialFix);
      }

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
            d.pending = null;
            d.leg = null;
            return;
          }
          const leg = legForStatus(activeTripRef.current?.trip_status);
          const lat = newLoc.coords.latitude;
          const lng = newLoc.coords.longitude;

          // Shared rule set (lib/gps-odometer): drops >400 m jumps, anything
          // implying more than 180 km/h, stale-gap distance, and parked jitter.
          // A long-gap fix becomes a candidate until a plausible next fix
          // confirms it. When the leg changes, the straddling fix is dropped.
          accumulateFix(d, {
            lat,
            lng,
            speedMs: newLoc.coords.speed ?? null,
            atMs: newLoc.timestamp ?? null,
            leg,
          });
        }
      );
      // 2. Compass/Gyroscope Subscription for when the car is stopped
      try {
          headingSubscription = await Location.watchHeadingAsync((headingObj) => {
              const compassHeading = headingObj.trueHeading >= 0 ? headingObj.trueHeading : headingObj.magHeading;
              if (compassHeading == null || compassHeading < 0) return;

              // Only propagate meaningful changes (>= 10 degrees).
              const last = lastCompassHeading.current;
              let delta = last == null ? 999 : Math.abs(compassHeading - last) % 360;
              if (delta > 180) delta = 360 - delta;
              if (delta < 10) return;
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
  }, [permRetry, emptyStateKey]);

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

  // Countdown tick: re-renders every 30s so the departure-window gate flips
  // when the window opens, AND so the standby header's freshness test
  // (`now - poster.standbyObservedAt <= 90000`) can actually go stale.
  //
  // This used to run only while a PRE-START trip was showing. `now` therefore
  // stayed frozen at module load for the whole idle/standby period, and
  // `now - standbyObservedAt` was a large NEGATIVE number, so the "Live
  // Tracking" chip kept claiming a live publication long after the poster had
  // stopped or failed. A truthfulness bug, not a cosmetic one: the driver is
  // told dispatch can see them when it cannot. Cheap fix — the tick is 30 s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

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
  // Pickup → destination leg changes keep the same trip_id, so the trip-id
  // reset above is not enough: an old "3 min to pickup" ETA would linger on
  // the "EN ROUTE TO DESTINATION" header until TomTom answers (or forever if
  // it fails). Clear live route numbers whenever the routing target changes.
  const routeLegKey = `${activeTrip?.trip_id ?? "none"}|${isHeadingToPickup ? "pickup" : "dest"}|${destLat ?? ""}|${destLng ?? ""}`;
  const lastRouteLegKey = useRef(routeLegKey);
  useEffect(() => {
    if (routeLegKey !== lastRouteLegKey.current) {
      lastRouteLegKey.current = routeLegKey;
      setRouteData(null);
      setRouteStale(false);
    }
  }, [routeLegKey]);
  const handleMapReady = useCallback(() => setMapReady(true), []);
  const handleMarkerPress = useCallback((marker) => setSelectedMarker(marker), []);
  const handleMapDragged = useCallback(() => {}, []);

  // The first Map tutorial is a UI walkthrough, so it must be able to render
  // even when location permission is unavailable. GPS only controls the car
  // marker; it is not a prerequisite for explaining the Map screen.
  const shouldRenderMapBeforeGps = activeMilestone === "map_intro" || mapIntroPending;

  // Cold start resolution: while duty eligibility resolves on first mount, keep
  // the dark companion shell stable without flashing the GPS map or location dialog.
  // Cold start resolution: while duty eligibility resolves on first mount, keep
  // the companion shell stable without flashing the GPS map or location dialog.
  const isDutyResolving = !duty?.loaded && !profile && !activeTrip && !params?.status && !params?.empty_state && !params?.mode;
  if (isDutyResolving) {
    return (
      <View style={[styles.emptyScreenContainer, { backgroundColor: emptyTheme.bgColors[0] }]}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <LinearGradient
            colors={emptyTheme.bgColors}
            locations={emptyTheme.bgLocations}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.waveRibbon1, { borderColor: emptyTheme.waveBorderColor }]}>
            <LinearGradient
              colors={emptyTheme.wave1Colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </View>
        <View style={[styles.emptyHeader, { paddingTop: Math.max(insets.top, 16) + 6 }]}>
          <View style={styles.headerBrandRow}>
            <View style={styles.headerLogoBadge}>
              <Ionicons name="car" size={20} color="#042F24" />
            </View>
            <View style={styles.headerBrandTextCol}>
              <Text style={[styles.headerBrandTitle, { color: emptyTheme.brandTitle }]}>FleetOps</Text>
              <Text style={[styles.headerBrandSubtitle, { color: emptyTheme.brandSubtitle }]}>DRIVER COMPANION</Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerBellBtn,
              { backgroundColor: emptyTheme.bellBg, borderColor: emptyTheme.bellBorder },
              pressed && { opacity: 0.75, transform: [{ scale: 0.95 }] },
            ]}
          >
            <Ionicons name="notifications-outline" size={20} color={emptyTheme.bellIcon} />
          </Pressable>
        </View>
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator size="large" color={emptyTheme.spinner} />
        </View>
      </View>
    );
  }

  // FleetOps Driver Companion — Map Tab Empty States
  // When driver status is Off Duty, Rest Day, or On Leave, render the intentional empty state.
  if (emptyStateKey && MAP_EMPTY_STATES[emptyStateKey]) {
    const config = MAP_EMPTY_STATES[emptyStateKey];
    return (
      <View style={[styles.emptyScreenContainer, { backgroundColor: emptyTheme.bgColors[0] }]}>
        {/* Subtle abstract curves/waves in background */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <LinearGradient
            colors={emptyTheme.bgColors}
            locations={emptyTheme.bgLocations}
            style={StyleSheet.absoluteFill}
          />
          {/* Top-left sweeping wave ribbon */}
          <View style={[styles.waveRibbon1, { borderColor: emptyTheme.waveBorderColor }]}>
            <LinearGradient
              colors={emptyTheme.wave1Colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
          {/* Mid-right sweeping wave ribbon */}
          <View style={[styles.waveRibbon2, { borderColor: emptyTheme.waveBorderColor }]}>
            <LinearGradient
              colors={emptyTheme.wave2Colors}
              start={{ x: 0.8, y: 0.2 }}
              end={{ x: 0.1, y: 0.9 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
          {/* Bottom sweeping glow arc */}
          <View style={[styles.waveRibbon3, { borderColor: emptyTheme.waveBorderColor }]}>
            <LinearGradient
              colors={emptyTheme.wave3Colors}
              start={{ x: 0.2, y: 0.8 }}
              end={{ x: 0.9, y: 0.1 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </View>

        {/* Top App Header */}
        <View style={[styles.emptyHeader, { paddingTop: Math.max(insets.top, 16) + 6 }]}>
          <View style={styles.headerBrandRow}>
            <View style={styles.headerLogoBadge}>
              <Ionicons name="car" size={20} color="#042F24" />
            </View>
            <View style={styles.headerBrandTextCol}>
              <Text style={[styles.headerBrandTitle, { color: emptyTheme.brandTitle }]}>FleetOps</Text>
              <Text style={[styles.headerBrandSubtitle, { color: emptyTheme.brandSubtitle }]}>DRIVER COMPANION</Text>
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={8}
            style={({ pressed }) => [
              styles.headerBellBtn,
              { backgroundColor: emptyTheme.bellBg, borderColor: emptyTheme.bellBorder },
              pressed && { opacity: 0.75, transform: [{ scale: 0.95 }] },
            ]}
          >
            <Ionicons name="notifications-outline" size={20} color={emptyTheme.bellIcon} />
          </Pressable>
        </View>

        {/* Centered Empty-State Content */}
        <ScrollView
          contentContainerStyle={[
            styles.emptyScrollContent,
            { paddingBottom: insets.bottom + 90 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={emptyRefreshing}
              onRefresh={handleEmptyRefresh}
              tintColor={emptyTheme.spinner}
              colors={[emptyTheme.spinner]}
            />
          }
        >
          <View style={styles.emptyCenterContent}>
            {/* Glowing Icon Card */}
            <View style={styles.iconGlowWrapper}>
              <View style={[styles.iconAmbientHalo, { backgroundColor: emptyTheme.haloBg, shadowColor: emptyTheme.haloShadow }]} />
              <LinearGradient
                colors={emptyTheme.cardColors}
                start={{ x: 0.1, y: 0.1 }}
                end={{ x: 0.9, y: 0.9 }}
                style={[styles.iconCardSurface, { borderColor: emptyTheme.cardBorder, shadowColor: emptyTheme.cardShadow }]}
              >
                {config.iconType === 'off_duty' && (
                  <MaterialCommunityIcons name="map-marker-off" size={46} color={emptyTheme.iconColor} />
                )}
                {config.iconType === 'rest_day' && (
                  <MaterialCommunityIcons name="calendar-minus" size={48} color={emptyTheme.iconColor} />
                )}
                {config.iconType === 'on_leave' && (
                  <View style={styles.calendarSlashIconWrap}>
                    <MaterialCommunityIcons name="calendar-blank-outline" size={48} color={emptyTheme.iconColor} />
                    <View style={[styles.calendarSlashBar, { backgroundColor: emptyTheme.iconColor }]} />
                  </View>
                )}
              </LinearGradient>
            </View>

            {/* Status Pill */}
            <View style={[styles.emptyStatusPill, { backgroundColor: emptyTheme.pillBg, borderColor: emptyTheme.pillBorder }]}>
              <View style={[styles.emptyStatusDot, { backgroundColor: emptyTheme.pillDot, shadowColor: emptyTheme.pillDot }]} />
              <Text style={[styles.emptyStatusPillText, { color: emptyTheme.pillText }]}>{config.statusPill}</Text>
            </View>

            {/* Title */}
            <Text style={[styles.emptyStateTitle, { color: emptyTheme.title }]}>{config.title}</Text>

            {/* Short Supporting Description */}
            <Text style={[styles.emptyStateDescription, { color: emptyTheme.description }]}>{config.description}</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // Permission denied — an honest dead-end with a way out, not a loader that
  // never resolves. Keep the tutorial shell available when Map was explicitly
  // opened for its first-time walkthrough.
  if (permissionDenied && !shouldRenderMapBeforeGps) {
    return (
      <View
        style={[
          styles.center,
          {
            backgroundColor: colors.background,
            paddingTop: Math.max(insets.top, 24) + 16,
            paddingBottom: Math.max(insets.bottom, 24) + 20,
          },
          styles.permState,
        ]}
      >
        <View style={styles.permIconWrap}>
          <View
            style={[
              styles.permIconInner,
              mats.clayTile,
              {
                backgroundColor: colors.surfaceContainerHigh,
                borderColor: colors.outlineVariant,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <Ionicons name="location-outline" size={34} color={colors.primary} />
          </View>
        </View>
        <Text style={[type.titleLg, { color: colors.onSurface, textAlign: 'center', marginTop: 4 }]}>
          Location Permission Required
        </Text>
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

  // Mount the Map tour's stable targets immediately while GPS resolves. The
  // normal screen keeps its loader; only the intentional first Map visit needs
  // the map shell present so the first spotlight has something to measure.
  if (!driverLocation && !gpsTimedOut && !shouldRenderMapBeforeGps) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <LottieView
          autoPlay
          loop
          source={require("../../../assets/globe.json")}
          style={styles.mapLoader}
        />
        <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginTop: 16, letterSpacing: 0.2 }]}>
          Acquiring GPS position…
        </Text>
      </View>
    );
  }

  // If no active trip, show driver live map in Proximity & Coverage Radar Mode
  if (!activeTrip) {
    return (
      <View style={[styles.container, { backgroundColor: rTheme.background }]}>
        <TomTomMap 
          ref={mapRef}
          origin={driverLocation}
          destination={null}
          scrollEnabled={true}
          showCarIcon={true}
          radarMode={true}
          radarRadiusKm={radarRadiusKm}
          radarMarkers={filteredRadarMarkers}
          showVehicleMarker={coverageVisibility.vehicle}
          topInset={Math.max(insets.top, 20) + 10}
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
          <View style={[styles.toastBanner, { top: insets.top + 92, backgroundColor: rTheme.topBarBg, borderColor: rTheme.primary }]}>
            <View style={[styles.radarLiveDot, { backgroundColor: rTheme.primary }]} />
            <Text style={[styles.toastText, { color: rTheme.textPrimary }]}>{recentNotification}</Text>
          </View>
        )}
        
        <CoachMarkTarget targetId="map.standby_status" style={[styles.standbyHeader, { top: insets.top + 16 }]}>
          <View
            pointerEvents="none"
            style={[
              styles.standbyHeaderCard,
              mats.compactShade,
              {
                backgroundColor: scheme === 'dark' ? rTheme.sheetBg : colors.surfaceContainerLow,
                borderColor: scheme === 'dark' ? rTheme.sheetBorder : colors.outlineVariant,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[styles.standbyLiveDot, { backgroundColor: poster.standbyObservedAt && now - new Date(poster.standbyObservedAt).getTime() <= 90000 && !poster.error && connectivity === 'online' ? colors.primary : colors.outline }]} />
              <Text style={[type.titleLg, { color: colors.onSurface }]}>
                {!driverLocation ? 'Locating vehicle' : connectivity !== 'online' ? 'Connection interrupted' : poster.standbyObservedAt && now - new Date(poster.standbyObservedAt).getTime() <= 90000 && !poster.error ? 'Live Tracking' : 'Tracking paused'}
              </Text>
            </View>
            <Text style={[type.caption, { color: colors.onSurfaceVariant, marginTop: 4 }]}>Waiting for assignment</Text>
          </View>
        </CoachMarkTarget>

        {/* Collapsible Interactive Radar Legend */}
        {legendExpanded && <View style={[styles.legendCard, { top: insets.top + 92 }, mats.compactShade, { backgroundColor: rTheme.legendBg, borderColor: rTheme.legendBorder, shadowColor: colors.shadow }]}>
          <Pressable 
            onPress={() => setLegendExpanded(!legendExpanded)} 
            style={styles.legendHeaderRow}
            accessibilityRole="button"
            accessibilityLabel="Toggle radar coverage legend"
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={[styles.legendIndicatorDot, { backgroundColor: rTheme.primary }]} />
              <Text style={[styles.legendHeaderTitle, { color: rTheme.legendText }]}>Coverage Legend</Text>
              {(() => {
                const activeCount = Object.values(coverageVisibility).filter(Boolean).length;
                if (activeCount < 4) {
                  return (
                    <View style={[styles.legendFilterBadge, { backgroundColor: rTheme.activeRangeBg }]}>
                      <Text style={[styles.legendFilterBadgeText, { color: rTheme.activeRangeText }]}>
                        {activeCount}/4
                      </Text>
                    </View>
                  );
                }
                return null;
              })()}
            </View>
            <Ionicons name={legendExpanded ? "chevron-up" : "chevron-down"} size={13} color={rTheme.legendSubtext} />
          </Pressable>
          
          {legendExpanded && (
            <View style={styles.legendItemsList}>
              {[
                {
                  key: 'vehicle',
                  label: 'Your Vehicle',
                  renderIcon: (active) => (
                    <View style={[styles.legendDot, { backgroundColor: rTheme.primary, opacity: active ? 1 : 0.4 }]} />
                  ),
                },
                {
                  key: 'gas_station',
                  label: 'Nearest Gas Station',
                  renderIcon: (active) => (
                    <Ionicons name="water" size={13} color={active ? "#0284c7" : rTheme.legendSubtext} />
                  ),
                },
                {
                  key: 'driver',
                  label: 'Fleet Drivers',
                  renderIcon: (active) => (
                    <Ionicons name="car" size={13} color={active ? "#286B54" : rTheme.legendSubtext} />
                  ),
                },
                {
                  key: 'assignment',
                  label: 'Dispatch Requests',
                  renderIcon: (active) => (
                    <Ionicons name="document-text" size={13} color={active ? rTheme.warning : rTheme.legendSubtext} />
                  ),
                },
              ].map((item) => {
                const isVisible = coverageVisibility[item.key];
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => toggleCoverage(item.key)}
                    style={({ pressed }) => [
                      styles.legendItem,
                      { opacity: pressed ? 0.7 : (isVisible ? 1 : 0.45) },
                    ]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isVisible }}
                    accessibilityLabel={`Toggle ${item.label} coverage visibility`}
                    accessibilityHint={`Currently ${isVisible ? 'visible' : 'hidden'}. Tap to toggle.`}
                  >
                    <View style={styles.legendItemLeft}>
                      {item.renderIcon(isVisible)}
                      <Text
                        style={[
                          styles.legendLabel,
                          {
                            color: isVisible ? rTheme.legendText : rTheme.legendSubtext,
                            textDecorationLine: isVisible ? 'none' : 'line-through',
                          },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </View>
                    <Ionicons
                      name={isVisible ? "eye-outline" : "eye-off-outline"}
                      size={12}
                      color={isVisible ? rTheme.legendSubtext : rTheme.legendSubtext + '88'}
                      style={styles.legendEyeIcon}
                    />
                  </Pressable>
                );
              })}

              {Object.values(coverageVisibility).some((v) => !v) && (
                <Pressable
                  onPress={showAllCoverage}
                  style={styles.legendShowAllBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Show all coverage layers"
                >
                  <Text style={[styles.legendShowAllText, { color: rTheme.primary }]}>
                    Show all layers
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>}

        {/* radius 24 is half of the 48dp control, which is how a target says
            "I am round": the spotlight hole then becomes a circle instead of a
            rounded square. The cluster is a column of three, so the hole takes
            rounded ends rather than being a single circle. */}
        <CoachMarkTarget
          targetId="map.controls"
          radius={24}
          style={[styles.standbyControls, { bottom: standbyBottom }]}
        >
          <ClayCard variant="compact" style={styles.standbyControl} onPress={() => mapRef.current?.recenter()} accessibilityLabel="Recenter on vehicle">
            <Ionicons name="navigate-outline" size={21} color={colors.onSurface} />
          </ClayCard>
          <CoachMarkTarget targetId="map.layers" radius={24} style={styles.mapLayerTarget}>
            <ClayCard variant="compact" style={styles.standbyControl} onPress={() => setLegendExpanded(!legendExpanded)} accessibilityLabel="Map layers" accessibilityState={{ expanded: legendExpanded }}>
              <Ionicons name="layers-outline" size={21} color={colors.onSurface} />
            </ClayCard>
          </CoachMarkTarget>
          <ClayCard variant="compact" style={styles.standbyControl} onPress={() => mapRef.current?.recenter()} accessibilityLabel="Locate my vehicle">
            <Ionicons name="locate-outline" size={21} color={colors.onSurface} />
          </ClayCard>
        </CoachMarkTarget>

        {/* Compact Interactive Assignment / Station / Driver Card */}
        {selectedMarker && (
          <View style={[
            styles.selectedMarkerCard, 
            mats.clayShade,
            { 
              backgroundColor: rTheme.cardBg, 
              borderColor: rTheme.cardBorder,
              shadowColor: colors.shadow,
              bottom: standbyBottom + 70,
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

        <View style={[styles.standbyWeather, { bottom: standbyBottom }]} pointerEvents="none">
          {weather && <ClayCard variant="compact" style={styles.standbyWeatherCard} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {weatherArt && <Image source={weatherArt} resizeMode="contain" accessible={false} style={{ width: 26, height: 26 }} />}
            <View style={{ flexGrow: 0, flexShrink: 1, flexBasis: 'auto', minWidth: 0 }}>
              <Text style={[type.labelLg, { color: colors.onSurface }]}>{weather.temperature}</Text>
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]} numberOfLines={1}>{weatherDetails?.label}</Text>
            </View>
            <View style={{ flexGrow: 0, flexShrink: 1, flexBasis: 'auto', minWidth: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.outlineVariant, paddingLeft: 10 }}>
              <Text style={[type.caption, { color: colors.onSurface }]} numberOfLines={1}>{weatherDetails?.placeName || 'Local weather'}</Text>
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]} numberOfLines={1}>{new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
            </View>
          </ClayCard>}
        </View>
        {mapIntroPractice}
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
        topInset={Math.max(insets.top, 20) + 10}
        onRouteData={handleRouteMessage}
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

      {mapIntroActiveLayers}
      
      {activeTrip && (
        <Animated.View 
          style={[styles.bottomSheet, mats.clayShade, { transform: [{ translateY: panY }], backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}
        >
          {/* Floating Map Controls (Sticks to top of sheet) */}
          {/* radius 18 matches the control buttons' own corners, so the hole
              outlines the row rather than falling back to the generic 12. */}
          <CoachMarkTarget targetId="map.controls" radius={18} style={styles.floatingControlsContainer}>
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
          </CoachMarkTarget>

          {/* eslint-disable-next-line react-hooks/refs -- spreading the once-created responder's handlers */}
      <View {...panResponder.panHandlers} style={{ backgroundColor: 'transparent' }}>
            <Pressable onPress={() => snapTo(!isExpandedRef.current)}>
              {/* Drag Handle */}
              <View style={[styles.dragHandle, { backgroundColor: colors.outlineVariant }]} />

              {/* Location Header */}
              <CoachMarkTarget targetId="map.standby_status" style={styles.sheetHeader}>
                <View style={[styles.locationIconWrapper, mats.clayTile, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}>
                  <Ionicons name="location-sharp" size={20} color={colors.primary} />
                </View>
                <CoachMarkTarget targetId="map.current_target" style={{ flex: 1 }}>
                  <View style={styles.locationTextWrapper}>
                    <Text style={[styles.locationIndicator, { color: colors.onSurfaceVariant }]}>
                      {preDeparture && `NEXT TRIP · ${pickupAt || "TBD"}`}
                      {!preDeparture && isPending && "PICK UP LOCATION"}
                      {(isDriverAccepted && !preDeparture) && "READY TO START"}
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
                </CoachMarkTarget>
                
                {/* ETA & Distance or Contextual Info */}
                {/* Live numbers come ONLY from TomTom ROUTE_CALCULATED. The
                    server's estimated_duration/distance is the PLANNED whole
                    trip (pickup → destination), not remaining live ETA, so it
                    is never substituted into the live slot — it renders as a
                    separate "Planned" line while the live route resolves. The
                    main minutes already INCLUDE traffic; the badge names the
                    traffic portion instead of implying an addition. */}
                <CoachMarkTarget targetId="map.telemetry">
                  <View style={styles.headerStatsRight}>
                    {preDeparture ? null : (isPending || isDriverAccepted || isState1 || isState3) ? (
                      <>
                        {(() => {
                          const live = routeData && !routeStale;
                          const liveMin = live ? Math.ceil(routeData.travelTimeInSeconds / 60) : null;
                          const delayMin = live ? Math.ceil((routeData.trafficDelayInSeconds || 0) / 60) : 0;
                          const liveKm = live ? (routeData.lengthInMeters / 1000).toFixed(1) + " km" : null;
                          const plannedMin = activeTrip.estimated_duration != null ? Math.ceil(activeTrip.estimated_duration) : null;
                          const plannedKm = activeTrip.estimated_distance != null ? Number(activeTrip.estimated_distance).toFixed(1) + " km" : null;
                          const showTraffic = live && delayMin >= 2;
                          const heavyTraffic = live && delayMin >= 5;
                          if (!live) {
                            return (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                                  <Text style={[type.headlineMd, { color: colors.onSurfaceVariant }]}>--</Text>
                                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurfaceVariant, marginBottom: 2 }}> min</Text>
                                </View>
                                <Text style={{ fontFamily: fonts.body, fontSize: 10, color: colors.onSurfaceVariant, marginBottom: 4 }}>
                                  {routeStale ? "Route temporarily unavailable" : "Calculating live route…"}
                                </Text>
                                {(plannedMin != null || plannedKm != null) && (
                                  <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant }]}>
                                    Planned{plannedMin != null ? ` ~${plannedMin} min` : ""}{plannedKm != null ? ` · ${plannedKm}` : ""}
                                  </Text>
                                )}
                              </>
                            );
                          }
                          return (
                            <>
                              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                                <Text style={[type.headlineMd, { color: colors.primary }]}>
                                  {liveMin}
                                </Text>
                                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.primary, marginBottom: 2 }}> min</Text>
                              </View>

                              {showTraffic && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4, marginBottom: 4, backgroundColor: (heavyTraffic ? colors.error : colors.warning) + '1A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
                                  <Ionicons name="warning" size={10} color={heavyTraffic ? colors.error : colors.warning} />
                                  <Text style={{ fontFamily: fonts.dataSemiBold, fontSize: 10, color: heavyTraffic ? colors.error : colors.warning }}>
                                    {heavyTraffic ? `Heavy traffic · incl. ~${delayMin} min` : `Incl. ~${delayMin} min traffic`}
                                  </Text>
                                </View>
                              )}

                              <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant }]}>
                                {liveKm}
                              </Text>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                        <Text style={[type.cardTitle, { color: colors.primary }]}>
                          {isCargoLoad(activeTrip)
                            ? loadSubtitle(activeTrip) || 'Cargo consignment'
                            : `${activeTrip.passenger_count || 1} ${activeTrip.passenger_count === 1 ? 'Guest' : 'Guests'}`}
                        </Text>
                        <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant, marginTop: 4, maxWidth: 80, textAlign: 'right' }]} numberOfLines={2}>
                          {isState2 ? 'Waiting at pickup' : 'Ready for drop-off'}
                        </Text>
                      </View>
                    )}
                  </View>
                </CoachMarkTarget>
              </CoachMarkTarget>

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
            <CoachMarkTarget targetId="map.trip_progression">
              <SwipeButton
                title={
                  // Single clock gate: label AND disabled state both derive from
                  // earliest_start/windowOpen so they can never disagree.
                  (isPending || isDriverAccepted) && !preTripDone ? "START TRIP" :
                  (isPending || isDriverAccepted) && preTripDone && !windowOpen ? `OPENS AT ${new Date(earliestStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toUpperCase()}` :
                  (isPending || isDriverAccepted) && preTripDone && windowOpen ? "START ROUTE" :
                  tripActionLabel(activeTrip.trip_status, activeTrip.load_type)
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
                        // Accept MUST complete before START is attempted. The
                        // server's state machine only allows
                        // Assigned → Driver Accepted → Trip Started, one hop at
                        // a time, so firing accept without awaiting it made
                        // START race that write and 409 with "Cannot move a
                        // trip from Assigned to Trip Started" on a cold
                        // network — the driver saw a failure for an action that
                        // is really two ordered steps. A genuine accept failure
                        // still throws to the catch below and is reported once.
                        const acceptRes = await api.put(`/api/trips/${activeTrip.trip_id}/accept`, { accept: true });
                        if (wasQueued(acceptRes)) announceSavedForSync();
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
                          totalKm = Number(activeTrip.estimated_distance) || ((routeData && !routeStale) ? (routeData.lengthInMeters / 1000) : 0);
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
                          duration: (routeData && !routeStale) ? Math.ceil(routeData.travelTimeInSeconds / 60) + " min" : "-- min",
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
            </CoachMarkTarget>
          )}

          {/* Expanded Content */}
          <ScrollView 
            style={{ flex: 1, marginTop: 24 }}
            showsVerticalScrollIndicator={false}
            pointerEvents={isExpanded ? 'auto' : 'none'}
            contentContainerStyle={{ paddingBottom: 24, gap: 16 }}
          >
            {/* Passenger Card — cargo rows name the consignment in kilograms,
                never a guest name or a fabricated count. */}
            <View style={[styles.detailCard, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}>
              <View style={[styles.cardHeader, { borderBottomColor: colors.outlineVariant }]}>
                <Ionicons name="person" size={16} color={colors.onSurfaceVariant} />
                <Text style={[styles.cardHeaderTitle, { color: colors.onSurfaceVariant }]}>{isCargoLoad(activeTrip) ? 'Cargo Info' : 'Passenger Info'}</Text>
              </View>
              <View style={styles.cardBody}>
                <View style={[styles.avatar, mats.clayTile, { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow }]}>
                  <Text style={[styles.avatarText, { color: colors.onSurface }]}>
                    {(isCargoLoad(activeTrip) ? loadTitle(activeTrip) : (activeTrip.passenger_name || 'G'))[0].toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailTitle, { color: colors.onSurface }]}>{isCargoLoad(activeTrip) ? loadTitle(activeTrip) : (activeTrip.passenger_name || 'Guest')}</Text>
                  {(() => {
                    const sub = isCargoLoad(activeTrip)
                      ? loadSubtitle(activeTrip)
                      : `${activeTrip.passenger_count || 1} Pax`;
                    return sub ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <Ionicons name="people" size={14} color={colors.outline} />
                        <Text style={[styles.detailSub, { color: colors.outline }]}>{sub}</Text>
                      </View>
                    ) : null;
                  })()}
                </View>
                {!isCargoLoad(activeTrip) && <Pressable
                  style={({ pressed }) => [
                    styles.iconButton,
                    mats.clayTile,
                    {
                      backgroundColor: colors.primaryContainer,
                      shadowColor: colors.shadow,
                      opacity: pressed ? 0.75 : 1,
                      transform: [{ scale: pressed ? 0.95 : 1 }],
                    },
                  ]}
                  onPress={() => {
                    if (activeTrip.passenger_phone) {
                      Linking.openURL(`tel:${activeTrip.passenger_phone}`).catch(() => {
                        AppAlert.alert("Call Failed", "Unable to open phone dialer on this device.");
                      });
                    } else {
                      AppAlert.alert("Contact Unavailable", "No contact phone number was listed for this passenger.");
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Call passenger"
                  hitSlop={8}
                >
                  <Ionicons name="call" size={18} color={colors.onPrimaryContainer} />
                </Pressable>}
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
                        <Text style={[styles.statusBadgeText, { color: sc.fg }]}>{tripStatusLabel(activeTrip.trip_status, activeTrip.load_type)}</Text>
                      </View>
                    );
                  })()}
                </View>
              </View>
            </View>
          </ScrollView>
        </Animated.View>
      )}
      {mapIntroPractice}
    </View>
  );
}

const styles = StyleSheet.create({
  standbyHeader: { position: 'absolute', left: 20, right: 20 },
  standbyHeaderCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  standbyLiveDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFFB3' },
  standbyControls: { position: 'absolute', right: 16, gap: 10 },
  standbyControl: { width: 48, height: 48, borderRadius: 24, padding: 0, alignItems: 'center', justifyContent: 'center' },
  mapLayerTarget: { width: 48, height: 48 },
  mapIntroPractice: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 104,
    zIndex: 40,
  },
  mapIntroPracticeTarget: { width: '100%' },
  mapIntroActiveLayersTarget: {
    position: 'absolute',
    top: 92,
    right: 16,
    zIndex: 40,
  },
  mapIntroActiveLayers: {
    minWidth: 112,
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
  },
  mapIntroActiveLayersText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
  },
  standbyWeatherCard: { maxWidth: 280, padding: 10 },
  standbyWeather: { position: 'absolute', left: 16, right: 80, alignItems: 'flex-start' },
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
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  permIconInner: {
    width: 68,
    height: 68,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  radarLiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toastBanner: {
    position: 'absolute',
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
    minWidth: 172,
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
  legendFilterBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 4,
  },
  legendFilterBadgeText: {
    fontSize: 9,
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    letterSpacing: 0.2,
  },
  legendItemsList: {
    marginTop: 8,
    gap: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  legendItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  legendEyeIcon: {
    marginLeft: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
  },
  legendShowAllBtn: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(166, 199, 184, 0.2)',
    alignItems: 'center',
  },
  legendShowAllText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 10,
    letterSpacing: 0.2,
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
  },
  // Empty State Styles — matching reference media_1790700314264.jpg
  emptyScreenContainer: {
    flex: 1,
    backgroundColor: '#040D0A',
    overflow: 'hidden',
  },
  waveRibbon1: {
    position: 'absolute',
    top: -120,
    left: -160,
    width: 480,
    height: 480,
    borderRadius: 240,
    borderWidth: 1.5,
    borderColor: 'rgba(52, 211, 153, 0.12)',
    transform: [{ scaleX: 1.4 }, { rotate: '-28deg' }],
  },
  waveRibbon2: {
    position: 'absolute',
    top: 180,
    right: -140,
    width: 520,
    height: 520,
    borderRadius: 260,
    borderWidth: 1.5,
    borderColor: 'rgba(52, 211, 153, 0.09)',
    transform: [{ scaleX: 1.3 }, { rotate: '38deg' }],
  },
  waveRibbon3: {
    position: 'absolute',
    bottom: -100,
    left: -120,
    width: 460,
    height: 460,
    borderRadius: 230,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.08)',
    transform: [{ scaleX: 1.5 }, { rotate: '-18deg' }],
  },
  emptyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    zIndex: 10,
  },
  headerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogoBadge: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#34D399',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  headerBrandTextCol: {
    marginLeft: 12,
  },
  headerBrandTitle: {
    fontFamily: fonts.displayBold || 'System',
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerBrandSubtitle: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold || 'System',
    fontSize: 9.5,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.55)',
    letterSpacing: 1.4,
    marginTop: 2,
  },
  headerBellBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  emptyCenterContent: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 320,
  },
  iconGlowWrapper: {
    width: 126,
    height: 126,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  iconAmbientHalo: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 44,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
    elevation: 10,
  },
  iconCardSurface: {
    width: 110,
    height: 110,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: 'rgba(52, 211, 153, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#34D399',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 8,
  },
  calendarSlashIconWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarSlashBar: {
    position: 'absolute',
    width: 54,
    height: 3.5,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  emptyStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 26,
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.28)',
  },
  emptyStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#34D399',
    marginRight: 9,
    shadowColor: '#34D399',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 5,
    elevation: 3,
  },
  emptyStatusPillText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold || 'System',
    fontSize: 12,
    fontWeight: '700',
    color: '#E6FFFA',
    letterSpacing: 1.4,
  },
  emptyStateTitle: {
    fontFamily: fonts.displayBold || 'System',
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.2,
    marginTop: 18,
  },
  emptyStateDescription: {
    fontFamily: fonts.body || 'System',
    fontSize: 14,
    lineHeight: 22,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 290,
  },
});
