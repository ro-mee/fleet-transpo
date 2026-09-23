import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { moderateScale } from "../lib/scaling";
import { clayMaterials } from "../lib/clay";
import { useAuth } from "../lib/auth";
import { useAppLock } from "../lib/app-lock-context";
import { methodIcon, unlockActionLabel, methodNoun } from "../lib/biometric-method";
import { ClayButton } from "./clay";

/**
 * The locked state of the app.
 *
 * Rendered **instead of** the authenticated navigator, never over it, so no
 * protected screen is mounted and nothing underneath is tappable — the driver's
 * trips, fuel and incident screens cannot be reached or peeked at while locked.
 *
 * Unlocking does not mint anything. It releases a local gate; the session the
 * app already holds is unchanged and the backend stays the authority on whether
 * that session is still valid.
 */
export default function AppLockScreen() {
  const insets = useSafeAreaInsets();
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");
  const { signOut } = useAuth();
  const { unlock, method, meta } = useAppLock();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fallbackModal, setFallbackModal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // One automatic prompt per lock, so the common case is a glance and a touch.
  // A failure never re-prompts on its own — that would trap the driver in a
  // loop they cannot dismiss.
  const prompted = useRef(false);
  const inFlight = useRef(false);

  const methodName = methodNoun(method, Platform.OS);
  const actionLabel = unlockActionLabel(method, Platform.OS);

  const attempt = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await unlock({ reason: "Confirm it is you to unlock FleetOps." });
      if (!result.ok) {
        // CREDENTIAL_INVALIDATED already switched biometric login off, so its
        // message explains the change; everything else is just a retry.
        setError(result.message);
      }
    } catch {
      setError("Biometric authentication could not be completed. Try again, or sign in with your password.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [unlock]);

  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    // A beat before the first automatic prompt. On Android the biometric dialog
    // needs the hosting activity resumed, and on a cold start React can commit
    // before it is — prompting in that window is the classic way to get a
    // prompt that silently never appears.
    const timer = setTimeout(() => {
      attempt();
    }, 250);
    return () => clearTimeout(timer);
  }, [attempt]);

  const handlePasswordPath = useCallback(async () => {
    setSigningOut(true);
    try {
      // A new session needs the password *and* the emailed code, and the server
      // will not mint one while the old family is alive — so this is a real
      // sign-out, not a bypass. It also destroys the biometric enrollment.
      await signOut();
    } catch {
      setSigningOut(false);
    }
  }, [signOut]);

  const firstName = meta?.firstName;

  return (
    <View
      style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      <View style={styles.body}>
        <View
          style={[
            styles.medallion,
            {
              backgroundColor: colors.primaryContainer,
              borderTopColor: mats.clayTile.borderTopColor,
              borderBottomColor: mats.clayTile.borderBottomColor,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <Ionicons name="lock-closed" size={moderateScale(34)} color={colors.onPrimaryContainer} />
        </View>

        <Text style={[type.titleLg, styles.title, { color: colors.onSurface }]}>
          {firstName ? `Welcome back, ${firstName}` : "FleetOps is locked"}
        </Text>
        <Text style={[type.bodyMd, styles.subtitle, { color: colors.onSurfaceVariant }]}>
          {`Unlock with ${methodName} to continue where you left off.`}
        </Text>

        {error ? (
          <View
            style={[
              styles.errorCard,
              { backgroundColor: colors.errorContainer, borderColor: colors.error + "24" },
            ]}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            <Ionicons name="alert-circle-outline" size={18} color={colors.onErrorContainer} />
            <Text style={[type.caption, styles.errorText, { color: colors.onErrorContainer }]}>{error}</Text>
          </View>
        ) : null}

        <ClayButton
          label={actionLabel}
          icon={busy ? undefined : methodIcon(method)}
          onPress={attempt}
          loading={busy}
          size="lg"
          style={styles.primary}
        />
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
            <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>Waiting for your device…</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text style={[type.caption, styles.footerNote, { color: colors.onSurfaceVariant }]}>
          FleetOps never sees or stores your fingerprint or face. Your device checks it and only tells the app yes or no.
        </Text>
        <ClayButton
          label="Sign in with password"
          variant="outline"
          icon="key-outline"
          onPress={() => setFallbackModal(true)}
        />
      </View>

      <Modal
        visible={fallbackModal}
        transparent
        animationType="fade"
        onRequestClose={() => setFallbackModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              mats.clayCard,
              { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow },
            ]}
          >
            <View
              style={[
                styles.modalIcon,
                {
                  backgroundColor: colors.errorContainer,
                  borderTopColor: mats.clayTile.borderTopColor,
                  borderBottomColor: mats.clayTile.borderBottomColor,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <Ionicons name="key-outline" size={26} color={colors.onErrorContainer} />
            </View>
            <Text style={[type.titleLg, styles.modalTitle, { color: colors.onSurface }]}>Sign in with password?</Text>
            <Text style={[type.bodyMd, styles.modalBody, { color: colors.onSurfaceVariant }]}>
              This signs you out on this device and turns off biometric login. You will need your password and the
              code we email you to get back in.
            </Text>
            <View style={styles.modalActions}>
              <ClayButton
                label="Cancel"
                variant="tonal"
                onPress={() => setFallbackModal(false)}
                disabled={signingOut}
                style={{ flex: 1 }}
              />
              <ClayButton
                label="Sign out"
                variant="danger"
                onPress={handlePasswordPath}
                loading={signingOut}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: moderateScale(24) },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: moderateScale(10) },
  medallion: {
    width: moderateScale(84),
    height: moderateScale(84),
    borderRadius: moderateScale(42),
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 2,
    borderBottomWidth: 3,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: moderateScale(6),
  },
  title: { textAlign: "center" },
  subtitle: { textAlign: "center", paddingHorizontal: moderateScale(12) },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(8),
    padding: moderateScale(12),
    borderRadius: moderateScale(16),
    borderWidth: 1,
    marginTop: moderateScale(6),
  },
  errorText: { flex: 1, lineHeight: 18, fontFamily: fonts.body },
  primary: { alignSelf: "stretch", marginTop: moderateScale(12) },
  busyRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(8) },
  footer: { gap: moderateScale(12), paddingBottom: moderateScale(12) },
  footerNote: { textAlign: "center", lineHeight: 17, paddingHorizontal: moderateScale(8) },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: moderateScale(24),
  },
  modalCard: {
    width: "100%",
    borderRadius: 30,
    padding: moderateScale(24),
    gap: moderateScale(10),
    alignItems: "center",
  },
  modalIcon: {
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(32),
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 2,
    borderBottomWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 7,
    elevation: 3,
  },
  modalTitle: { textAlign: "center" },
  modalBody: { textAlign: "center", paddingHorizontal: moderateScale(8) },
  modalActions: { flexDirection: "row", gap: moderateScale(12), marginTop: moderateScale(8), alignSelf: "stretch" },
});
