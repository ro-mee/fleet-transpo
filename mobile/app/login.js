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
import { Redirect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { DEMO_ENABLED } from "../lib/config";
import { colors, fonts, space } from "../lib/theme";
import { LogoMark } from "../components/logo";
import { Button, Card, ErrorNotice, Field, styles as ui } from "../components/ui";

export default function Login() {
  const { user, loading, signIn, signInDriverDemo } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Waiting on the stored session avoids showing this form for a moment to a
  // driver who is already signed in.
  if (loading) {
    return (
      <View style={styles.center}>
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

  const onDriverDemoSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInDriverDemo();
    } catch (e) {
      setError(e.message || "Could not sign in as driver demo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
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
          <Text style={styles.brandName}>FleetOps</Text>
          <Text style={styles.brandSub}>Driver sign in</Text>
        </View>

        <Card>
          <Text style={ui.cardTitle}>Welcome back</Text>
          <Text style={ui.bodyText}>
            Use your driver account credentials{DEMO_ENABLED ? ", or use a quick demo sign-in below for testing." : "."}
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
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            editable={!submitting}
            onSubmitEditing={onSubmit}
            returnKeyType="go"
          />
          <Button
            label={submitting ? "Signing in..." : "Sign in"}
            onPress={onSubmit}
            loading={submitting}
          />
        </Card>

        {DEMO_ENABLED ? (
          <>
            <View style={styles.demoDivider}>
              <View style={styles.line} />
              <Text style={styles.demoLabel}>Temporary testing / demo</Text>
              <View style={styles.line} />
            </View>

            <Button
              label="Sign in as driver (demo)"
              variant="secondary"
              onPress={onDriverDemoSubmit}
              disabled={submitting}
            />
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: space.xl,
    gap: space.xl,
    flexGrow: 1,
    justifyContent: "center",
  },
  brand: { alignItems: "center", gap: space.sm, marginBottom: space.xs },
  brandName: {
    color: colors.foreground,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    fontFamily: "Archivo_700Bold",
    marginTop: space.xs,
  },
  brandSub: {
    color: colors.foregroundSecondary,
    fontSize: 14,
    fontFamily: fonts.body,
  },
  demoDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  demoLabel: {
    color: colors.foregroundSecondary,
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: "IBMPlexMono_500Medium",
  },
});
