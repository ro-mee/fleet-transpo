import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  colors,
  statusSurfaces,
  space,
  radius,
  TOUCH_TARGET,
} from "../lib/theme";

/**
 * Shared primitives for the driver app, built from the semantic tokens in
 * lib/theme.js. Screens compose these rather than defining their own colours or
 * button variants, per docs/design-system.md.
 */

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Status expressed as text + colour + shape, never colour alone. */
export function StatusPill({ label, tone = "neutral" }) {
  return (
    <View style={[styles.pill, { backgroundColor: statusSurfaces[tone] }]}>
      <View style={[styles.dot, { backgroundColor: toneColor(tone) }]} />
      <Text style={[styles.pillText, { color: toneColor(tone) }]}>{label}</Text>
    </View>
  );
}

function toneColor(tone) {
  return tone === "neutral" ? colors.foregroundSecondary : colors[tone];
}

/**
 * Buttons keep their label while loading and block duplicate submissions, per
 * the design system's action rules.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
}) {
  const isDisabled = disabled || loading;
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        isPrimary && styles.buttonPrimary,
        isDanger && styles.buttonDanger,
        !isPrimary && !isDanger && styles.buttonSecondary,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={isPrimary || isDanger ? colors.surface : colors.foreground}
        />
      )}
      <Text
        style={[
          styles.buttonText,
          { color: isPrimary || isDanger ? colors.surface : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({ label, error, required = false, ...inputProps }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? " *" : ""}
      </Text>
      <TextInput
        style={[styles.input, error && styles.inputError]}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={label}
        {...inputProps}
      />
      {/* Errors sit next to the field they belong to. */}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** Label + value pair for read-only record detail. */
export function Detail({ label, value, mono = false }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.monoValue]}>
        {value ?? "—"}
      </Text>
    </View>
  );
}

/** Empty states say what happened and what to do next. */
export function EmptyState({ title, message, action }) {
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.bodyText}>{message}</Text>
      {action}
    </Card>
  );
}

/** An error that needs action stays visible near the work, not in a toast. */
export function ErrorNotice({ message, onRetry }) {
  if (!message) return null;
  return (
    <View style={styles.errorNotice} accessibilityLiveRegion="polite">
      <Text style={styles.errorNoticeText}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

export function ScreenTitle({ eyebrow, title }) {
  return (
    <View style={styles.titleBlock}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.sm,
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
  dot: { width: 6, height: 6, borderRadius: radius.marker },
  pillText: { fontSize: 12, fontWeight: "600" },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.control,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonDanger: { backgroundColor: colors.danger },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: colors.foreground,
    backgroundColor: "transparent",
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  field: { gap: space.xs, marginBottom: space.md },
  label: {
    color: colors.foregroundSecondary,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 16,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: 13 },
  detail: { gap: 2, marginTop: space.xs },
  detailValue: { color: colors.foreground, fontSize: 15 },
  monoValue: { fontVariant: ["tabular-nums"] },
  bodyText: {
    color: colors.foregroundSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  empty: { alignItems: "flex-start", gap: space.md },
  emptyTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  errorNotice: {
    gap: space.md,
    padding: space.base,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: statusSurfaces.danger,
  },
  errorNoticeText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  titleBlock: { gap: space.xs },
  eyebrow: {
    color: colors.foregroundSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: { color: colors.foreground, fontSize: 24, fontWeight: "700" },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  cardTitle: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
});
