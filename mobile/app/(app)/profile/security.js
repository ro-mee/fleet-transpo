import { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts } from "../../../lib/theme";
import { useAuth } from "../../../lib/auth";
import { useAppLock } from "../../../lib/app-lock-context";
import { APP_LOCK_TIMEOUT_MS } from "../../../lib/app-lock";
import { methodNoun, methodIcon, unlockActionLabel } from "../../../lib/biometric-method";
import { AppAlert } from "../../../components/AppAlert";
import ClayScreenHeader from "../../../components/ClayScreenHeader";
import { ClayCard, ClayButton, ClayBadge, ClayTile } from "../../../components/clay";
import { moderateScale } from "../../../lib/scaling";

/** "5 minutes" from the single constant — the number is never written twice. */
const TIMEOUT_MINUTES = Math.round(APP_LOCK_TIMEOUT_MS / 60000);

function DetailRow({ label, value, colors, type, isLast = false }) {
  return (
    <View
      style={[
        styles.detailRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" },
      ]}
    >
      <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, flex: 1 }]}>{label}</Text>
      <Text style={[type.bodyMd, { color: colors.onSurface, flex: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

/**
 * Biometric login settings, reached from Profile → Privacy & Security.
 *
 * Deliberately *not* a new top-level Settings → Security section: the existing
 * Settings screen stays display/accessibility only, and this lives beside
 * Change Password and Devices & Sessions where a driver already looks for
 * account security.
 */
export default function BiometricSecurityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= 768;

  const { user } = useAuth();
  const { enabled, meta, method, capability, enable, disable, refresh } = useAppLock();

  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh])
  );

  const available = Boolean(capability?.available);
  const methodName = methodNoun(method, Platform.OS);
  const statusLabel = available ? (enabled ? "On" : "Available") : "Not available";

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)");
    }
  };

  const handleEnable = async (next) => {
    if (busy) return;
    if (!next) {
      setBusy(true);
      try {
        await disable();
        AppAlert.alert(
          "Biometric login is off",
          "You can still unlock FleetOps by signing in with your password. Your current session has not been signed out."
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!user?.employeeId) {
      AppAlert.alert("Sign in again", "We could not tell which account this is. Sign in again and try once more.");
      return;
    }

    setBusy(true);
    try {
      const result = await enable({
        employeeId: user.employeeId,
        driverId: user.driverId ?? null,
        firstName: user.firstName ?? null,
      });
      if (!result.ok) {
        AppAlert.alert("Could not turn on biometric login", result.message);
        return;
      }
      AppAlert.alert(
        "Biometric login is on",
        `FleetOps will ask for ${methodName} when it opens and after ${TIMEOUT_MINUTES} minutes in the background. Your password and email code are still required whenever you sign in fresh.`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Biometric Login" onBack={goBack} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          wide && { alignSelf: "center", width: "100%", maxWidth: moderateScale(640) },
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>STATUS</Text>
        <ClayCard variant="standard" style={{ padding: 0, gap: 0 }}>
          <View style={styles.toggleRow}>
            <ClayTile
              icon={available ? methodIcon(method) : "lock-closed-outline"}
              size="sm"
              backgroundColor={colors.primaryContainer}
              color={colors.onPrimaryContainer}
            />
            <View style={styles.toggleText}>
              <View style={styles.toggleHeader}>
                <Text style={[type.bodyMd, styles.toggleTitle, { color: colors.onSurface }]}>
                  Unlock with {methodName}
                </Text>
                <Switch
                  value={enabled}
                  disabled={!available || busy}
                  onValueChange={handleEnable}
                  trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
                  thumbColor="white"
                />
              </View>
              <Text style={[type.caption, styles.toggleCaption, { color: colors.onSurfaceVariant }]}>
                {!available
                  ? capability?.message || "Checking this device…"
                  : enabled
                    ? `FleetOps locks when it opens and after ${TIMEOUT_MINUTES} minutes in the background.`
                    : "Off. FleetOps opens straight to your trips."}
              </Text>
              <View style={styles.badgeRow}>
                <ClayBadge
                  label={statusLabel}
                  tone={available ? (enabled ? "primary" : "neutral") : "warning"}
                  size="sm"
                />
                {available ? <ClayBadge label={`Device: ${methodName}`} tone="neutral" size="sm" /> : null}
              </View>
            </View>
          </View>

          {enabled ? (
            <>
              <DetailRow
                label="Account"
                value={meta?.firstName ? `${meta.firstName}` : "This device"}
                colors={colors}
                type={type}
              />
              <DetailRow
                label="Enabled on"
                value={meta?.enrolledAt ? new Date(meta.enrolledAt).toLocaleDateString() : "—"}
                colors={colors}
                type={type}
              />
              <DetailRow
                label="Last unlock"
                value={meta?.lastUnlockAt ? new Date(meta.lastUnlockAt).toLocaleString() : "Not yet used"}
                colors={colors}
                type={type}
                isLast
              />
            </>
          ) : null}
        </ClayCard>

        {!available ? (
          <ClayCard variant="standard" style={styles.noteCard}>
            <View style={styles.noteHeader}>
              <Ionicons name="information-circle-outline" size={18} color={colors.onSurfaceVariant} />
              <Text style={[type.labelLg, { color: colors.onSurface }]}>Why it is unavailable</Text>
            </View>
            <Text style={[type.caption, styles.noteBody, { color: colors.onSurfaceVariant }]}>
              {capability?.message ||
                "FleetOps could not confirm that this device supports biometric login. Signing in with your password always works."}
            </Text>
          </ClayCard>
        ) : null}

        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>HOW IT WORKS</Text>
        <ClayCard variant="standard" style={styles.noteCard}>
          <View style={styles.noteHeader}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
            <Text style={[type.labelLg, { color: colors.onSurface }]}>What this protects</Text>
          </View>
          <Text style={[type.caption, styles.noteBody, { color: colors.onSurfaceVariant }]}>
            Someone who picks up your phone while FleetOps is open or in the background cannot reach your trips,
            fuel reports or incidents. The check is done by your device&apos;s own security, and FleetOps only
            receives a yes or a no.
          </Text>
          <View style={[styles.noteDivider, { backgroundColor: colors.outlineVariant + "55" }]} />
          <View style={styles.noteHeader}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.onSurfaceVariant} />
            <Text style={[type.labelLg, { color: colors.onSurface }]}>What it does not protect</Text>
          </View>
          <Text style={[type.caption, styles.noteBody, { color: colors.onSurfaceVariant }]}>
            It does not protect a phone whose operating system has been modified or rooted, a phone whose owner
            account is already compromised, or the {TIMEOUT_MINUTES} minutes right after you unlock. It is a
            convenience lock, not a replacement for your password — and it never changes what the server will
            accept as a valid session.
          </Text>
        </ClayCard>

        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>PRIVACY</Text>
        <ClayCard variant="standard" style={styles.noteCard}>
          <Text style={[type.caption, styles.noteBody, { color: colors.onSurfaceVariant }]}>
            FleetOps never collects, stores, or sends your fingerprint, face, or any biometric information. Nothing
            about your fingerprint or face leaves this device, and no biometric data is ever sent to our servers.
            FleetOps keeps only a note that the lock is switched on.
          </Text>
        </ClayCard>

        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>SIGNING OUT</Text>
        <ClayCard variant="standard" style={styles.noteCard}>
          <Text style={[type.caption, styles.noteBody, { color: colors.onSurfaceVariant }]}>
            Signing out removes this biometric login from the device and ends your session. To get back in you will
            need your password and the code we email you, after which you can turn this on again. Choosing{" "}
            <Text style={{ fontFamily: fonts.bodySemiBold }}>Sign in with password</Text> from the lock screen does
            the same thing.
          </Text>
          {enabled ? (
            <ClayButton
              label={`Turn off ${unlockActionLabel(method, Platform.OS).replace("Unlock with ", "")}`}
              variant="outline"
              size="sm"
              icon="lock-open-outline"
              disabled={busy}
              onPress={() => handleEnable(false)}
              style={styles.noteAction}
            />
          ) : null}
        </ClayCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 10, gap: 22 },
  sectionLabel: {
    marginLeft: 8,
    marginBottom: -12,
    fontFamily: fonts.dataSemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(12),
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(16),
  },
  toggleText: { flex: 1, gap: 6 },
  toggleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: moderateScale(12),
  },
  toggleTitle: { flexShrink: 1 },
  toggleCaption: { lineHeight: moderateScale(16) },
  badgeRow: { flexDirection: "row", gap: moderateScale(6), flexWrap: "wrap" },

  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(12),
    minHeight: moderateScale(48),
  },

  noteCard: { padding: moderateScale(18), gap: moderateScale(8) },
  noteHeader: { flexDirection: "row", alignItems: "center", gap: moderateScale(8) },
  noteBody: { lineHeight: moderateScale(18) },
  noteDivider: { height: 1, marginVertical: moderateScale(4) },
  noteAction: { alignSelf: "flex-start", marginTop: moderateScale(4), paddingHorizontal: 24 },
});
