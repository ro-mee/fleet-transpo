import { moderateScale } from '../lib/scaling';
import { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { ClayCard, ClayButton, ClayTile, ClayInput } from "../components/clay";

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

          {mfaRequired ? (
            <ClayInput
              label="Verification code"
              icon="shield-checkmark-outline"
              placeholder="6-digit code or recovery code"
              autoCapitalize="characters"
              autoCorrect={false}
              value={mfaCode}
              onChangeText={setMfaCode}
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
          ) : null}

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
  footer: {
    textAlign: "center",
    fontSize: moderateScale(12),
    fontFamily: fonts.body,
    lineHeight: moderateScale(16),
  },
});
