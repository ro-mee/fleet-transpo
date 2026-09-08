import { moderateScale } from '../../lib/scaling';
import { useState, useCallback, useEffect, useRef } from "react";
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
import { fonts, TOUCH_TARGET, statusColorForTone } from "../../lib/theme";
import { api, isTransportFailure } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { CACHE_KEYS, getCached, setCached, resolveDriverId } from "../../lib/offline-cache";
import { combineOfflineSources } from "../../lib/offline-ux";
import { SyncNote, NeverSyncedCard, SavedChip } from "../../components/OfflineStates";
import { useConnectivity } from "../../lib/connectivity-context";
import {
  getIncidentDeadLetters,
  retryIncidentDeadLetters,
  clearIncidentDeadLetters,
} from "../../lib/sync";
import { AppAlert } from "../../components/AppAlert";

const FILTERS = ["ALL", "FUEL", "INSPECTIONS", "INCIDENTS"];

function LogCard({ item, colors, onPress }) {
  const isIncident = item.recordType === "INCIDENT";
  const isFuel = item.recordType === "FUEL";
  const isRejected = isFuel && item.status?.toLowerCase() === "rejected";

  const icon = isFuel ? "water-outline" : item.recordType === "INSPECTION" ? "clipboard-outline" : "warning-outline";
  const iconColor = isIncident ? colors.error : isFuel ? colors.secondary : colors.primary;

  const getStatusDisplay = () => {
    const tone = (t) => statusColorForTone(colors, t);
    if (isIncident) {
      // Real lifecycle status from the server — dispatch resolves reports and
      // the driver now sees the outcome instead of a static ALERT label.
      const s = item.status?.toLowerCase();
      if (s === "resolved") return { text: "RESOLVED", bg: tone("success").bg, textCol: tone("success").fg };
      // Acknowledged = the fleet team has taken ownership; help is on the way.
      if (item.acknowledged_at) return { text: "ACKNOWLEDGED", bg: tone("info").bg, textCol: tone("info").fg };
      if (!s) return { text: "ALERT", bg: colors.errorContainer, textCol: colors.onErrorContainer };
      return { text: "OPEN", bg: tone("warning").bg, textCol: tone("warning").fg };
    }
    if (isFuel) {
      const s = item.status?.toLowerCase();
      if (s === "pending") return { text: "PENDING", bg: tone("warning").bg, textCol: tone("warning").fg };
      if (s === "approved") return { text: "APPROVED", bg: tone("success").bg, textCol: tone("success").fg };
      if (s === "rejected") return { text: "REJECTED", bg: tone("danger").bg, textCol: tone("danger").fg };
    }
    if (item.recordType === "INSPECTION") {
      const s = item.status?.toLowerCase();
      if (s === "passed") return { text: "PASSED", bg: tone("success").bg, textCol: tone("success").fg };
      if (s === "failed") return { text: "FAILED", bg: tone("danger").bg, textCol: tone("danger").fg };
    }
    return { text: "LOGGED", bg: colors.secondaryContainer, textCol: colors.onSecondaryContainer };
  };

  const statusStyle = getStatusDisplay();
  const content = (
    <>
      <View style={styles.logCardRow}>
        <View style={[styles.logIcon, { backgroundColor: isIncident ? colors.errorContainer + '60' : isFuel ? colors.secondaryContainer + '60' : colors.primaryContainer + '60' }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.logInfo}>
          <Text style={[styles.logType, { color: colors.onSurfaceVariant }]}>
            {item.recordType} {isRejected && " (Tap to Fix)"}
          </Text>
          {isFuel ? (
            <Text style={[styles.logMain, { color: colors.onSurface }]}>
              ₱{parseFloat(item.amount || item.total_cost || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </Text>
          ) : item.recordType === "INSPECTION" ? (
            <Text style={[styles.logMain, { color: colors.onSurface }]}>
              Pre-Trip Inspection
            </Text>
          ) : (
            <Text style={[styles.logMain, { color: colors.error }]}>
              {item.title || item.incident_type || "Incident Report"}
            </Text>
          )}
          <Text style={[styles.logSub, { color: colors.onSurfaceVariant }]}>
            {item.date ? new Date(item.date).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
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
      {isIncident && item.actions_taken ? (
        <Text style={[styles.logDesc, { color: colors.primary, fontFamily: fonts.bodySemiBold }]} numberOfLines={3}>
          Resolution: {item.actions_taken}
        </Text>
      ) : null}
    </>
  );

  if (isRejected) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.logCard,
          {
            backgroundColor: colors.surfaceContainerLow,
            borderColor: colors.error,
            transform: [{ scale: pressed ? 0.97 : 1 }],
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  // Incident cards open the live status screen (timeline + fleet response).
  if (isIncident) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.logCard,
          {
            backgroundColor: colors.surfaceContainerLow,
            borderColor: colors.outlineVariant + '40',
            transform: [{ scale: pressed ? 0.98 : 1 }],
            opacity: pressed ? 0.9 : 1,
          },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.logCard,
        { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' },
      ]}
    >
      {content}
    </View>
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
  // Incident reports that permanently failed to deliver while offline.
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const [retryingDead, setRetryingDead] = useState(false);
  // Offline Read Mode: per-source server confirmation. A screen is only
  // confirmed empty when BOTH sources were answered — one unanswered source
  // is a partial state (it might hold items we cannot see), never a
  // confirmed-empty claim. setCached stamps syncedAt even for [] payloads,
  // so syncedAt != null means "the server answered this source".
  const [subSyncedAt, setSubSyncedAt] = useState(null);
  const [inspSyncedAt, setInspSyncedAt] = useState(null);
  // Mirrors for load()'s error decision — the callback closure would otherwise
  // read the stale mount-time values (nulls) forever.
  const subSyncedAtRef = useRef(null);
  const inspSyncedAtRef = useRef(null);
  const subCountRef = useRef(0);
  const inspCountRef = useRef(0);
  useEffect(() => {
    subSyncedAtRef.current = subSyncedAt;
    inspSyncedAtRef.current = inspSyncedAt;
    subCountRef.current = submissionsData.length;
    inspCountRef.current = inspections.length;
  }, [subSyncedAt, inspSyncedAt, submissionsData, inspections]);
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  // Unstable counts as online (the amber banner speaks for it) — only a fully
  // offline verdict switches the screen to saved data.
  const { status } = useConnectivity();
  const offline = status === "offline";
  // Filter-empty (data exists, active filter yields nothing) is decided below
  // against the combined sources, never inside the combiner.
  const view = combineOfflineSources(offline, [
    { syncedAt: subSyncedAt, itemCount: submissionsData.length },
    { syncedAt: inspSyncedAt, itemCount: inspections.length },
  ]);

  const refreshDeadLetters = useCallback(async () => {
    const list = await getIncidentDeadLetters();
    setDeadLetterCount(list.length);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    await refreshDeadLetters();
    // Cache first: each source renders instantly from its own snapshot.
    if (driverId) {
      const [subC, inspC] = await Promise.all([
        getCached(driverId, CACHE_KEYS.SUBMISSIONS),
        getCached(driverId, CACHE_KEYS.INSPECTIONS),
      ]);
      if (subC) {
        setSubmissionsData(Array.isArray(subC.data) ? subC.data : []);
        setSubSyncedAt(subC.syncedAt ?? Date.now());
      }
      if (inspC) {
        setInspections(Array.isArray(inspC.data) ? inspC.data : []);
        setInspSyncedAt(inspC.syncedAt ?? Date.now());
      }
      if (subC || inspC) setLoading(false);
    }
    const [subRes, inspRes] = await Promise.allSettled([
      api.get("/api/mobile/driver/submissions"),
      api.get("/api/mobile/driver/inspections"),
    ]);
    if (subRes.status === "fulfilled" && Array.isArray(subRes.value)) {
      if (driverId) await setCached(driverId, CACHE_KEYS.SUBMISSIONS, subRes.value);
      // Confirmed empty counts too — the server answered; stamp it.
      setSubSyncedAt(Date.now());
    }
    if (inspRes.status === "fulfilled" && Array.isArray(inspRes.value)) {
      if (driverId) await setCached(driverId, CACHE_KEYS.INSPECTIONS, inspRes.value);
      setInspSyncedAt(Date.now());
    }
    // A rejected source keeps its previous state (cache or prior network
    // data) instead of blanking to []. Error only when NEITHER source has
    // confirmation (cache nor network) and the failure is genuine — transport
    // failures belong to the global banner.
    const reasons = [subRes, inspRes]
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason);
    setSubmissionsData((prev) =>
      subRes.status === "fulfilled" && Array.isArray(subRes.value) ? subRes.value : prev
    );
    setInspections((prev) =>
      inspRes.status === "fulfilled" && Array.isArray(inspRes.value) ? inspRes.value : prev
    );
    const confirmedAny = subSyncedAtRef.current != null || inspSyncedAtRef.current != null;
    const genuine = reasons.filter((e) => !isTransportFailure(e));
    if (!confirmedAny && subCountRef.current === 0 && inspCountRef.current === 0 && genuine.length > 0) {
      setError(genuine[0]?.message || "Could not load records.");
    }
    setLoading(false);
    setRefreshing(false);
  }, [refreshDeadLetters, driverId]);

  useEffect(() => {
  // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
  const t = setTimeout(load, 0);
  return () => clearTimeout(t);
}, [load]);

  const onRetryDeadLetters = async () => {
    setRetryingDead(true);
    try {
      await retryIncidentDeadLetters();
      setRefreshing(true);
      await load();
    } finally {
      setRetryingDead(false);
    }
  };

  const onDiscardDeadLetters = () => {
    AppAlert.alert(
      "Discard unsent reports?",
      `${deadLetterCount} incident report${deadLetterCount > 1 ? "s" : ""} never reached dispatch and will be removed from this device. This cannot be undone.`,
      [
        { text: "Keep", style: "cancel" },
        { text: "Discard", destructive: true, onPress: async () => { await clearIncidentDeadLetters(); refreshDeadLetters(); } },
      ],
      { type: "warning" }
    );
  };

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
          { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant + '30', paddingTop: insets.top },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View>
          <Text style={[styles.topBarTitle, { color: colors.onSurface }]}>Activity Logs</Text>
          <Text style={[styles.topBarSub, { color: colors.onSurfaceVariant }]}>
            Fuel • Inspections • Incidents
          </Text>
        </View>
      </View>

      {/* Unsent incident reports — quarantined offline, never auto-deleted */}
      {deadLetterCount > 0 && (
        <View style={[styles.deadBanner, { backgroundColor: colors.errorContainer }]}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.error} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.deadTitle, { color: colors.onSurface }]}>
              {deadLetterCount} unsent incident report{deadLetterCount > 1 ? "s" : ""}
            </Text>
            <Text style={[styles.deadSub, { color: colors.onSurfaceVariant }]}>
              Dispatch has NOT received {deadLetterCount > 1 ? "them" : "it"} yet.
            </Text>
          </View>
          <Pressable
            onPress={onRetryDeadLetters}
            disabled={retryingDead}
            accessibilityRole="button"
            accessibilityLabel="Retry sending unsent incident reports"
            style={({ pressed }) => [
              styles.deadBtn,
              { backgroundColor: colors.primary, opacity: retryingDead ? 0.6 : pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={[styles.deadBtnText, { color: colors.onPrimary }]}>
              {retryingDead ? "SENDING" : "RETRY"}
            </Text>
          </Pressable>
          <Pressable
            onPress={onDiscardDeadLetters}
            disabled={retryingDead}
            accessibilityRole="button"
            accessibilityLabel="Discard unsent incident reports"
            style={({ pressed }) => [
              styles.deadBtn,
              {
                backgroundColor: colors.surfaceContainerHighest,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Text style={[styles.deadBtnText, { color: colors.onSurface }]}>DISCARD</Text>
          </Pressable>
        </View>
      )}

      {/* Filter Tabs */}
      <View style={[styles.filterBar, { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant + '30' }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={({ pressed }) => [
                  styles.filterTab,
                  {
                    backgroundColor: active ? colors.primary : colors.surfaceContainerLow,
                    borderColor: active ? colors.primary : colors.outlineVariant + '40',
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    { color: active ? colors.onPrimary : colors.onSurfaceVariant },
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
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {view.showSyncNote && allItems.length > 0 ? (
          // One note for the whole screen — per-source notes would be noise.
          <SyncNote syncedAt={Math.min(subSyncedAt ?? Infinity, inspSyncedAt ?? Infinity)} label="activity logs" />
        ) : null}
        {loading ? (
          <View style={styles.loadingBox}>
            <Text style={[styles.loadingText, { color: colors.onSurfaceVariant }]}>Loading records...</Text>
          </View>
        ) : filtered.length === 0 ? (
          view.state === "never-synced" ? (
            <NeverSyncedCard body="Connect once while online to save your logs for offline viewing." />
          ) : allItems.length > 0 ? (
            // Filter artifact: the sources HAVE records — this empty is the
            // filter's, not the sources'. Unchanged behavior, now explicit.
            <View style={styles.emptyBox}>
              <View style={[styles.emptyIconCircle, { backgroundColor: colors.surfaceContainerHighest }]}>
                <Ionicons name="document-text-outline" size={36} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No records found</Text>
              <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
                Nothing filed under {filter === "ALL" ? "any category" : filter.toLowerCase()} yet.
              </Text>
            </View>
          ) : view.state === "partial" ? (
            // One source answered [], the other never answered — we cannot
            // claim the screen is empty, only that part is unavailable.
            <View style={styles.emptyBox}>
              <View style={[styles.emptyIconCircle, { backgroundColor: colors.surfaceContainerHighest }]}>
                <Ionicons name="cloud-offline-outline" size={36} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>Activity incomplete</Text>
              <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
                Some offline activity may be unavailable. Reconnect to refresh all activity logs.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <View style={[styles.emptyIconCircle, { backgroundColor: colors.surfaceContainerHighest }]}>
                <Ionicons name="document-text-outline" size={36} color={colors.onSurfaceVariant} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No records found</Text>
              <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
                {view.state === "empty-confirmed"
                  ? // Offline confirmed-empty is a snapshot — "when last synced".
                    (offline ? "No records were filed when last synced." : "Submitted fuel, inspection, and expense logs will appear here.")
                  : "Records couldn't be confirmed right now. Pull to refresh or try again."}
              </Text>
              {view.state === "empty-confirmed" && offline ? <SavedChip syncedAt={Math.min(subSyncedAt ?? Infinity, inspSyncedAt ?? Infinity)} /> : null}
            </View>
          )
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
                      fuelDate: String(item.date || ""),
                    },
                  });
                } else if (item.recordType === "INCIDENT") {
                  const incidentId = String(item.id).replace(/^inc_/, "");
                  if (incidentId) router.push(`/incident/${incidentId}`);
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
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
  },
  topBarTitle: { fontSize: 17, fontFamily: fonts.displayBold },
  topBarSub: { fontSize: 12, fontFamily: fonts.body },
  filterBar: { borderBottomWidth: 1 },
  deadBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  deadTitle: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  deadSub: { fontSize: 12, fontFamily: fonts.body },
  deadBtn: {
    minHeight: TOUCH_TARGET - 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  deadBtnText: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6 },
  filterScroll: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterText: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.5 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },
  loadingBox: { padding: 32, alignItems: "center" },
  loadingText: { fontSize: 14, fontFamily: fonts.body },
  emptyBox: { padding: 48, alignItems: "center", gap: 12 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 17, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  emptySub: { fontSize: 14, fontFamily: fonts.body, textAlign: "center" },
  logCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  logCardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  logIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  logInfo: { flex: 1, gap: 2 },
  logType: { fontSize: 10, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6, textTransform: "uppercase" },
  logMain: { fontSize: 15, fontFamily: fonts.bodySemiBold },
  logSub: { fontSize: 12, fontFamily: fonts.body },
  logBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  logBadgeText: { fontSize: 10, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.5 },
  logDesc: { fontSize: 13, fontFamily: fonts.body, lineHeight: 18, paddingLeft: 52 },
});
