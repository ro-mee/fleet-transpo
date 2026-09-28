import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { api, isTransportFailure } from "../lib/api";
import { useTheme } from "../lib/theme-context";
import { moderateScale } from "../lib/scaling";
import { ClayCard, ClayButton, ClayInput } from "../components/clay";
import { AuthHeader } from "../components/auth/AuthHeader";
import { AppAlert } from "../components/AppAlert";
import {
  passwordRequirementChecks,
  validateConfirmPassword,
  validateNewPassword,
} from "../lib/password-validation";

export default function SetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const { colors, type } = useTheme();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const passwordError = touched ? validateNewPassword(password) : null;
  const confirmError = touched ? validateConfirmPassword(password, confirmPassword) : null;
  const checks = passwordRequirementChecks(password);

  const handleSubmit = async () => {
    setTouched(true);
    if (validateNewPassword(password) || validateConfirmPassword(password, confirmPassword)) return;

    setSaving(true);
    try {
      await api.post("/api/auth/change-password", { newPassword: password }, { queueOnFailure: false });
      AppAlert.alert(
        "Password Updated",
        "Your temporary password has been replaced. Sign in again with your new password.",
        [
          {
            text: "Continue",
            onPress: async () => {
              await signOut();
              router.replace("/login");
            },
          },
        ]
      );
    } catch (e) {
      if (isTransportFailure(e) || e?.status === 0) {
        AppAlert.alert("No Connection", "The password could not be changed while offline. Check your connection and try again.");
      } else if (e?.status === 429) {
        AppAlert.alert("Too Many Attempts", "Too many attempts. Try again in a minute.");
      } else {
        AppAlert.alert("Change Failed", e?.message || "The password could not be changed. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;
  if (!user.mustChangePassword) return <Redirect href="/" />;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <AuthHeader
          icon="key-outline"
          title="Choose a Password"
          tagline="Required before you can continue"
        />

        <ClayCard variant="standard" style={styles.card}>
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant }]}>
            Create a permanent password for your FleetOps driver account. Your temporary password will stop working after this change.
          </Text>

          <ClayInput
            label="New Password"
            icon="lock-closed-outline"
            placeholder="Enter a new password"
            secureTextEntry={!showPassword}
            rightIcon={showPassword ? "eye-off-outline" : "eye-outline"}
            onRightIconPress={() => setShowPassword((value) => !value)}
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={setPassword}
            error={passwordError}
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
                <Text style={[type.bodyMd, { color: check.valid ? colors.onSurface : colors.onSurfaceVariant }]}>
                  {check.label}
                </Text>
              </View>
            ))}
          </View>

          <ClayInput
            label="Confirm New Password"
            icon="shield-checkmark-outline"
            placeholder="Repeat the new password"
            secureTextEntry={!showConfirm}
            rightIcon={showConfirm ? "eye-off-outline" : "eye-outline"}
            onRightIconPress={() => setShowConfirm((value) => !value)}
            autoCapitalize="none"
            autoCorrect={false}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            error={confirmError}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <ClayButton
            label="Set Permanent Password"
            icon="checkmark-circle-outline"
            onPress={handleSubmit}
            loading={saving}
            disabled={saving}
            size="lg"
            variant="primary"
          />
        </ClayCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
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
