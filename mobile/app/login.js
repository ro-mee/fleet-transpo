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
import { colors, space } from "../lib/theme";
import { Button, Field, ErrorNotice, styles as ui } from "../components/ui";

export default function Login() {
  const { user, loading, signIn, signInGuest, signInDriverDemo } = useAuth();
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

  const onGuestSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInGuest();
    } catch (e) {
      setError(e.message || "Could not sign in as guest.");
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
        <View style={styles.header}>
          <Text style={ui.eyebrow}>FleetOps</Text>
          <Text style={styles.title} accessibilityRole="header">
            Driver sign in
          </Text>
          <Text style={ui.bodyText}>
            Use your driver account credentials, or use a quick demo sign-in below for testing.
          </Text>
        </View>

        <ErrorNotice message={error} />

        <View style={styles.form}>
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

          <View style={styles.demoDivider}>
            <View style={styles.line} />
            <Text style={styles.demoLabel}>TEMPORARY TESTING / DEMO</Text>
            <View style={styles.line} />
          </View>

          <Button
            label="⚡ Quick Sign In as Driver"
            variant="secondary"
            onPress={onDriverDemoSubmit}
            disabled={submitting}
          />
          
          <View style={{ height: space.xs }} />

          <Button
            label="👤 Quick Sign In as Guest"
            variant="secondary"
            onPress={onGuestSubmit}
            disabled={submitting}
          />
        </View>
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
  header: { gap: space.sm },
  title: { color: colors.foreground, fontSize: 28, fontWeight: "700" },
  form: { gap: space.xs },
  demoDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: space.md,
    gap: space.sm,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  demoLabel: {
    color: colors.foregroundSecondary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
  },
});
