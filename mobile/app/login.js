import { moderateScale } from '../lib/scaling';
import { useCallback, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { useAppLock } from "../lib/app-lock-context";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { clayMaterials } from "../lib/clay";
import { methodNoun, methodIcon, unlockActionLabel } from "../lib/biometric-method";
import { AppAlert } from "../components/AppAlert";
import { ClayCard, ClayButton, ClayTile, ClayInput } from "../components/clay";
import { OtpVerificationView } from "../components/otp/OtpVerificationView";
import { CURRENT_PRIVACY_POLICY_VERSION, getAcceptedConsentVersion } from "../lib/consent";

/**
 * The one-time offer shown right after a successful password + OTP sign-in.
 *
 * Enrollment is only ever reachable from here and from Profile → Biometric
 * Login, both of which sit behind a real sign-in — there is no way to turn the
 * lock on without first proving the account.
 */
function BiometricOfferModal({ driver, method, enrolling, onAccept, onDecline }) {
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");
  const methodName = methodNoun(method, Platform.OS);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.modalBackdrop}>
        <ClayCard variant="standard" style={styles.modalCard}>
          <View
            style={[
              styles.modalIconWrap,
              {
                backgroundColor: colors.primaryContainer,
                borderTopColor: mats.clayTile.borderTopColor,
                borderBottomColor: mats.clayTile.borderBottomColor,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <Ionicons name={methodIcon(method)} size={28} color={colors.onPrimaryContainer} />
          </View>
          <Text style={[type.titleLg, styles.modalTitle, { color: colors.onSurface }]}>
            {unlockActionLabel(method, Platform.OS)}?
          </Text>
          <Text style={[type.bodyMd, styles.modalBody, { color: colors.onSurfaceVariant }]}>
            {driver?.firstName ? `Welcome, ${driver.firstName}. ` : ""}
            Turn on biometric login and FleetOps will ask for {methodName} when it opens and after a few minutes in
            the background. You will still sign in with your password and emailed code whenever you start a new
            session, and signing out removes this from the device.
          </Text>
          <Text style={[type.caption, styles.modalFootnote, { color: colors.onSurfaceVariant }]}>
            FleetOps never sees or stores your fingerprint or face. Your device performs the check and only tells the
            app yes or no.
          </Text>
          <View style={styles.modalActions}>
            <ClayButton
              label="Not now"
              variant="tonal"
              onPress={onDecline}
              disabled={enrolling}
              style={{ flex: 1 }}
            />
            <ClayButton
              label="Turn on"
              onPress={onAccept}
              loading={enrolling}
              style={{ flex: 1 }}
            />
          </View>
        </ClayCard>
      </View>
    </Modal>
  );
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { colors } = useTheme();

  // This screen is the only place a *new* session can be created — password
  // plus the emailed code — so it is also the only honest place to offer the
  // biometric lock for the first time.
  const { refresh: refreshLock, reconcileEnrollment, enable: enableBiometric, method } = useAppLock();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaNotice, setMfaNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // The driver awaiting an enable/decline answer. Non-null means the prompt is
  // up and navigation is deliberately paused until it is answered.
  const [offerDriver, setOfferDriver] = useState(null);
  const [enrolling, setEnrolling] = useState(false);

  const router = useRouter();

  /**
   * Decides whether to offer biometric login after a fresh sign-in.
   *
   * Returns true only when the prompt was actually shown, in which case the
   * caller must NOT navigate — the prompt's buttons do that.
   */
  const maybeOfferBiometric = useCallback(
    async (driver) => {
      if (!driver?.employeeId) return false;
      try {
        // A different driver's enrollment must never be inherited: driver B on a
        // shared phone cannot be prompted into driver A's app.
        await reconcileEnrollment(driver.employeeId);
        const { meta, capability } = await refreshLock();
        // Already on for this account, or the device cannot do it at all — no
        // prompt either way, and never a "turn it on" button that cannot work.
        if (!capability?.available) return false;
        if (meta?.employeeId === driver.employeeId) return false;
        setOfferDriver(driver);
        return true;
      } catch {
        return false;
      }
    },
    [reconcileEnrollment, refreshLock]
  );

  const handlePostLogin = async (driver) => {
    const consentVersion = await getAcceptedConsentVersion().catch(() => null);
    if (consentVersion !== CURRENT_PRIVACY_POLICY_VERSION) {
      // Policy first: a driver who has not accepted the current policy should
      // read it before being asked about device security.
      router.replace("/consent");
      return;
    }
    if (await maybeOfferBiometric(driver)) return;
    router.replace("/");
  };

  const finishBiometricOffer = useCallback(() => {
    setOfferDriver(null);
    setEnrolling(false);
    router.replace("/");
  }, [router]);

  const acceptBiometricOffer = useCallback(async () => {
    const driver = offerDriver;
    if (!driver || enrolling) return;
    setEnrolling(true);
    try {
      const result = await enableBiometric({
        employeeId: driver.employeeId,
        driverId: driver.driverId ?? null,
        firstName: driver.firstName ?? null,
      });
      if (!result.ok) {
        setEnrolling(false);
        AppAlert.alert("Could not turn on biometric login", result.message);
        return;
      }
      finishBiometricOffer();
    } catch {
      setEnrolling(false);
      AppAlert.alert(
        "Could not turn on biometric login",
        "Something went wrong setting up biometric login. You can try again from Profile → Biometric Login."
      );
    }
  }, [offerDriver, enrolling, enableBiometric, finishBiometricOffer]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError("Please enter both username and password.");
      return;
    }
    try {
      setError(null);
      setLoading(true);
      const driver = await signIn(username.trim(), password);
      await handlePostLogin(driver);
    } catch (e) {
      if (e.message === "MFA_REQUIRED") {
        // Valid credentials: the server has emailed a fresh 6-digit code.
        // The OTP step owns everything from here — no code field on this
        // form, no second tap after the code is complete.
        setMfaRequired(true);
        setMfaNotice("Enter the 6-digit code we emailed to your registered address.");
      } else if (e.message === "MFA_INVALID") {
        setError("That verification code is invalid or already used.");
      } else if (e.message === "OTP_UNDELIVERABLE") {
        setError(
          "No verification code could be sent to this account. Contact your administrator."
        );
      } else if (e.message === "MFA_UNAVAILABLE") {
        setError("Verification is temporarily unavailable. Please try again shortly.");
      } else {
        setError(e.message || "Invalid credentials. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Called by the OTP step for the automatic verification (final digit) and
  // for recovery-code entry. Resolves with the driver on success so the OTP
  // view can play its success animation before navigating.
  const handleVerifyOtp = (otpCode) => signIn(username.trim(), password, { otpCode });

  // Re-submitting the sign-in without a code IS the resend: the server
  // issues a fresh challenge and answers MFA_REQUIRED again.
  const handleResendOtp = async () => {
    try {
      await signIn(username.trim(), password, { otpCode: "" });
    } catch (e) {
      if (e.message === "MFA_REQUIRED") return;
      throw e;
    }
  };

  // Rendered in both branches: the offer fires after OTP verification, which
  // happens while the OTP step is still on screen.
  const biometricOffer = offerDriver ? (
    <BiometricOfferModal
      driver={offerDriver}
      method={method}
      enrolling={enrolling}
      onAccept={acceptBiometricOffer}
      onDecline={finishBiometricOffer}
    />
  ) : null;

  if (mfaRequired) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <OtpVerificationView
            identifier={username.trim()}
            notice={mfaNotice}
            onVerify={handleVerifyOtp}
            onResend={handleResendOtp}
            onVerified={handlePostLogin}
            onBack={() => {
              setMfaRequired(false);
              setMfaNotice(null);
            }}
          />

          <Text style={[styles.footer, { color: colors.outline }]}>
            FleetOps Tactical Driver Companion
          </Text>
        </ScrollView>
        {biometricOffer}
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Branding ─── */}
        <View style={styles.brand}>
          <ClayTile
            icon="car-sport"
            size="lg"
            backgroundColor={colors.primary}
            color={colors.onPrimary}
            style={styles.logoTile}
          />
          <Text style={[styles.appName, { color: colors.primary }]}>FleetOps</Text>
          <Text style={[styles.tagline, { color: colors.onSurfaceVariant }]}>
            Driver Portal Access
          </Text>
        </View>

        {/* ─── Form Card ─── */}
        <ClayCard variant="standard" style={styles.card}>
          {/* Error Banner */}
          {error ? (
            <View
              style={[styles.errorBanner, { backgroundColor: colors.errorContainer }]}
            >
              <Ionicons name="alert-circle" size={18} color={colors.onErrorContainer} />
              <Text style={[styles.errorText, { color: colors.onErrorContainer }]}>
                {error}
              </Text>
            </View>
          ) : null}

          {/* Username field */}
          <ClayInput
            label="Driver ID or Email"
            icon="person-outline"
            placeholder="Enter ID or Email"
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            returnKeyType="next"
          />

          {/* Password field */}
          <ClayInput
            label="Password"
            icon="lock-closed-outline"
            placeholder="Enter Password"
            secureTextEntry={!showPassword}
            rightIcon={showPassword ? "eye-off-outline" : "eye-outline"}
            onRightIconPress={() => setShowPassword(!showPassword)}
            value={password}
            onChangeText={setPassword}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          {/* Login CTA */}
          <ClayButton
            label="Login"
            onPress={handleLogin}
            loading={loading}
            size="lg"
            variant="primary"
            style={styles.loginBtn}
          />

          {/* Recovery entry point — public forgot + admin-code reset flow */}
          <Pressable
            onPress={() => router.push("/forgot-password")}
            accessibilityRole="link"
            accessibilityLabel="Forgot password"
            style={styles.forgotLink}
          >
            <Text style={[styles.forgotText, { color: colors.primary }]}>
              Forgot password?
            </Text>
          </Pressable>
        </ClayCard>

        {/* Footer */}
        <Text style={[styles.footer, { color: colors.outline }]}>
          FleetOps Tactical Driver Companion
        </Text>
      </ScrollView>
      {biometricOffer}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: moderateScale(16),
    flexGrow: 1,
    justifyContent: "center",
    gap: moderateScale(24),
  },
  brand: {
    alignItems: "center",
    gap: moderateScale(8),
    marginBottom: moderateScale(4),
  },
  logoTile: {
    marginBottom: moderateScale(4),
  },
  appName: {
    fontSize: moderateScale(28),
    fontFamily: fonts.displayBold,
    lineHeight: moderateScale(36),
  },
  tagline: {
    fontSize: moderateScale(16),
    fontFamily: fonts.body,
    lineHeight: moderateScale(24),
  },
  card: {
    padding: moderateScale(20),
    gap: moderateScale(16),
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    padding: moderateScale(12),
    borderRadius: moderateScale(12),
  },
  errorText: {
    flex: 1,
    fontSize: moderateScale(14),
    fontFamily: fonts.body,
    lineHeight: moderateScale(20),
  },
  loginBtn: {
    marginTop: moderateScale(8),
  },
  forgotLink: {
    alignItems: "center",
    paddingVertical: moderateScale(8),
  },
  forgotText: {
    fontSize: moderateScale(14),
    fontFamily: fonts.bodySemiBold,
    lineHeight: moderateScale(20),
  },
  footer: {
    textAlign: "center",
    fontSize: moderateScale(12),
    fontFamily: fonts.body,
    lineHeight: moderateScale(16),
  },

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
  modalIconWrap: {
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
  modalBody: { textAlign: "center" },
  modalFootnote: { textAlign: "center", lineHeight: moderateScale(16) },
  modalActions: {
    flexDirection: "row",
    gap: moderateScale(12),
    marginTop: moderateScale(8),
    alignSelf: "stretch",
  },
});
