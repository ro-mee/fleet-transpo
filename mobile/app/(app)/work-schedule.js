import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { moderateScale } from "../../lib/scaling";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { AppAlert } from "../../components/AppAlert";

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
  const { colors } = useTheme();
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

  const load = useCallback(async () => {
    try {
      setError(null);
      const [scheduleData, leaveData, balanceData] = await Promise.all([
        api.get("/api/driver-work-schedules"),
        api.get("/api/driver/leave"),
        api.get("/api/driver/balances"),
      ]);
      setSchedule(Array.isArray(scheduleData?.days) ? scheduleData.days : []);
      setLeaves(Array.isArray(leaveData) ? leaveData : []);
      setBalances(Array.isArray(balanceData) ? balanceData : []);
    } catch (e) {
      setError(e.message || "Could not load your schedule.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
      AppAlert.alert("Request submitted", "Your leave request is pending fleet manager approval.");
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
        <View style={[styles.headerIcon, { backgroundColor: colors.primaryContainer }]}>
          <Ionicons name="calendar-outline" size={21} color={colors.onPrimaryContainer} />
        </View>
      </View>

      <View style={[styles.segmented, { backgroundColor: colors.surfaceContainerHigh }]}>
        {[{ id: "schedule", label: "My schedule" }, { id: "leave", label: "Leave requests" }].map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setView(item.id)}
            style={[styles.segment, view === item.id && { backgroundColor: colors.surfaceContainerLowest }]}
          >
            <Text style={[styles.segmentText, { color: view === item.id ? colors.onSurface : colors.onSurfaceVariant }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {loading ? <ActivityIndicator size="large" color={colors.primary} style={styles.loader} /> : error ? (
          <View style={styles.empty}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.onSurfaceVariant} />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>{error}</Text>
            <Pressable onPress={load} style={[styles.retry, { backgroundColor: colors.primary }]}><Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemiBold }}>Try again</Text></Pressable>
          </View>
        ) : view === "schedule" ? (
          <View style={styles.contentGap}>
            <View style={[styles.hero, { backgroundColor: colors.primary }]}>
              <View style={[styles.heroIcon, { backgroundColor: "rgba(255,255,255,0.16)" }]}><Ionicons name="time-outline" size={23} color={colors.onPrimary} /></View>
              <View style={styles.heroText}>
                <Text style={[styles.heroLabel, { color: colors.onPrimary }]}>WEEKLY RHYTHM</Text>
                <Text style={[styles.heroTitle, { color: colors.onPrimary }]}>Know your next shift.</Text>
                <Text style={[styles.heroBody, { color: "rgba(255,255,255,0.76)" }]}>Your schedule is managed by the fleet team and syncs with the website.</Text>
              </View>
            </View>
            <View style={[styles.panel, { backgroundColor: colors.surfaceContainerLowest }]}>
              <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.onSurface }]}>Weekly work schedule</Text><Ionicons name="calendar-clear-outline" size={19} color={colors.primary} /></View>
              {DAY_ORDER.map((dayId) => {
                const day = byDay.get(dayId);
                const isToday = today === dayId;
                return (
                  <View key={dayId} style={[styles.dayRow, { borderBottomColor: colors.outlineVariant + "55" }, isToday && { backgroundColor: colors.primaryContainer }]}>
                    <View style={styles.dayNameWrap}><View style={[styles.dayDot, { backgroundColor: isToday ? colors.primary : colors.outlineVariant }]} /><Text style={[styles.dayName, { color: colors.onSurface }]}>{DAYS[dayId]}</Text>{isToday ? <Text style={[styles.today, { color: colors.primary }]}>TODAY</Text> : null}</View>
                    {day?.is_rest_day ? <Text style={[styles.rest, { color: colors.secondary }]}>Rest day</Text> : day?.shift_start ? <Text style={[styles.shift, { color: colors.onSurface }]}>{formatTime(day.shift_start)} - {formatTime(day.shift_end)}</Text> : <Text style={[styles.noSchedule, { color: colors.onSurfaceVariant }]}>No schedule</Text>}
                  </View>
                );
              })}
              {!schedule.length ? <Text style={[styles.noFile, { color: colors.onSurfaceVariant }]}>No weekly schedule on file yet. Ask your fleet manager to set it.</Text> : null}
            </View>
          </View>
        ) : (
          <View style={styles.contentGap}>
            {balances.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.balanceRow}>{balances.map((balance) => <View key={balance.leave_type} style={[styles.balanceChip, { backgroundColor: colors.secondaryContainer }]}><Text style={[styles.balanceText, { color: colors.onSecondaryContainer }]}>{balance.leave_type} {balance.used_days}/{balance.allocated_days}</Text></View>)}</ScrollView> : null}
            <View style={[styles.panel, { backgroundColor: colors.surfaceContainerLowest }]}>
              <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.onSurface }]}>Request time off</Text><Ionicons name="send-outline" size={19} color={colors.primary} /></View>
              <Text style={[styles.helper, { color: colors.onSurfaceVariant }]}>Requests stay pending until your fleet manager approves them.</Text>
              <View style={styles.dateRow}><View style={styles.field}><Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>START DATE</Text><TextInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.outline} style={[styles.input, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, color: colors.onSurface }]} keyboardType="numbers-and-punctuation" /></View><View style={styles.field}><Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>END DATE</Text><TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.outline} style={[styles.input, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, color: colors.onSurface }]} keyboardType="numbers-and-punctuation" /></View></View>
              <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>LEAVE TYPE</Text>
              <View style={styles.leaveTypes}>{LEAVE_TYPES.map((item) => <Pressable key={item} onPress={() => setLeaveType(item)} style={[styles.leaveType, { borderColor: leaveType === item ? colors.primary : colors.outlineVariant, backgroundColor: leaveType === item ? colors.primaryContainer : colors.surfaceContainerLow }]}><Text style={[styles.leaveTypeText, { color: leaveType === item ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>{item}</Text></Pressable>)}</View>
              <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>REASON <Text style={{ fontFamily: fonts.body }}>OPTIONAL</Text></Text>
              <TextInput value={reason} onChangeText={setReason} placeholder="Add context for your manager" placeholderTextColor={colors.outline} style={[styles.reason, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, color: colors.onSurface }]} multiline textAlignVertical="top" />
              <Pressable disabled={submitting} onPress={submitLeave} style={({ pressed }) => [styles.submit, { backgroundColor: colors.primary }, pressed && styles.pressed, submitting && { opacity: 0.65 }]}><Text style={[styles.submitText, { color: colors.onPrimary }]}>{submitting ? "Submitting..." : "Submit leave request"}</Text><Ionicons name="arrow-forward" size={18} color={colors.onPrimary} /></Pressable>
            </View>
            <View style={[styles.panel, { backgroundColor: colors.surfaceContainerLowest }]}>
              <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.onSurface }]}>My requests</Text><Ionicons name="list-outline" size={19} color={colors.primary} /></View>
              {!leaves.length ? <Text style={[styles.noFile, { color: colors.onSurfaceVariant }]}>Leave requests you submit will appear here.</Text> : leaves.map((leave) => <View key={leave.leave_request_id} style={[styles.leaveRow, { borderBottomColor: colors.outlineVariant + "55" }]}><View style={styles.leaveInfo}><Text style={[styles.leaveDate, { color: colors.onSurface }]}>{formatDate(leave.start_date)} - {formatDate(leave.end_date)}</Text><Text style={[styles.leaveMeta, { color: colors.onSurfaceVariant }]}>{leave.leave_type || "Leave"}{leave.reason ? ` · ${leave.reason}` : ""}</Text></View><Text style={[styles.status, { color: leave.status === "Approved" ? colors.success : leave.status === "Declined" ? colors.error : colors.secondary }]}>{leave.status}</Text></View>)}
            </View>
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
  headerIcon: { width: moderateScale(42), height: moderateScale(42), borderRadius: moderateScale(14), alignItems: "center", justifyContent: "center" },
  segmented: { flexDirection: "row", marginHorizontal: moderateScale(16), marginTop: moderateScale(14), padding: moderateScale(4), borderRadius: moderateScale(14) },
  segment: { flex: 1, minHeight: moderateScale(42), borderRadius: moderateScale(11), alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(13) },
  scroll: { padding: moderateScale(16), paddingTop: moderateScale(18) },
  loader: { marginTop: moderateScale(60) },
  contentGap: { gap: moderateScale(14) },
  hero: { flexDirection: "row", borderRadius: moderateScale(20), padding: moderateScale(18), gap: moderateScale(13) },
  heroIcon: { width: moderateScale(44), height: moderateScale(44), borderRadius: moderateScale(14), alignItems: "center", justifyContent: "center" },
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
  today: { fontFamily: fonts.dataSemiBold, fontSize: moderateScale(9), letterSpacing: 0.6 },
  shift: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(12) },
  rest: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(12) },
  noSchedule: { fontFamily: fonts.body, fontSize: moderateScale(12), fontStyle: "italic" },
  noFile: { fontFamily: fonts.body, fontSize: moderateScale(13), lineHeight: moderateScale(20), textAlign: "center", paddingVertical: moderateScale(18) },
  balanceRow: { gap: moderateScale(8), paddingVertical: moderateScale(2) },
  balanceChip: { borderRadius: moderateScale(10), paddingHorizontal: moderateScale(12), paddingVertical: moderateScale(8) },
  balanceText: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(11) },
  helper: { fontFamily: fonts.body, fontSize: moderateScale(12), lineHeight: moderateScale(18) },
  dateRow: { flexDirection: "row", gap: moderateScale(10) },
  field: { flex: 1, gap: moderateScale(6) },
  fieldLabel: { fontFamily: fonts.dataSemiBold, fontSize: moderateScale(10), letterSpacing: 0.8 },
  input: { minHeight: moderateScale(48), borderWidth: 1, borderRadius: moderateScale(12), paddingHorizontal: moderateScale(12), fontFamily: fonts.body, fontSize: moderateScale(12) },
  leaveTypes: { flexDirection: "row", gap: moderateScale(8) },
  leaveType: { flex: 1, minHeight: moderateScale(42), borderWidth: 1, borderRadius: moderateScale(11), alignItems: "center", justifyContent: "center" },
  leaveTypeText: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(11) },
  reason: { minHeight: moderateScale(88), borderWidth: 1, borderRadius: moderateScale(12), padding: moderateScale(12), fontFamily: fonts.body, fontSize: moderateScale(13) },
  submit: { minHeight: TOUCH_TARGET, borderRadius: moderateScale(13), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: moderateScale(9), marginTop: moderateScale(2) },
  submitText: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(13) },
  leaveRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: moderateScale(12), paddingVertical: moderateScale(12), borderBottomWidth: 1 },
  leaveInfo: { flex: 1, gap: moderateScale(4) },
  leaveDate: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(13) },
  leaveMeta: { fontFamily: fonts.body, fontSize: moderateScale(11) },
  status: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(11) },
  empty: { alignItems: "center", paddingTop: moderateScale(70), gap: moderateScale(12) },
  emptyTitle: { fontFamily: fonts.bodyMedium, fontSize: moderateScale(14), textAlign: "center" },
  retry: { minHeight: moderateScale(44), borderRadius: moderateScale(12), paddingHorizontal: moderateScale(18), justifyContent: "center" },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
});
