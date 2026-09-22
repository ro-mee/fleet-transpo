import { moderateScale } from '../../lib/scaling';
import { useEffect, useState, useRef } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput } from 'react-native';
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";
import { AppAlert } from '../../components/AppAlert';
import { ClayCard, ClayButton, ClayTile } from '../../components/clay';
import { raisedControl } from '../../lib/clay';
import { useCoachMarkActions, useCoachMarkStatus, CoachMarkTarget } from "../../components/coachmarks";
import {
  QUICK_PASS_FAILED_ID,
  QUICK_PASS_FAIL_REMARK,
  buildQuickPassStatuses,
} from "../../lib/inspection-tour";

const CHECKLIST = [
  { id: "cabin", label: "Cabin Cleanliness & Sanitation" },
  { id: "aircon", label: "Air Conditioning & Ventilation" },
  { id: "dashboard", label: "Dashboard Warning Lights", passLabel: "NO LIGHTS", failLabel: "WARNING" },
  { id: "exterior", label: "Exterior & Basic Safety" },
  { id: "brakes", label: "Brake System & Responsiveness" },
  { id: "tires", label: "Tire Pressure & Condition" },
  { id: "fuel", label: "Fuel Level Check" },
];

export default function PreShiftInspection() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tripId, tour } = useLocalSearchParams();
  const isTour = tour === "1" || tour === true;
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === "dark";
  const raised = raisedControl(isDark);

  const [statuses, setStatuses] = useState(
    CHECKLIST.reduce((acc, item) => ({ ...acc, [item.id]: null }), {})
  );
  const [remarks, setRemarks] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [clientSubmissionId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [tripContext, setTripContext] = useState(() =>
    isTour
      ? {
          trip_id: "TOUR-101",
          plate_number: "ABC-1234",
          model: "Toyota HiAce Commuter",
        }
      : null
  );
  const [showTourSuccessModal, setShowTourSuccessModal] = useState(false);

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    api.get("/api/mobile/driver/trips?status=all")
      .then((trips) => {
        if (cancelled || !Array.isArray(trips)) return;
        setTripContext(trips.find((trip) => String(trip.trip_id) === String(tripId)) || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tripId]);

  // Actions only. The checklist is the heaviest screen a guide runs on, so it
  // must not be re-rendered by a step transition or a target re-measure.
  const { triggerMilestone, notifyInteraction } = useCoachMarkActions();
  const { activeMilestone } = useCoachMarkStatus();
  const scrollRef = useRef(null);

  // Initial guidance: spotlight Pass / Fail on first inspection open
  useEffect(() => {
    triggerMilestone("pretrip");
  }, [triggerMilestone]);

  const allAnswered = CHECKLIST.every((item) => statuses[item.id] !== null);
  const passCount = Object.values(statuses).filter((s) => s === "PASS").length;
  const failedCount = Object.values(statuses).filter((s) => s === "FAIL").length;
  const answeredCount = Object.values(statuses).filter(Boolean).length;

  // Complete inspection guidance: triggered when all 7 items are answered.
  // Guarded + re-evaluated on milestone transitions so answering everything
  // while pretrip/remarks is still open retries after it dismisses instead of
  // being refused once and lost.
  useEffect(() => {
    if (allAnswered && !activeMilestone) {
      triggerMilestone("pretrip_complete");
    }
  }, [allAnswered, activeMilestone, triggerMilestone]);

  const setStatus = (id, val) => {
    setStatuses((prev) => ({ ...prev, [id]: val }));
    notifyInteraction?.("inspection.pass_fail", { itemId: id, status: val });
    if (val === "FAIL") {
      triggerMilestone("pretrip_remarks");
    }
  };

  // Leaving mid-checklist must not silently throw away answers.
  const handleBack = () => {
    if (answeredCount > 0 && !submitting) {
      AppAlert.alert(
        "Discard Checklist?",
        "Your answers will be lost and the pre-trip check will not be recorded.",
        [
          { text: "Keep Editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: () => router.back() },
        ],
        { type: "warning" }
      );
      return;
    }
    router.back();
  };

  const handleSubmit = async () => {
    if (!allAnswered) {
      AppAlert.alert("Checklist Incomplete", "Please complete all pre-trip inspection items before submitting.");
      return;
    }
    const missingRemarks = CHECKLIST.find(
      (item) => statuses[item.id] === "FAIL" && !String(remarks[item.id] || "").trim()
    );
    if (missingRemarks) {
      AppAlert.alert("Remarks Required", `Please add details describing the issue found in ${missingRemarks.label}.`);
      return;
    }
    if (isTour) {
      notifyInteraction?.("inspection.complete");
      setShowTourSuccessModal(true);
      return;
    }
    try {
      setSubmitting(true);
      const result = await api.post("/api/mobile/driver/inspections", {
        trip_id: tripId ? parseInt(tripId, 10) : null,
        client_submission_id: clientSubmissionId,
        items: CHECKLIST.map((item) => ({
          item_id: item.id,
          label: item.label,
          status: statuses[item.id],
          remarks: remarks[item.id] || "",
        })),
        inspected_at: new Date().toISOString(),
      });
      if (result?.queued) {
        AppAlert.alert("Saved Offline", "Your pre-trip inspection is saved and will automatically sync once your connection is restored.", [
          { text: "Done", onPress: () => router.back() },
        ]);
        return;
      }
      if (failedCount > 0) {
        AppAlert.alert("Inspection Saved", "Pre-trip check saved. Some items were marked FAIL — dispatch has been notified to review before departure.", [
          { text: "Done", onPress: () => router.back() },
        ]);
        return;
      }
      AppAlert.alert("Inspection Completed", "Pre-trip check complete. All items passed. Your trip is ready for departure when the schedule opens.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    } catch (e) {
      AppAlert.alert("Unable to Submit Inspection", e.message || "Please check your network connection and try submitting again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top App Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surfaceContainerHigh, paddingTop: insets.top },
        ]}
      >
        <Pressable onPress={handleBack} hitSlop={8} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
        <Text style={[type.headlineMd, styles.topBarTitle, { color: colors.primary }]}>FleetOps</Text>
        <View style={[styles.topAvatar, { backgroundColor: colors.surfaceVariant }]}>
          <Ionicons name="person" size={20} color={colors.onSurfaceVariant} />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Heading */}
        <View style={styles.heading}>
          <Text style={[type.headlineLg, styles.headingTitle, { color: colors.onSurface }]}>
            Start Your Shift
          </Text>
          <Text style={[type.bodyLg, styles.headingSub, { color: colors.onSurfaceVariant }]}>
            1-Minute Pre-Shift Check
          </Text>
        </View>

        {/* Vehicle Info Card */}
        <ClayCard style={styles.vehicleCard}>
          <ClayTile icon="car" size={56} />
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colors.primary, letterSpacing: 0.5 }]}>
              VEHICLE & TRIP
            </Text>
            <Text style={[type.headlineMd, { color: colors.onSurface }]}>
              {tripContext?.plate_number || (tripId ? `Trip #${tripId}` : "Assigned Trip")}
            </Text>
            <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
              {tripContext?.model ? `${tripContext.model} - Trip #${tripId}` : `Trip #${tripId}`}
            </Text>
          </View>
        </ClayCard>

        {/* Quick Pass All in Tour Mode */}
        {isTour && !allAnswered && (
          <Pressable
            onPress={() => {
              // Every item but one passes. The single FAIL is deliberate: the
              // tour's remarks tip targets the remark field, which mounts only
              // for a failed item, so a clean sheet leaves that step with
              // nothing to point at and the driver never sees how a failed
              // check is described. See lib/inspection-tour.js.
              //
              // The FAIL goes through `setStatus` rather than the batch, so it
              // takes the same path a manual tap does — that is what emits the
              // pass/fail notification and triggers `pretrip_remarks`. The
              // notify this replaced hard-coded `status: "PASS"`, which took the
              // provider's PASS branch: it completed the pass/fail tip and
              // showed no remarks tip at all.
              setStatuses(buildQuickPassStatuses(CHECKLIST));
              setStatus(QUICK_PASS_FAILED_ID, "FAIL");
              // Required, not decorative: handleSubmit refuses any FAIL without
              // a remark, and the tour has no tip explaining that alert.
              setRemarks((prev) => ({
                ...prev,
                [QUICK_PASS_FAILED_ID]: QUICK_PASS_FAIL_REMARK,
              }));
            }}
            accessibilityRole="button"
            accessibilityLabel="Quick pass all tutorial items"
            style={({ pressed }) => [
              styles.quickFillBtn,
              {
                backgroundColor: isDark ? "rgba(40, 84, 72, 0.28)" : "rgba(234, 245, 240, 0.98)",
                borderColor: colors.primary + "45",
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="flash-outline" size={16} color={colors.primary} />
            <Text style={[type.labelMd, { color: colors.primary, fontFamily: fonts.bodySemiBold }]}>
              Quick Pass All (Tutorial Mode)
            </Text>
          </Pressable>
        )}

        {/* Checklist */}
        <View style={styles.checklist}>
          {CHECKLIST.map((item, idx) => {
            const status = statuses[item.id];
            const isPass = status === "PASS";
            const isFail = status === "FAIL";

            return (
              <ClayCard
                key={item.id}
                variant="compact"
                style={styles.checkItem}
              >
                <Text style={[type.labelLg, styles.checkItemLabel, { color: colors.onSurface }]}>
                  {idx + 1}. {item.label}
                </Text>
                {idx === 0 ? (
                  <CoachMarkTarget id="inspection.pass_fail" targetId="inspection.pass_fail" radius={14} scrollRef={scrollRef}>
                    <View style={styles.checkBtnRow}>
                      {/* PASS button */}
                      <Pressable
                        onPress={() => setStatus(item.id, "PASS")}
                        style={({ pressed }) => [
                          styles.checkBtn,
                          raised,
                          {
                            backgroundColor: isPass
                              ? colors.secondaryContainer
                              : colors.surfaceContainerHigh,
                            borderColor: isPass ? colors.secondary : 'transparent',
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={isPass ? "checkmark-circle" : "checkmark-circle-outline"}
                          size={18}
                          color={isPass ? colors.onSecondaryContainer : colors.onSurfaceVariant}
                        />
                        <Text
                          style={[
                            styles.checkBtnText,
                            { color: isPass ? colors.onSecondaryContainer : colors.onSurface },
                          ]}
                        >
                          {item.passLabel || "PASS"}
                        </Text>
                      </Pressable>

                      {/* FAIL button */}
                      <Pressable
                        onPress={() => setStatus(item.id, "FAIL")}
                        style={({ pressed }) => [
                          styles.checkBtn,
                          raised,
                          {
                            backgroundColor: isFail
                              ? colors.errorContainer
                              : colors.surfaceContainerHigh,
                            borderColor: isFail ? colors.error : 'transparent',
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? "close-circle" : "close-circle-outline"}
                          size={18}
                          color={isFail ? colors.onErrorContainer : colors.onSurfaceVariant}
                        />
                        <Text
                          style={[
                            styles.checkBtnText,
                            { color: isFail ? colors.onErrorContainer : colors.onSurface },
                          ]}
                        >
                          {item.failLabel || "FAIL"}
                        </Text>
                      </Pressable>
                    </View>
                  </CoachMarkTarget>
                ) : (
                  <View style={styles.checkBtnRow}>
                    {/* PASS button */}
                    <Pressable
                      onPress={() => setStatus(item.id, "PASS")}
                      style={({ pressed }) => [
                        styles.checkBtn,
                        raised,
                        {
                          backgroundColor: isPass
                            ? colors.secondaryContainer
                            : colors.surfaceContainerHigh,
                          borderColor: isPass ? colors.secondary : 'transparent',
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                          opacity: pressed ? 0.9 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isPass ? "checkmark-circle" : "checkmark-circle-outline"}
                        size={18}
                        color={isPass ? colors.onSecondaryContainer : colors.onSurfaceVariant}
                      />
                      <Text
                        style={[
                          styles.checkBtnText,
                          { color: isPass ? colors.onSecondaryContainer : colors.onSurface },
                        ]}
                      >
                        {item.passLabel || "PASS"}
                      </Text>
                    </Pressable>

                    {/* FAIL button */}
                    <Pressable
                      onPress={() => setStatus(item.id, "FAIL")}
                      style={({ pressed }) => [
                        styles.checkBtn,
                        raised,
                        {
                          backgroundColor: isFail
                            ? colors.errorContainer
                            : colors.surfaceContainerHigh,
                          borderColor: isFail ? colors.error : 'transparent',
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                          opacity: pressed ? 0.9 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? "close-circle" : "close-circle-outline"}
                        size={18}
                        color={isFail ? colors.onErrorContainer : colors.onSurfaceVariant}
                      />
                      <Text
                        style={[
                          styles.checkBtnText,
                          { color: isFail ? colors.onErrorContainer : colors.onSurface },
                        ]}
                      >
                        {item.failLabel || "FAIL"}
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* Remarks input when failed */}
                {isFail && (
                  <CoachMarkTarget id="inspection.remarks" targetId="inspection.remarks" radius={12} scrollRef={scrollRef}>
                    <TextInput
                      placeholder="Describe issue (e.g. Low tire pressure, broken bulb)..."
                      placeholderTextColor={colors.outline}
                      value={remarks[item.id] || ""}
                      maxLength={1000}
                      onChangeText={(text) =>
                        setRemarks((prev) => ({ ...prev, [item.id]: text }))
                      }
                      style={[
                        styles.remarkInput,
                        {
                          borderColor: colors.error + '60',
                          color: colors.onSurface,
                          backgroundColor: colors.surfaceContainerLowest,
                        },
                      ]}
                      multiline
                    />
                  </CoachMarkTarget>
                )}
              </ClayCard>
            );
          })}
        </View>
      </ScrollView>

      {/* Start Shift CTA */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.outlineVariant + '30',
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        <CoachMarkTarget id="inspection.complete" targetId="inspection.complete" radius={16} scrollRef={scrollRef}>
          <ClayButton
            label={submitting ? "SUBMITTING..." : allAnswered ? "COMPLETE INSPECTION" : `COMPLETE ALL ITEMS (${answeredCount}/${CHECKLIST.length})`}
            variant="primary"
            size="lg"
            icon={allAnswered ? "checkmark-circle-outline" : "lock-closed-outline"}
            iconPosition="right"
            disabled={!allAnswered || submitting}
            loading={submitting}
            onPress={handleSubmit}
          />
        </CoachMarkTarget>
      </View>

      {/* Tour Completion Modal */}
      {showTourSuccessModal && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: 20 }]}>
          <ClayCard style={{ width: '100%', maxWidth: 380, padding: 24, alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryContainer, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Ionicons name="checkmark-circle" size={44} color={colors.primary} />
            </View>
            <Text style={{ fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, letterSpacing: -0.3, marginBottom: 6, textAlign: 'center' }}>
              Pre-Trip Inspection Complete!
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 18, lineHeight: 19 }}>
              {failedCount > 0
                ? `${CHECKLIST.length - failedCount} of ${CHECKLIST.length} vehicle safety items passed. The flagged item was reported to dispatch so they can review it before departure. You are now ready to practice your route on the Live Map!`
                : `All ${CHECKLIST.length} vehicle safety items passed. Dispatch has been notified. You are now ready to practice your route on the Live Map!`}
            </Text>
            <View style={{ width: '100%', backgroundColor: colors.surfaceContainerLow, borderRadius: 12, padding: 12, gap: 8, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Inspected Items:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.onSurface }}>
                  {CHECKLIST.length - failedCount} of {CHECKLIST.length} Passed
                  {failedCount > 0 ? ` · ${failedCount} Flagged` : ''}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Safety Status:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: failedCount > 0 ? colors.error : colors.primary }}>
                  {failedCount > 0 ? 'Flagged for Dispatch Review' : 'Safe for Route Departure'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Mode:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Simulation (No DB record)</Text>
              </View>
            </View>
            <ClayButton
              label="Next: Live Map Tour →"
              variant="primary"
              size="lg"
              onPress={() => {
                setShowTourSuccessModal(false);
                router.push("/(app)/(tabs)/map?tour=1&pretrip=passed");
              }}
              style={{ width: '100%' }}
            />
          </ClayCard>
        </View>
      )}
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
    height: moderateScale(48) + 0,
  },
  backBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: TOUCH_TARGET / 2,
  },
  topAvatar: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    alignItems: "center",
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(24),
    gap: moderateScale(16),
  },
  heading: { alignItems: "center", gap: moderateScale(4), width: "100%" },
  headingTitle: { textAlign: "center" },
  headingSub: { textAlign: "center" },
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    padding: moderateScale(12),
    borderRadius: moderateScale(12),
    width: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  checklist: { gap: moderateScale(12), width: "100%" },
  checkItem: {
    borderRadius: moderateScale(12),
    padding: moderateScale(12),
    gap: moderateScale(8),
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    minHeight: moderateScale(72),
  },
  checkItemLabel: {
  },
  checkBtnRow: { flexDirection: "row", gap: moderateScale(8) },
  checkBtn: {
    flex: 1,
    height: TOUCH_TARGET,
    borderRadius: moderateScale(8),
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(6),
  },
  checkBtnText: { },
  remarkInput: {
    borderWidth: 1,
    borderRadius: moderateScale(8),
    padding: moderateScale(10),
    minHeight: moderateScale(60),
    textAlignVertical: "top",
  },
  footer: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(12),
    borderTopWidth: 1,
  },
  quickFillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    width: "100%",
  },
});
