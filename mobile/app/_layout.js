import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { PlusJakartaSans_400Regular } from "@expo-google-fonts/plus-jakarta-sans/400Regular";
import { PlusJakartaSans_500Medium } from "@expo-google-fonts/plus-jakarta-sans/500Medium";
import { PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans/600SemiBold";
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { IBMPlexMono_600SemiBold } from "@expo-google-fonts/ibm-plex-mono/600SemiBold";
// ^ Plus Jakarta Sans keeps the mobile interface warm, polished, and highly legible;
//   IBM Plex Mono remains reserved for operational data.
import { AuthProvider } from "../lib/auth";
import { initPush } from "../lib/notifications/push";
import { ErrorBoundary } from "../components/error-boundary";
import { ThemeProvider, useTheme } from "../lib/theme-context";
import { SettingsProvider } from "../lib/settings-context";
import { syncQueue } from "../lib/sync";
import { AppAlertHost } from "../components/AppAlert";
import { NotificationHost } from "../components/NotificationHost";
import { LaunchScreen } from "../components/LaunchScreen";
import { completeLaunch } from "../lib/launch";

// Keep the native splash up while fonts load so the app never flashes in a
// fallback typeface. Hidden in the effect below once fonts are ready.
SplashScreen.preventAutoHideAsync().catch(() => { });

function ThemedApp({ showLaunch, onLaunchDone }) {
  const { scheme, colors } = useTheme();
  return (
    <ErrorBoundary>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View
        style={{ flex: 1 }}
        pointerEvents={showLaunch ? "none" : "auto"}
        accessibilityElementsHidden={showLaunch}
        importantForAccessibility={showLaunch ? "no-hide-descendants" : "auto"}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </View>
      {/* Premium alert overlay — above everything, below nothing */}
      <AppAlertHost />
      {/* Heads-up banners + toasts for the 3-tier notification system */}
      <NotificationHost />
      {showLaunch && <LaunchScreen onComplete={onLaunchDone} />}
    </ErrorBoundary>
  );
}

/**
 * Root layout. Wraps every route in the auth + theme context so the guard in
 * (app)/_layout.js, the login screen, and every screen read the same state.
 *
 * expo-router's ExpoRoot already provides SafeAreaProvider, so screens can use
 * useSafeAreaInsets without another provider here.
 */
export default function RootLayout() {
  const [showLaunch, setShowLaunch] = useState(true);
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  const ready = loaded || error;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => { });
    }
  }, [ready]);

  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Create the Android notification channel before any push can arrive so
    // remote FCM notifications have somewhere to display.
    initPush().catch(() => { });
  }, []);

  const handleLaunchDone = useCallback(() => {
    setShowLaunch(false);
    completeLaunch();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === "active"
      ) {
        // App has come to the foreground, trigger sync
        syncQueue().catch(() => { });
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <AuthProvider>
      <SettingsProvider>
        <ThemeProvider>
          <ThemedApp
            showLaunch={showLaunch}
            onLaunchDone={handleLaunchDone}
          />
        </ThemeProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
