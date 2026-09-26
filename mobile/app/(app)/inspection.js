import { moderateScale } from '../../lib/scaling';
import { useEffect, useMemo, useState, useRef } from "react";
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
import {
  PRE_SHIFT_CHECKLIST,
  checklistForMode,
  inspectionTypeForMode,
} from "../../lib/inspection-checklist";

export default function PreShiftInspection() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tripId, tour, mode, from } = useLocalSearchParams();
  const isTour = tour === "1" || tour === true;
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === "dark";
  const raised = raisedControl(isDark);

  // Two modes, one screen.
  //  - "pretrip"  — the 4-item quick re-check, scoped to a trip. Entered with a
  //    tripId (Home/Trips CTA, trip detail) or by the map checkpoint (tour=1).
  //  - "preshift" — the full 7-point shift baseline. Entered bare from the Home
  //    banner, explicitly with mode=preshift, or by the tour's Pre-Shift step.
  // mode=pretrip is accepted so a trip-scoped entry point can be explicit too.
  //
  // An explicit `mode` outranks the `isTour` default. `isTour` alone used to
  // collapse every tour visit to Pre-Trip, which is right for the map checkpoint
  // and wrong for the tour's Pre-Shift step — the latter asks for the baseline
  // by name. The map checkpoint pushes `?tour=1&from=map` with no `mode`, so it
  // keeps resolving to Pre-Trip and its behaviour is unchanged.
  const screenMode = mode === "preshift" || (!isTour && !tripId && mode !== "pretrip")
    ? "preshift"
    : "pretrip";
  const inspectionType = inspectionTypeForMode(screenMode);
  const CHECKLIST = useMemo(() => checklistForMode(screenMode), [screenMode]);

  // Seeded from the FULL baseline list, not the current mode's subset: `statuses`
  // is keyed by item id and the checklist is a filtered view of it, so a driver
  // who answers the baseline and then opens a quick check (or the reverse) keeps
  // the answers they already gave instead of silently losing them.
  const [statuses, setStatuses] = useState(
    PRE_SHIFT_CHECKLIST.reduce((acc, item) => ({ ...acc, [item.id]: null }), {})
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
    if (screenMode !== "pretrip" || !tripId) return;
    let cancelled = false;
    api.get("/api/mobile/driver/trips?status=all")
      .then((trips) => {
        if (cancelled || !Array.isArray(trips)) return;
        setTripContext(trips.find((trip) => String(trip.trip_id) === String(tripId)) || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tripId, screenMode]);

  // Pre-Shift belongs to no trip, so the card names the vehicle the driver is
  // actually assigned instead of a placeholder. Display-only — the server
  // re-resolves the vehicle in the POST's Pre-Shift branch, so a stale value
  // here can never decide which vehicle an inspection gets recorded against.
  useEffect(() => {
    if (screenMode !== "preshift" || isTour) return;
    let cancelled = false;
    api.get("/api/mobile/driver/me")
      .then((me) => {
        if (cancelled) return;
        setTripContext(
          me?.assignedVehicle
            ? {
                plate_number: me.assignedVehicle.plate_number,
                model: me.assignedVehicle.model,
                trip_id: null,
              }
            : null
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [screenMode, isTour]);

  // Actions only. The checklist is the heaviest screen a guide runs on, so it
  // must not be re-rendered by a step transition or a target re-measure.
  const { triggerMilestone, notifyInteraction } = useCoachMarkActions();
  const { activeMilestone } = useCoachMarkStatus();
  const scrollRef = useRef(null);

  const checklistTotal = CHECKLIST.length;
  const checkNoun = screenMode === "preshift" ? "pre-shift" : "pre-trip";

  // Initial guidance: spotlight Pass / Fail on first inspection open.
  // The context is what makes the guide's body true in both modes: the same
  // two steps run on this screen whether it holds 7 items or 4, so the copy
  // asks the mode rather than assuming the baseline. `dynamicBody` wins over
  // `body` in CoachMarkOverlay — a dynamicBody with no context passed here is
  // simply never reached.
  useEffect(() => {
    triggerMilestone("pretrip", { mode: screenMode, total: checklistTotal });
  }, [triggerMilestone, screenMode, checklistTotal]);

  const allAnswered = CHECKLIST.every((item) => statuses[item.id] !== null);
  const passCount = Object.values(statuses).filter((s) => s === "PASS").length;
  const failedCount = Object.values(statuses).filter((s) => s === "FAIL").length;
  const answeredCount = Object.values(statuses).filter(Boolean).length;

  // Complete inspection guidance: triggered when every item in this mode's set
  // is answered. Guarded + re-evaluated on milestone transitions so answering
  // everything while pretrip/remarks is still open retries after it dismisses
  // instead of being refused once and lost.
  useEffect(() => {
    if (allAnswered && !activeMilestone) {
      triggerMilestone("pretrip_complete", { mode: screenMode, total: checklistTotal });
    }
  }, [allAnswered, activeMilestone, triggerMilestone, screenMode, checklistTotal]);

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
        `Your answers will be lost and the ${checkNoun} check will not be recorded.`,
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

  // Pre-Shift IS Start Duty, so the outcome the driver actually needs is whether
  // duty started — not merely whether the checklist saved. The server reports that
  // in `duty`. A refusal there (rest day, approved leave, privacy consent not yet
  // accepted) still leaves the check recorded, so it is explained rather than
  // dressed up as a failure.
  const dutyLine = (duty) => {
    if (!duty) return "";
    if (duty.started) return " Your duty has started — standby location is now shared with dispatch.";
    return ` Duty was not started: ${duty.message}`;
  };

  const handleSubmit = async () => {
    if (!allAnswered) {
      AppAlert.alert("Checklist Incomplete", `Please complete all ${checkNoun} inspection items before submitting.`);
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
      // This early return is the guard that keeps the tour off the POST — which
      // now starts duty for a Pre-Shift. It must never be removed or narrowed.
      //
      // Two tour entries reach this screen, and they part ways here. The map's
      // START ROUTE checkpoint teaches the per-trip quick check and hands back to
      // the map on `?pretrip=passed`, which advances the practice card one stage.
      // The tour's Pre-Shift step teaches the once-a-day baseline instead, so its
      // next beat is End Duty on Home — and its own modal would have to read
      // "Pre-Trip Inspection Complete!", which is the wrong lesson twice over.
      if (from === "tour") {
        router.replace("/(app)/(tabs)?tour_step=end_duty");
        return;
      }
      setShowTourSuccessModal(true);
      return;
    }
    try {
      setSubmitting(true);
      const result = await api.post("/api/mobile/driver/inspections", {
        // Pre-Shift is a shift-wide baseline and must not carry a trip_id; the
        // server rejects it outright. Pre-Trip is trip-scoped by definition.
        trip_id: inspectionType === "Pre-Trip" ? parseInt(tripId, 10) : null,
        inspection_type: inspectionType,
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
        AppAlert.alert("Saved Offline", `Your ${checkNoun} inspection is saved and will automatically sync once your connection is restored.`, [
          { text: "Done", onPress: () => router.back() },
        ]);
        return;
      }
      if (failedCount > 0) {
        AppAlert.alert(
          "Inspection Saved",
          screenMode === "preshift"
            ? "Pre-shift check saved. Some items were marked FAIL — dispatch has been notified to review before your first trip." + dutyLine(result?.duty)
            : "Pre-trip check saved. Some items were marked FAIL — dispatch has been notified to review before departure.",
          [{ text: "Done", onPress: () => router.back() }]
        );
        return;
      }
      AppAlert.alert(
        "Inspection Completed",
        screenMode === "preshift"
          ? "Pre-shift check complete. All items passed." + dutyLine(result?.duty)
          : "Pre-trip check complete. All items passed. Your trip is ready for departure when the schedule opens.",
        [{ text: "Done", onPress: () => router.back() }]
      );
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
          {
            backgroundColor: colors.surfaceContainerHigh,
            paddingTop: Math.max(insets.top, 16) + moderateScale(4),
          },
        ]}
      >
        <Pressable
          onPress={handleBack}
          hitSlop={10}
          style={({ pressed }) => [
            styles.backBtn,
            {
              backgroundColor: pressed
                ? colors.surfaceContainerHighest
                : colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
              shadowColor: colors.shadow,
              shadowOpacity: pressed ? 0.04 : 0.08,
              shadowRadius: pressed ? 2 : 4,
              shadowOffset: { width: 0, height: pressed ? 1 : 2 },
              elevation: pressed ? 1 : 3,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.headlineMd, styles.topBarTitle, { color: colors.onSurface }]}>
          {screenMode === "preshift" ? "Pre-Shift Check" : "Pre-Trip Check"}
        </Text>
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
        {/* Heading — the Pre-Shift copy is verbatim from the spec (§3.1) and is
            kept only for the baseline; a quick re-check must not be labelled a
            shift check or the driver will think they have done today's
            baseline twice. */}
        <View style={styles.heading}>
          <Text style={[type.headlineLg, styles.headingTitle, { color: colors.onSurface }]}>
            {screenMode === "preshift" ? "Start Your Shift" : "Pre-Trip Check"}
          </Text>
          <Text style={[type.bodyLg, styles.headingSub, { color: colors.onSurfaceVariant }]}>
            {screenMode === "preshift"
              ? "1-Minute Pre-Shift Check"
              : `Quick ${checklistTotal}-Point Safety Check`}
          </Text>
        </View>

        {/* Vehicle Info Card */}
        <ClayCard style={styles.vehicleCard}>
          <ClayTile icon="car" size={56} />
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colors.primary, letterSpacing: 0.5 }]}>
              {screenMode === "preshift" ? "ASSIGNED VEHICLE" : "VEHICLE & TRIP"}
            </Text>
            <Text style={[type.headlineMd, { color: colors.onSurface }]}>
              {tripContext?.plate_number || (tripId ? `Trip #${tripId}` : "Assigned Trip")}
            </Text>
            <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
              {/* A vehicle is identified by its PLATE, not its model. Testing
                  `model` here read a real assignment as no assignment for every
                  vehicle whose model is unset — which is most of the fleet — and
                  printed "Not yet assigned - contact dispatch" directly beneath
                  that vehicle's own plate. The model is optional detail. */}
              {screenMode === "preshift"
                ? tripContext?.plate_number
                  ? [tripContext.model, "Daily check"].filter(Boolean).join(" - ")
                  : "Not yet assigned - contact dispatch"
                : tripContext?.model
                  ? `${tripContext.model} - Trip #${tripId ?? tripContext.trip_id}`
                  : `Trip #${tripId}`}
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

            const passBg = isPass
              ? (isDark ? "#1E5647" : colors.primary)
              : colors.surfaceContainerHigh;
            const passBorder = isPass
              ? (isDark ? "#3E8D75" : colors.primary)
              : (isDark ? "rgba(255,255,255,0.06)" : "transparent");
            const passTextColor = isPass ? "#FFFFFF" : colors.onSurface;
            const passIconColor = isPass ? "#FFFFFF" : colors.onSurfaceVariant;

            const failBg = isFail
              ? colors.errorContainer
              : colors.surfaceContainerHigh;
            const failBorder = isFail
              ? colors.error
              : (isDark ? "rgba(255,255,255,0.06)" : "transparent");
            const failTextColor = isFail ? colors.onErrorContainer : colors.onSurface;
            const failIconColor = isFail ? colors.onErrorContainer : colors.onSurfaceVariant;

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
                            backgroundColor: passBg,
                            borderColor: passBorder,
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={isPass ? "checkmark-circle" : "checkmark-circle-outline"}
                          size={18}
                          color={passIconColor}
                        />
                        <Text
                          style={[
                            styles.checkBtnText,
                            { color: passTextColor },
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
                            backgroundColor: failBg,
                            borderColor: failBorder,
                            transform: [{ scale: pressed ? 0.97 : 1 }],
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? "close-circle" : "close-circle-outline"}
                          size={18}
                          color={failIconColor}
                        />
                        <Text
                          style={[
                            styles.checkBtnText,
                            { color: failTextColor },
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
                          backgroundColor: passBg,
                          borderColor: passBorder,
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                          opacity: pressed ? 0.9 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isPass ? "checkmark-circle" : "checkmark-circle-outline"}
                        size={18}
                        color={passIconColor}
                      />
                      <Text
                        style={[
                          styles.checkBtnText,
                          { color: passTextColor },
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
                          backgroundColor: failBg,
                          borderColor: failBorder,
                          transform: [{ scale: pressed ? 0.97 : 1 }],
                          opacity: pressed ? 0.9 : 1,
                        },
                      ]}
                    >
                      <Ionicons
                        name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? "close-circle" : "close-circle-outline"}
                        size={18}
                        color={failIconColor}
                      />
                      <Text
                        style={[
                          styles.checkBtnText,
                          { color: failTextColor },
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
    paddingBottom: moderateScale(10),
  },
  backBtn: {
    width: moderateScale(40),
    height: moderateScale(40),
    alignItems: "center",
    justifyContent: "center",
    borderRadius: moderateScale(14),
    borderWidth: 1,
  },
  topBarTitle: { flex: 1, textAlign: "center" },
  topAvatar: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
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
    width: "100%",
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
  checkBtnText: {
    fontSize: moderateScale(13),
    fontWeight: "600",
    letterSpacing: 0.3,
  },
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
