import { Component, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTheme } from "../lib/theme-context";
import { fonts, radius, space, TOUCH_TARGET } from "../lib/theme";

/**
 * MD3 shared primitives for the driver app. Every component derives its colour
 * and elevation from useTheme(), so light and dark modes both work without
 * touching screens. Screens compose these rather than defining their own
 * colours or button variants.
 */

/**
 * A tonal MD3 surface card. `tone` draws a short coloured edge along the top
 * (the dispatch-slip signal) and `elevated` raises the card.
 */
export function Card({ children, style, tone, elevated }) {
  const { colors, statusSurfaces, elevation } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
        elevated && elevation.level1,
        tone ? styles.cardWithEdge : null,
        style,
      ]}
    >
      {tone ? (
        <View
          style={[
            styles.cardEdge,
            { backgroundColor: colors[tone] ?? colors.primary },
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

/** MD3 filled button (primary action). */
export function FilledButton({ label, onPress, loading, disabled, style, size = "lg" }) {
  const { colors, elevation, type } = useTheme();
  const isDisabled = disabled || loading;
  const isSmall = size === "sm";
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        isSmall && styles.buttonSmall,
        { backgroundColor: isDisabled ? colors.onSurfaceVariant : colors.primary },
        isSmall ? elevation.level0 : elevation.level1,
        pressed && !isDisabled && { transform: [{ scale: 0.96 }] },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading && <ActivityIndicator size="small" color={colors.onPrimary} />}
      <Text style={[type.labelLg, { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

/** MD3 tonal button (secondary). */
export function TonalButton({ label, onPress, loading, disabled, style, size = "lg" }) {
  const { colors, type } = useTheme();
  const isDisabled = disabled || loading;
  const isSmall = size === "sm";
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        isSmall && styles.buttonSmall,
        {
          backgroundColor: isDisabled ? colors.surfaceContainer : colors.secondaryContainer,
          borderWidth: 1,
          borderColor: isDisabled ? "transparent" : colors.secondary
        },
        pressed && !isDisabled && { transform: [{ scale: 0.96 }] },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading && <ActivityIndicator size="small" color={colors.onSecondaryContainer} />}
      <Text style={[type.labelLg, { color: colors.onSecondaryContainer }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** MD3 outlined button. */
export function OutlinedButton({ label, onPress, loading, disabled, style, size = "lg" }) {
  const { colors, type } = useTheme();
  const isDisabled = disabled || loading;
  const isSmall = size === "sm";
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        isSmall && styles.buttonSmall,
        { borderWidth: 1, borderColor: colors.outline, backgroundColor: "transparent" },
        pressed && !isDisabled && { opacity: 0.7, transform: [{ scale: 0.98 }] },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading && <ActivityIndicator size="small" color={colors.primary} />}
      <Text style={[type.labelLg, { color: colors.primary }]}>{label}</Text>
    </Pressable>
  );
}

/** MD3 text button. */
export function TextButton({ label, onPress, disabled, style, size = "lg" }) {
  const { colors, type } = useTheme();
  const isDisabled = disabled;
  const isSmall = size === "sm";
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.button,
        isSmall && styles.buttonSmall,
        { backgroundColor: "transparent" },
        pressed && !isDisabled && { opacity: 0.5, transform: [{ scale: 0.98 }] },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text style={[type.labelLg, { color: isDisabled ? colors.outline : colors.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Backward-compatible Button (maps to MD3 variants). */
export function CriticalButton({ label, onPress, loading, disabled, style, size = "lg" }) {
  const { colors, elevation, type } = useTheme();
  const isDisabled = disabled || loading;
  const isSmall = size === "sm";
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        isSmall && styles.buttonSmall,
        { backgroundColor: isDisabled ? colors.onSurfaceVariant : colors.error },
        isSmall ? elevation.level0 : elevation.level1,
        pressed && !isDisabled && { transform: [{ scale: 0.96 }] },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading && <ActivityIndicator size="small" color={colors.onError} />}
      <Text style={[type.labelLg, { color: colors.onError }]}>{label}</Text>
    </Pressable>
  );
}

export function CriticalTonalButton({ label, icon, onPress, loading, disabled, style, size = "md" }) {
  const { colors, type } = useTheme();
  const isDisabled = disabled || loading;
  const isSmall = size === "sm";

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        isSmall && styles.buttonSmall,
        {
          backgroundColor: isDisabled ? colors.surfaceContainer : colors.errorContainer,
          borderWidth: 1,
          borderColor: isDisabled ? "transparent" : colors.error
        },
        pressed && !isDisabled && { transform: [{ scale: 0.96 }] },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      <View style={styles.buttonInner}>
        {icon && <View style={[styles.icon, isSmall && styles.iconSmall]}>{icon}</View>}
        <Text
          style={[
            type.labelLg,
            isSmall && { fontSize: 13 },
            { color: isDisabled ? colors.onSurfaceVariant : colors.error, opacity: loading ? 0 : 1 },
          ]}
        >
          {label}
        </Text>
      </View>
      {loading && (
        <ActivityIndicator
          color={colors.error}
          style={StyleSheet.absoluteFill}
        />
      )}
    </Pressable>
  );
}

export function Button({ label, onPress, variant = "primary", loading, disabled, style, size }) {
  if (variant === "secondary") {
    return (
      <TonalButton label={label} onPress={onPress} loading={loading} disabled={disabled} style={style} size={size} />
    );
  }
  if (variant === "outline") {
    return (
      <OutlinedButton label={label} onPress={onPress} loading={loading} disabled={disabled} style={style} size={size} />
    );
  }
  if (variant === "text") {
    return <TextButton label={label} onPress={onPress} disabled={disabled} style={style} size={size} />;
  }
  if (variant === "critical") {
    return <CriticalButton label={label} onPress={onPress} loading={loading} disabled={disabled} style={style} size={size} />;
  }
  if (variant === "critical-tonal") {
    return <CriticalTonalButton label={label} onPress={onPress} loading={loading} disabled={disabled} style={style} size={size} />;
  }
  return <FilledButton label={label} onPress={onPress} loading={loading} disabled={disabled} style={style} size={size} />;
}

/** MD3 assist chip (selectable). */
export function Chip({ label, selected, onPress, disabled, style }) {
  const { colors, type } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.secondaryContainer : colors.surfaceContainerLow,
          borderColor: selected ? "transparent" : colors.outlineVariant,
        },
        pressed && !selected && { backgroundColor: colors.surfaceContainerHigh },
        style,
      ]}
    >
      {selected ? <View style={[styles.chipDot, { backgroundColor: colors.onSecondaryContainer }]} /> : null}
      <Text style={[type.labelLg, { color: selected ? colors.onSecondaryContainer : colors.onSurfaceVariant }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Status expressed as text + colour + shape, never colour alone. */
export function StatusPill({ label, status, tone = "neutral" }) {
  const { colors, statusSurfaces, type } = useTheme();
  const text = label || status || "Unknown";
  const bg = statusSurfaces[tone] || statusSurfaces.neutral;
  const fg = tone === "neutral" ? colors.onSurfaceVariant : colors[tone] || colors.onSurfaceVariant;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <Text style={[type.caption, { color: fg }]}>{text}</Text>
    </View>
  );
}

/**
 * A softly pulsing dot for genuinely live state (e.g. an active trip). Reserved
 * for live indicators only — never static records (design-system §5).
 */
export function PulsingDot({ color, size = 8, style }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? colors.secondary,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/**
 * Counts up from 0 to `value` when mounted. Numbers animate via transform/opacity
 * only; used for small dashboard figures. Respects reduced-motion via `motion`.
 */
export function CountUpText({ value, style, duration = 600 }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    const target = Number(value) || 0;
    const listener = anim.addListener(({ value: v }) => setShown(Math.round(v)));
    Animated.timing(anim, {
      toValue: target,
      duration,
      useNativeDriver: false,
    }).start();
    return () => {
      anim.removeListener(listener);
    };
  }, [value, duration, anim]);

  return <Animated.Text style={style}>{shown}</Animated.Text>;
}

/**
 * MD3 outlined text field with focus state. An optional `right` accessory is
 * rendered inside the same bordered box as the input (e.g. a show-password
 * toggle), so it always sits within the field at any width.
 */
export function Field({ label, error, required = false, right, ...inputProps }) {
  const { colors, type } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: focused ? colors.primary : colors.onSurfaceVariant }]}>
        {label}
        {required ? " *" : ""}
      </Text>
      <View
        style={[
          styles.inputBox,
          {
            borderColor: error ? colors.error : focused ? colors.primary : colors.outlineVariant,
            backgroundColor: focused ? colors.surface : colors.surfaceContainer,
            borderWidth: focused ? 1.5 : 1,
          },
        ]}
      >
        <TextInput
          style={[styles.input, type.bodyMd, { color: colors.onSurface }]}
          placeholderTextColor={colors.onSurfaceVariant}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label}
          {...inputProps}
        />
        {right ? <View style={styles.inputAdornment}>{right}</View> : null}
      </View>
      {error ? <Text style={[type.caption, { color: colors.error }]}>{error}</Text> : null}
    </View>
  );
}

/** Label + value pair for read-only record detail. Data values use mono. */
export function Detail({ label, value, mono = false }) {
  const { colors, type } = useTheme();
  return (
    <View style={styles.detail}>
      <Text style={[type.label, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[type.bodyMd, { color: colors.onSurface }, mono && { fontFamily: fonts.data, fontVariant: ["tabular-nums"] }]}>
        {value ?? "—"}
      </Text>
    </View>
  );
}

/** Empty states say what happened and what to do next. */
export function EmptyState({ title, message, action }) {
  const { colors, type } = useTheme();
  return (
    <Card style={styles.empty}>
      <View style={[styles.emptyMark, { backgroundColor: colors.surfaceContainer }]}>
        <View style={[styles.emptyBar, { backgroundColor: colors.outlineVariant, width: 28 }]} />
        <View style={[styles.emptyBar, { backgroundColor: colors.outlineVariant, width: 18 }]} />
      </View>
      <Text style={[type.cardTitle, { color: colors.onSurface, textAlign: "center" }]}>{title}</Text>
      <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, textAlign: "center" }]}>{message}</Text>
      {action}
    </Card>
  );
}

