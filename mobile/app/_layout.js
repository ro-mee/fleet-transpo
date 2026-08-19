import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import {
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";
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
SplashScreen.preventAutoHideAsync().catch(() => {});

function ThemedApp({ appEntrance, showLaunch, onLaunchDone }) {
  const { scheme, colors } = useTheme();
  return (
    <ErrorBoundary>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Animated.View
        style={{
          flex: 1,
          opacity: appEntrance,
          transform: [{
            scale: appEntrance.interpolate({
              inputRange: [0, 1],
              outputRange: [0.985, 1],
            }),
          }],
        }}
      >
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </Animated.View>
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
  const appEntrance = useRef(new Animated.Value(0)).current;
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
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Create the Android notification channel before any push can arrive so
    // remote FCM notifications have somewhere to display.
    initPush().catch(() => {});
  }, []);

  const handleLaunchDone = (reduceMotion) => {
    setShowLaunch(false);
    completeLaunch();
    Animated.timing(appEntrance, {
      toValue: 1,
      duration: reduceMotion ? 1 : 620,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === "active"
      ) {
        // App has come to the foreground, trigger sync
        syncQueue().catch(() => {});
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
            appEntrance={appEntrance}
            showLaunch={showLaunch}
            onLaunchDone={handleLaunchDone}
          />
        </ThemeProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
