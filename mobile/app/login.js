import { moderateScale } from '../lib/scaling';
import { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { ClayCard, ClayButton, ClayInput } from "../components/clay";
import { AuthHeader } from "../components/auth/AuthHeader";
import { OtpVerificationView } from "../components/otp/OtpVerificationView";
import { CURRENT_PRIVACY_POLICY_VERSION, getAcceptedConsentVersion } from "../lib/consent";
import {
  describeOtpAttemptsLeft,
  describeOtpBurn,
  formatLockWait,
  parseOtpAttemptsLeft,
  parseOtpLock,
  parseOtpStrike,
} from "../lib/otp";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { colors } = useTheme();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const router = useRouter();

  const handlePostLogin = async (driver) => {
    if (driver?.mustChangePassword) {
      router.replace("/set-password");
      return;
    }
    const consentVersion = await getAcceptedConsentVersion().catch(() => null);
    if (consentVersion !== CURRENT_PRIVACY_POLICY_VERSION) {
      // Policy first: the driver must accept the current policy before entering the app.
      router.replace("/consent");
      return;
    }
    router.replace("/");
  };

  const handleLogin = async () => {
    // The OTP step offers no resend link any more, so re-submitting this form
    // is the resend path — and after a strike, the only way to a new code. That
    // is what keeps a new code costing the password: `signIn` here is the
    // credential check, not a bare "send me another code" call.
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
      const lockSecs = parseOtpLock(e?.message);
      const attemptsLeft = parseOtpAttemptsLeft(e?.message);
      const strike = parseOtpStrike(e?.message);
      if (e.message === "MFA_REQUIRED") {
        // Valid credentials: the server has emailed a fresh 6-digit code.
        // The OTP step owns everything from here — no code field on this
        // form, no second tap after the code is complete.
        setMfaRequired(true);
      } else if (e.message === "MFA_INVALID") {
        setError("That verification code is invalid or already used.");
      } else if (attemptsLeft !== null) {
        setError(describeOtpAttemptsLeft(attemptsLeft));
      } else if (strike !== null) {
        // Defensive: this step never submits a code, so the server has no
        // challenge to burn and cannot answer with a strike. The wording is
        // shared with the OTP step's hand-back so the two can never disagree
        // if that ever changes; nothing was requested from here.
        setError(describeOtpBurn({ strike }));
      } else if (e.message === "OTP_UNDELIVERABLE") {
        setError(
          "No verification code could be sent to this account. Contact your administrator."
        );
      } else if (e.message === "TEMP_PASSWORD_EXPIRED") {
        setError("This temporary password has expired. Ask your administrator to resend the login invite.");
      } else if (lockSecs !== null) {
        setError(`Too many incorrect codes. Try again in ${formatLockWait(lockSecs)}.`);
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

  /**
   * A strike ends the OTP step: the burned code can never verify, nothing is
   * sent for the driver, and a new code costs the password again. The password
   * state is dropped so the form cannot re-submit what is still in memory, and
   * the verdict copy lands on the form — the surface that can re-prove the
   * credential.
   */
  const handleOtpBurned = (strike) => {
    setPassword("");
    setMfaRequired(false);
    setError(describeOtpBurn({ strike }));
  };

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
            onVerify={handleVerifyOtp}
            onVerified={handlePostLogin}
            onBurned={handleOtpBurned}
            onBack={() => {
              setMfaRequired(false);
            }}
          />

          <Text style={[styles.footer, { color: colors.onSurfaceVariant }]}>
            FleetOps Tactical Driver Companion
          </Text>
        </ScrollView>
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
        <AuthHeader
          icon="car-sport"
          title="FleetOps"
          tagline="Driver Portal Access"
        />

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

});
