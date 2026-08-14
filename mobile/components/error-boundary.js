import { Component } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme-context";
import { fonts, space } from "../lib/theme";

function ErrorScreen({ error, onRetry }) {
  const { colors, type } = useTheme();
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.pageTitle, { color: colors.onSurface }]}>Something went wrong</Text>
        <Text style={[type.bodyMd, styles.message, { color: colors.error }]}>
          {error?.message || "An unexpected error occurred"}
        </Text>
        <Text style={[type.caption, styles.stack, { color: colors.onSurfaceVariant }]}>
          {error?.stack || ""}
        </Text>
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
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorScreen
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: null })}
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
