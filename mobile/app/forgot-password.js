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

/**
 * Forgot Password — public pre-login recovery entry point for drivers.
 *
 * Calls the existing public `POST /api/auth/forgot-password`. When email
 * delivery is configured the server emails a 30-minute single-use reset link
 * (plus a paste-able code for this app's reset screen); otherwise it returns
 * the administrator path. Either way the message is identical whether or not
 * the email exists (no account enumeration). This screen renders that message
 * verbatim and keeps the reset-code screen one tap away.
 *
 * `skipAuth` (no session exists out here) and `queueOnFailure: false`
 * (a recovery request must never sit in the offline outbox).
 */
export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, type } = useTheme();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);

  const emailError =
    touched && !email.trim() ? "Email is required." : null;

  const handleSubmit = async () => {
    setTouched(true);
    if (!email.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
        skipAuth: true,
        queueOnFailure: false,
      });
      AppAlert.alert(
        "Request Received",
        data?.message ||
          "If an account exists for that email, a reset link has been sent. It expires in 30 minutes."
      );
    } catch (e) {
      if (isTransportFailure(e) || e?.status === 0) {
        AppAlert.alert(
          "No Connection",
          "The request could not be sent while offline. Check your connection and try again."
        );
      } else if (e?.status === 429) {
        AppAlert.alert("Too Many Attempts", "Too many attempts. Try again in a minute.");
      } else {
        AppAlert.alert("Request Failed", e?.message || "The request could not be sent. Please try again.");
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
            icon="key-outline"
            size="lg"
            backgroundColor={colors.primary}
            color={colors.onPrimary}
            style={styles.logoTile}
          />
          <Text style={[styles.appName, { color: colors.primary }]}>Reset Password</Text>
          <Text style={[styles.tagline, { color: colors.onSurfaceVariant }]}>
            Enter your account email to start recovery
          </Text>
        </View>

        <ClayCard variant="standard" style={styles.card}>
          <ClayInput
            label="Email"
            icon="mail-outline"
            placeholder="Enter your email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            error={emailError}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />

          <ClayButton
            label="Send Reset Request"
            onPress={handleSubmit}
            loading={loading}
            disabled={loading}
            size="lg"
            variant="primary"
          />

            <View style={styles.infoRow}>
            <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={[styles.infoText, { color: colors.onSurfaceVariant }]}>
              Check your email for the reset link — it carries a code you can paste on the next screen if you are
              resetting inside this app.
            </Text>
          </View>

          <ClayButton
            label="I have a reset code"
            onPress={() => router.push("/reset-password")}
            variant="tonal"
            size="md"
            disabled={loading}
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
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(8),
  },
  infoText: {
    flex: 1,
    fontSize: moderateScale(13),
    fontFamily: fonts.body,
    lineHeight: moderateScale(19),
  },
});
