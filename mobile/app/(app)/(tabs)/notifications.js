import { useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "../../../lib/theme-context";
import { statusColorForTone } from "../../../lib/theme";
import { useNotificationFeed } from "../../../context/notification-feed";
import { mobileNotificationTarget } from "../../../lib/notifications/navigation";
import { mobileNotificationAppearance, notificationTimeLabel } from "../../../lib/notifications/presentation";
import ClayScreenHeader from "../../../components/ClayScreenHeader";
import { SkeletonCard } from "../../../components/ui";
import { ClayCard, ClayTile, ClayBadge, ClayButton } from "../../../components/clay";

function NotifCard({ notif, onPress, onDismiss }) {
  const { colors, type } = useTheme();
  const appearance = mobileNotificationAppearance(notif);
  const iconColors = appearance.tone === "primary"
    ? { bg: colors.primaryContainer, fg: colors.onPrimaryContainer }
    : statusColorForTone(colors, appearance.tone);
  const title = notif.title || "Notification";
  const body = notif.message || notif.body || "";
  const unread = !notif.is_read;

  return (
    <ClayCard variant="standard" style={[styles.messageCard, { borderLeftColor: unread ? colors.primary : "transparent" }]}>
      <View style={styles.messageRow}>
        <Pressable
          onPress={() => onPress(notif)}
          accessibilityRole="button"
          accessibilityLabel={`${unread ? "Unread" : "Read"}. ${title}. ${body}${appearance.severity ? `. ${appearance.severity.label}` : ""}`}
          style={({ pressed }) => [styles.messageTarget, { opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={styles.messageContent}>
            <View style={styles.metaRow}>
              <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.messageIcon, { backgroundColor: iconColors.bg }]}>
                <Ionicons name={appearance.icon} size={16} color={iconColors.fg} />
              </View>
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{appearance.category?.label || "Fleet update"}</Text>
              {appearance.severity && <ClayBadge label={appearance.severity.label} tone={appearance.severity.tone} size="sm" />}
            </View>
            <Text style={[type.cardTitle, { color: colors.onSurface }]}>{title}</Text>
            {body ? <Text style={type.supporting}>{body}</Text> : null}
            <View style={styles.metaRow}>
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{notificationTimeLabel(notif.created_at)}</Text>
              <View style={styles.readState}>
                {unread && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
                <Text style={[type.caption, { color: unread ? colors.primary : colors.onSurfaceVariant }]}>{unread ? "Unread" : "Read"}</Text>
              </View>
            </View>
          </View>
        </Pressable>
        <Pressable
          onPress={() => onDismiss(notif)}
          accessibilityRole="button"
          accessibilityLabel={`Dismiss notification: ${title}`}
          style={({ pressed }) => [styles.dismissBtn, { backgroundColor: colors.surfaceContainerHigh, opacity: pressed ? 0.65 : 1 }]}
        >
          <Ionicons name="close-outline" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>
    </ClayCard>
  );
}

export default function NotificationsTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, type } = useTheme();
  const { notifications, loading, refreshing, error, unreadCount, refresh, markRead, markAllRead, dismiss } = useNotificationFeed();
  const [markingRead, setMarkingRead] = useState(false);
  const today = new Date().toDateString();
  const groups = [
    { label: "Today", rows: notifications.filter(n => n.created_at && new Date(n.created_at).toDateString() === today) },
    { label: "Earlier", rows: notifications.filter(n => !n.created_at || new Date(n.created_at).toDateString() !== today) },
  ];
  const handleNotifPress = notif => {
    const id = notif.notification_id || notif.id;
    if (!notif.is_read && id) markRead(id);
    const target = mobileNotificationTarget(notif);
    if (target) router.push(target);
  };
  const handleMarkAllRead = async () => {
    if (markingRead) return;
    setMarkingRead(true);
    try { await markAllRead(); } finally { setMarkingRead(false); }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Notifications" onBack={() => router.canGoBack() ? router.back() : router.replace("/")} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 168 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <ClayCard variant="hero" style={styles.summary}>
          <View style={styles.summaryRow}>
            <ClayTile icon="notifications-outline" size="md" variant="primary" />
            <View style={styles.summaryCopy}>
              <Text style={type.titleLg}>{loading ? "Checking your inbox" : unreadCount > 0 ? `${unreadCount} unread` : notifications.length > 0 ? "All read" : "Your inbox"}</Text>
              <Text style={type.supporting}>{unreadCount > 0 ? "Open a message to view details and mark it as read." : "Your trip updates and fleet messages."}</Text>
            </View>
          </View>
          {unreadCount > 0 && <ClayButton label="Mark all read" icon="checkmark-done-outline" variant="tonal" loading={markingRead} onPress={handleMarkAllRead} />}
        </ClayCard>

        {error && (
          <ClayCard variant="standard" style={styles.errorCard}>
            <View accessibilityRole="alert" style={styles.errorCopy}>
              <Text style={[type.cardTitle, { color: colors.error }]}>Notifications couldn’t refresh</Text>
              <Text style={type.supporting}>{error}</Text>
            </View>
            <ClayButton label="Try again" icon="refresh-outline" variant="tonal" loading={refreshing} onPress={() => refresh()} />
          </ClayCard>
        )}

        {loading ? (
          <><SkeletonCard lines={3} /><SkeletonCard lines={3} /></>
        ) : notifications.length === 0 ? (
          !error && <ClayCard variant="standard" style={styles.emptyCard}>
            <ClayTile icon="checkmark-done-outline" size="lg" variant="primary" />
            <Text style={[type.titleLg, styles.centered]}>All caught up</Text>
            <Text style={[type.supporting, styles.centered]}>Trip updates and fleet messages will appear here.</Text>
          </ClayCard>
        ) : groups.map(group => group.rows.length > 0 && (
          <View key={group.label} style={styles.group}>
            <Text accessibilityRole="header" style={[type.labelLg, styles.groupLabel]}>{group.label}</Text>
            {group.rows.map(notif => <NotifCard key={notif.notification_id || notif.id} notif={notif} onPress={handleNotifPress} onDismiss={row => dismiss(row.notification_id || row.id)} />)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { width: "100%", maxWidth: 720, alignSelf: "center", paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  summary: { padding: 20, gap: 16 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryCopy: { flex: 1, minWidth: 0, gap: 4 },
  group: { gap: 12 },
  groupLabel: { paddingHorizontal: 4, marginTop: 4 },
  messageCard: { padding: 16, borderLeftWidth: 3 },
  messageRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  messageTarget: { flex: 1, minWidth: 0, minHeight: 48 },
  messageIcon: { width: 28, height: 28, flexShrink: 0, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  messageContent: { minWidth: 0, gap: 8 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  readState: { flexDirection: "row", alignItems: "center", gap: 5 },
  unreadDot: { width: 6, height: 6, borderRadius: 3 },
  dismissBtn: { width: 48, height: 48, flexShrink: 0, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  errorCard: { padding: 20, gap: 16 },
  errorCopy: { gap: 4 },
  emptyCard: { padding: 28, minHeight: 240, alignItems: "center", justifyContent: "center", gap: 16 },
  centered: { textAlign: "center", maxWidth: 320 },
});
