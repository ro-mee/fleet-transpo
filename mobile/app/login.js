import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme-context";
import { fonts, space } from "../lib/theme";
import { LogoMark } from "../components/logo";
import { Button, Card, ErrorNotice, Field, styles as ui } from "../components/ui";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Waiting on the stored session avoids showing this form for a moment to a
  // driver who is already signed in.
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Also covers the moment just after a successful sign in.
  if (user) {
    return <Redirect href="/" />;
  }

  // Validate on submit; the entered email is preserved after a failure.
  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      // `user` is now set, so the redirect above takes over on re-render.
    } catch (e) {
      setError(e.message || "Could not sign in. Check your connection.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <LogoMark variant="login" size="lg" />
          <Text style={[styles.brandName, { color: colors.onBackground }]}>FleetOps</Text>
          <Text style={[styles.brandSub, { color: colors.onSurfaceVariant }]}>Driver sign in</Text>
          <View style={[styles.brandRule, { backgroundColor: colors.primary }]} />
        </View>

        <Card style={styles.formCard}>
          <Text style={[ui.cardTitle, { color: colors.onSurface }]}>Welcome back</Text>
          <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>
            Use your driver account credentials to sign in.
          </Text>

          <ErrorNotice message={error} />

          <Field
            label="Email"
            required
            value={email}
            onChangeText={setEmail}
            placeholder="driver@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            editable={!submitting}
          />
          <Field
            label="Password"
            required
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            editable={!submitting}
            onSubmitEditing={onSubmit}
            returnKeyType="go"
            right={
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityState={{ disabled: submitting }}
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.eyeToggle,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <View style={styles.eyeWrap}>
                  <View
                    style={[
                      styles.eyeHollow,
                      { borderColor: colors.onSurfaceVariant },
                    ]}
                  >
                    <View style={[styles.eyeIris, { backgroundColor: colors.onSurfaceVariant }]} />
                  </View>
                  {showPassword ? (
                    <View style={[styles.eyeSlash, { backgroundColor: colors.onSurfaceVariant }]} />
                  ) : null}
                </View>
              </Pressable>
            }
          />
          <Button
            label={submitting ? "Signing in..." : "Sign in"}
            onPress={onSubmit}
            loading={submitting}
          />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: {
    paddingHorizontal: space.xl,
    gap: space.xl,
    flexGrow: 1,
    justifyContent: "center",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  formCard: { width: "100%", maxWidth: 480, alignSelf: "center" },
  brand: { alignItems: "center", gap: space.sm, marginBottom: space.xs },
  brandRule: { width: 40, height: 3, borderRadius: 2, marginTop: space.xs },
  brandName: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    fontFamily: "Archivo_700Bold",
    marginTop: space.xs,
  },
  brandSub: { fontSize: 14, fontFamily: fonts.body },
  eyeToggle: {
    minWidth: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeHollow: {
    width: 22,
    height: 13,
    borderRadius: 999,
    borderWidth: 1.6,
    alignItems: "center",
    justifyContent: "center",
  },
  eyeIris: { width: 5, height: 5, borderRadius: 3 },
  eyeSlash: {
    position: "absolute",
    width: 26,
    height: 1.8,
    borderRadius: 1,
    transform: [{ rotate: "45deg" }],
  },
});
