import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../lib/auth";
import { isDriverSession } from "../../lib/rbac";
import { colors } from "../../lib/theme";

/**
 * Auth guard for every signed-in route. A driver whose refresh token was
 * revoked lands back here on the next failed request, because the api layer
 * clears `user` through the session-expired handler.
 */
export default function AppLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Only a driver session may enter the signed-in area. This is the UI half of
  // the role check; the server independently rejects non-driver tokens on every
  // request, and a driver whose refresh token was revoked lands back here when
  // the api layer clears `user` through the session-expired handler.
  if (!isDriverSession(user)) {
    return <Redirect href="/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});
