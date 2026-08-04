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
  fonts,
  radius,
  space,
  statusSurfaces,
  TOUCH_TARGET,
  type,
} from "../lib/theme";

/**
 * Shared primitives for the driver app, built from the semantic tokens in
 * lib/theme.js. Screens compose these rather than defining their own colours or
 * button variants, per docs/design-system.md.
 *
 * The visual language is inherited from the web app: flat paper cards with a
 * hairline border, Archivo headings, IBM Plex Sans copy, and IBM Plex Mono for
 * labels, codes, and figures.
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

/** Label + value pair for read-only record detail. Data values use mono. */
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

/** Initials avatar, as in the web top bar. */
export function Avatar({ initials }) {
  return (
    <View style={styles.avatar} accessibilityLabel={`Signed in as ${initials}`}>
      <Text style={styles.avatarText}>{initials}</Text>
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
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
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
  pillText: { fontFamily: fonts.data, fontSize: 12, lineHeight: 16 },
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
  buttonPressed: { opacity: 0.88 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontFamily: fonts.bodySemiBold, fontSize: 15 },
  field: { gap: space.xs, marginBottom: space.md },
  label: { ...type.label },
  input: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 16,
    fontFamily: fonts.body,
    color: colors.foreground,
    backgroundColor: colors.surface,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: 13, fontFamily: fonts.body },
  detail: { gap: 2, marginTop: space.xs },
  detailValue: {
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: fonts.body,
  },
  monoValue: {
    fontFamily: fonts.data,
    fontSize: 14,
    lineHeight: 20,
    fontVariant: ["tabular-nums"],
  },
  bodyText: { ...type.body },
  empty: { alignItems: "flex-start", gap: space.md },
  emptyTitle: {
    color: colors.foreground,
    fontSize: 16,
    lineHeight: 21,
    fontFamily: fonts.bodySemiBold,
  },
  errorNotice: {
    gap: space.md,
    padding: space.base,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: statusSurfaces.danger,
  },
  errorNoticeText: { color: colors.danger, fontSize: 14, lineHeight: 20, fontFamily: fonts.body },
  titleBlock: { gap: space.xs },
  eyebrow: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.foregroundSecondary,
  },
  title: { ...type.pageTitle, letterSpacing: -0.3 },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
  },
  cardTitle: { ...type.cardTitle },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.hover,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.data,
    fontSize: 11,
    fontWeight: "600",
    color: colors.foregroundSecondary,
  },
});
