import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { moderateScale } from "../lib/scaling";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme-context";
import { TOUCH_TARGET } from "../lib/theme";
import { clayMaterials } from "../lib/clay";
import { AppAlert } from "./AppAlert";
import RadarPulse from "./RadarPulse";

const sosIcon = require("../assets/images/SOS.png");

const STORAGE_KEY = "driver-sos-offset";
const SOS_SIZE = moderateScale(64);

let openSosHandler = null;
export function registerSosHandler(fn) {
  openSosHandler = fn;
}
export function triggerDriverSos() {
  if (openSosHandler) {
    openSosHandler();
  }
}

// The FAB lives in the (tabs) layout but stays mounted while Stack screens are
// pushed on top, so it must opt out of profile/settings-area routes explicitly.
const HIDDEN_ROUTE_PREFIXES = ["/profile", "/settings", "/work-schedule", "/devices"];

export function DriverSos() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");
  // Option 2 Enhanced (Soft Rose Medallion centered on #FFF0F0):
  // Sculpted dual-tone soft rose clay surface centered on #FFF0F0 with a uniform,
  // seamless soft rose border (no white patches, zero border overhang/crescent),
  // paired with a dark-mode deep wine clay adaptation for OLED comfort.
  const sosTheme = scheme === "dark"
    ? {
        backgroundColor: "#241012",
        borderColor: "rgba(242, 163, 156, 0.35)",
        gradient: ["#3D1B1E", "#241012"],
        shadowColor: "#000000",
        shadowOpacity: 0.50,
      }
    : {
        backgroundColor: "#FFF0F0",
        borderColor: "rgba(230, 80, 80, 0.28)",
        gradient: ["#FFF0F0", "#FFDADA"],
        shadowColor: "#E24B4B",
        shadowOpacity: 0.22,
      };
  const [open, setOpen] = useState(false);

  useEffect(() => {
    registerSosHandler(() => setOpen(true));
    return () => registerSosHandler(null);
  }, []);
  const [sending, setSending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [position] = useState(() => new Animated.ValueXY({ x: 0, y: 0 }));
  const offset = useRef({ x: 0, y: 0 });
  const start = useRef({ x: 0, y: 0 });
  const bounds = useRef({ maxX: 0, maxY: 0 });
  const moved = useRef(false);

  const setPosition = useCallback(
    (next) => {
      offset.current = next;
      position.setValue(next);
    },
    [position]
  );

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (value) {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
            const screen = Dimensions.get("window");
            const maxX = screen.width - SOS_SIZE - moderateScale(32);
            const maxY = screen.height - moderateScale(220);
            setPosition({
              x: Math.max(-maxX, Math.min(0, parsed.x)),
              y: Math.max(-maxY, Math.min(0, parsed.y)),
            });
          }
        } catch {
          // ignore corrupted storage
        }
      }
    }).catch(() => {});

    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [setPosition]);

  // Handlers live OUTSIDE the lazy PanResponder initializer so no `.current`
  // access is lexically inside render scope; they only run on real gestures.
  const handleGrant = () => {
    moved.current = false;
    start.current = offset.current;
    position.stopAnimation();
    const screen = Dimensions.get("window");
    bounds.current = {
      maxX: screen.width - SOS_SIZE - moderateScale(32),
      maxY: screen.height - moderateScale(220),
    };
  };
  const handleMove = (_e, gesture) => {
    if (Math.hypot(gesture.dx, gesture.dy) > 6) moved.current = true;
    const { maxX, maxY } = bounds.current;
    setPosition({
      x: Math.max(-maxX, Math.min(0, start.current.x + gesture.dx)),
      y: Math.max(-maxY, Math.min(0, start.current.y + gesture.dy)),
    });
  };
  const handleRelease = () => {
    if (!moved.current) {
      setOpen(true);
      return;
    }
    const screen = Dimensions.get("window");
    const maxX = screen.width - SOS_SIZE - moderateScale(32);
    const current = offset.current;
    const snapped = { x: current.x < -maxX / 2 ? -maxX : 0, y: current.y };
    offset.current = snapped;
    Animated.spring(position, {
      toValue: snapped,
      damping: 18,
      stiffness: 220,
      mass: 0.8,
      overshootClamping: true,
      useNativeDriver: false,
    }).start();
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapped)).catch(() => {});
  };

  // eslint-disable-next-line react-hooks/refs -- RN PanResponder idiom: handlers read live refs; created once via lazy state, invoked only on real gestures
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: handleGrant,
      onPanResponderMove: handleMove,
      onPanResponderRelease: handleRelease,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    })
  );

  const sendEmergencyLocation = async () => {
    try {
      setSending(true);
      let latitude = null;
      let longitude = null;
      let locationLabel = "GPS location unavailable";
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status === "granted") {
          const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          latitude = location.coords.latitude;
          longitude = location.coords.longitude;
          locationLabel = `${latitude},${longitude}`;
          try {
            const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (address) {
              locationLabel =
                [address.name, address.street || address.district, address.city, address.region]
                  .filter(Boolean)
                  .join(", ") || locationLabel;
            }
          } catch {
            // Reverse geocoding is best-effort; the decimal pair above still resolves on the web.
          }
        }
      } catch {
        // A critical report still needs to reach dispatch when GPS is denied
        // or temporarily unavailable.
      }
      const clientSubmissionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await api.post("/api/driver/incidents", {
        incident_type: "Emergency",
        description: "Emergency alert from driver. Call an ambulance or 911 immediately.",
        location: locationLabel,
        latitude,
        longitude,
        severity: "Critical",
        incident_date: new Date().toISOString(),
        client_submission_id: clientSubmissionId,
        // The SOS is inherently medical — carry the structured flag so triage
        // can filter on medical_assistance_required instead of parsing prose.
        assistance_needed: ["Medical Assistance"],
      });
      setOpen(false);
      AppAlert.alert(
        result?.queued ? "Please stay safe" : "Emergency report received",
        result?.queued
          ? "We could not reach dispatch yet. Your alert will send when the connection returns. Call 911 now if you need immediate help."
          : `Dispatch has received your emergency report${latitude == null ? " without GPS coordinates" : " and location"}. Move to a safe place if you can, and call 911 for immediate help.`
      );
    } catch {
      AppAlert.alert("Emergency not sent", "Your emergency location could not be submitted. Call 911 if you need immediate help.");
    } finally {
      setSending(false);
    }
  };

  if (
    keyboardVisible ||
    HIDDEN_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) return null;

  return (
    <>
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.sos,
          {
            backgroundColor: sosTheme.backgroundColor,
            borderColor: sosTheme.borderColor,
            shadowColor: sosTheme.shadowColor,
            shadowOpacity: sosTheme.shadowOpacity,
            bottom: insets.bottom + 88,
            transform: position.getTranslateTransform(),
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Emergency actions"
        accessibilityHint="Tap to open. Drag to reposition."
        accessible
        onAccessibilityTap={() => setOpen(true)}
      >
        <LinearGradient
          colors={sosTheme.gradient}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.sosInner}
        >
          <View style={styles.concentricRim}>
            <Image
              source={sosIcon}
              style={[styles.sosImage, { width: moderateScale(50), height: moderateScale(50) }]}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        </LinearGradient>
      </Animated.View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
            <LinearGradient
              colors={sosTheme.gradient}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={[
                styles.icon,
                mats.clayTile,
                {
                  borderColor: sosTheme.borderColor,
                  borderWidth: 1.5,
                  shadowColor: sosTheme.shadowColor,
                },
              ]}
            >
              {sending ? (
                <RadarPulse size={38} color={colors.error} icon="warning" />
              ) : (
                <Image
                  source={sosIcon}
                  style={[styles.modalSosImage, { width: moderateScale(44), height: moderateScale(44) }]}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
              )}
            </LinearGradient>
            <Text style={[type.titleLg, { color: colors.onSurface }]}>Emergency assistance</Text>
            <Text style={[type.bodyMd, styles.body, { color: colors.onSurfaceVariant }]}>
              Send your live location directly to dispatch as a critical emergency. Report Issue remains for non-urgent concerns.
            </Text>
            <Pressable
              onPress={() => Linking.openURL("tel:911")}
              style={({ pressed }) => [styles.primary, mats.clayCta, { backgroundColor: colors.error, shadowColor: colors.shadow }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Call emergency services"
            >
              <Ionicons name="call" size={21} color={colors.onError} />
              <Text style={[type.labelLg, { color: colors.onError }]}>Call emergency services (911)</Text>
            </Pressable>
            <Pressable
              onPress={sendEmergencyLocation}
              disabled={sending}
              style={({ pressed }) => [styles.secondary, mats.clayCta, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }, pressed && styles.pressed, sending && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={sending ? "Sending emergency location" : "Share current location"}
            >
              {sending
                ? <ActivityIndicator size="small" color={colors.onPrimaryContainer} />
                : <Ionicons name="location" size={21} color={colors.onPrimaryContainer} />}
              <Text style={[type.labelLg, { color: colors.onPrimaryContainer }]}>
                {sending ? "Sending emergency..." : "Share current location"}
              </Text>
            </Pressable>
            <Pressable onPress={() => setOpen(false)} style={styles.cancel} accessibilityRole="button" accessibilityLabel="Close emergency actions">
              <Text style={[type.labelLg, { color: colors.onSurfaceVariant }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Soft Rose Clay Medallion (#FFF0F0) / Dark Wine Clay:
  // Uniform symmetric border eliminates any eccentric crescent overhang ("lumalampas").
  // Consistent soft rose hue across the entire circumference with zero uncolored white spots.
  sos: {
    position: "absolute",
    right: moderateScale(16),
    width: SOS_SIZE,
    height: SOS_SIZE,
    borderRadius: SOS_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  },
  sosInner: {
    width: "100%",
    height: "100%",
    borderRadius: SOS_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  concentricRim: {
    width: "100%",
    height: "100%",
    borderRadius: SOS_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  sosImage: {
    width: moderateScale(50),
    height: moderateScale(50),
    maxWidth: moderateScale(50),
    maxHeight: moderateScale(50),
  },
  modalSosImage: {
    width: moderateScale(44),
    height: moderateScale(44),
    maxWidth: moderateScale(44),
    maxHeight: moderateScale(44),
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: moderateScale(24),
  },
  sheet: {
    width: "100%",
    maxWidth: moderateScale(420),
    borderRadius: moderateScale(30),
    padding: moderateScale(24),
    alignItems: "center",
    gap: moderateScale(12),
  },
  icon: {
    width: moderateScale(56),
    height: moderateScale(56),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(2),
  },
  body: { textAlign: "center", marginBottom: moderateScale(6) },
  primary: {
    width: "100%",
    minHeight: TOUCH_TARGET,
    paddingHorizontal: moderateScale(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(9),
  },
  secondary: {
    width: "100%",
    minHeight: TOUCH_TARGET,
    paddingHorizontal: moderateScale(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(9),
  },
  cancel: { minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: moderateScale(16) },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.6 },
});

export default DriverSos;
