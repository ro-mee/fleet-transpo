import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import {
  Archivo_600SemiBold,
  Archivo_700Bold,
} from "@expo-google-fonts/archivo";
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from "@expo-google-fonts/ibm-plex-sans";
import {
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";
// ^ Design-system type spec (docs/design-system.md): Archivo display,
//   IBM Plex Sans interface, IBM Plex Mono data.
import { AuthProvider } from "../lib/auth";
import { ErrorBoundary } from "../components/error-boundary";
import { ThemeProvider, useTheme } from "../lib/theme-context";
import { SettingsProvider } from "../lib/settings-context";
import { syncQueue } from "../lib/sync";
import { AppAlertHost } from "../components/AppAlert";

// Keep the native splash up while fonts load so the app never flashes in a
// fallback typeface. Hidden in the effect below once fonts are ready.
SplashScreen.preventAutoHideAsync().catch(() => {});

function ThemedApp() {
  const { scheme, colors } = useTheme();
  return (
    <ErrorBoundary>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      {/* Premium alert overlay — above everything, below nothing */}
      <AppAlertHost />
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
  const [loaded, error] = useFonts({
    Archivo_600SemiBold,
    Archivo_700Bold,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
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
          <ThemedApp />
        </ThemeProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
