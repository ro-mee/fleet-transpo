import { useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ScreenCapture from "expo-screen-capture";
import { useTheme } from "../lib/theme-context";
import { useAppLock } from "../lib/app-lock-context";

/**
 * An opaque cover for the moment the app is not in the foreground.
 *
 * The threat this addresses is the one from the brief: a phone handed over or
 * left on a depot bench, where the OS task switcher renders a live thumbnail of
 * whatever was on screen. The cover paints over it so the snapshot is a blank
 * FleetOps card rather than a driver's trip list.
 *
 * Two limits, stated rather than papered over:
 *
 * - **Android** additionally sets `FLAG_SECURE` while covered, so the recents
 *   entry is genuinely blank. It is released on resume, so screenshots during
 *   normal use are unaffected.
 * - **iOS** obscuring needs a native scene-delegate hook that this app does not
 *   have. The cover is best-effort there: iOS captures its snapshot during the
 *   `inactive` transition, and a JavaScript state update may land too late.
 *
 * The cover never touches the server session. Backgrounding is not signing out,
 * and the app resumes straight back into the same session when it returns.
 */
export default function AppPrivacyVeil() {
  const { colors, type } = useTheme();
  const { veiled } = useAppLock();

  useEffect(() => {
    // Android-only: on iOS these calls are unsupported, and asking would just
    // add a rejected promise to the log on every background transition.
    if (Platform.OS !== "android") return undefined;
    if (veiled) {
      ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    } else {
      ScreenCapture.allowScreenCaptureAsync().catch(() => {});
    }
    return undefined;
  }, [veiled]);

  if (!veiled) return null;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.background }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons name="shield-checkmark-outline" size={40} color={colors.onSurfaceVariant} />
      <Text style={[type.caption, styles.label, { color: colors.onSurfaceVariant }]}>FleetOps</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  label: {
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
});
