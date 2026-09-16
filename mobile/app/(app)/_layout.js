import { Redirect, Stack, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { isDriverSession } from "../../lib/rbac";
import { useActiveTripGpsPoster } from "../../lib/tracking";
import { CURRENT_PRIVACY_POLICY_VERSION, getAcceptedConsentVersion } from "../../lib/consent";
import { resolveDriverId } from "../../lib/offline-cache";
import { useTheme } from "../../lib/theme-context";
import { NotificationFeedProvider } from "../../context/notification-feed";
import { ConnectivityProvider } from "../../lib/connectivity-context";
import { ConnectivityBanner } from "../../components/ConnectivityBanner";
import { CoachMarkProvider } from "../../components/coachmarks/CoachMarkProvider";

/**
 * Auth + consent guard for every signed-in route.
 *
 * Auth: only a driver session may enter the signed-in area.
 * Consent: a driver who has not accepted the current privacy policy version is
 * parked on the consent screen until they agree.
 *
 * Contextual Coach Marks: wraps the authenticated tree in CoachMarkProvider
 * so real production screens trigger just-in-time guidance.
 */
export default function AppLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const [consentVersion, setConsentVersion] = useState(null);
  const [consentLoading, setConsentLoading] = useState(true);

  const consented = consentVersion === CURRENT_PRIVACY_POLICY_VERSION;
  const driverId = resolveDriverId(user);

  // The single GPS poster for the whole app (see lib/tracking.js). Runs only
  // once the driver is signed in and consented.
  useActiveTripGpsPoster(Boolean(user) && isDriverSession(user) && consented);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const v = await getAcceptedConsentVersion().catch(() => null);
        if (active) {
          setConsentVersion(v);
          setConsentLoading(false);
        }
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

  if (!consented) {
    return <Redirect href="/consent" />;
  }

  return (
    <CoachMarkProvider driverId={driverId}>
      <NotificationFeedProvider>
        <ConnectivityProvider>
          {/* PR #3.1 global connectivity status: layout-participating sibling
              above the navigator — driver-only (guards above already redirected
              non-drivers/consent), pushes content down, never overlays map
              controls or tabs, invisible when healthy. */}
          <ConnectivityBanner />
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
        </ConnectivityProvider>
      </NotificationFeedProvider>
    </CoachMarkProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
