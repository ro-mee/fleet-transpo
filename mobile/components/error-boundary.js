import { Component } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme-context";
import { fonts, space } from "../lib/theme";
import { api } from "../lib/api";

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

function truncate(value, max) {
  const s = typeof value === "string" ? value : String(value ?? "");
  return s.length > max ? s.slice(0, max) : s;
}

function ErrorScreen({ error, onRetry }) {
  const { colors, type } = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.pageTitle, { color: colors.onSurface }]}>Something went wrong</Text>
        <Text style={[type.bodyMd, styles.message, { color: colors.error }]}>
          {error?.message || "An unexpected error occurred"}
        </Text>
        {__DEV__ ? (
          <Text style={[type.caption, styles.stack, { color: colors.onSurfaceVariant }]}>
            {error?.stack || ""}
          </Text>
        ) : (
          <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
            The details were logged automatically. Please try again.
          </Text>
        )}
        <Pressable
          onPress={onRetry}
          style={[styles.button, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
        >
          <Text style={[type.labelLg, { color: colors.onPrimary }]}>Try again</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/**
 * Catches render errors and shows the message instead of a blank white screen.
 * The blank-screen-on-login bug hides the real error from Expo Go; this makes
 * it visible so it can be fixed.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reported = false;
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error) {
    // Fire-and-forget mobile crash report. queueOnFailure:false keeps it out
    // of the offline replay queue (a later replay of a crash is pointless),
    // and every failure mode is swallowed — reporting must never crash the
    // fallback screen. Reported once per mount; retry resets the flag.
    if (this.reported) return;
    this.reported = true;
    (async () => {
      try {
        await api.post(
          "/api/errors",
          {
            source: "mobile",
            route: null,
            message: truncate(error?.message || "Unknown mobile render error", MAX_MESSAGE),
            stack: error?.stack ? truncate(error.stack, MAX_STACK) : null,
          },
          { queueOnFailure: false }
        );
      } catch {
        // Reporting is best-effort by contract.
      }
    })();
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorScreen
          error={this.state.error}
          onRetry={() => {
            this.reported = false;
            this.setState({ hasError: false, error: null });
          }}
        />
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space.xl, gap: space.md },
  message: { fontFamily: fonts.bodySemiBold },
  stack: { fontFamily: fonts.data },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: 8,
  },
});
