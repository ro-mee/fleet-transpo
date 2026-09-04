import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import TomTomMap from "../../../components/TomTomMap";
import { api } from "../../../lib/api";
import { fonts } from "../../../lib/theme";
import { useTheme } from "../../../lib/theme-context";
import { AppAlert } from "../../../components/AppAlert";

// In-app rescue navigation for the assigned fleet responder — the counterpart
// of the guest-trip Map tab. "Navigate to driver" on the mission screen
// deep-links here instead of leaving the app for Google Maps: the responder's
// own GPS drives the car marker and the TomTom route/banner, and the stranded
// driver's live position (polled every 30s) is the destination. The app-wide
// GPS poster keeps feeding the response ladder while this screen is open, so
// Dispatched → En Route → Arrived still updates itself; the bottom card offers
// the manual "I've arrived" fallback for weak signal.

// Haversine distance in meters — powers the destination re-bake threshold.
function distanceM(latA, lngA, latB, lngB) {
  const R = 6371e3;
  const p1 = (latA * Math.PI) / 180;
  const p2 = (latB * Math.PI) / 180;
  const dp = ((latB - latA) * Math.PI) / 180;
  const dl = ((lngB - lngA) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// The WebView map is regenerated when the destination prop changes, so the
// stranded driver's position is baked once and only re-baked after a real
// move. A stranded driver is near-stationary; occasional re-bakes are fine.
const DEST_REBAKE_M = 200;

function formatEta(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function RescueNavigationScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [mission, setMission] = useState(null);
  const [missionMissing, setMissionMissing] = useState(false);
  const [ownLocation, setOwnLocation] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [permRetry, setPermRetry] = useState(0);
  const [routeData, setRouteData] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [bakedDest, setBakedDest] = useState(null);
  const bakedDestRef = useRef(null);

  // Mission + destination refresh. The stranded driver's live position is the
  // navigation target; falls back to the report-time coordinates if their
  // phone went quiet.
  const loadMission = useCallback(async () => {
    try {
      const missions = await api.get("/api/driver/incidents?role=responder");
      const found = Array.isArray(missions)
        ? missions.find((m) => String(m.incident_id) === String(id))
        : null;
      setMission(found || null);
      setMissionMissing(!found);
      if (!found) return;
      const lat = found.driver_latitude ?? found.latitude;
      const lng = found.driver_longitude ?? found.longitude;
      if (lat == null || lng == null) return;
      const next = { lat: Number(lat), lng: Number(lng) };
      const prev = bakedDestRef.current;
      if (!prev || distanceM(prev.lat, prev.lng, next.lat, next.lng) > DEST_REBAKE_M) {
        bakedDestRef.current = next;
        setBakedDest(next);
      }
    } catch (e) {
      console.warn("Could not load rescue mission", e);
    }
  }, [id]);

  useEffect(() => {
    // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
    const t = setTimeout(loadMission, 0);
    return () => clearTimeout(t);
  }, [loadMission]);

  useEffect(() => {
    const t = setInterval(loadMission, 30000);
    return () => clearInterval(t);
  }, [loadMission]);

  // Own position pipeline (the Map tab's approach): permission → highest-
  // accuracy fix → live watch. GPS course-over-ground steers the car marker
  // while driving; the compass takes over when stopped.
  useEffect(() => {
    let subscription = null;
    let headingSubscription = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        setPermissionDenied(true);
        return;
      }
      setPermissionDenied(false);

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      if (cancelled) return;
      setOwnLocation({
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        heading: loc.coords.heading,
        speed: loc.coords.speed,
      });

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, distanceInterval: 5, timeInterval: 3000 },
        (newLoc) => {
          setOwnLocation((prev) => {
            let heading = prev?.heading;
            if (newLoc.coords.speed > 2 && newLoc.coords.heading >= 0) {
              heading = newLoc.coords.heading;
            }
            return {
              lat: newLoc.coords.latitude,
              lng: newLoc.coords.longitude,
              heading,
              speed: newLoc.coords.speed,
            };
          });
        }
      );

      try {
        headingSubscription = await Location.watchHeadingAsync((headingObj) => {
          const compass = headingObj.trueHeading >= 0 ? headingObj.trueHeading : headingObj.magHeading;
          if (compass == null || compass < 0) return;
          setOwnLocation((prev) => {
            if (!prev) return prev;
            if (prev.speed === undefined || prev.speed < 2) {
              return { ...prev, heading: compass };
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

  // Manual arrival fallback — same endpoint the mission screen uses.
  const markArrived = async () => {
    try {
      setArriving(true);
      await api.post("/api/driver/responder/arrived");
      await loadMission();
    } catch (e) {
      AppAlert.alert("Could not confirm arrival", e?.message || "Please try again.");
    } finally {
      setArriving(false);
    }
  };

  const openGoogleMaps = () => {
    if (!bakedDest) return;
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${bakedDest.lat},${bakedDest.lng}`
    ).catch(() => {});
  };

  const driverName =
    `${mission?.driver_first_name || ""} ${mission?.driver_last_name || ""}`.trim() || "Fleet driver";
  const status = mission?.response_status || "Dispatched";
  const arrived = status === "Arrived";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.topBarTitle, { color: colors.onSurface }]}>Rescue Navigation</Text>
          {mission ? (
            <Text style={[styles.topBarSub, { color: colors.onSurfaceVariant }]}>
              Report #{mission.incident_id}
            </Text>
          ) : null}
        </View>
      </View>

      {permissionDenied ? (
        <View style={styles.centerBox}>
          <View style={[styles.permIconWrap, { backgroundColor: colors.surfaceContainerHigh }]}>
            <Ionicons name="location-outline" size={32} color={colors.onSurfaceVariant} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>Location Permission Required</Text>
          <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
            Location permission is required to navigate to the stranded driver.
          </Text>
          <Pressable
            onPress={() => Linking.openSettings()}
            style={[styles.secondaryBtn, { borderColor: colors.outlineVariant }]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Open Settings</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setPermissionDenied(false);
              setPermRetry((c) => c + 1);
            }}
            style={[styles.secondaryBtn, { borderColor: colors.outlineVariant }]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>Try Again</Text>
          </Pressable>
        </View>
      ) : missionMissing ? (
        <View style={styles.centerBox}>
          <Ionicons name="checkmark-circle" size={36} color={colors.secondary} />
          <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No active mission</Text>
          <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
            You are not currently assigned as a responder to this report — it may have been resolved or reassigned.
          </Text>
        </View>
      ) : !mission ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>Loading mission…</Text>
        </View>
      ) : !ownLocation ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>Waiting for your GPS fix…</Text>
        </View>
      ) : (
        <>
          <View style={styles.mapWrap}>
            <TomTomMap
              origin={{
                lat: ownLocation.lat,
                lng: ownLocation.lng,
                heading: ownLocation.heading,
              }}
              destination={bakedDest}
              scrollEnabled
              pickupLabel="You"
              dropoffLabel={`Driver: ${driverName}`}
              showCarIcon
              autoSwoop
              onRouteData={setRouteData}
              onMapReady={() => setMapReady(true)}
            />
            {!mapReady && (
              <View style={[styles.mapLoadingOverlay, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}
          </View>

          <View
            style={[
              styles.bottomCard,
              { backgroundColor: colors.surface, borderColor: colors.outlineVariant + "40", paddingBottom: insets.bottom + 16 },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.onSurface }]} numberOfLines={1}>
                  {driverName}
                </Text>
                <Text style={[styles.cardSub, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                  {mission.incident_type || "Incident"}
                  {mission.plate_number ? ` • ${mission.plate_number}` : ""}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: colors.primaryContainer }]}>
                <Text style={[styles.statusText, { color: colors.onPrimaryContainer }]}>
                  {arrived
                    ? "On scene"
                    : status === "En Route"
                    ? `En route${mission.response_eta ? ` · ETA ${formatEta(mission.response_eta)}` : ""}`
                    : "Dispatched"}
                </Text>
              </View>
            </View>

            <View style={styles.etaRow}>
              <View style={styles.etaBox}>
                <Text style={[styles.etaValue, { color: colors.primary }]}>
                  {routeData ? Math.ceil(routeData.travelTimeInSeconds / 60) : "--"}
                </Text>
                <Text style={[styles.etaUnit, { color: colors.onSurfaceVariant }]}>min</Text>
              </View>
              <View style={styles.etaBox}>
                <Text style={[styles.etaValue, { color: colors.primary }]}>
                  {routeData ? (routeData.lengthInMeters / 1000).toFixed(1) : "--"}
                </Text>
                <Text style={[styles.etaUnit, { color: colors.onSurfaceVariant }]}>km</Text>
              </View>
              {routeData?.trafficDelayInSeconds > 0 ? (
                <View style={[styles.delayBadge, { backgroundColor: colors.errorContainer }]}>
                  <Ionicons name="warning" size={12} color={colors.error} />
                  <Text style={[styles.delayText, { color: colors.onErrorContainer }]}>
                    +{Math.ceil(routeData.trafficDelayInSeconds / 60)} min traffic
                  </Text>
                </View>
              ) : null}
            </View>

            {arrived ? (
              <Text style={[styles.arrivedNote, { color: colors.onSurfaceVariant }]}>
                You are on scene — the driver and fleet team have been notified. The incident stays
                open until it is resolved — confirm it from your mission screen when the situation
                is handled.
              </Text>
            ) : (
              <Pressable
                onPress={markArrived}
                disabled={arriving}
                accessibilityRole="button"
                accessibilityLabel="Confirm you have arrived"
                style={({ pressed }) => [
                  styles.actionBtn,
                  { backgroundColor: colors.primary },
                  (pressed || arriving) && styles.actionPressed,
                ]}
              >
                {arriving ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Ionicons name="checkmark-circle" size={20} color={colors.onPrimary} />
                )}
                <Text style={[styles.actionBtnText, { color: colors.onPrimary }]}>
                  {arriving ? "Updating…" : "I've arrived"}
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={openGoogleMaps}
              disabled={!bakedDest}
              accessibilityRole="button"
              accessibilityLabel="Open navigation in Google Maps"
              hitSlop={6}
            >
              <Text
                style={[
                  styles.fallbackLink,
                  { color: bakedDest ? colors.primary : colors.outline },
                ]}
              >
                Prefer another app? Open in Google Maps
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { fontSize: 17, fontFamily: fonts.displayBold },
  topBarSub: { fontSize: 12, fontFamily: fonts.body, marginTop: 1 },
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  permIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold, textAlign: "center" },
  emptySub: { fontSize: 13, fontFamily: fonts.body, textAlign: "center", lineHeight: 19 },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    alignSelf: "stretch",
    maxWidth: 280,
  },
  secondaryBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  mapWrap: { flex: 1, overflow: "hidden" },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomCard: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 14,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitle: { fontSize: 17, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  cardSub: { fontSize: 13, fontFamily: fonts.body, marginTop: 2 },
  statusBadge: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: { fontSize: 12, fontFamily: fonts.bodySemiBold },
  etaRow: { flexDirection: "row", alignItems: "center", gap: 24 },
  etaBox: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  etaValue: { fontSize: 26, fontFamily: fonts.displayBold },
  etaUnit: { fontSize: 13, fontFamily: fonts.bodySemiBold },
  delayBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  delayText: { fontSize: 11, fontFamily: fonts.bodySemiBold },
  arrivedNote: { fontSize: 13, fontFamily: fonts.body, lineHeight: 19 },
  actionBtn: {
    minHeight: 50,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  actionBtnText: { fontSize: 15, fontFamily: fonts.bodySemiBold },
  fallbackLink: { fontSize: 12, fontFamily: fonts.body, textAlign: "center", paddingVertical: 2 },
});
