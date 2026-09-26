// End Duty — the shift-closing vehicle report.
//
// ONE QUESTION, and it is the owner's own framing: "may napansin ba syang hindi
// okay" — noticed anything wrong with the vehicle today? Two answers, and either
// one ends duty: nothing unusual, or a description of what was noticed.
//
// The report and the `time_out` are written by the SERVER in one transaction
// (endDutyWithReport). This screen has no fallback write path and no partial
// state to reconcile: it either ends duty with a report, or nothing happened.
// That is also why it is online-only — see the queueOnFailure note below.
//
// No item checklist here, deliberately. The 7-item baseline at the start of the
// shift is where the vehicle gets inspected; asking a driver to re-run it at the
// end of a long day would collect reflexive taps, not observations. One open
// question collects the thing that actually changed during the shift.
import { moderateScale } from '../../lib/scaling';
import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";
import { AppAlert } from '../../components/AppAlert';
import { ClayCard, ClayButton, ClayTile } from '../../components/clay';

// Matches the server's POST_SHIFT_FINDINGS_MAX. Enforced on both sides on
// purpose: the counter below is a courtesy, the server's 400 is the boundary.
const FINDINGS_MAX = 1000;

export default function EndDuty() {
  const insets = useSafeAreaInsets();
  const { reportFor } = useLocalSearchParams();
  // 'YYYY-MM-DD' or undefined. A late report names its day; the server files the
  // report against THAT date and its vehicle, so this is passed through, never
  // re-derived here.
  const lateFor = typeof reportFor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(reportFor) ? reportFor : null;
  const router = useRouter();
  const { colors, type } = useTheme();

  const [findings, setFindings] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  // One id per screen mount, reused across retries. That is what makes the
  // server's partial unique index do its job: a submit whose response was lost
  // and is then retried returns the FIRST report's row instead of filing a
  // second one, so a flaky connection cannot produce two End Duty records.
  const [clientSubmissionId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)");
  };

  const endDuty = useCallback(async (report) => {
    setSubmitting(true);
    try {
      // queueOnFailure: false — identical to the existing duty toggle on
      // Profile, and load-bearing here. The generic offline path would queue
      // this into the outbox and report success, but the outbox cannot replay
      // the atomic report+time_out transaction, so the driver would be told
      // their shift had ended while still checked in. Better to refuse and say
      // so than to queue a promise the server will never keep.
      const data = await api.post(
        "/api/mobile/driver/duty",
        { active: false, client_submission_id: clientSubmissionId, report, ...(lateFor ? { report_date: lateFor } : {}) },
        { queueOnFailure: false }
      );
      setResult(data ?? { checkedIn: false, reported: false, recorded: true });
    } catch (error) {
      // status 0 is a transport failure. The shared message ("The queued request
      // will be retried later") is false on this screen — nothing is queued —
      // and telling a driver their report is on its way when it is not is the
      // one thing this screen must never do.
      if (error?.status === 0) {
        AppAlert.alert(
          "You're Offline",
          "Ending duty needs a connection so the report and your clock-out are saved together. Your shift is still open — try again when you're back online."
        );
      } else {
        AppAlert.alert("Unable to End Duty", error.message || "Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [clientSubmissionId, lateFor]);

  const reportNothing = () => endDuty({ nothing_unusual: true });

  const submitFindings = () => {
    const text = findings.trim();
    if (!text) {
      AppAlert.alert("Nothing to Report", "Describe what you noticed, or tap the button above if nothing was unusual.");
      return;
    }
    endDuty({ findings: text });
  };

  if (result) {
    // Three distinct outcomes, and they must not share copy: a report that
    // reached the maintenance team, a clean shift, and a shift that ended with
    // no vehicle to report against are not the same event. The last one is the
    // honest gap the server records rather than a report invented against a
    // vehicle the driver never had.
    const noVehicle = result.recorded === false;
    const reported = result.reported === true;
    const late = result.late === true;
    return (
      <View style={[styles.root, { backgroundColor: colors.background, padding: moderateScale(24), justifyContent: "center", alignItems: "center" }]}>
        <ClayCard style={{ width: "100%", maxWidth: moderateScale(400), padding: moderateScale(28), alignItems: "center" }}>
          <View style={{ width: moderateScale(96), height: moderateScale(96), borderRadius: moderateScale(48), backgroundColor: noVehicle ? colors.surfaceContainerHighest : colors.primaryContainer, justifyContent: "center", alignItems: "center", marginBottom: moderateScale(20) }}>
            <Ionicons
              name={noVehicle ? "alert-circle-outline" : "checkmark"}
              size={52}
              color={noVehicle ? colors.onSurfaceVariant : colors.primary}
            />
          </View>

          <Text style={[type.headlineLg, { color: colors.onSurface, marginBottom: moderateScale(8), textAlign: "center" }]}>
            {lateFor ? "Report for an earlier shift" : "End Duty"}
          </Text>
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, textAlign: "center", marginBottom: moderateScale(24), lineHeight: moderateScale(22) }]}>
            {noVehicle
              ? "Your shift is closed. No vehicle was paired with you today, so there was nothing to file a report against — that gap was recorded on your attendance instead."
              : late
                ? "Thank you — your report has been added to that day's record. The shift itself was already closed, so nothing else is needed."
                : reported
                  ? "Your report was sent to the maintenance team, who will review the vehicle before it goes out again."
                  : "Nothing unusual was noted for this shift."}
          </Text>

          {reported && !noVehicle ? (
            <View style={{ width: "100%", backgroundColor: colors.surfaceContainerLow, borderRadius: moderateScale(18), padding: moderateScale(18), gap: moderateScale(10) }}>
              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>WHAT HAPPENS NEXT</Text>
              <Text style={[type.supporting, { color: colors.onSurfaceVariant, lineHeight: moderateScale(19) }]}>
                A work order is open for the vehicle. Fleet will triage it and decide whether it can still be dispatched.
              </Text>
            </View>
          ) : null}

          <ClayButton
            label="Done"
            variant="primary"
            size="lg"
            onPress={close}
            style={{ width: "100%", marginTop: moderateScale(24) }}
          />
        </ClayCard>
      </View>
    );
  }

  const canSubmit = findings.trim().length > 0 && !submitting;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <View style={[styles.topBar, { backgroundColor: colors.surfaceContainerHigh, paddingTop: insets.top }]}>
        <Pressable onPress={close} hitSlop={8} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close End Duty report">
          <Ionicons name="close" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
        <Text style={[type.headlineMd, { color: colors.primary }]}>FleetOps</Text>
        <View style={styles.closeBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heading}>
          <Text style={[type.headlineLg, { color: colors.onBackground }]}>End Duty</Text>
          <Text style={[type.bodyLg, { color: colors.onSurfaceVariant }]}>
            One last check before you clock out.
          </Text>
        </View>

        {/* No vehicle card, deliberately. The server resolves which vehicle this
            report belongs to (today's last inspection, else the standby pairing)
            inside the same transaction that closes the shift — re-deriving that
            here would be a second answer to a question the server already owns,
            and a wrong plate on this screen is worse than no plate. This line
            says what is true without naming it. */}
        {lateFor ? (
          <ClayCard style={styles.card}>
            <View style={styles.cardHeader}>
              <ClayTile icon="car-outline" size={48} />
              <View style={styles.cardCopy}>
                <Text style={[type.labelLg, { color: colors.onSurface }]}>Report for {lateFor}</Text>
                <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
                  This goes on the vehicle you drove that day, not today&apos;s.
                </Text>
              </View>
            </View>
          </ClayCard>
        ) : (
          <ClayCard style={styles.card}>
            <View style={styles.cardHeader}>
              <ClayTile icon="car-outline" size={48} />
              <View style={styles.cardCopy}>
                <Text style={[type.labelLg, { color: colors.onSurface }]}>Today&apos;s vehicle</Text>
                <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
                  Your report is filed against the vehicle on today&apos;s check.
                </Text>
              </View>
            </View>
          </ClayCard>
        )}

        <ClayCard style={styles.card}>
          <Text style={[type.headlineMd, { color: colors.onSurface }]}>
            Did you notice anything unusual about the vehicle?
          </Text>
          <Text style={[type.supporting, { color: colors.onSurfaceVariant, marginTop: 6 }]}>
            Odd sounds, warning lights, damage, or anything that felt different while driving.
          </Text>

          {/* The one-tap answer is labelled with its consequence, not just its
              meaning: "Nothing unusual" alone reads like a note, when in fact it
              closes the shift. */}
          <ClayButton
            label="Nothing unusual — end my duty"
            variant="tonal"
            icon="checkmark-circle-outline"
            loading={submitting}
            disabled={submitting}
            onPress={reportNothing}
            style={{ alignSelf: "stretch", marginTop: moderateScale(18) }}
          />

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: colors.outlineVariant }]} />
            <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>OR DESCRIBE IT</Text>
            <View style={[styles.dividerLine, { backgroundColor: colors.outlineVariant }]} />
          </View>

          <TextInput
            style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
            placeholder="e.g. May kalansing sa preno kapag mabilis"
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={5}
            maxLength={FINDINGS_MAX}
            textAlignVertical="top"
            accessibilityLabel="What you noticed about the vehicle"
            value={findings}
            onChangeText={setFindings}
          />
          <Text style={[type.caption, { color: colors.onSurfaceVariant, textAlign: "right", marginTop: 4 }]}>
            {findings.length}/{FINDINGS_MAX}
          </Text>

          <ClayButton
            label={submitting ? "Ending duty…" : "Send report & end duty"}
            variant="primary"
            size="lg"
            icon="send-outline"
            iconPosition="right"
            loading={submitting}
            disabled={!canSubmit}
            onPress={submitFindings}
            style={{ alignSelf: "stretch", marginTop: moderateScale(12) }}
          />

          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={[type.caption, { color: colors.onSurfaceVariant, flex: 1 }]}>
              A report opens a work order for the vehicle. Saying nothing was unusual closes your shift without one.
            </Text>
          </View>
        </ClayCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  closeBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 16 },
  heading: { gap: 4 },
  card: { borderRadius: 16, borderWidth: 1, borderColor: "transparent", padding: 18, gap: 4 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 13 },
  cardCopy: { flex: 1, gap: 4 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: moderateScale(18) },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  noticeRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: moderateScale(14) },
});
