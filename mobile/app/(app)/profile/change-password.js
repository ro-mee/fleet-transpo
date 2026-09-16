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
import { useAuth } from "../../../lib/auth";
import { api, isTransportFailure } from "../../../lib/api";
import { useTheme } from "../../../lib/theme-context";
import { moderateScale } from "../../../lib/scaling";
import { fonts } from "../../../lib/theme";
import ClayScreenHeader from "../../../components/ClayScreenHeader";
import { ClayCard, ClayButton, ClayInput } from "../../../components/clay";
import { AppAlert } from "../../../components/AppAlert";
import {
  passwordRequirementChecks,
  validateConfirmPassword,
  validateNewPassword,
} from "../../../lib/password-validation";

/**
 * Change Password — authenticated credential change for drivers.
 *
 * Calls the same `POST /api/auth/change-password` endpoint as web
 * Settings > Security (the route accepts any role and prefers the mobile
 * bearer token, so no mobile-specific backend was needed). The server bumps
 * `auth_version` and revokes every web + mobile session, hence the response
 * carries `signInRequired: true` — success signs the driver out to the login
 * screen, mirroring the web flow.
 *
 * Credential changes are never queued: `queueOnFailure: false` so an offline
 * driver gets a plain connection error instead of a "Saved for sync" promise
 * the server never confirmed.
 */
export default function ChangePasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();
  const { signOut } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const newError = touched ? validateNewPassword(newPassword, { currentPassword }) : null;
  const confirmError =
    touched ? validateConfirmPassword(newPassword, confirmPassword) : null;
  const checks = passwordRequirementChecks(newPassword);

  const handleSubmit = async () => {
    setTouched(true);
    if (!currentPassword) {
      return;
    }
    if (validateNewPassword(newPassword, { currentPassword })) return;
    if (validateConfirmPassword(newPassword, confirmPassword)) return;

    setSaving(true);
    try {
      // Never queued — a password change the server hasn't confirmed is not
      // a change at all. Offline the driver retries when back online.
      await api.post(
        "/api/auth/change-password",
        { currentPassword, newPassword },
        { queueOnFailure: false }
      );
      AppAlert.alert(
        "Password Updated",
        "Your password was changed. All sessions were signed out — please sign in again with your new password.",
        [
          {
            text: "OK",
            onPress: async () => {
              await signOut();
              router.replace("/login");
            },
          },
        ]
      );
    } catch (e) {
      if (isTransportFailure(e) || e?.status === 0) {
        AppAlert.alert(
          "No Connection",
          "The password could not be changed while offline. Check your connection and try again."
        );
      } else if (e?.status === 403) {
        AppAlert.alert("Incorrect Password", "Your current password is incorrect.");
      } else if (e?.status === 429) {
        AppAlert.alert("Too Many Attempts", "Too many attempts. Try again in a minute.");
      } else {
        AppAlert.alert("Change Failed", e?.message || "The password could not be changed. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Change Password" onBack={() => router.back()} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ClayCard variant="standard" style={styles.card}>
            <Text style={[type.bodyMd, { color: colors.onSurfaceVariant }]}>
              Use a new password you do not use anywhere else. You will be signed
              out on all devices after it is changed.
            </Text>

            <ClayInput
              label="Current Password"
              icon="lock-closed-outline"
              placeholder="Enter current password"
              secureTextEntry={!showCurrent}
              rightIcon={showCurrent ? "eye-off-outline" : "eye-outline"}
              onRightIconPress={() => setShowCurrent((v) => !v)}
              autoCapitalize="none"
              autoCorrect={false}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              error={touched && !currentPassword ? "Current password is required." : null}
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
              label="Update Password"
              icon="lock-closed-outline"
              variant="primary"
              size="lg"
              loading={saving}
              disabled={saving}
              onPress={handleSubmit}
              style={styles.submitBtn}
            />
            <Text style={[styles.note, { color: colors.outline }]}>
              Updating your password signs out your web and mobile sessions.
            </Text>
          </ClayCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    paddingHorizontal: moderateScale(16),
    paddingTop: 12,
  },
  card: {
    padding: moderateScale(20),
    gap: moderateScale(14),
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
  submitBtn: {
    marginTop: moderateScale(4),
  },
  note: {
    textAlign: "center",
    fontSize: moderateScale(12),
    fontFamily: fonts.body,
    lineHeight: moderateScale(16),
  },
});
