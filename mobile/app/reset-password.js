import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { apiFetch, isTransportFailure } from "../lib/api";
import { useTheme } from "../lib/theme-context";
import { moderateScale } from "../lib/scaling";
import { fonts } from "../lib/theme";
import { ClayCard, ClayButton, ClayTile, ClayInput } from "../components/clay";
import { AppAlert } from "../components/AppAlert";
import {
  passwordRequirementChecks,
  validateConfirmPassword,
  validateNewPassword,
} from "../lib/password-validation";

/**
 * Reset Password — consumes an administrator-issued one-time reset code.
 *
 * Calls the public token mode of `POST /api/auth/reset-password` with
 * `{ token, newPassword }` — no session required, so `skipAuth: true`.
 * Codes are 30-minute single-use and hashed at rest; consuming one revokes
 * every web + mobile session for the account, so success returns the driver
 * to the login screen.
 *
 * Like every credential mutation, this request is never queued
 * (`queueOnFailure: false`): offline the driver retries when back online.
 */
export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, type } = useTheme();

  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);

  const tokenError = touched && !token.trim() ? "Reset code is required." : null;
  const newError = touched ? validateNewPassword(newPassword) : null;
  const confirmError =
    touched ? validateConfirmPassword(newPassword, confirmPassword) : null;
  const checks = passwordRequirementChecks(newPassword);

  const handleSubmit = async () => {
    setTouched(true);
    if (!token.trim()) return;
    if (validateNewPassword(newPassword)) return;
    if (validateConfirmPassword(newPassword, confirmPassword)) return;

    setLoading(true);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: token.trim(), newPassword }),
        skipAuth: true,
        queueOnFailure: false,
      });
      AppAlert.alert(
        "Password Updated",
        "Your password was reset. Please sign in with your new password.",
        [{ text: "OK", onPress: () => router.replace("/login") }]
      );
    } catch (e) {
      if (isTransportFailure(e) || e?.status === 0) {
        AppAlert.alert(
          "No Connection",
          "The password could not be reset while offline. Check your connection and try again."
        );
      } else if (e?.status === 429) {
        AppAlert.alert("Too Many Attempts", "Too many attempts. Try again in a minute.");
      } else if (e?.status === 400) {
        AppAlert.alert(
          "Invalid or Expired Code",
          e?.message || "That reset code is invalid or has expired. Ask your administrator for a new one."
        );
      } else {
        AppAlert.alert("Reset Failed", e?.message || "The password could not be reset. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

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
        <View style={styles.brand}>
          <ClayTile
            icon="shield-checkmark-outline"
            size="lg"
            backgroundColor={colors.primary}
            color={colors.onPrimary}
            style={styles.logoTile}
          />
          <Text style={[styles.appName, { color: colors.primary }]}>New Password</Text>
          <Text style={[styles.tagline, { color: colors.onSurfaceVariant }]}>
            Enter the reset code from your administrator
          </Text>
        </View>

        <ClayCard variant="standard" style={styles.card}>
          <ClayInput
            label="Reset Code"
            icon="ticket-outline"
            placeholder="Paste your reset code"
            autoCapitalize="none"
            autoCorrect={false}
            value={token}
            onChangeText={setToken}
            error={tokenError}
            helperText="Single-use and expires 30 minutes after it was issued."
            returnKeyType="next"
          />

          <ClayInput
            label="New Password"
            icon="key-outline"
            placeholder="Enter new password"
            secureTextEntry={!showNew}
            rightIcon={showNew ? "eye-off-outline" : "eye-outline"}
            onRightIconPress={() => setShowNew((v) => !v)}
            autoCapitalize="none"
            autoCorrect={false}
            value={newPassword}
            onChangeText={setNewPassword}
            error={newError}
            returnKeyType="next"
          />

          <View style={styles.checklist} accessibilityLabel="Password requirements">
            {checks.map((check) => (
              <View key={check.key} style={styles.checkRow}>
                <Ionicons
                  name={check.valid ? "checkmark-circle" : "ellipse-outline"}
                  size={18}
                  color={check.valid ? colors.primary : colors.outline}
                />
                <Text
                  style={[
                    type.bodyMd,
                    { color: check.valid ? colors.onSurface : colors.onSurfaceVariant },
                  ]}
                >
                  {check.label}
                </Text>
              </View>
            ))}
          </View>

          <ClayInput
            label="Confirm New Password"
            icon="shield-checkmark-outline"
            placeholder="Repeat new password"
            secureTextEntry={!showConfirm}
            rightIcon={showConfirm ? "eye-off-outline" : "eye-outline"}
            onRightIconPress={() => setShowConfirm((v) => !v)}
            autoCapitalize="none"
            autoCorrect={false}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={confirmError}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <ClayButton
            label="Reset Password"
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            size="lg"
            variant="primary"
          />
        </ClayCard>

        <ClayButton
          label="Back to Login"
          onPress={() => router.replace("/login")}
          variant="outline"
          size="md"
          disabled={loading}
        />
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
    textAlign: "center",
  },
  card: {
    padding: moderateScale(20),
    gap: moderateScale(16),
  },
  checklist: {
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(4),
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
});
