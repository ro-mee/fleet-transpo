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
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { moderateScale } from "../lib/scaling";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme-context";
import { TOUCH_TARGET } from "../lib/theme";
import { AppAlert } from "./AppAlert";

const STORAGE_KEY = "driver-sos-offset";
const SOS_WIDTH = moderateScale(68);

export function DriverSos() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { colors, type } = useTheme();
  const [open, setOpen] = useState(false);
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
      if (value) setPosition(JSON.parse(value));
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
      maxX: screen.width - SOS_WIDTH - moderateScale(32),
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
    const maxX = screen.width - SOS_WIDTH - moderateScale(32);
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
          locationLabel = `https://maps.google.com/?q=${latitude},${longitude}`;
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
    pathname.startsWith("/profile") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/work-schedule")
  ) return null;

  return (
    <>
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.sos,
          {
            backgroundColor: colors.error,
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
        <Ionicons name="shield" size={22} color={colors.onError} />
        <Text style={[type.labelLg, styles.sosText, { color: colors.onError }]}>SOS</Text>
      </Animated.View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.surfaceContainerLowest }]}>
            <View style={[styles.icon, { backgroundColor: colors.errorContainer }]}>
              <Ionicons name="shield" size={26} color={colors.error} />
            </View>
            <Text style={[type.titleLg, { color: colors.onSurface }]}>Emergency assistance</Text>
            <Text style={[type.bodyMd, styles.body, { color: colors.onSurfaceVariant }]}>
              Send your live location directly to dispatch as a critical emergency. Report Issue remains for non-urgent concerns.
            </Text>
            <Pressable
              onPress={() => Linking.openURL("tel:911")}
              style={({ pressed }) => [styles.primary, { backgroundColor: colors.error }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Call emergency services"
            >
              <Ionicons name="call" size={21} color={colors.onError} />
              <Text style={[type.labelLg, { color: colors.onError }]}>Call emergency services (911)</Text>
            </Pressable>
            <Pressable
              onPress={sendEmergencyLocation}
              disabled={sending}
              style={({ pressed }) => [styles.secondary, { borderColor: colors.outlineVariant }, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={sending ? "Sending emergency location" : "Share current location"}
            >
              {sending
                ? <ActivityIndicator size="small" color={colors.error} />
                : <Ionicons name="location" size={21} color={colors.error} />}
              <Text style={[type.labelLg, { color: colors.onSurface }]}>
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
  sos: {
    position: "absolute",
    right: moderateScale(16),
    width: SOS_WIDTH,
    height: moderateScale(58),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(1),
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
    zIndex: 10,
  },
  sosText: { fontSize: moderateScale(11), lineHeight: moderateScale(15), textAlign: "center", includeFontPadding: false },
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
    borderRadius: moderateScale(22),
    padding: moderateScale(22),
    alignItems: "center",
    gap: moderateScale(12),
  },
  icon: {
    width: moderateScale(52),
    height: moderateScale(52),
    borderRadius: moderateScale(16),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(2),
  },
  body: { textAlign: "center", marginBottom: moderateScale(6) },
  primary: {
    width: "100%",
    minHeight: TOUCH_TARGET,
    borderRadius: moderateScale(14),
    paddingHorizontal: moderateScale(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(9),
  },
  secondary: {
    width: "100%",
    minHeight: TOUCH_TARGET,
    borderRadius: moderateScale(14),
    borderWidth: 1,
    paddingHorizontal: moderateScale(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(9),
  },
  cancel: { minHeight: TOUCH_TARGET, justifyContent: "center", paddingHorizontal: moderateScale(16) },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
});
