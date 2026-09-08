/**
 * ConnectivityBanner — global, in-layout connectivity status (PR #3.1).
 *
 * Mounted ONCE in the authenticated shell (mobile/app/(app)/_layout.js), as a
 * normal layout sibling above the Stack: it pushes content down, never floats
 * over map controls or the bottom tabs, and never appears on login/consent/
 * setup screens. It is not a modal and not a NotificationHost notification.
 *
 * State contract (locked):
 * - healthy → renders nothing; the UI stays completely clean.
 * - unstable → compact amber "Connection unstable / Last synced {age} · Updates
 *   may be delayed." (age omitted on a never-synced session).
 * - offline → calm "You're offline / Last synced {age} · Showing saved data.
 *   Updates will sync automatically." (+ "N queued" badge when actions wait).
 *   With live GPS tracking for the current trip: "Offline · GPS still
 *   recording / Last synced {age} · Showing saved data · Dispatcher may see
 *   your last synced location." — never "live location active".
 * - back online → transient "Back online" + "Syncing N updates…" while the
 *   drain runs; "All updates synced" only after the queue truly hits zero,
 *   then auto-dismiss.
 */

import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { useConnectivity } from "../lib/connectivity-context";
import { formatLastSynced } from "../lib/offline-cache";

function pickVisual({ status, phase, pendingCount, gpsRecording, lastSuccessAt }) {
  const queued = Number(pendingCount) > 0 ? Number(pendingCount) : 0;
  // Offline Read Mode staleness: global last server contact, shared with the
  // per-screen caches (same clock, same meaning — "how old is what you see").
  // Null on a never-synced session → generic copy, no age claim.
  const age = formatLastSynced(lastSuccessAt);
  switch (status) {
    case "unstable":
      return {
        kind: "unstable",
        icon: "warning-outline",
        title: "Connection unstable",
        subtitle: age ? `Last synced ${age} · Updates may be delayed.` : "Updates may be delayed.",
        badge: queued > 0 ? `${queued} queued` : null,
      };
    case "offline":
      return gpsRecording
        ? {
            kind: "offline-gps",
            icon: "cloud-offline-outline",
            title: "Offline · GPS still recording",
            subtitle: age
              ? `Last synced ${age} · Showing saved data · Dispatcher may see your last synced location.`
              : "Dispatcher may see your last synced location.",
            badge: queued > 0 ? `${queued} queued` : null,
          }
        : {
            kind: "offline",
            icon: "cloud-offline-outline",
            title: "You're offline",
            subtitle: age
              ? `Last synced ${age} · Showing saved data. Updates will sync automatically.`
              : "Updates will sync automatically when you're back online.",
            badge: queued > 0 ? `${queued} queued` : null,
          };
    case "syncing":
      return {
        kind: "syncing",
        icon: "sync-outline",
        title: "Back online",
        subtitle: `Syncing ${queued} update${queued === 1 ? "" : "s"}…`,
      };
    case "online":
      if (phase === "synced") {
        return {
          kind: "synced",
          icon: "checkmark-circle-outline",
          title: "All updates synced",
          subtitle: null,
        };
      }
      if (phase === "recovered") {
        return {
          kind: "recovered",
          icon: "checkmark-circle-outline",
          title: "Back online",
          subtitle: queued > 0 ? `Syncing ${queued} update${queued === 1 ? "" : "s"}…` : "Connection restored.",
        };
      }
      return null;
    default:
      return null;
  }
}

function toneFor(kind, colors) {
  switch (kind) {
    case "unstable":
      return { container: colors.warning + "1A", border: colors.warning + "45", icon: colors.warning, title: colors.onSurface, sub: colors.onSurfaceVariant };
    case "offline":
    case "offline-gps":
      return { container: colors.errorContainer, border: colors.errorContainer, icon: colors.onErrorContainer, title: colors.onErrorContainer, sub: colors.onErrorContainer };
    case "syncing":
    case "recovered":
      return { container: colors.info + "1A", border: colors.info + "40", icon: colors.info, title: colors.onSurface, sub: colors.onSurfaceVariant };
    case "synced":
      return { container: colors.success + "1A", border: colors.success + "40", icon: colors.success, title: colors.onSurface, sub: colors.onSurfaceVariant };
    default:
      return null;
  }
}

export function ConnectivityBanner() {
  const { status, phase, pendingCount, gpsRecording, lastSuccessAt } = useConnectivity();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [opacity] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(-8));

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduceMotion);
    return () => {
      if (typeof sub?.remove === "function") sub.remove();
      else if (typeof sub === "function") sub();
    };
  }, []);

  const visual = pickVisual({ status, phase, pendingCount, gpsRecording, lastSuccessAt });

  useEffect(() => {
    if (!visual) return;
    opacity.setValue(0);
    translateY.setValue(reduceMotion ? 0 : -8);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? 1 : 220, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: reduceMotion ? 1 : 220, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visual?.kind, reduceMotion]);

  if (!visual) return null;
  const tone = toneFor(visual.kind, colors);
  if (!tone) return null;

  return (
    <View style={[styles.shell, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <Animated.View
        style={[
          styles.banner,
          {
            backgroundColor: tone.container,
            borderColor: tone.border,
            opacity,
            transform: [{ translateY }],
          },
        ]}
        accessibilityRole="alert"
        accessibilityLabel={`${visual.title}${visual.subtitle ? `. ${visual.subtitle}` : ""}`}
      >
        <Ionicons name={visual.icon} size={18} color={tone.icon} style={styles.icon} />
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: tone.title }]} numberOfLines={1}>
            {visual.title}
          </Text>
          {visual.subtitle ? (
            <Text style={[styles.subtitle, { color: tone.sub }]} numberOfLines={2}>
              {visual.subtitle}
            </Text>
          ) : null}
        </View>
        {visual.badge ? (
          <View style={[styles.badge, { borderColor: tone.border }]}>
            <Text style={[styles.badgeText, { color: tone.title }]}>{visual.badge}</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 10,
  },
  icon: {
    marginTop: 1,
  },
  textCol: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
});
