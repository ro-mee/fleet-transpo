import { moderateScale } from '../../lib/scaling';
import { useEffect, useMemo, useState, useRef } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Vibration,
} from 'react-native';
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
  PRE_TRIP_CHECKLIST,
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
  //  - "pretrip"  — the 3-item readiness check (Safety, Passenger Check, Cabin Ready), scoped to a trip.
  //  - "preshift" — the full 5-point vehicle safety baseline.
  const screenMode = mode === "preshift" || (!isTour && !tripId && mode !== "pretrip")
    ? "preshift"
    : "pretrip";
  const inspectionType = inspectionTypeForMode(screenMode);
  const CHECKLIST = useMemo(() => checklistForMode(screenMode), [screenMode]);

  // Seeded with all possible items so answers are preserved across mode toggles.
  const [statuses, setStatuses] = useState(() => {
    const initial = {};
    for (const item of [...PRE_SHIFT_CHECKLIST, ...PRE_TRIP_CHECKLIST]) {
      initial[item.id] = null;
    }
    return initial;
  });
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

  const { triggerMilestone, notifyInteraction } = useCoachMarkActions();
  const { activeMilestone } = useCoachMarkStatus();
  const scrollRef = useRef(null);
  const cardLayouts = useRef({});

  const handleCardLayout = (id, event) => {
    cardLayouts.current[id] = event.nativeEvent.layout.y;
  };

  const scrollToItem = (id) => {
    const y = cardLayouts.current[id];
    if (typeof y === "number" && scrollRef.current) {
      scrollRef.current.scrollTo({ y: Math.max(0, y - 80), animated: true });
    }
  };

  const checklistTotal = CHECKLIST.length;
  const checkNoun = screenMode === "preshift" ? "pre-shift" : "pre-trip";

  useEffect(() => {
    triggerMilestone("pretrip", { mode: screenMode, total: checklistTotal });
  }, [triggerMilestone, screenMode, checklistTotal]);

  const allAnswered = CHECKLIST.every((item) => {
    if (item.kind === "acknowledgment") {
      return statuses[item.id] === "PASS";
    }
    return statuses[item.id] !== null;
  });
  const failedCount = CHECKLIST.filter((item) => statuses[item.id] === "FAIL").length;
  const answeredCount = CHECKLIST.filter((item) => {
    if (item.kind === "acknowledgment") return statuses[item.id] === "PASS";
    return statuses[item.id] !== null;
  }).length;

  useEffect(() => {
    if (allAnswered && !activeMilestone) {
      triggerMilestone("pretrip_complete", { mode: screenMode, total: checklistTotal });
    }
  }, [allAnswered, activeMilestone, triggerMilestone, screenMode, checklistTotal]);

  const setStatus = (id, val) => {
    try {
      Vibration.vibrate(12);
    } catch {}
    setStatuses((prev) => ({ ...prev, [id]: val }));
    notifyInteraction?.("inspection.pass_fail", { itemId: id, status: val });
    if (val === "FAIL") {
      triggerMilestone("pretrip_remarks");
    }
  };

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
      AppAlert.alert(
        "Remarks Required",
        missingRemarks.remarksPrompt || `Please add details describing the issue found in ${missingRemarks.label}.`
      );
      return;
    }
    if (isTour) {
      notifyInteraction?.("inspection.complete");
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
      if (screenMode === "preshift") {
        if (failedCount > 0) {
          AppAlert.alert(
            "Inspection Saved",
            "Pre-shift check saved. Some items were marked with issues — dispatch has been notified to review before your first trip." + dutyLine(result?.duty),
            [{ text: "Done", onPress: () => router.back() }]
          );
          return;
        }
        AppAlert.alert(
          "Inspection Completed",
          "Pre-shift check complete. All 5 safety items passed." + dutyLine(result?.duty),
          [{ text: "Done", onPress: () => router.back() }]
        );
        return;
      } else {
        // Pre-Trip
        if (statuses.brakes_tires === "FAIL") {
          AppAlert.alert(
            "Safety Issue Reported",
            "Pre-trip check saved. A safety issue was reported on brakes/tires — dispatch has been notified. Trip departure remains blocked until resolved.",
            [{ text: "Done", onPress: () => router.back() }]
          );
          return;
        }
        if (statuses.passenger_items === "FAIL") {
          AppAlert.alert(
            "Pre-Trip Complete",
            "Pre-trip check complete. Leftover passenger item reported to dispatch — you are good to go!",
            [{ text: "Done", onPress: () => router.back() }]
          );
          return;
        }
        AppAlert.alert(
          "Pre-Trip Complete",
          "Pre-trip check complete. All items passed. You are good to go when the schedule opens.",
          [{ text: "Done", onPress: () => router.back() }]
        );
      }
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
        <Text style={[styles.topBarTitle, { color: colors.onSurface }]}>
          {screenMode === "preshift" ? "Pre-Shift Check" : "Pre-Trip Check"}
        </Text>
        <View style={[styles.topAvatar, { backgroundColor: colors.surfaceVariant }]}>
          <Ionicons name="person" size={20} color={colors.onSurfaceVariant} />
        </View>
      </View>

      {/* Sticky Segmented Progress Header */}
      <View
        style={[
          styles.progressContainer,
          {
            backgroundColor: colors.surfaceContainerHigh,
            borderBottomColor: colors.outlineVariant + "25",
          },
        ]}
      >
        <View style={styles.progressHeaderRow}>
          <Text style={[type.labelMd, { color: colors.onSurfaceVariant, fontFamily: fonts.bodySemiBold, letterSpacing: 0.3 }]}>
            {answeredCount === checklistTotal ? "ALL ITEMS VERIFIED" : `${checkNoun.toUpperCase()} PROGRESS`}
          </Text>
          <Text style={[type.labelMd, { color: colors.primary, fontFamily: fonts.bodySemiBold }]}>
            {answeredCount} of {checklistTotal} Complete
          </Text>
        </View>
        <View style={styles.segmentTrack}>
          {CHECKLIST.map((item) => {
            const st = statuses[item.id];
            const isDone = item.kind === "acknowledgment" ? st === "PASS" : st !== null;
            let segmentColor = colors.surfaceContainerHighest;
            let borderColor = "transparent";
            if (isDone) {
              if (st === "FAIL") {
                segmentColor = item.findingTone === "service" ? "#D97706" : colors.error;
              } else {
                segmentColor = colors.primary;
              }
            } else {
              borderColor = colors.outlineVariant + "40";
            }
            return (
              <Pressable
                key={item.id}
                onPress={() => scrollToItem(item.id)}
                hitSlop={6}
                style={[
                  styles.segmentPill,
                  {
                    backgroundColor: segmentColor,
                    borderColor: borderColor,
                  },
                ]}
                accessibilityLabel={`${item.shortTitle || item.label}: ${
                  isDone ? (st === "FAIL" ? "Flagged" : "Passed") : "Not checked"
                }`}
              />
            );
          })}
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 120 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {/* Heading */}
          <View style={styles.heading}>
            <Text style={[styles.headingTitle, { color: colors.onSurface }]}>
              {screenMode === "preshift" ? "Start Your Shift" : "Pre-Trip Check"}
            </Text>
            <Text style={[styles.headingSub, { color: colors.onSurfaceVariant }]}>
              {screenMode === "preshift"
                ? "Daily Vehicle Safety Baseline (5 Points)"
                : "Trip Safety & Passenger Readiness"}
            </Text>
          </View>

          {/* Vehicle Info Card */}
          <ClayCard style={styles.vehicleCard}>
            <ClayTile icon="car" size={40} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.vehicleMetaLabel, { color: colors.primary }]}>
                {screenMode === "preshift" ? "ASSIGNED VEHICLE" : "VEHICLE & TRIP"}
              </Text>
              <Text style={[styles.vehiclePlateText, { color: colors.onSurface }]}>
                {tripContext?.plate_number || (tripId ? `Trip #${tripId}` : "Assigned Trip")}
              </Text>
              <Text style={[styles.vehicleSubText, { color: colors.onSurfaceVariant }]}>
                {screenMode === "preshift"
                  ? tripContext?.plate_number
                    ? [tripContext.model, "Daily safety check"].filter(Boolean).join(" - ")
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
                setStatuses(buildQuickPassStatuses(CHECKLIST));
                setStatus(QUICK_PASS_FAILED_ID, "FAIL");
                setRemarks((prev) => ({
                  ...prev,
                  [QUICK_PASS_FAILED_ID]: QUICK_PASS_FAIL_REMARK,
                }));
                if (screenMode === "pretrip") {
                  setStatuses((prev) => ({ ...prev, cabin_ready: "PASS" }));
                }
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
              if (item.kind === "acknowledgment") {
                const isAcknowledged = statuses[item.id] === "PASS";
                const ackBg = isAcknowledged
                  ? (isDark ? "#1E5647" : colors.primary)
                  : colors.surfaceContainerHigh;
                const ackBorder = isAcknowledged
                  ? (isDark ? "#3E8D75" : colors.primary)
                  : (isDark ? "rgba(255,255,255,0.06)" : colors.outlineVariant + "50");
                const ackTextColor = isAcknowledged ? "#FFFFFF" : colors.onSurface;

                return (
                  <View
                    key={item.id}
                    onLayout={(e) => handleCardLayout(item.id, e)}
                  >
                    <ClayCard
                      variant="compact"
                      style={styles.checkItem}
                    >
                      <View style={styles.cardHeaderRow}>
                        <View
                          style={[
                            styles.categoryIconBadge,
                            {
                              backgroundColor: isAcknowledged
                                ? (isDark ? "rgba(46, 125, 50, 0.2)" : "#E8F5E9")
                                : (isDark ? colors.surfaceContainerHighest : colors.surfaceVariant),
                            },
                          ]}
                        >
                          <Ionicons
                            name={item.icon || "sparkles-outline"}
                            size={20}
                            color={isAcknowledged ? colors.primary : colors.onSurfaceVariant}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <Text style={[styles.cardCategoryTitle, { color: colors.onSurface }]}>
                              {item.shortTitle || item.label}
                            </Text>
                            <Text style={[styles.cardSectionTag, { color: colors.primary }]}>
                              {item.section || "CABIN READY?"}
                            </Text>
                          </View>
                          <Text style={[styles.cardQuestionText, { color: isDark ? "#CBD5E1" : colors.onSurfaceVariant }]}>
                            Before departure, make sure:
                          </Text>
                        </View>
                      </View>

                      <View style={styles.bulletList}>
                        {(item.reminders || []).map((reminder, rIdx) => (
                          <View key={rIdx} style={styles.bulletRow}>
                            <Text style={[styles.bulletPoint, { color: colors.primary }]}>•</Text>
                            <Text style={[type.bodyMd, styles.bulletText, { color: colors.onSurface }]}>
                              {reminder}
                            </Text>
                          </View>
                        ))}
                      </View>
                      {item.supportingText && (
                        <Text style={[type.supporting, { color: colors.onSurfaceVariant, marginTop: 2, fontStyle: "italic" }]}>
                          {item.supportingText}
                        </Text>
                      )}
                      <Pressable
                        onPress={() => setStatus(item.id, isAcknowledged ? null : "PASS")}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isAcknowledged }}
                        style={({ pressed }) => [
                          styles.cabinAckBtn,
                          raised,
                          {
                            backgroundColor: ackBg,
                            borderColor: ackBorder,
                            transform: [{ scale: pressed ? 0.98 : 1 }],
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={isAcknowledged ? "checkmark-circle" : "checkmark-circle-outline"}
                          size={20}
                          color={isAcknowledged ? "#FFFFFF" : colors.primary}
                        />
                        <Text style={[styles.cabinAckBtnText, { color: ackTextColor }]} numberOfLines={1}>
                          {isAcknowledged ? "✓ CABIN VERIFIED & READY" : (item.buttonLabel || "✓ CABIN READY")}
                        </Text>
                      </Pressable>
                    </ClayCard>
                  </View>
                );
              }

              const status = statuses[item.id];
              const isPass = status === "PASS";
              const isFail = status === "FAIL";
              const isServiceFinding = item.findingTone === "service";
              const unselectedTextColor = isDark ? "#E2E8F0" : colors.onSurface;
              const unselectedIconColor = isDark ? "#94A3B8" : colors.onSurfaceVariant;

              const passBg = isPass
                ? (isDark ? "#1E5647" : colors.primary)
                : colors.surfaceContainerHigh;
              const passBorder = isPass
                ? (isDark ? "#3E8D75" : colors.primary)
                : (isDark ? "rgba(255,255,255,0.06)" : "transparent");
              const passTextColor = isPass ? "#FFFFFF" : unselectedTextColor;
              const passIconColor = isPass ? "#FFFFFF" : unselectedIconColor;

              const failBg = isFail
                ? (isServiceFinding
                  ? (isDark ? "rgba(217, 119, 6, 0.22)" : "#FEF3C7")
                  : colors.errorContainer)
                : colors.surfaceContainerHigh;
              const failBorder = isFail
                ? (isServiceFinding ? "#D97706" : colors.error)
                : (isDark ? "rgba(255,255,255,0.06)" : "transparent");
              const failTextColor = isFail
                ? (isServiceFinding
                  ? (isDark ? "#FDE68A" : "#92400E")
                  : colors.onErrorContainer)
                : unselectedTextColor;
              const failIconColor = isFail
                ? (isServiceFinding
                  ? (isDark ? "#FDE68A" : "#B45309")
                  : colors.onErrorContainer)
                : unselectedIconColor;

              return (
                <View
                  key={item.id}
                  onLayout={(e) => handleCardLayout(item.id, e)}
                >
                  <ClayCard
                    variant="compact"
                    style={styles.checkItem}
                  >
                    <View style={styles.cardHeaderRow}>
                      <View
                        style={[
                          styles.categoryIconBadge,
                          {
                            backgroundColor: isPass
                              ? (isDark ? "rgba(46, 125, 50, 0.2)" : "#E8F5E9")
                              : isFail
                              ? (isServiceFinding
                                ? (isDark ? "rgba(217, 119, 6, 0.2)" : "#FEF3C7")
                                : (isDark ? "rgba(239, 68, 68, 0.2)" : "#FEE2E2"))
                              : (isDark ? colors.surfaceContainerHighest : colors.surfaceVariant),
                          },
                        ]}
                      >
                        <Ionicons
                          name={item.icon || "checkmark-circle-outline"}
                          size={20}
                          color={
                            isPass
                              ? colors.primary
                              : isFail
                              ? (isServiceFinding ? "#D97706" : colors.error)
                              : colors.onSurfaceVariant
                          }
                        />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Text style={[styles.cardCategoryTitle, { color: colors.onSurface }]}>
                            {screenMode === "preshift" ? `${idx + 1}. ${item.shortTitle || item.label}` : (item.shortTitle || item.label)}
                          </Text>
                          {item.section && (
                            <Text style={[styles.cardSectionTag, { color: colors.primary }]}>
                              {item.section}
                            </Text>
                          )}
                        </View>
                        <Text style={[styles.cardQuestionText, { color: isDark ? "#CBD5E1" : colors.onSurfaceVariant }]}>
                          {item.question}
                        </Text>
                      </View>
                    </View>

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
                              size={16}
                              color={passIconColor}
                            />
                            <Text
                              style={[
                                styles.checkBtnText,
                                { color: passTextColor },
                              ]}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.75}
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
                              name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? (isServiceFinding ? "bag-outline" : "close-circle") : "close-circle-outline"}
                              size={16}
                              color={failIconColor}
                            />
                            <Text
                              style={[
                                styles.checkBtnText,
                                { color: failTextColor },
                              ]}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.75}
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
                            size={16}
                            color={passIconColor}
                          />
                          <Text
                            style={[
                              styles.checkBtnText,
                              { color: passTextColor },
                            ]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
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
                            name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? (isServiceFinding ? "bag-outline" : "close-circle") : "close-circle-outline"}
                            size={16}
                            color={failIconColor}
                          />
                          <Text
                            style={[
                              styles.checkBtnText,
                              { color: failTextColor },
                            ]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {item.failLabel || "FAIL"}
                          </Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Remarks input when failed */}
                    {isFail && (
                      <View style={{ gap: 6 }}>
                        <CoachMarkTarget id="inspection.remarks" targetId="inspection.remarks" radius={12} scrollRef={scrollRef}>
                          <TextInput
                            placeholder={item.remarksPrompt || "Describe issue..."}
                            placeholderTextColor={colors.outline}
                            value={remarks[item.id] || ""}
                            maxLength={1000}
                            onChangeText={(text) =>
                              setRemarks((prev) => ({ ...prev, [item.id]: text }))
                            }
                            style={[
                              styles.remarkInput,
                              {
                                borderColor: isServiceFinding ? "#D97706" : (colors.error + "60"),
                                color: colors.onSurface,
                                backgroundColor: colors.surfaceContainerLowest,
                              },
                            ]}
                            multiline
                          />
                        </CoachMarkTarget>
                        {isServiceFinding && (
                          <View style={styles.serviceFindingNoteRow}>
                            <Ionicons name="information-circle-outline" size={15} color="#D97706" />
                            <Text style={[type.caption, { color: isDark ? "#FDE68A" : "#92400E", flex: 1 }]}>
                              Service finding will be logged for dispatch & Lost & Found. You can still proceed with your route.
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </ClayCard>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Primary CTA Button & Pre-submission Safety Banner */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.outlineVariant + "30",
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        {allAnswered && (
          (screenMode === "preshift" && failedCount > 0) ? (
            <View
              style={[
                styles.preSubmitWarningBanner,
                {
                  backgroundColor: isDark ? "rgba(239, 68, 68, 0.16)" : "#FEE2E2",
                  borderColor: colors.error + "50",
                },
              ]}
            >
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={[type.labelMd, { color: colors.error, flex: 1, fontFamily: fonts.bodySemiBold }]}>
                {failedCount} safety issue{failedCount > 1 ? "s" : ""} reported — Pre-shift failure requires dispatch clearance before duty starts.
              </Text>
            </View>
          ) : (screenMode === "pretrip" && statuses.brakes_tires === "FAIL") ? (
            <View
              style={[
                styles.preSubmitWarningBanner,
                {
                  backgroundColor: isDark ? "rgba(239, 68, 68, 0.16)" : "#FEE2E2",
                  borderColor: colors.error + "50",
                },
              ]}
            >
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <Text style={[type.labelMd, { color: colors.error, flex: 1, fontFamily: fonts.bodySemiBold }]}>
                Brake or tire issue reported — Trip departure will be blocked until resolved.
              </Text>
            </View>
          ) : null
        )}

        <CoachMarkTarget id="inspection.complete" targetId="inspection.complete" radius={16} scrollRef={scrollRef}>
          <ClayButton
            label={
              submitting
                ? "SUBMITTING..."
                : allAnswered
                ? (screenMode === "preshift" ? "START YOUR SHIFT" : "GOOD TO GO")
                : (screenMode === "preshift" ? `COMPLETE ALL 5 ITEMS (${answeredCount}/${CHECKLIST.length})` : "CONFIRM ALL ITEMS TO CONTINUE")
            }
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
                ? "Vehicle safety check confirmed. The reported passenger finding was logged for dispatch. You are now ready to practice your route on the Live Map!"
                : "All safety and readiness checks completed. Dispatch has been notified. You are now ready to practice your route on the Live Map!"}
            </Text>
            <View style={{ width: '100%', backgroundColor: colors.surfaceContainerLow, borderRadius: 12, padding: 12, gap: 8, marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Brakes & Tires:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>SAFE</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Passenger Items:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: failedCount > 0 ? colors.tertiary : colors.primary }}>
                  {failedCount > 0 ? 'Item Reported' : 'Clean'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Safety Status:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>
                  {failedCount > 0 ? 'Flagged for Dispatch Review' : 'Safe for Route Departure'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Cabin Ready:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>Acknowledged</Text>
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
  topBarTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: moderateScale(16),
    fontFamily: fonts.displayBold,
    letterSpacing: -0.2,
  },
  topAvatar: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(14),
    gap: moderateScale(12),
  },
  heading: {
    alignItems: "center",
    gap: moderateScale(2),
    width: "100%",
    marginBottom: moderateScale(2),
  },
  headingTitle: {
    textAlign: "center",
    fontSize: moderateScale(20),
    lineHeight: moderateScale(26),
    fontFamily: fonts.displayBold,
    letterSpacing: -0.3,
  },
  headingSub: {
    textAlign: "center",
    fontSize: moderateScale(13),
    lineHeight: moderateScale(18),
    fontFamily: fonts.body,
  },
  vehicleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(10),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(10),
    borderRadius: moderateScale(12),
    width: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  vehicleMetaLabel: {
    fontSize: moderateScale(10),
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: moderateScale(1),
  },
  vehiclePlateText: {
    fontSize: moderateScale(16),
    lineHeight: moderateScale(20),
    fontFamily: fonts.displayBold,
    letterSpacing: -0.2,
  },
  vehicleSubText: {
    fontSize: moderateScale(12),
    lineHeight: moderateScale(16),
    fontFamily: fonts.body,
  },
  checklist: { gap: moderateScale(10), width: "100%" },
  checkItem: {
    borderRadius: moderateScale(12),
    padding: moderateScale(12),
    gap: moderateScale(10),
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    minHeight: moderateScale(68),
    width: "100%",
  },
  cardBadge: {
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: fonts.bodySemiBold,
    marginBottom: moderateScale(2),
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bulletList: {
    gap: moderateScale(4),
    marginVertical: moderateScale(4),
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(6),
  },
  bulletPoint: {
    fontSize: moderateScale(16),
    lineHeight: moderateScale(20),
  },
  bulletText: {
    flex: 1,
    lineHeight: moderateScale(20),
  },
  cabinAckBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: TOUCH_TARGET,
    borderRadius: moderateScale(10),
    borderWidth: 1,
    gap: moderateScale(8),
    marginTop: moderateScale(6),
    paddingHorizontal: moderateScale(12),
  },
  cabinAckBtnText: {
    fontSize: moderateScale(13),
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 0.3,
  },
  checkItemLabel: {},
  checkBtnRow: { flexDirection: "row", gap: moderateScale(8) },
  checkBtn: {
    flex: 1,
    height: TOUCH_TARGET,
    borderRadius: moderateScale(8),
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(6),
    gap: moderateScale(5),
  },
  checkBtnText: {
    fontSize: moderateScale(11.5),
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 0.1,
    textAlign: "center",
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
  progressContainer: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(8),
    paddingBottom: moderateScale(10),
    borderBottomWidth: 1,
    gap: moderateScale(6),
  },
  progressHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  segmentTrack: {
    flexDirection: "row",
    gap: moderateScale(6),
    height: moderateScale(8),
    width: "100%",
  },
  segmentPill: {
    flex: 1,
    height: moderateScale(8),
    borderRadius: moderateScale(4),
    borderWidth: 1,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(10),
    marginBottom: moderateScale(2),
  },
  categoryIconBadge: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.04)",
  },
  cardCategoryTitle: {
    fontSize: moderateScale(15),
    fontFamily: fonts.displayBold,
    letterSpacing: -0.2,
  },
  cardSectionTag: {
    fontSize: moderateScale(10),
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: fonts.bodySemiBold,
  },
  cardQuestionText: {
    fontSize: moderateScale(13.5),
    lineHeight: moderateScale(19),
    fontFamily: fonts.bodyMedium,
  },
  serviceFindingNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(4),
    marginTop: moderateScale(2),
  },
  preSubmitWarningBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    padding: moderateScale(10),
    borderRadius: moderateScale(10),
    borderWidth: 1,
    marginBottom: moderateScale(10),
  },
});
