import { moderateScale } from '../../lib/scaling';
import { useState, useCallback, useEffect } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";

const FILTERS = ["ALL", "FUEL", "INSPECTIONS", "INCIDENTS"];

function LogCard({ item, colors, onPress }) {
  const isIncident = item.recordType === "INCIDENT";
  const isFuel = item.recordType === "FUEL";
  const isRejected = isFuel && item.status?.toLowerCase() === "rejected";

  const icon = isFuel ? "water" : item.recordType === "INSPECTION" ? "clipboard" : "warning";
  const iconColor = isIncident ? colors.error : isFuel ? colors.secondary : colors.primary;

  const getStatusDisplay = () => {
    if (isIncident) return { text: "ALERT", bg: colors.errorContainer, textCol: colors.onErrorContainer };
    if (isFuel) {
      const s = item.status?.toLowerCase();
      if (s === "pending") return { text: "PENDING", bg: "#fef3c7", textCol: "#b45309" };
      if (s === "approved") return { text: "APPROVED", bg: "#d1fae5", textCol: "#047857" };
      if (s === "rejected") return { text: "REJECTED", bg: "#fee2e2", textCol: "#b91c1c" };
    }
    if (item.recordType === "INSPECTION") {
      const s = item.status?.toLowerCase();
      if (s === "passed") return { text: "PASSED", bg: "#d1fae5", textCol: "#047857" };
      if (s === "failed") return { text: "FAILED", bg: "#fee2e2", textCol: "#b91c1c" };
    }
    return { text: "LOGGED", bg: colors.secondaryContainer, textCol: colors.onSecondaryContainer };
  };

  const statusStyle = getStatusDisplay();
  const CardComponent = isRejected ? Pressable : View;

  return (
    <CardComponent
      onPress={isRejected ? onPress : undefined}
      style={[
        styles.logCard,
        { backgroundColor: colors.surfaceContainerLowest, borderColor: isRejected ? colors.error : colors.outlineVariant },
      ]}
    >
      <View style={styles.logCardRow}>
        <View style={[styles.logIcon, { backgroundColor: isIncident ? colors.errorContainer : colors.secondaryContainer }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.logInfo}>
          <Text style={[styles.logType, { color: colors.onSurfaceVariant }]}>
            {item.recordType} {isRejected && " (Tap to Fix)"}
          </Text>
          {isFuel ? (
            <Text style={[styles.logMain, { color: colors.onSurface }]}>
              ₱{parseFloat(item.amount || item.total_cost || 0).toFixed(2)}
            </Text>
          ) : item.recordType === "INSPECTION" ? (
            <Text style={[styles.logMain, { color: colors.onSurface }]}>
              Pre-Shift Inspection
            </Text>
          ) : (
            <Text style={[styles.logMain, { color: colors.error }]}>
              {item.title || item.incident_type || "Incident"}
            </Text>
          )}
          <Text style={[styles.logSub, { color: colors.onSurfaceVariant }]}>
            {item.date ? new Date(item.date).toLocaleString() : "—"}
          </Text>
        </View>
        <View style={[styles.logBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.logBadgeText, { color: statusStyle.textCol }]}>
            {statusStyle.text}
          </Text>
        </View>
      </View>
      {item.description ? (
        <Text style={[styles.logDesc, { color: colors.onSurfaceVariant }]} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
    </CardComponent>
  );
}

export default function SubmissionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();

  const [filter, setFilter] = useState("ALL");
  const [submissionsData, setSubmissionsData] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [subRes, inspRes] = await Promise.allSettled([
        api.get("/api/mobile/driver/submissions"),
        api.get("/api/mobile/driver/inspections"),
      ]);
      setSubmissionsData(subRes.status === "fulfilled" && Array.isArray(subRes.value) ? subRes.value : []);
      setInspections(inspRes.status === "fulfilled" && Array.isArray(inspRes.value) ? inspRes.value : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allItems = [
    ...submissionsData.map((i) => ({
      ...i,
      recordType: i.category === "Fuel" ? "FUEL" : "INCIDENT",
      date: i.date || i.created_at,
    })),
    ...inspections.map((i) => ({
      ...i,
      recordType: "INSPECTION",
      date: i.inspected_at || i.created_at
    })),
  ].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const filtered = allItems.filter((item) => {
    if (filter === "ALL") return true;
    if (filter === "FUEL") return item.recordType === "FUEL";
    if (filter === "INSPECTIONS") return item.recordType === "INSPECTION";
    if (filter === "INCIDENTS") return item.recordType === "INCIDENT";
    return true;
  });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top App Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant, paddingTop: insets.top },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View>
          <Text style={[styles.topBarTitle, { color: colors.onSurface }]}>My Submissions</Text>
          <Text style={[styles.topBarSub, { color: colors.onSurfaceVariant }]}>
            Fuel · Inspections · Incidents
          </Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={[styles.filterBar, { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[
                  styles.filterTab,
                  {
                    backgroundColor: active ? colors.primaryContainer : "transparent",
                    borderColor: active ? colors.primary : colors.outlineVariant,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    { color: active ? colors.onPrimaryContainer : colors.onSurfaceVariant },
                  ]}
                >
                  {f}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {loading ? (
          <View style={styles.loadingBox}>
            <Text style={[styles.loadingText, { color: colors.onSurfaceVariant }]}>Loading records...</Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-text-outline" size={48} color={colors.outline} />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No Records Found</Text>
            <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
              Your submitted logs will appear here.
            </Text>
          </View>
        ) : (
          filtered.map((item, idx) => (
            <LogCard
              key={idx}
              item={item}
              colors={colors}
              onPress={() => {
                if (item.recordType === "FUEL") {
                  router.push({
                    pathname: "/fuel-report",
                    params: {
                      id: item.id,
                      odometer: String(item.odometer || ""),
                      liters: String(item.liters || ""),
                      cost: String(item.amount || item.total_cost || ""),
                      station: String(item.station_name || ""),
                    },
                  });
                }
              }}
            />
          ))
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
    gap: moderateScale(12),
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(12),
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  backBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: TOUCH_TARGET / 2,
  },
  topBarTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  topBarSub: { fontSize: moderateScale(12), fontFamily: fonts.body, lineHeight: moderateScale(16) },
  filterBar: { borderBottomWidth: 1 },
  filterScroll: { paddingHorizontal: moderateScale(16), paddingVertical: moderateScale(10), gap: moderateScale(8), flexDirection: "row" },
  filterTab: {
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(6),
    borderRadius: moderateScale(999),
    borderWidth: 1,
  },
  filterText: { fontSize: moderateScale(12), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(16) },
  scroll: { paddingHorizontal: moderateScale(16), paddingTop: moderateScale(16), gap: moderateScale(12) },
  loadingBox: { padding: moderateScale(32), alignItems: "center" },
  loadingText: { fontSize: moderateScale(16), fontFamily: fonts.body },
  emptyBox: { padding: moderateScale(48), alignItems: "center", gap: moderateScale(8) },
  emptyTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  emptySub: { fontSize: moderateScale(14), fontFamily: fonts.body, lineHeight: moderateScale(20), textAlign: "center" },
  logCard: {
    borderRadius: moderateScale(12),
    borderWidth: 1,
    padding: moderateScale(16),
    gap: moderateScale(8),
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  logCardRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(12) },
  logIcon: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(22),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  logInfo: { flex: 1, gap: moderateScale(2) },
  logType: { fontSize: moderateScale(12), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(16), letterSpacing: 0.5, textTransform: "uppercase" },
  logMain: { fontSize: moderateScale(16), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(24) },
  logSub: { fontSize: moderateScale(12), fontFamily: fonts.body, lineHeight: moderateScale(16) },
  logBadge: {
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(4),
    borderRadius: moderateScale(999),
    alignItems: "center",
    justifyContent: "center",
  },
  logBadgeText: { fontSize: moderateScale(10), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(14), letterSpacing: 0.5 },
  logDesc: { fontSize: moderateScale(14), fontFamily: fonts.body, lineHeight: moderateScale(20), paddingLeft: moderateScale(56) },
});
