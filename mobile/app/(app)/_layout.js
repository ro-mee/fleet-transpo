import { Redirect, Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { isDriverSession } from "../../lib/rbac";
import { CURRENT_PRIVACY_POLICY_VERSION, getAcceptedConsentVersion } from "../../lib/consent";
import { useTheme } from "../../lib/theme-context";

/**
 * Auth + consent guard for every signed-in route.
 *
 * Auth: only a driver session may enter the signed-in area. This is the UI
 * half of the role check; the server independently rejects non-driver tokens
 * on every request, and a driver whose refresh token was revoked lands back
 * here when the api layer clears `user` through the session-expired handler.
 *
 * Consent: a driver who has not accepted the current privacy policy version is
 * parked on the consent screen until they agree, so no personal-data section
 * (license, face photo, live location) is shown first. The version is re-read
 * on every focus, so accepting on the consent screen lets the driver straight
 * into the app without a restart.
 */
export default function AppLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const [consentVersion, setConsentVersion] = useState(null);
  const [consentLoading, setConsentLoading] = useState(true);

  // Read the locally-accepted policy version. A signed-in driver is remembered
  // so returning drivers are not re-prompted; the version constant lives beside
  // the web policy (mobile/lib/consent.js).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const v = await getAcceptedConsentVersion().catch(() => null);
        if (active) setConsentVersion(v);
        if (active) setConsentLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  if (loading || consentLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!isDriverSession(user)) {
    return <Redirect href="/login" />;
  }

  const consented = consentVersion === CURRENT_PRIVACY_POLICY_VERSION;
  if (!consented) {
    return <Redirect href="/consent" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="trip/[id]" />
      <Stack.Screen name="fuel-report" />
      <Stack.Screen name="incidents" />
      <Stack.Screen name="inspection" />
      <Stack.Screen name="work-schedule" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
