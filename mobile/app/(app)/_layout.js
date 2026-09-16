import { Redirect, Stack, useFocusEffect, usePathname } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { isDriverSession } from "../../lib/rbac";
import { useActiveTripGpsPoster } from "../../lib/tracking";
import { CURRENT_PRIVACY_POLICY_VERSION, getAcceptedConsentVersion } from "../../lib/consent";
import { resolveDriverId } from "../../lib/offline-cache";
import { getGuideProgress, calculateProgress } from "../../lib/driver-guide";
import { useTheme } from "../../lib/theme-context";
import { NotificationFeedProvider } from "../../context/notification-feed";
import { ConnectivityProvider } from "../../lib/connectivity-context";
import { ConnectivityBanner } from "../../components/ConnectivityBanner";

/**
 * Auth + consent + academy guard for every signed-in route.
 *
 * Auth: only a driver session may enter the signed-in area. This is the UI
 * half of the role check; the server independently rejects non-driver tokens
 * on every request, and a driver whose refresh token was revoked lands back
 * here when the api layer clears `user` through the session-expired handler.
 *
 * Consent: a driver who has not accepted the current privacy policy version is
 * parked on the consent screen until they agree, so no personal-data section
 * (license, face photo, live location) is shown first.
 *
 * Driver Academy: all drivers (both new accounts and existing drivers who have
 * not completed all 6 tutorial missions) are strictly locked to /guide until
 * training is 100% completed. Access to trips, dispatch, and vehicle controls
 * is gated until certification.
 */
export default function AppLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const pathname = usePathname();
  const [consentVersion, setConsentVersion] = useState(null);
  const [consentLoading, setConsentLoading] = useState(true);
  const [guideComplete, setGuideComplete] = useState(false);
  const [guideLoading, setGuideLoading] = useState(true);

  const consented = consentVersion === CURRENT_PRIVACY_POLICY_VERSION;
  const driverId = resolveDriverId(user);

  // The single GPS poster for the whole app (see lib/tracking.js). Runs only
  // once the driver is signed in, consented, and academy-certified.
  useActiveTripGpsPoster(Boolean(user) && isDriverSession(user) && consented && guideComplete);

  // Re-read consent and driver academy progress on every focus so finishing
  // the guide unlocks the rest of the app immediately without restart.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [v, guideRes] = await Promise.all([
          getAcceptedConsentVersion().catch(() => null),
          getGuideProgress(driverId).catch(() => ({ completedMissions: [] })),
        ]);
        if (active) {
          setConsentVersion(v);
          const progress = calculateProgress(guideRes?.completedMissions || []);
          setGuideComplete(progress.isComplete);
          setConsentLoading(false);
          setGuideLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [driverId])
  );

  if (loading || consentLoading || guideLoading) {
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

  const isGuideRoute = pathname === "/guide" || pathname?.endsWith("/guide");
  if (!guideComplete && !isGuideRoute) {
    return <Redirect href="/guide" />;
  }

  return (
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
          <Stack.Screen name="guide" />
        </Stack>
      </ConnectivityProvider>
    </NotificationFeedProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
