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
import { fonts } from "../../lib/theme";
import { ClayBadge, ClayButton, ClayCard, ClayTile } from "../../components/clay";
import { raisedControl, pillEdges } from "../../lib/clay";
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
  const tileVariant = isIncident ? "danger" : isFuel ? "secondary" : "primary";

  const getBadge = () => {
    if (isIncident) {
      const s = item.status?.toLowerCase();
      if (s === "resolved") return { label: "RESOLVED", tone: "success", statusDot: true };
      if (item.acknowledged_at) return { label: "ACKNOWLEDGED", tone: "primary", statusDot: true };
      if (!s) return { label: "ALERT", tone: "danger", statusDot: true };
      return { label: "OPEN", tone: "warning", statusDot: true };
    }
    if (isFuel) {
      const s = item.status?.toLowerCase();
      if (s === "pending") return { label: "PENDING", tone: "warning", statusDot: true };
      if (s === "approved") return { label: "APPROVED", tone: "success", statusDot: true };
      if (s === "rejected") return { label: "REJECTED", tone: "danger", statusDot: true };
    }
    if (item.recordType === "INSPECTION") {
      const s = item.status?.toLowerCase();
      if (s === "passed") return { label: "PASSED", tone: "success", statusDot: true };
      if (s === "failed") return { label: "FAILED", tone: "danger", statusDot: true };
    }
    return { label: "LOGGED", tone: "neutral", statusDot: false };
  };

  const badge = getBadge();

  return (
    <ClayCard
      variant="compact"
      onPress={onPress}
      style={[
        styles.logCard,
        isRejected && { borderColor: colors.error, borderWidth: 1 },
      ]}
    >
      <View style={styles.logCardRow}>
        <ClayTile icon={icon} size={40} variant={tileVariant} />
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
        <ClayBadge label={badge.label} tone={badge.tone} statusDot={badge.statusDot} />
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
    </ClayCard>
  );
}

export default function SubmissionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

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
      date: i.inspected_at || i.created_at,
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
          {
            backgroundColor: colors.surface,
            borderBottomColor: isDark ? colors.outlineVariant + "30" : "transparent",
            paddingTop: insets.top,
          },
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
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <ClayCard
            variant="standard"
            style={[styles.deadBanner, { backgroundColor: colors.errorContainer, borderColor: colors.error + "40" }]}
          >
            <View style={styles.deadHeaderRow}>
              <ClayTile icon="cloud-offline-outline" size={38} variant="danger" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.deadTitle, { color: colors.onSurface }]}>
                  {deadLetterCount} unsent incident report{deadLetterCount > 1 ? "s" : ""}
                </Text>
                <Text style={[styles.deadSub, { color: colors.onSurfaceVariant }]}>
                  Dispatch has NOT received {deadLetterCount > 1 ? "them" : "it"} yet.
                </Text>
              </View>
            </View>
            <View style={styles.deadActionsRow}>
              <ClayButton
                label={retryingDead ? "SENDING..." : "RETRY"}
                variant="primary"
                size="sm"
                loading={retryingDead}
                disabled={retryingDead}
                onPress={onRetryDeadLetters}
                accessibilityLabel="Retry sending unsent incident reports"
              />
              <ClayButton
                label="DISCARD"
                variant="tonal"
                size="sm"
                disabled={retryingDead}
                onPress={onDiscardDeadLetters}
                accessibilityLabel="Discard unsent incident reports"
              />
            </View>
          </ClayCard>
        </View>
      )}

      {/* Filter Tabs */}
      <View
        style={[
          styles.filterBar,
          {
            backgroundColor: colors.surface,
            borderBottomColor: isDark ? colors.outlineVariant + "30" : "transparent",
          },
        ]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[
                  styles.filterTab,
                  pillEdges(isDark),
                  active
                    ? { backgroundColor: colors.primary, borderColor: colors.primary }
                    : raisedControl(isDark),
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
        ) : error ? (
          <View style={styles.emptyBox}>
            <ClayTile icon="alert-circle-outline" size={56} variant="danger" />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>Could not load records</Text>
            <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>{error}</Text>
          </View>
        ) : filtered.length === 0 ? (
          view.state === "never-synced" ? (
            <NeverSyncedCard body="Connect once while online to save your logs for offline viewing." />
          ) : allItems.length > 0 ? (
            // Filter artifact: the sources HAVE records — this empty is the
            // filter's, not the sources'. Unchanged behavior, now explicit.
            <View style={styles.emptyBox}>
              <ClayTile icon="document-text-outline" size={56} variant="surface" />
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>No records found</Text>
              <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
                Nothing filed under {filter === "ALL" ? "any category" : filter.toLowerCase()} yet.
              </Text>
            </View>
          ) : view.state === "partial" ? (
            // One source answered [], the other never answered — we cannot
            // claim the screen is empty, only that part is unavailable.
            <View style={styles.emptyBox}>
              <ClayTile icon="cloud-offline-outline" size={56} variant="surface" />
              <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>Activity incomplete</Text>
              <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
                Some offline activity may be unavailable. Reconnect to refresh all activity logs.
              </Text>
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <ClayTile icon="document-text-outline" size={56} variant="surface" />
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
          filtered.map((item, idx) => {
            const isClickable = (item.recordType === "FUEL" && item.status?.toLowerCase() === "rejected") || item.recordType === "INCIDENT";
            return (
              <LogCard
                key={idx}
                item={item}
                colors={colors}
                onPress={
                  isClickable
                    ? () => {
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
                      }
                    : undefined
                }
              />
            );
          })
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
    padding: 14,
    gap: 10,
  },
  deadHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  deadTitle: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  deadSub: { fontSize: 12, fontFamily: fonts.body },
  deadActionsRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 4,
  },
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
  emptyTitle: { fontSize: 17, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  emptySub: { fontSize: 14, fontFamily: fonts.body, textAlign: "center" },
  logCard: {
    gap: 8,
  },
  logCardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  logInfo: { flex: 1, gap: 2 },
  logType: { fontSize: 10, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6, textTransform: "uppercase" },
  logMain: { fontSize: 15, fontFamily: fonts.bodySemiBold },
  logSub: { fontSize: 12, fontFamily: fonts.body },
  logDesc: { fontSize: 13, fontFamily: fonts.body, lineHeight: 18, paddingLeft: 52 },
});
