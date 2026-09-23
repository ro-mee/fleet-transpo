import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts } from "../../lib/theme";
import { moderateScale } from "../../lib/scaling";
import { ClayCard, ClayInput } from "../clay";
import { OtpInput } from "./OtpInput";
import {
  OTP_CODE_DIGITS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SUCCESS_HOLD_MS,
  OTP_TTL_SECONDS,
  OTP_VERIFY_MIN_MS,
  formatCountdown,
  isEmailLike,
  maskEmailAddress,
  sanitizeOtpInput,
} from "../../lib/otp";

/**
 * OtpVerificationView — FleetOps OTP verification step.
 *
 * State machine: ENTERING → COMPLETE → VERIFYING → ERROR → ENTERING,
 *                                              ↘ SUCCESS → NAVIGATING.
 *
 * There is deliberately NO confirm/submit button: completing the final digit
 * dismisses the keyboard and verifies automatically; success plays the check
 * animation and navigates via `onVerified` with no second tap. The backend
 * response is the source of truth — navigation only happens after `onVerify`
 * resolves.
 *
 * Security: the code lives in local state only, is never logged, is cleared
 * on error/back/unmount, and leaves the screen through `onVerify` alone.
 */
export function OtpVerificationView({
  identifier = "",
  notice,
  onVerify,
  onResend,
  onVerified,
  onBack,
}) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

  const [code, setCode] = useState("");
  const [phase, setPhase] = useState("entering"); // entering | verifying | error | success
  const [errorMsg, setErrorMsg] = useState(null);
  const [infoMsg, setInfoMsg] = useState(notice || null);
  const [resending, setResending] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + OTP_TTL_SECONDS * 1000);
  const [cooldownUntil, setCooldownUntil] = useState(
    () => Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000
  );

  const inputRef = useRef(null);
  const verifyingRef = useRef(false);
  // State (not a ref) so the animation node can be read during render
  // without tripping the refs-during-render rule.
  const [successAnim] = useState(() => new Animated.Value(0));
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 1s ticker for the expiry + resend-cooldown countdowns.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingSec = Math.max(0, Math.round((expiresAt - now) / 1000));
  const expired = remainingSec <= 0;
  const cooldownSec = Math.max(0, Math.round((cooldownUntil - now) / 1000));
  const canResend = cooldownSec <= 0 && !resending && phase !== "verifying" && phase !== "success";

  const masked = isEmailLike(identifier) ? maskEmailAddress(identifier) : null;

  const fail = useCallback((message, { keepCode = false } = {}) => {
    if (!mountedRef.current) return;
    setPhase("error");
    setErrorMsg(message);
    if (!keepCode) setCode("");
    inputRef.current?.shake();
    // Let the shake play, then return focus to the first cell.
    setTimeout(() => {
      if (mountedRef.current) inputRef.current?.focusFirst();
    }, 380);
  }, []);

  const verifyWith = useCallback(
    async (otpCode) => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      Keyboard.dismiss();
      setPhase("verifying");
      setErrorMsg(null);
      const started = Date.now();
      try {
        const driver = await onVerify(otpCode);
        // Keep the loader perceptible on fast networks (400–700ms band).
        const elapsed = Date.now() - started;
        if (elapsed < OTP_VERIFY_MIN_MS) {
          await new Promise((r) => setTimeout(r, OTP_VERIFY_MIN_MS - elapsed));
        }
        if (!mountedRef.current) return;
        setPhase("success");
        Animated.timing(successAnim, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }).start();
        // Success IS the confirmation: brief hold, then automatic navigation.
        setTimeout(() => {
          if (mountedRef.current) {
            setCode("");
            setRecoveryCode("");
            onVerified?.(driver);
          }
        }, OTP_SUCCESS_HOLD_MS);
      } catch (e) {
        verifyingRef.current = false;
        if (!mountedRef.current) return;
        const message = e?.message || "Verification failed. Please try again.";
        if (message === "MFA_INVALID") {
          fail("Incorrect verification code.\nPlease check the code and try again.");
        } else if (message === "MFA_UNAVAILABLE") {
          fail("Verification is temporarily unavailable. Please try again shortly.", {
            keepCode: true,
          });
        } else if (message === "OTP_UNDELIVERABLE") {
          fail("No verification code could be sent to this account. Contact your administrator.", {
            keepCode: true,
          });
        } else if (e?.status === 0 || /network|connection|offline/i.test(message)) {
          // Transport failures belong to the connectivity banner; keep the
          // code so retrying needs no retyping.
          fail("No connection. Check your connection and try again.", { keepCode: true });
        } else if (message === "MFA_REQUIRED") {
          // A fresh challenge was issued instead of a verdict — treat as resend.
          setPhase("entering");
          setCode("");
          setExpiresAt(Date.now() + OTP_TTL_SECONDS * 1000);
          setCooldownUntil(Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000);
          setInfoMsg("A new code is on its way to your registered email.");
          setTimeout(() => inputRef.current?.focusFirst(), 100);
        } else {
          fail(message);
        }
      }
    },
    [fail, onVerify, onVerified, successAnim]
  );

  // Automatic verification lives in the change handler (not an effect):
  // the final digit triggers the whole flow with no second tap.
  const handleCodeChange = useCallback(
    (next) => {
      setCode(next);
      if (phase === "error") {
        setPhase("entering");
        setErrorMsg(null);
      }
      if (
        !recoveryMode &&
        phase === "entering" &&
        sanitizeOtpInput(next).length >= OTP_CODE_DIGITS
      ) {
        verifyWith(sanitizeOtpInput(next));
      }
    },
    [phase, recoveryMode, verifyWith]
  );

  const handleResend = useCallback(async () => {
    if (!canResend) return;
    setResending(true);
    setErrorMsg(null);
    try {
      await onResend();
      if (!mountedRef.current) return;
      setExpiresAt(Date.now() + OTP_TTL_SECONDS * 1000);
      setCooldownUntil(Date.now() + OTP_RESEND_COOLDOWN_SECONDS * 1000);
      setCode("");
      setRecoveryCode("");
      setPhase("entering");
      setInfoMsg("A new code is on its way to your registered email.");
      setTimeout(() => inputRef.current?.focusFirst(), 100);
    } catch (e) {
      if (!mountedRef.current) return;
      const message = e?.message || "The code could not be resent. Please try again.";
      if (/cooldown|too many|wait/i.test(message)) {
        setErrorMsg("Please wait a moment before requesting a new code.");
        setPhase("error");
      } else if (e?.status === 0 || /network|connection|offline/i.test(message)) {
        setErrorMsg("No connection. Check your connection and try again.");
        setPhase("error");
      } else {
        setErrorMsg(message);
        setPhase("error");
      }
    } finally {
      if (mountedRef.current) setResending(false);
    }
  }, [canResend, onResend]);

  const handleBack = useCallback(() => {
    // Clear OTP state before leaving so nothing lingers in memory.
    setCode("");
    setRecoveryCode("");
    setErrorMsg(null);
    onBack?.();
  }, [onBack]);

  const handleRecoveryChange = useCallback(
    (text) => {
      const clean = String(text ?? "").replace(/\s/g, "");
      setRecoveryCode(clean);
      setErrorMsg(null);
      if (clean.length >= 20 && phase === "entering") {
        verifyWith(clean);
      }
    },
    [phase, verifyWith]
  );

  const successScale = successAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });
  const successOpacity = successAnim;

  const busy = phase === "verifying" || phase === "success";

  return (
    <View style={styles.root}>
      {/* ─── Header ─── */}
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Back to login"
          style={({ pressed }) => [
            styles.backBtn,
            {
              backgroundColor: colors.surfaceContainerLow,
              borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
              opacity: busy ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* ─── Intro ─── */}
      <View style={styles.intro}>
        <Text style={[styles.title, { color: colors.onBackground }]}>
          Verify your identity
        </Text>
        <Text style={[styles.description, { color: colors.onSurfaceVariant }]}>
          {masked
            ? `Enter the ${OTP_CODE_DIGITS}-digit code sent to`
            : `Enter the ${OTP_CODE_DIGITS}-digit code sent to your registered email`}
        </Text>
        {masked ? (
          <View
            style={[
              styles.emailPill,
              {
                backgroundColor: isDark ? colors.surfaceContainerHigh : colors.primaryContainer,
                borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(40,84,72,0.12)",
              },
            ]}
          >
            <Ionicons name="mail-outline" size={14} color={colors.primary} />
            <Text
              style={[
                styles.maskedEmail,
                { color: isDark ? colors.primary : colors.onPrimaryContainer },
              ]}
            >
              {masked}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ─── OTP card ─── */}
      <ClayCard variant="standard" style={styles.card}>
        {!recoveryMode ? (
          <OtpInput
            ref={inputRef}
            value={code}
            onChange={handleCodeChange}
            status={phase === "error" ? "error" : phase === "success" ? "success" : phase === "verifying" ? "verifying" : "idle"}
            disabled={busy}
            testID="otp-input"
          />
        ) : (
          <ClayInput
            label="Recovery code"
            icon="shield-checkmark-outline"
            placeholder="Enter recovery code"
            autoCapitalize="characters"
            autoCorrect={false}
            value={recoveryCode}
            onChangeText={handleRecoveryChange}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (recoveryCode.trim() && phase === "entering") verifyWith(recoveryCode.trim());
            }}
            helperText="Recovery codes verify automatically once complete."
          />
        )}

        {/* ─── Verification status (reserved height: no layout jump) ─── */}
        <View style={styles.statusArea} accessibilityLiveRegion="polite">
          {phase === "verifying" ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.statusText, { color: colors.onSurfaceVariant }]}>
                Verifying code…
              </Text>
            </View>
          ) : phase === "success" ? (
            <View style={styles.statusRow}>
              <Animated.View
                style={[
                  styles.checkBadge,
                  {
                    backgroundColor: colors.primary,
                    opacity: successOpacity,
                    transform: [{ scale: successScale }],
                  },
                ]}
              >
                <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
              </Animated.View>
              <Text style={[styles.statusText, { color: colors.success }]}>
                Verified successfully
              </Text>
            </View>
          ) : phase === "error" && errorMsg ? (
            <View style={styles.statusRow}>
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={[styles.statusText, { color: colors.error }]}>{errorMsg}</Text>
            </View>
          ) : infoMsg ? (
            <View style={styles.statusRow}>
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={colors.onSurfaceVariant}
              />
              <Text style={[styles.statusText, { color: colors.onSurfaceVariant }]}>
                {infoMsg}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ─── Divider ─── */}
        <View
          style={[
            styles.divider,
            { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
          ]}
        />

        {/* ─── Expiration timer ─── */}
        <View style={styles.timerRow}>
          <Ionicons
            name="time-outline"
            size={15}
            color={expired ? colors.error : colors.onSurfaceVariant}
          />
          <Text
            style={[
              styles.timerText,
              { color: expired ? colors.error : colors.onSurfaceVariant },
            ]}
          >
            {expired
              ? "Code expired — resend a new code below"
              : `Code expires in ${formatCountdown(remainingSec)}`}
          </Text>
        </View>

        {/* ─── Resend ─── */}
        <View style={styles.resendRow}>
          <Text style={[styles.resendHint, { color: colors.onSurfaceVariant }]}>
            Didn&apos;t receive a code?
          </Text>
          {resending ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.resendLink, { color: colors.primary }]}>Sending…</Text>
            </View>
          ) : canResend ? (
            <Pressable
              onPress={handleResend}
              accessibilityRole="button"
              accessibilityLabel="Resend verification code"
              style={styles.resendTap}
            >
              <Text style={[styles.resendLink, { color: colors.primary }]}>Resend</Text>
            </Pressable>
          ) : (
            <Text style={[styles.resendLink, { color: colors.outline }]}>
              Resend in {formatCountdown(cooldownSec)}
            </Text>
          )}
        </View>

        {/* ─── Recovery fallback (preserves the pre-existing capability) ─── */}
        <Pressable
          onPress={() => {
            setRecoveryMode((v) => !v);
            setErrorMsg(null);
            setPhase("entering");
          }}
          disabled={busy}
          accessibilityRole="button"
          style={styles.recoveryTap}
        >
          <Text style={[styles.recoveryText, { color: colors.primary }]}>
            {recoveryMode ? "Back to code entry" : "Use a recovery code instead"}
          </Text>
        </Pressable>
      </ClayCard>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: moderateScale(16),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(14),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  intro: {
    alignItems: "center",
    gap: moderateScale(8),
    paddingHorizontal: moderateScale(8),
  },
  title: {
    fontSize: moderateScale(24),
    fontFamily: fonts.displayBold,
    lineHeight: moderateScale(32),
    textAlign: "center",
  },
  description: {
    fontSize: moderateScale(14),
    fontFamily: fonts.body,
    lineHeight: moderateScale(20),
    textAlign: "center",
  },
  emailPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(6),
    borderRadius: moderateScale(20),
    borderWidth: 1,
    marginTop: moderateScale(2),
  },
  maskedEmail: {
    fontSize: moderateScale(14),
    fontFamily: fonts.bodySemiBold,
    lineHeight: moderateScale(20),
  },
  card: {
    padding: moderateScale(18),
    gap: moderateScale(14),
  },
  statusArea: {
    minHeight: moderateScale(26),
    justifyContent: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
  },
  statusText: {
    flexShrink: 1,
    fontSize: moderateScale(14),
    fontFamily: fonts.bodyMedium,
    lineHeight: moderateScale(20),
    textAlign: "center",
  },
  checkBadge: {
    width: moderateScale(22),
    height: moderateScale(22),
    borderRadius: moderateScale(11),
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: 1,
    width: "100%",
    marginVertical: moderateScale(2),
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(6),
  },
  timerText: {
    fontSize: moderateScale(13),
    fontFamily: fonts.body,
    lineHeight: moderateScale(18),
  },
  resendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(6),
    flexWrap: "wrap",
  },
  resendHint: {
    fontSize: moderateScale(14),
    fontFamily: fonts.body,
    lineHeight: moderateScale(20),
  },
  resendTap: {
    paddingVertical: moderateScale(8),
    paddingHorizontal: moderateScale(6),
    minHeight: moderateScale(40),
    justifyContent: "center",
  },
  resendLink: {
    fontSize: moderateScale(14),
    fontFamily: fonts.bodySemiBold,
    lineHeight: moderateScale(20),
  },
  recoveryTap: {
    alignItems: "center",
    paddingVertical: moderateScale(8),
    minHeight: moderateScale(40),
    justifyContent: "center",
  },
  recoveryText: {
    fontSize: moderateScale(13),
    fontFamily: fonts.bodyMedium,
    lineHeight: moderateScale(18),
  },
});
