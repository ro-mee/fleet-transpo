import { moderateScale } from '../../../lib/scaling';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { useNotificationFeed } from "../../../context/notification-feed";

const NOTIF_TYPE_ICONS = {
  trip_assigned: { icon: "car", color: "primary" },
  trip_cancelled: { icon: "close-circle", color: "error" },
  trip_updated: { icon: "refresh-circle", color: "secondary" },
  fuel_alert: { icon: "water", color: "warning" },
  sos_acknowledged: { icon: "checkmark-circle", color: "secondary" },
  dispatch_message: { icon: "megaphone", color: "primary" },
};

function NotifCard({ notif, colors, onPress }) {
  const { type } = useTheme();
  const typeInfo = NOTIF_TYPE_ICONS[notif.type] || { icon: "notifications", color: "primary" };
  const iconColor =
    typeInfo.color === "error"
      ? colors.error
      : typeInfo.color === "secondary"
      ? colors.secondary
      : typeInfo.color === "warning"
      ? colors.warning
      : colors.primary;
  const bgColor =
    typeInfo.color === "error"
      ? colors.errorContainer
      : typeInfo.color === "secondary"
      ? colors.secondaryContainer
      : colors.primaryContainer;

  const timeStr = notif.created_at
    ? new Date(notif.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <Pressable
      onPress={() => onPress && onPress(notif)}
      style={({ pressed }) => [
        styles.notifCard,
        {
          backgroundColor: notif.is_read
            ? colors.surfaceContainerLowest
            : colors.surfaceContainerLow,
          borderColor: notif.is_read ? colors.outlineVariant : colors.outline,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      {!notif.is_read && (
        <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
      )}
      <View style={[styles.notifIconBox, { backgroundColor: bgColor }]}>
        <Ionicons name={typeInfo.icon} size={22} color={iconColor} />
      </View>
      <View style={styles.notifContent}>
        <View style={styles.notifRow}>
          <Text style={[type.labelLg, styles.notifTitle, { color: colors.onSurface }]} numberOfLines={1}>
            {notif.title || "Notification"}
          </Text>
          <Text style={[type.caption, styles.notifTime, { color: colors.onSurfaceVariant }]}>{timeStr}</Text>
        </View>
        <Text style={[type.bodyMd, styles.notifBody, { color: colors.onSurfaceVariant }]} numberOfLines={2}>
          {notif.message || notif.body}
        </Text>
      </View>
    </Pressable>
  );
}

export default function NotificationsTab() {
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  const {
    notifications,
    loading,
    refreshing,
    unreadCount,
    refresh,
    markRead,
    markAllRead,
  } = useNotificationFeed();

  // Group by date
  const today = new Date().toDateString();
  const todayNotifs = notifications.filter(
    (n) => n.created_at && new Date(n.created_at).toDateString() === today
  );
  const earlierNotifs = notifications.filter(
    (n) => !n.created_at || new Date(n.created_at).toDateString() !== today
  );

  const handleNotifPress = async (notif) => {
    const id = notif.notification_id || notif.id;
    if (!notif.is_read && id) markRead(id);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top App Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant, paddingTop: insets.top },
        ]}
      >
        <View style={styles.topBarLeft}>
          <Text style={[type.headlineMd, styles.topBarBrand, { color: colors.primary }]}>FleetOps</Text>
          <View style={styles.titleBlock}>
            <Text style={[type.titleLg, styles.pageTitle, { color: colors.onSurface }]}>Alerts</Text>
            {unreadCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.error }]}>
                <Text style={[type.labelMd, styles.badgeText, { color: colors.onError }]}>{unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
        {unreadCount > 0 && (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text style={[type.labelLg, styles.markRead, { color: colors.primary }]}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refresh()}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {loading ? (
          <View style={styles.emptyBox}>
            <Text style={[type.bodyMd, styles.emptyText, { color: colors.onSurfaceVariant }]}>Loading...</Text>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.outline} />
            <Text style={[type.titleLg, styles.emptyTitle, { color: colors.onSurface }]}>All Caught Up</Text>
            <Text style={[type.bodyMd, styles.emptyText, { color: colors.onSurfaceVariant }]}>
              No notifications at this time.
            </Text>
          </View>
        ) : (
          <>
            {todayNotifs.length > 0 && (
              <>
                <Text style={[type.labelMd, styles.groupLabel, { color: colors.onSurfaceVariant }]}>TODAY</Text>
                {todayNotifs.map((n) => (
                  <NotifCard key={n.notification_id || n.id} notif={n} colors={colors} onPress={handleNotifPress} />
                ))}
              </>
            )}
            {earlierNotifs.length > 0 && (
              <>
                <Text style={[type.labelMd, styles.groupLabel, { color: colors.onSurfaceVariant }]}>EARLIER</Text>
                {earlierNotifs.map((n) => (
                  <NotifCard key={n.notification_id || n.id} notif={n} colors={colors} onPress={handleNotifPress} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(12),
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  topBarLeft: { gap: moderateScale(2) },
  topBarBrand: { },
  titleBlock: { flexDirection: "row", alignItems: "center", gap: moderateScale(8) },
  pageTitle: { },
  badge: {
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(2),
    borderRadius: moderateScale(999),
    minWidth: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { },
  markRead: { },
  scroll: { paddingHorizontal: moderateScale(16), paddingTop: moderateScale(16), gap: moderateScale(8) },
  groupLabel: {
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: moderateScale(8),
    marginBottom: moderateScale(4),
  },
  emptyBox: { padding: moderateScale(48), alignItems: "center", gap: moderateScale(8) },
  emptyTitle: { },
  emptyText: { textAlign: "center" },
  notifCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: moderateScale(12),
    borderWidth: 1,
    padding: moderateScale(14),
    gap: moderateScale(12),
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    position: "relative",
  },
  unreadDot: {
    position: "absolute",
    top: moderateScale(14),
    left: moderateScale(8),
    width: moderateScale(6),
    height: moderateScale(6),
    borderRadius: moderateScale(3),
  },
  notifIconBox: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  notifContent: { flex: 1, gap: moderateScale(4) },
  notifRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  notifTitle: { flex: 1 },
  notifTime: { marginLeft: moderateScale(8) },
  notifBody: { },
});