/** An error that needs action stays visible near the work, not in a toast. */
export function ErrorNotice({ message, onRetry }) {
  const { colors, type } = useTheme();
  if (!message) return null;
  return (
    <View
      style={[styles.errorNotice, { borderColor: colors.error, backgroundColor: colors.errorContainer }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[type.bodyMd, { color: colors.onErrorContainer }]}>{message}</Text>
      {onRetry ? <TextButton label="Try again" onPress={onRetry} /> : null}
    </View>
  );
}

/** Page heading with an optional eyebrow. */
export function ScreenTitle({ eyebrow, title }) {
  const { colors, type } = useTheme();
  return (
    <View style={styles.titleBlock}>
      {eyebrow ? <Text style={[type.label, { color: colors.onSurfaceVariant }]}>{eyebrow}</Text> : null}
      <Text style={[type.pageTitle]} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

/** Initials avatar. */
export function Avatar({ initials, size = 40 }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary }]}
      accessibilityLabel={`Signed in as ${initials}`}
    >
      <Text style={[styles.avatarText, { color: colors.onPrimary, fontSize: size * 0.4 }]}>{initials}</Text>
    </View>
  );
}

/** A single key figure, value in mono over a small uppercase label. */
export function Metric({ value, label }) {
  const { colors, type } = useTheme();
  return (
    <View style={styles.metric}>
      <Text style={[type.titleLg, { fontFamily: fonts.dataSemiBold, fontVariant: ["tabular-nums"], color: colors.onSurface }]}>{value ?? "—"}</Text>
      <Text style={[type.label, { color: colors.onSurfaceVariant }]}>{label}</Text>
    </View>
  );
}

