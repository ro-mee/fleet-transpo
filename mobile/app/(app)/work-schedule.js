import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { moderateScale } from "../../lib/scaling";
import { api, isTransportFailure } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { CACHE_KEYS, getCached, setCached, resolveDriverId } from "../../lib/offline-cache";
import { useConnectivity } from "../../lib/connectivity-context";
import { SyncNote, NeverSyncedCard } from "../../components/OfflineStates";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { ClayBadge, ClayButton, ClayCard, ClayInput, ClayTile } from "../../components/clay";
import { AppAlert } from "../../components/AppAlert";
import { notify } from "../../lib/notifications/notify";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const LEAVE_TYPES = ["Vacation", "Personal", "Medical"];

function formatTime(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value);
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function WorkScheduleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";
  const [view, setView] = useState("schedule");
  const [schedule, setSchedule] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [leaveType, setLeaveType] = useState("Vacation");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Offline Read Mode: cachedTimes/freshTimes track which sources have ANY
  // data (each source falls back independently — one failing never blanks the
  // rest) for the no-data error decision below. Per-screen staleness display
  // is per-source (scheduleSyncedAt/leavesSyncedAt) + the global banner.
  // Per-source server confirmation for the 4-state UI. setCached stamps
  // syncedAt even for an empty [] payload, so `syncedAt != null` honestly
  // means "the server answered this source at some point" — that separates
  // a confirmed-empty schedule from a never-synced device. Tracked for the
  // two sources with row-level empty states (days, leaves); balances chips
  // render-or-hide naturally and need no branch.
  const [scheduleSyncedAt, setScheduleSyncedAt] = useState(null);
  const [leavesSyncedAt, setLeavesSyncedAt] = useState(null);
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  // Unstable/syncing count as online here (fetches still revalidate, and the
  // global banner already speaks for degraded connections) — only a fully
  // offline verdict switches the screen to saved data.
  const { status } = useConnectivity();
  const offline = status === "offline";

  const load = useCallback(async () => {
    setError(null);
    // Cache first: each source renders instantly from its own snapshot.
    let cachedTimes = [];
    if (driverId) {
      const [daysC, leavesC, balancesC] = await Promise.all([
        getCached(driverId, CACHE_KEYS.SCHEDULE_DAYS),
        getCached(driverId, CACHE_KEYS.LEAVES),
        getCached(driverId, CACHE_KEYS.BALANCES),
      ]);
      if (daysC) {
        setSchedule(Array.isArray(daysC.data) ? daysC.data : []);
        setScheduleSyncedAt(daysC.syncedAt ?? Date.now());
        if (daysC.syncedAt != null) cachedTimes.push(daysC.syncedAt);
      }
      if (leavesC) {
        setLeaves(Array.isArray(leavesC.data) ? leavesC.data : []);
        setLeavesSyncedAt(leavesC.syncedAt ?? Date.now());
        if (leavesC.syncedAt != null) cachedTimes.push(leavesC.syncedAt);
      }
      if (balancesC) {
        setBalances(Array.isArray(balancesC.data) ? balancesC.data : []);
        if (balancesC.syncedAt != null) cachedTimes.push(balancesC.syncedAt);
      }
      if (cachedTimes.length > 0) {
        setLoading(false);
      }
    }
    // Revalidate each source independently — display-only cache updates.
    const results = await Promise.allSettled([
      api.get("/api/driver-work-schedules"),
      api.get("/api/driver/leave"),
      api.get("/api/driver/balances"),
    ]);
    const freshTimes = [];
    const [schedRes, leaveRes, balRes] = results;
    if (schedRes.status === "fulfilled") {
      const days = Array.isArray(schedRes.value?.days) ? schedRes.value.days : [];
      setSchedule(days);
      // Confirmed empty counts too — the server answered; stamp it.
      setScheduleSyncedAt(Date.now());
      if (driverId) await setCached(driverId, CACHE_KEYS.SCHEDULE_DAYS, days);
      freshTimes.push(Date.now());
    }
    if (leaveRes.status === "fulfilled") {
      const list = Array.isArray(leaveRes.value) ? leaveRes.value : [];
      setLeaves(list);
      setLeavesSyncedAt(Date.now());
      if (driverId) await setCached(driverId, CACHE_KEYS.LEAVES, list);
      freshTimes.push(Date.now());
    }
    if (balRes.status === "fulfilled") {
      const list = Array.isArray(balRes.value) ? balRes.value : [];
      setBalances(list);
      if (driverId) await setCached(driverId, CACHE_KEYS.BALANCES, list);
      freshTimes.push(Date.now());
    }
    // Error only when a source has NEITHER cache NOR network. Transport
    // failures belong to the global banner; the badge covers cached staleness.
    const failures = results.filter((r) => r.status === "rejected").map((r) => r.reason);
    const genuine = failures.filter((e) => !isTransportFailure(e));
    const hasAnyData = freshTimes.length > 0 || cachedTimes.length > 0;
    if (!hasAnyData && genuine.length > 0) {
      setError(genuine[0]?.message || "Could not load your schedule.");
    } else if (!hasAnyData && failures.length > 0) {
      // Offline with a never-synced device: badge + empty panels explain it.
      setError(null);
    }
    setLoading(false);
    setRefreshing(false);
  }, [driverId]);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        load();
      });
      return () => task?.cancel?.();
    }, [load])
  );

  const submitLeave = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      AppAlert.alert("Check your dates", "Use YYYY-MM-DD for the start and end date.");
      return;
    }
    if (endDate < startDate) {
      AppAlert.alert("Check your dates", "The end date must be on or after the start date.");
      return;
    }
    try {
      setSubmitting(true);
      await api.post("/api/driver/leave", {
        start_date: startDate,
        end_date: endDate,
        leave_type: leaveType,
        reason: reason.trim(),
      });
      setStartDate("");
      setEndDate("");
      setReason("");
      await load();
      notify.toast({ title: "Request submitted", message: "Leave request is pending fleet manager approval.", tone: "success" });
    } catch (e) {
      AppAlert.alert("Request not submitted", e.message || "Could not submit your leave request.");
    } finally {
      setSubmitting(false);
    }
  };

  const today = new Date().getDay();
  const byDay = new Map(schedule.map((day) => [Number(day.day_of_week), day]));

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <View style={[styles.header, { paddingTop: insets.top + moderateScale(8), backgroundColor: colors.surface }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <Ionicons name="arrow-back" size={23} color={colors.onSurface} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>DRIVER WORKSPACE</Text>
          <Text style={[styles.title, { color: colors.onSurface }]}>Work schedule</Text>
        </View>
      </View>

      <View style={[styles.segmented, { backgroundColor: colors.surfaceContainer, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.06)' : colors.outlineVariant + '30' }]}>
        {[{ id: "schedule", label: "My schedule" }, { id: "leave", label: "Leave requests" }].map((item) => {
          const active = view === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setView(item.id)}
              style={[
                styles.segment,
                active && {
                  backgroundColor: colors.primary,
                  shadowColor: colors.shadow,
                  shadowOpacity: isDark ? 0.3 : 0.12,
                  shadowOffset: { width: 0, height: 2 },
                  shadowRadius: 4,
                  elevation: 2,
                },
              ]}
            >
              <Text style={[styles.segmentText, { color: active ? colors.onPrimary : colors.onSurfaceVariant, fontWeight: active ? '600' : '500' }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading ? <ActivityIndicator size="large" color={colors.primary} style={styles.loader} /> : error ? (
          <View style={styles.empty}>
            <ClayTile icon="cloud-offline-outline" size={56} variant="danger" />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>{error}</Text>
            <ClayButton label="Try again" variant="primary" onPress={load} style={{ marginTop: 8 }} />
          </View>
        ) : view === "schedule" ? (
          <View style={styles.contentGap}>
            <ClayCard variant="hero" style={[styles.hero, { backgroundColor: isDark ? '#1B473A' : colors.primary }]}>
              <ClayTile icon="time-outline" size={44} color="#FFFFFF" backgroundColor="rgba(255,255,255,0.18)" />
              <View style={styles.heroText}>
                <Text style={[styles.heroLabel, { color: 'rgba(255,255,255,0.75)' }]}>WEEKLY RHYTHM</Text>
                <Text style={[styles.heroTitle, { color: '#FFFFFF', fontWeight: '700' }]}>Know your next shift.</Text>
                <Text style={[styles.heroBody, { color: 'rgba(255,255,255,0.90)' }]}>
                  Your schedule is managed by the fleet team and syncs with the website.
                </Text>
              </View>
            </ClayCard>
            {offline && scheduleSyncedAt == null ? (
              // State 3: offline on a never-synced device — a dedicated card,
              // not day rows pretending to be data.
              <NeverSyncedCard body="Connect once while online to save your schedule for offline viewing." />
            ) : (
              <ClayCard variant="standard" style={styles.panel}>
                <View style={styles.panelHeader}>
                  <Text style={[styles.panelTitle, { color: colors.onSurface }]}>Weekly work schedule</Text>
                  <ClayTile icon="calendar-clear-outline" size={32} variant="surface" />
                </View>
                {offline && scheduleSyncedAt != null ? (
                  // State 1: cached rows + one contextual inline note. Microcopy
                  // under the title — the global banner already says "You're
                  // offline", this says what THIS screen is showing.
                  <SyncNote syncedAt={scheduleSyncedAt} label="schedule" />
                ) : null}
                {DAY_ORDER.map((dayId) => {
                  const day = byDay.get(dayId);
                  const isToday = today === dayId;
                  return (
                    <View
                      key={dayId}
                      style={[
                        styles.dayRow,
                        { borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : colors.outlineVariant + '40' },
                        isToday && { backgroundColor: isDark ? 'rgba(40, 95, 80, 0.28)' : colors.primaryContainer + '70', borderRadius: moderateScale(10), marginHorizontal: moderateScale(2) },
                      ]}
                    >
                      <View style={styles.dayNameWrap}>
                        <View style={[styles.dayDot, { backgroundColor: isToday ? colors.primary : colors.outlineVariant }]} />
                        <Text style={[styles.dayName, { color: colors.onSurface, fontWeight: isToday ? '600' : '400' }]}>{DAYS[dayId]}</Text>
                        {isToday ? <ClayBadge label="TODAY" tone="primary" size="sm" /> : null}
                      </View>
                      {day?.is_rest_day ? (
                        <ClayBadge label="Rest day" tone="neutral" size="sm" />
                      ) : day?.shift_start ? (
                        <View style={[styles.timeBadge, { backgroundColor: colors.surfaceContainerHigh, borderColor: isDark ? 'rgba(255,255,255,0.08)' : colors.outlineVariant + '50' }]}>
                          <Text style={[styles.timeText, { color: colors.onSurface }]}>
                            {formatTime(day.shift_start)} – {formatTime(day.shift_end)}
                          </Text>
                        </View>
                      ) : (
                        <Text style={[styles.noSchedule, { color: colors.onSurfaceVariant }]}>No schedule</Text>
                      )}
                    </View>
                  );
                })}
                {!schedule.length ? (
                  <Text style={[styles.noFile, { color: colors.onSurfaceVariant }]}>
                    {scheduleSyncedAt != null
                      ? "No schedule assigned yet."
                      : "No offline data available. Connect once to save your schedule for offline viewing."}
                  </Text>
                ) : null}
              </ClayCard>
            )}
          </View>
        ) : (
          <View style={styles.contentGap}>
            {balances.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.balanceRow}>
                {balances.map((balance) => (
                  <ClayBadge
                    key={balance.leave_type}
                    label={`${balance.leave_type} ${balance.used_days}/${balance.allocated_days}`}
                    variant="secondary"
                    size="md"
                  />
                ))}
              </ScrollView>
            ) : null}
            <ClayCard variant="standard" style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={[styles.panelTitle, { color: colors.onSurface }]}>Request time off</Text>
                <ClayTile icon="send-outline" size={32} variant="surface" />
              </View>
              <Text style={[styles.helper, { color: colors.onSurfaceVariant }]}>
                Requests stay pending until your fleet manager approves them.
              </Text>
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <ClayInput
                    label="START DATE"
                    value={startDate}
                    onChangeText={setStartDate}
                    placeholder="YYYY-MM-DD"
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ClayInput
                    label="END DATE"
                    value={endDate}
                    onChangeText={setEndDate}
                    placeholder="YYYY-MM-DD"
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
              <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>LEAVE TYPE</Text>
              <View style={styles.leaveTypes}>
                {LEAVE_TYPES.map((item) => {
                  const active = leaveType === item;
                  return (
                    <Pressable
                      key={item}
                      onPress={() => setLeaveType(item)}
                      style={[
                        styles.leaveType,
                        active
                          ? {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                              shadowColor: colors.shadow,
                              shadowOpacity: isDark ? 0.25 : 0.12,
                              shadowOffset: { width: 0, height: 2 },
                              shadowRadius: 4,
                              elevation: 2,
                            }
                          : {
                              backgroundColor: colors.surfaceContainer,
                              borderColor: isDark ? 'rgba(255,255,255,0.08)' : colors.outlineVariant + '45',
                            },
                      ]}
                    >
                      <Text
                        style={[
                          styles.leaveTypeText,
                          { color: active ? colors.onPrimary : colors.onSurfaceVariant, fontWeight: active ? '600' : '500' },
                        ]}
                      >
                        {item}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <ClayInput
                label="REASON (OPTIONAL)"
                value={reason}
                onChangeText={setReason}
                placeholder="Add context for your manager"
                multiline
                numberOfLines={3}
              />
              <ClayButton
                label={submitting ? "Submitting..." : "Submit leave request"}
                variant="primary"
                icon="arrow-forward"
                loading={submitting}
                disabled={submitting}
                onPress={submitLeave}
              />
            </ClayCard>
            <ClayCard variant="standard" style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={[styles.panelTitle, { color: colors.onSurface }]}>My requests</Text>
                <ClayTile icon="list-outline" size={32} variant="surface" />
              </View>
              {!leaves.length ? (
                <Text style={[styles.noFile, { color: colors.onSurfaceVariant }]}>
                  {offline && leavesSyncedAt == null
                    ? "No offline data yet. Connect once to save your requests."
                    : "Leave requests you submit will appear here."}
                </Text>
              ) : (
                leaves.map((leave) => (
                  <View
                    key={leave.leave_request_id}
                    style={[
                      styles.leaveRow,
                      { borderBottomColor: isDark ? colors.outlineVariant + "55" : "transparent" },
                    ]}
                  >
                    <View style={styles.leaveInfo}>
                      <Text style={[styles.leaveDate, { color: colors.onSurface }]}>
                        {formatDate(leave.start_date)} - {formatDate(leave.end_date)}
                      </Text>
                      <Text style={[styles.leaveMeta, { color: colors.onSurfaceVariant }]}>
                        {leave.leave_type || "Leave"}{leave.reason ? ` · ${leave.reason}` : ""}
                      </Text>
                    </View>
                    <ClayBadge
                      label={leave.status}
                      tone={leave.status === "Approved" ? "success" : leave.status === "Declined" ? "danger" : "warning"}
                      size="sm"
                    />
                  </View>
                ))
              )}
            </ClayCard>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: moderateScale(18), paddingBottom: moderateScale(16), gap: moderateScale(12) },
  back: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, gap: moderateScale(2) },
  eyebrow: { fontFamily: fonts.dataSemiBold, fontSize: moderateScale(10), letterSpacing: 1.2 },
  title: { fontFamily: fonts.displayBold, fontSize: moderateScale(22), letterSpacing: -0.4 },
  segmented: { flexDirection: "row", marginHorizontal: moderateScale(16), marginTop: moderateScale(14), padding: moderateScale(4), borderRadius: moderateScale(14) },
  segment: { flex: 1, minHeight: moderateScale(42), borderRadius: moderateScale(11), alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(13) },
  scroll: { padding: moderateScale(16), paddingTop: moderateScale(18) },
  loader: { marginTop: moderateScale(60) },
  contentGap: { gap: moderateScale(14) },
  hero: { flexDirection: "row", borderRadius: moderateScale(20), padding: moderateScale(18), gap: moderateScale(13) },
  heroText: { flex: 1, gap: moderateScale(3) },
  heroLabel: { fontFamily: fonts.dataSemiBold, fontSize: moderateScale(10), letterSpacing: 1.2 },
  heroTitle: { fontFamily: fonts.displayBold, fontSize: moderateScale(20), letterSpacing: -0.3 },
  heroBody: { fontFamily: fonts.body, fontSize: moderateScale(12), lineHeight: moderateScale(18) },
  panel: { borderRadius: moderateScale(18), padding: moderateScale(16), gap: moderateScale(12) },
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panelTitle: { fontFamily: fonts.displaySemiBold, fontSize: moderateScale(16) },
  dayRow: { minHeight: moderateScale(52), flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: moderateScale(10), borderBottomWidth: 1, borderRadius: moderateScale(10) },
  dayNameWrap: { flexDirection: "row", alignItems: "center", gap: moderateScale(8) },
  dayDot: { width: moderateScale(7), height: moderateScale(7), borderRadius: moderateScale(4) },
  dayName: { fontFamily: fonts.bodyMedium, fontSize: moderateScale(13) },
  timeBadge: { height: moderateScale(28), paddingHorizontal: moderateScale(10), borderRadius: moderateScale(8), borderWidth: 1, alignItems: "center", justifyContent: "center" },
  timeText: { fontFamily: fonts.data, fontSize: moderateScale(11.5), letterSpacing: -0.2 },
  noSchedule: { fontFamily: fonts.body, fontSize: moderateScale(12), fontStyle: "italic" },
  noFile: { fontFamily: fonts.body, fontSize: moderateScale(13), lineHeight: moderateScale(20), textAlign: "center", paddingVertical: moderateScale(18) },
  balanceRow: { gap: moderateScale(8), paddingVertical: moderateScale(2) },
  helper: { fontFamily: fonts.body, fontSize: moderateScale(12), lineHeight: moderateScale(18) },
  dateRow: { flexDirection: "row", gap: moderateScale(10) },
  fieldLabel: { fontFamily: fonts.dataSemiBold, fontSize: moderateScale(10), letterSpacing: 0.8 },
  leaveTypes: { flexDirection: "row", gap: moderateScale(8) },
  leaveType: { flex: 1, minHeight: moderateScale(42), borderWidth: 1, borderRadius: moderateScale(11), alignItems: "center", justifyContent: "center" },
  leaveTypeText: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(11) },
  leaveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: moderateScale(12), paddingVertical: moderateScale(12), borderBottomWidth: 1 },
  leaveInfo: { flex: 1, gap: moderateScale(4) },
  leaveDate: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(13) },
  leaveMeta: { fontFamily: fonts.body, fontSize: moderateScale(11) },
  empty: { alignItems: "center", paddingTop: moderateScale(70), gap: moderateScale(12) },
  emptyTitle: { fontFamily: fonts.bodyMedium, fontSize: moderateScale(14), textAlign: "center" },
});
