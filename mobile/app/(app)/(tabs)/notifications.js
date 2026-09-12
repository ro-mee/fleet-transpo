import { moderateScale } from '../../../lib/scaling';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "../../../lib/theme-context";
import { useNotificationFeed } from "../../../context/notification-feed";
import { mobileNotificationTarget } from "../../../lib/notifications/navigation";
import { SkeletonCard } from "../../../components/ui";
import { ClayCard, ClayTile, ClayBadge, ClayButton } from "../../../components/clay";

const NOTIF_TYPE_ICONS = {
  trip_assigned: { icon: "car", color: "primary" },
  trip_cancelled: { icon: "close-circle", color: "error" },
  trip_updated: { icon: "refresh-circle", color: "secondary" },
  fuel_alert: { icon: "water", color: "warning" },
  dispatch_message: { icon: "megaphone", color: "primary" },
  // The server labels incident rows "Info"/"Alert" — resolve them by
  // reference_type in NotifCard instead of this vocabulary.
};

// reference_type fallback for server types that have no icon entry above.
const REFERENCE_TYPE_ICONS = {
  incident: { icon: "warning", color: "error" },
  maintenance: { icon: "build", color: "warning" },
};

function NotifCard({ notif, onPress }) {
  const { colors, type } = useTheme();
  const typeInfo =
    NOTIF_TYPE_ICONS[notif.type] ||
    REFERENCE_TYPE_ICONS[notif.reference_type] ||
    { icon: "notifications", color: "primary" };
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
    <ClayCard
      onPress={() => onPress && onPress(notif)}
      variant="compact"
      accessibilityLabel={`${notif.title || "Notification"}. ${notif.message || notif.body || ""}`}
      style={styles.cardSpacing}
    >
      <View style={styles.notifCardInner}>
        {!notif.is_read && (
          <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
        )}
        <ClayTile icon={typeInfo.icon} size="md" color={iconColor} backgroundColor={bgColor} />
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
      </View>
    </ClayCard>
  );
}


export default function NotificationsTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
    // Deep-link to the notification's target (same map the banners use);
    // null means "no destination — marking read was the whole action".
    const target = mobileNotificationTarget(notif);
    if (target) router.push(target);
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
              <ClayBadge label={String(unreadCount)} tone="danger" size="sm" />
            )}
          </View>
        </View>
        {unreadCount > 0 && (
          <ClayButton
            label="Mark all read"
            onPress={markAllRead}
            variant="tonal"
            size="sm"
          />
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
          <>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyBox}>
            <ClayTile icon="notifications-off-outline" size="lg" backgroundColor={colors.surfaceContainerLow} />
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
                  <NotifCard key={n.notification_id || n.id} notif={n} onPress={handleNotifPress} />
                ))}
              </>
            )}
            {earlierNotifs.length > 0 && (
              <>
                <Text style={[type.labelMd, styles.groupLabel, { color: colors.onSurfaceVariant }]}>EARLIER</Text>
                {earlierNotifs.map((n) => (
                  <NotifCard key={n.notification_id || n.id} notif={n} onPress={handleNotifPress} />
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
  scroll: { paddingHorizontal: moderateScale(16), paddingTop: moderateScale(16), gap: moderateScale(8) },
  groupLabel: {
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: moderateScale(8),
    marginBottom: moderateScale(4),
  },
  cardSpacing: { marginBottom: moderateScale(4) },
  emptyBox: { padding: moderateScale(48), alignItems: "center", gap: moderateScale(12) },
  emptyTitle: { },
  emptyText: { textAlign: "center" },
  notifCardInner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(12),
    position: "relative",
  },
  unreadDot: {
    position: "absolute",
    top: moderateScale(2),
    left: -moderateScale(6),
    width: moderateScale(7),
    height: moderateScale(7),
    borderRadius: moderateScale(4),
  },
  notifContent: { flex: 1, gap: moderateScale(4) },
  notifRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  notifTitle: { flex: 1 },
  notifTime: { marginLeft: moderateScale(8) },
  notifBody: { },
});