/** A row of Metrics, evenly spread. */
export function MetricRow({ children, style }) {
  return <View style={[styles.metricRow, style]}>{children}</View>;
}

/** Small section label above a group of cards. */
export function SectionHeading({ children, style }) {
  const { colors, type } = useTheme();
  return <Text style={[type.label, { color: colors.onSurfaceVariant }, style]}>{children}</Text>;
}

/** MD3 loading skeleton (shimmering block). */
export function Skeleton({ width = "100%", height = 16, radius: round = radius.sm, style }) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: round, backgroundColor: colors.surfaceContainerHigh, opacity },
        style,
      ]}
    />
  );
}

/** A row of skeletons used while content loads. */
export function SkeletonCard({ lines = 3, style }) {
  const { colors, elevation } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.outlineVariant },
        elevation.level1,
        style,
      ]}
    >
      <Skeleton width="40%" height={14} />
      <Skeleton width="100%" height={14} />
      {lines > 2 ? <Skeleton width="70%" height={14} /> : null}
    </View>
  );
}

/** MD3 snackbar for transient feedback. */
export function Snackbar({ visible, message, onDismiss, actionLabel, onAction }) {
  const { colors, elevation, type } = useTheme();
  if (!visible) return null;
  return (
    <View style={[styles.snackbar, { backgroundColor: colors.inverseSurface }, elevation.level3]}>
      <Text style={[type.bodyMd, { color: colors.inverseOnSurface, flex: 1 }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button">
          <Text style={[type.labelLg, { color: colors.inversePrimary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardWithEdge: { paddingTop: space.md },
  cardEdge: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.xs + 2,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs + 1,
    borderRadius: radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: fonts.data, fontSize: 12, lineHeight: 16 },
  button: {
    minHeight: 52,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.base,
    paddingVertical: space.base,
    borderRadius: radius.control,
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: space.base, paddingVertical: space.sm },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: fonts.bodySemiBold, fontSize: 15 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  field: { gap: space.xs, marginBottom: space.base },
  inputBox: {
    minHeight: 56,
    borderRadius: radius.control,
    flexDirection: "row",
    alignItems: "center",
  },
  inputAdornment: { marginRight: space.sm },
  label: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  input: {
    flex: 1,
    minHeight: 53,
    paddingHorizontal: space.base,
    fontSize: 16,
    fontFamily: fonts.body,
  },
  fieldError: { fontSize: 13, fontFamily: fonts.body },
  detail: { gap: 2, marginTop: space.xs },
  detailValue: { fontSize: 15, lineHeight: 20, fontFamily: fonts.body },
  monoValue: { fontFamily: fonts.data, fontSize: 14, lineHeight: 20 },
  bodyText: { fontSize: 14, lineHeight: 21, fontFamily: fonts.body },
  cardTitle: { fontFamily: fonts.display, fontSize: 16, lineHeight: 22 },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.xl },
  emptyMark: { alignItems: "center", gap: 4, padding: space.base, borderRadius: radius.control, marginBottom: space.xs },
  emptyBar: { height: 3, borderRadius: 2 },
  emptyTitle: { fontSize: 16, lineHeight: 21, fontFamily: fonts.bodySemiBold, textAlign: "center" },
  errorNotice: {
    gap: space.md,
    padding: space.base,
    borderRadius: radius.control,
    borderWidth: 1,
  },
  errorNoticeText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.body },
  titleBlock: { gap: space.xs },
  eyebrow: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.data, fontWeight: "600" },
  metricRow: { flexDirection: "row", gap: space.base, marginTop: space.xs },
  metric: { flex: 1, gap: 2 },
  metricValue: { fontFamily: fonts.dataSemiBold, fontSize: 20, lineHeight: 24, fontVariant: ["tabular-nums"] },
  metricLabel: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionHeading: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  snackbar: {
    position: "absolute",
    left: space.base,
    right: space.base,
    bottom: space.base,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.base,
    paddingHorizontal: space.base,
    paddingVertical: space.base,
    borderRadius: radius.control,
    minHeight: 48,
  },
  snackbarText: { fontFamily: fonts.bodyMedium, fontSize: 14, flex: 1 },
  snackbarAction: { fontFamily: fonts.bodySemiBold, fontSize: 14, textTransform: "uppercase" },
});
