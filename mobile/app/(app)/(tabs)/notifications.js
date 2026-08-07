import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../../lib/api";
import { useTheme } from "../../../lib/theme-context";
import { fonts, space } from "../../../lib/theme";
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  ScreenTitle,
  SkeletonCard,
} from "../../../components/ui";
import { BrandBar } from "../../../components/logo";

/**
 * In-app notifications feed (GET /api/notifications, self-scoped). Tapping an
 * unread notification marks it read. Push notifications are a separate,
 * later workstream — this is the in-app inbox.
 */
export default function Notifications() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get("/api/notifications");
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const markRead = useCallback(async (id) => {
    try {
      await api.put(`/api/notifications/${id}/read`);
      setItems((prev) =>
        prev.map((n) =>
          n.notification_id === id ? { ...n, is_read: true } : n
        )
      );
    } catch {
      // Non-blocking; the row stays unread.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      await api.put("/api/notifications/read-all");
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // ignore
    }
  }, []);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.header}>
          <ScreenTitle eyebrow="Driver" title="Notifications" />
          <Button
            label="Mark all read"
            variant="text"
            size="sm"
            onPress={markAllRead}
          />
        </View>
        <ErrorNotice message={error} />

        {loading ? (
          <View style={styles.skeletons}>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={2} />
          </View>
        ) : items.length === 0 ? (
          <EmptyState title="No notifications" message="Updates will appear here." />
        ) : (
          items.map((n) => (
            <Pressable
              key={n.notification_id}
              onPress={() => markRead(n.notification_id)}
              accessibilityRole="button"
            >
              <Card tone={!n.is_read ? "info" : null}>
                <View style={styles.cardTop}>
                  <Text style={[styles.title, { color: colors.onSurface }]}>{n.title}</Text>
                  {!n.is_read ? <View style={[styles.dot, { backgroundColor: colors.info }]} /> : null}
                </View>
                <Text style={[styles.message, { color: colors.onSurfaceVariant }]}>{n.message}</Text>
                {n.sent_at ? (
                  <Text style={[styles.time, { color: colors.onSurfaceVariant }]}>{new Date(n.sent_at).toLocaleString()}</Text>
                ) : null}
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg },
  skeletons: { gap: space.base },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 15, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  message: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21 },
  time: { fontFamily: fonts.data, fontSize: 11, marginTop: space.xs },
});
