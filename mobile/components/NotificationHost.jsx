/**
 * NotificationHost — renders the mobile app's 3-tier notification surfaces.
 *
 * Mounted once at the root (like AppAlertHost). It subscribes to the `notify`
 * emitter and draws:
 *   - Heads-up banners (top of screen, double-bezel, auto-dismiss progress)
 *   - Toasts (bottom, above the tab bar)
 * It also wires OS-local-notification tap responses to deep-links.
 *
 * Visual language: the incumbent "Stitch FleetOps Tactical" system — Plus
 * Jakarta Sans + IBM Plex Mono, MD3 tone containers, double-bezel shell/core.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../lib/theme";
import { moderateScale } from "../lib/scaling";
import { subscribeNotificationHost, notify } from "../lib/notifications/notify";
import { subscribePushResponses } from "../lib/notifications/push";
import { mobileNotificationTarget } from "../lib/notifications/navigation";

const MAX_BANNERS = 2;
const MAX_TOASTS = 3;
const BANNER_AUTO_MS = 8000;
const BANNER_PERSIST_MS = 0; // Critical banners stay until actioned
const TOAST_MS = 2800;

// tone -> icon + color + container (from the mobile palette)
function toneVisual(colors) {
  return {
    critical: {
      icon: "alert-circle",
      color: colors.danger,
      container: colors.errorContainer,
      bar: colors.danger,
    },
    warning: {
      icon: "warning",
      color: colors.warning,
      container: colors.warning + "1A",
      bar: colors.warning,
    },
    success: {
      icon: "checkmark-circle",
      color: colors.success,
      container: colors.success + "1A",
      bar: colors.success,
    },
    info: {
      icon: "information-circle",
      color: colors.info,
      container: colors.info + "1A",
      bar: colors.info,
    },
  };
}

// ── Heads-up banner ──────────────────────────────────────────────────────────
function HeadsUpBanner({ banner, colors, type, reduceMotion, onDismiss }) {
  const progress = useRef(new Animated.Value(1)).current;
  const y = useRef(new Animated.Value(-130)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const visual = toneVisual(colors)[banner.tone] || toneVisual(colors).info;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, {
        toValue: 0,
        damping: 20,
        stiffness: 240,
        mass: 0.9,
        overshootClamping: true,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: reduceMotion ? 1 : 240,
        useNativeDriver: true,
      }),
    ]).start();
  }, [y, opacity, reduceMotion]);

  const autoMs = banner.persist ? BANNER_PERSIST_MS : BANNER_AUTO_MS;

  useEffect(() => {
    if (!autoMs) return undefined;
    Animated.timing(progress, {
      toValue: 0,
      duration: autoMs,
      useNativeDriver: true, // scaleX transform, origin left
    }).start(({ finished }) => {
      if (finished) onDismiss();
    });
    return () => progress.stopAnimation();
  }, [progress, autoMs, onDismiss]);

  const exit = () => {
    progress.stopAnimation();
    Animated.parallel([
      Animated.timing(y, {
        toValue: -130,
        duration: reduceMotion ? 1 : 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: reduceMotion ? 1 : 200,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  };

  return (
    <Animated.View
      style={[
        styles.bannerShell,
        {
          borderColor: colors.outlineVariant + "55",
          backgroundColor: colors.surface + "F5",
          opacity,
          transform: [{ translateY: y }],
        },
      ]}
    >
      <View style={styles.bannerGleam} />
      <View style={[styles.bannerCore, { backgroundColor: visual.container }]}>
        {/* Signal icon chip */}
        <View style={[styles.bannerChip, { backgroundColor: visual.color + "22" }]}>
          <Ionicons name={visual.icon} size={22} color={visual.color} />
        </View>

        <View style={styles.bannerBody}>
          {!!banner.category && (
            <Text style={[type.label, styles.bannerEyebrow, { color: visual.color }]}>
              {banner.category.toUpperCase()}
            </Text>
          )}
          <Text style={[type.labelLg, styles.bannerTitle, { color: colors.onSurface }]} numberOfLines={1}>
            {banner.title}
          </Text>
          {!!banner.message && (
            <Text style={[type.bodyMd, styles.bannerMsg, { color: colors.onSurfaceVariant }]} numberOfLines={2}>
              {banner.message}
            </Text>
          )}
        </View>

        <View style={styles.bannerActions}>
          <Pressable
            onPress={() => { banner.onPress?.(); exit(); }}
            accessibilityRole="button"
            style={({ pressed }) => [styles.viewBtn, { backgroundColor: visual.color }, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.onPrimary} />
          </Pressable>
          <Pressable
            onPress={exit}
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            hitSlop={8}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {!!autoMs && (
          <View style={[styles.bannerBarTrack, { backgroundColor: colors.outlineVariant + "55" }]}>
            <Animated.View
              style={[
                styles.bannerBar,
                { backgroundColor: visual.bar, transform: [{ scaleX: progress }] },
              ]}
            />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ── Toast ────────────────────────────────────────────────────────────────────
function ToastItem({ toast, colors, type, reduceMotion, onDismiss }) {
  const y = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const visual = toneVisual(colors)[toast.tone] || toneVisual(colors).info;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, {
        toValue: 0,
        damping: 20,
        stiffness: 260,
        mass: 0.9,
        overshootClamping: true,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: reduceMotion ? 1 : 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [y, opacity, reduceMotion]);

  useEffect(() => {
    const t = setTimeout(onDismiss, toast.duration || TOAST_MS);
    return () => clearTimeout(t);
  }, [toast.duration, onDismiss]);

  const exit = () => {
    Animated.parallel([
      Animated.timing(y, {
        toValue: 24,
        duration: reduceMotion ? 1 : 180,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: reduceMotion ? 1 : 180,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss());
  };

  return (
    <Animated.View
      style={[
        styles.toastShell,
        {
          borderColor: colors.outlineVariant + "55",
          backgroundColor: colors.surface + "F7",
          opacity,
          transform: [{ translateY: y }],
        },
      ]}
    >
      <View style={styles.toastGleam} />
      <View style={styles.toastCore}>
        <Ionicons name={visual.icon} size={18} color={visual.color} />
        <View style={styles.toastTextWrap}>
          {!!toast.title && (
            <Text style={[type.labelLg, styles.toastTitle, { color: colors.onSurface }]} numberOfLines={1}>
              {toast.title}
            </Text>
          )}
          {!!toast.message && (
            <Text
              style={[type.bodyMd, styles.toastMsg, { color: toast.title ? colors.onSurfaceVariant : colors.onSurface }]}
              numberOfLines={2}
            >
              {toast.message}
            </Text>
          )}
        </View>
        <Pressable onPress={exit} hitSlop={8} style={({ pressed }) => [styles.toastClose, pressed && styles.pressed]}>
          <Ionicons name="close" size={16} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ── Host ─────────────────────────────────────────────────────────────────────
export function NotificationHost() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, type } = useTheme();
  const [banners, setBanners] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeNotificationHost((event) => {
      if (event.type === "headsUp") {
        const p = event.payload;
        setBanners((prev) => {
          const next = [...prev, p].slice(-MAX_BANNERS);
          return next;
        });
      } else if (event.type === "toast") {
        setToasts((prev) => [...prev, event.payload].slice(-MAX_TOASTS));
      }
    });
    return unsubscribe;
  }, []);

  // Deep-link when an OS local notification is tapped.
  useEffect(() => {
    return subscribePushResponses((data) => {
      const target = data.target || mobileNotificationTarget(data);
      if (target) router.push(target);
    });
  }, [router]);

  const dismissBanner = (index) =>
    setBanners((prev) => prev.filter((_, i) => i !== index));
  const dismissToast = (index) =>
    setToasts((prev) => prev.filter((_, i) => i !== index));

  return (
    <>
      {/* Heads-up banners — top of screen, below the status bar */}
      <View
        pointerEvents="box-none"
        style={[
          styles.bannerZone,
          { top: insets.top + moderateScale(8), left: moderateScale(12), right: moderateScale(12) },
        ]}
      >
        {banners.map((b, i) => (
          <HeadsUpBanner
            key={`b-${i}-${b.title}`}
            banner={b}
            colors={colors}
            type={type}
            reduceMotion={reduceMotion}
            onDismiss={() => dismissBanner(i)}
          />
        ))}
      </View>

      {/* Toasts — bottom, above the tab bar */}
      <View
        pointerEvents="box-none"
        style={[
          styles.toastZone,
          { bottom: insets.bottom + moderateScale(92), left: moderateScale(16), right: moderateScale(16) },
        ]}
      >
        {toasts.map((t, i) => (
          <ToastItem
            key={`t-${i}-${t.message}`}
            toast={t}
            colors={colors}
            type={type}
            reduceMotion={reduceMotion}
            onDismiss={() => dismissToast(i)}
          />
        ))}
      </View>
    </>
  );
}

export { notify };

const styles = StyleSheet.create({
  bannerZone: {
    position: "absolute",
    zIndex: 90,
    gap: moderateScale(8),
  },
  toastZone: {
    position: "absolute",
    zIndex: 90,
    gap: moderateScale(8),
    alignItems: "stretch",
  },
  // Double-bezel: outer hairline shell
  bannerShell: {
    borderRadius: moderateScale(22),
    borderWidth: 1,
    padding: moderateScale(2.5),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 18,
    overflow: "hidden",
  },
  bannerGleam: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.22)",
    zIndex: 10,
  },
  bannerCore: {
    borderRadius: moderateScale(20),
    flexDirection: "row",
    alignItems: "center",
    padding: moderateScale(14),
    paddingRight: moderateScale(12),
    gap: moderateScale(12),
    overflow: "hidden",
  },
  bannerChip: {
    width: moderateScale(46),
    height: moderateScale(46),
    borderRadius: moderateScale(15),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bannerBody: { flex: 1, minWidth: 0, gap: moderateScale(1) },
  bannerEyebrow: {
    marginBottom: moderateScale(2),
  },
  bannerTitle: { marginBottom: moderateScale(1) },
  bannerMsg: {},
  bannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    alignSelf: "flex-start",
    marginTop: moderateScale(2),
  },
  viewBtn: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtn: {
    width: moderateScale(32),
    height: moderateScale(32),
    alignItems: "center",
    justifyContent: "center",
  },
  bannerBarTrack: {
    position: "absolute",
    left: 0, right: 0, bottom: 0,
    height: moderateScale(3),
  },
  bannerBar: {
    height: "100%",
    borderBottomLeftRadius: moderateScale(20),
    borderBottomRightRadius: moderateScale(20),
    transformOrigin: "left",
  },
  toastShell: {
    borderRadius: moderateScale(18),
    borderWidth: 1,
    padding: moderateScale(2),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 12,
    overflow: "hidden",
  },
  toastGleam: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.22)",
    zIndex: 10,
  },
  toastCore: {
    borderRadius: moderateScale(16),
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: moderateScale(11),
    paddingHorizontal: moderateScale(14),
    gap: moderateScale(10),
    backgroundColor: "transparent",
  },
  toastTextWrap: { flex: 1, minWidth: 0 },
  toastTitle: {},
  toastMsg: {},
  toastClose: {
    width: moderateScale(26),
    height: moderateScale(26),
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
});