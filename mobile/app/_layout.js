import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
// ^ All Inter weights are exported from the root package index
import { AuthProvider } from "../lib/auth";
import { ErrorBoundary } from "../components/error-boundary";
import { ThemeProvider, useTheme } from "../lib/theme-context";

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
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const ready = loaded || error;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <AuthProvider>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </AuthProvider>
  );
}
