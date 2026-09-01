import { moderateScale } from '../lib/scaling';
import { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme-context";
import { fonts, space, radius, TOUCH_TARGET } from "../lib/theme";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { colors } = useTheme();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const router = useRouter();
  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError("Please enter both username and password.");
      return;
    }
    try {
      setError(null);
      setLoading(true);
      await signIn(username.trim(), password, { mfaCode });
      router.replace("/");
    } catch (e) {
      if (e.message === "MFA_REQUIRED") {
        setMfaRequired(true);
        setError("Enter the verification code from your authenticator app.");
      } else if (mfaRequired && e.message === "MFA_INVALID") {
        setError("That verification code is invalid or already used.");
      } else {
        setError(e.message || "Invalid credentials. Please try again.");
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
        {/* ─── Branding ─── */}
        <View style={styles.brand}>
          <View style={[styles.logoBox, { backgroundColor: colors.primary }]}>
            <Ionicons name="car-sport" size={36} color={colors.onPrimary} />
          </View>
          <Text style={[styles.appName, { color: colors.primary }]}>FleetOps</Text>
          <Text style={[styles.tagline, { color: colors.onSurfaceVariant }]}>
            Driver Portal Access
          </Text>
        </View>

        {/* ─── Form Card ─── */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surfaceContainerLowest,
              borderColor: colors.outlineVariant,
            },
          ]}
        >
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
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.onSurface }]}>
              Driver ID or Email
            </Text>
            <View
              style={[
                styles.inputRow,
                { borderColor: colors.outline, backgroundColor: colors.surfaceContainerLowest },
              ]}
            >
              <Ionicons name="person-outline" size={20} color={colors.outline} />
              <TextInput
                style={[styles.input, { color: colors.onSurface }]}
                placeholder="Enter ID or Email"
                placeholderTextColor={colors.outline}
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
                returnKeyType="next"
              />
            </View>
          </View>

          {mfaRequired ? (
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.onSurface }]}>Verification code</Text>
              <View
                style={[
                  styles.inputRow,
                  { borderColor: colors.outline, backgroundColor: colors.surfaceContainerLowest },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.outline} />
                <TextInput
                  style={[styles.input, { color: colors.onSurface }]}
                  placeholder="6-digit code or recovery code"
                  placeholderTextColor={colors.outline}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={mfaCode}
                  onChangeText={setMfaCode}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
              </View>
            </View>
          ) : null}

          {/* Password field */}
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.onSurface }]}>Password</Text>
            <View
              style={[
                styles.inputRow,
                { borderColor: colors.outline, backgroundColor: colors.surfaceContainerLowest },
              ]}
            >
              <Ionicons name="lock-closed-outline" size={20} color={colors.outline} />
              <TextInput
                style={[styles.input, { color: colors.onSurface }]}
                placeholder="Enter Password"
                placeholderTextColor={colors.outline}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={colors.outline}
                />
              </Pressable>
            </View>
          </View>

          {/* Login CTA */}
          <Pressable
            onPress={handleLogin}
            disabled={loading}
            style={({ pressed }) => [
              styles.loginBtn,
              { backgroundColor: loading ? colors.surfaceContainerHigh : colors.primary },
              pressed && !loading && { opacity: 0.9 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.loginBtnText, { color: colors.onPrimary }]}>Login</Text>
            )}
          </Pressable>
        </View>

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
  brand: {
    alignItems: "center",
    gap: moderateScale(8),
    marginBottom: moderateScale(4),
  },
  logoBox: {
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(16),
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: moderateScale(4) },
    elevation: 4,
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
    borderRadius: moderateScale(16),
    borderWidth: 1,
    padding: moderateScale(16),
    gap: moderateScale(12),
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: moderateScale(2) },
    elevation: 3,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    padding: moderateScale(12),
    borderRadius: moderateScale(8),
  },
  errorText: {
    flex: 1,
    fontSize: moderateScale(14),
    fontFamily: fonts.body,
    lineHeight: moderateScale(20),
  },
  fieldGroup: { gap: moderateScale(4) },
  fieldLabel: {
    fontSize: moderateScale(12),
    fontFamily: fonts.bodyMedium,
    lineHeight: moderateScale(16),
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(12),
    minHeight: TOUCH_TARGET,
    gap: moderateScale(8),
  },
  input: {
    flex: 1,
    fontSize: moderateScale(16),
    fontFamily: fonts.body,
    lineHeight: moderateScale(24),
  },
  loginBtn: {
    height: moderateScale(56),
    borderRadius: moderateScale(8),
    alignItems: "center",
    justifyContent: "center",
    marginTop: moderateScale(4),
  },
  loginBtnText: {
    fontSize: moderateScale(14),
    fontFamily: fonts.bodySemiBold,
    lineHeight: moderateScale(20),
    letterSpacing: 0.1,
  },
  footer: {
    textAlign: "center",
    fontSize: moderateScale(12),
    fontFamily: fonts.body,
    lineHeight: moderateScale(16),
  },
});
