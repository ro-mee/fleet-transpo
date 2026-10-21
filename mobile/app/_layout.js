import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, InteractionManager, View } from "react-native";
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
import { hideTripBubble } from "../lib/trip-bubble";

// Keep the native splash up while fonts and the app shell load so the app
// never exposes a fallback typeface or an empty handoff frame.
SplashScreen.preventAutoHideAsync().catch(() => { });

export function ThemedApp({ showLaunch, onLaunchDone }) {
  const { scheme, colors } = useTheme();
  const splashHidden = useRef(false);

  const handleLayout = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    // Wait for the themed shell's first layout, including the launch overlay.
    SplashScreen.hideAsync().catch(() => { });
  }, []);

  useEffect(() => {
    if (showLaunch) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      // Notification setup is not needed to paint the first screen.
      initPush().catch(() => { });
    });
    return () => task.cancel();
  }, [showLaunch]);

  return (
    <View style={{ flex: 1 }} onLayout={handleLayout}>
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
        <AppAlertHost />
        <NotificationHost />
        {showLaunch && <LaunchScreen onComplete={onLaunchDone} />}
      </ErrorBoundary>
    </View>
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
  const [bubbleCleared, setBubbleCleared] = useState(false);
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  const ready = loaded || error;

  const appState = useRef(AppState.currentState);
  const launchFinished = useRef(false);

  useEffect(() => {
    let mounted = true;
    // Fence pending JavaScript work before restoring any navigation tree.
    hideTripBubble().then(() => { if (mounted) setBubbleCleared(true); });
    return () => { mounted = false; };
  }, []);

  const handleLaunchDone = useCallback(() => {
    if (launchFinished.current) return;
    launchFinished.current = true;
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

  if (!ready || !bubbleCleared) {
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
