import { moderateScale } from '../../lib/scaling';
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput,  } from 'react-native';
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, space, radius, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";
import { AppAlert } from '../../components/AppAlert';

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
  const { tripId } = useLocalSearchParams();
  const { colors, type } = useTheme();

  const [statuses, setStatuses] = useState(
    CHECKLIST.reduce((acc, item) => ({ ...acc, [item.id]: null }), {})
  );
  const [remarks, setRemarks] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [clientSubmissionId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [tripContext, setTripContext] = useState(null);

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

  const allAnswered = CHECKLIST.every((item) => statuses[item.id] !== null);
  const passCount = Object.values(statuses).filter((s) => s === "PASS").length;

  const setStatus = (id, val) => {
    setStatuses((prev) => ({ ...prev, [id]: val }));
  };

  const handleSubmit = async () => {
    if (!allAnswered) {
      AppAlert.alert("Incomplete", "Please answer all checklist items before proceeding.");
      return;
    }
    const missingRemarks = CHECKLIST.find(
      (item) => statuses[item.id] === "FAIL" && !String(remarks[item.id] || "").trim()
    );
    if (missingRemarks) {
      AppAlert.alert("Describe the Issue", `Add remarks for ${missingRemarks.label} before submitting.`);
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
        AppAlert.alert("Inspection Saved Offline", "The inspection will sync when the connection returns.", [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }
      AppAlert.alert("Inspection Submitted", "Pre-trip check complete. The trip can start after the departure checks pass.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (e) {
      AppAlert.alert("Error", e.message || "Could not submit inspection.");
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
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="menu" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
        <Text style={[type.headlineMd, styles.topBarTitle, { color: colors.primary }]}>FleetOps</Text>
        <View style={[styles.topAvatar, { backgroundColor: colors.surfaceVariant }]}>
          <Ionicons name="person" size={20} color={colors.onSurfaceVariant} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
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
        <View
          style={[
            styles.vehicleCard,
            { backgroundColor: colors.surfaceContainerHighest },
          ]}
        >
          <View style={[styles.vehicleImgPlaceholder, { backgroundColor: colors.surfaceVariant }]}>
            <Ionicons name="car" size={36} color={colors.onSurfaceVariant} />
          </View>
          <View>
            <Text style={[type.labelLg, styles.vehicleCardLabel, { color: colors.onSurfaceVariant }]}>
              Vehicle & Trip
            </Text>
            <Text style={[type.titleLg, styles.vehicleCardName, { color: colors.onSurface }]}>
              {tripContext?.plate_number || (tripId ? `Trip #${tripId}` : "Assigned Trip")}
            </Text>
            <Text style={[type.bodyLg, styles.vehicleCardDriver, { color: colors.onSurface }]}>
              {tripContext?.model ? `${tripContext.model} - Trip #${tripId}` : `Trip #${tripId}`}
            </Text>
          </View>
        </View>

        {/* Checklist */}
        <View style={styles.checklist}>
          {CHECKLIST.map((item, idx) => {
            const status = statuses[item.id];
            const isPass = status === "PASS";
            const isFail = status === "FAIL";

            return (
              <View
                key={item.id}
                style={[
                  styles.checkItem,
                  { backgroundColor: colors.surfaceContainer },
                ]}
              >
                <Text style={[type.labelLg, styles.checkItemLabel, { color: colors.onSurface }]}>
                  {idx + 1}. {item.label}
                </Text>
                <View style={styles.checkBtnRow}>
                  {/* PASS button */}
                  <Pressable
                    onPress={() => setStatus(item.id, "PASS")}
                    style={({ pressed }) => [
                      styles.checkBtn,
                      {
                        backgroundColor: isPass
                          ? colors.secondaryContainer
                          : colors.surfaceContainerHigh,
                        borderColor: isPass ? colors.secondary : colors.outlineVariant + '40',
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
                      {
                        backgroundColor: isFail
                          ? colors.errorContainer
                          : colors.surfaceContainerHigh,
                        borderColor: isFail ? colors.error : colors.outlineVariant + '40',
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

                {/* Remarks input when failed */}
                {isFail && (
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
                )}
              </View>
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
        <Pressable
          onPress={handleSubmit}
          disabled={!allAnswered || submitting}
          style={({ pressed }) => [
            styles.startBtn,
            {
              backgroundColor:
                allAnswered && !submitting
                  ? colors.primary
                  : colors.surfaceContainerHigh,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.startBtnText,
              { color: allAnswered ? colors.onPrimary : colors.onSurfaceVariant },
            ]}
          >
            {submitting ? "SUBMITTING..." : allAnswered ? "COMPLETE INSPECTION" : `COMPLETE ALL ITEMS (${Object.values(statuses).filter(Boolean).length}/${CHECKLIST.length})`}
          </Text>
          <View style={[styles.btnIconCapsule, { backgroundColor: allAnswered && !submitting ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.06)' }]}>
            <Ionicons
              name={allAnswered ? "checkmark-circle-outline" : "lock-closed-outline"}
              size={17}
              color={allAnswered ? colors.onPrimary : colors.onSurfaceVariant}
            />
          </View>
        </Pressable>
      </View>
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
  topBarTitle: {
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
  vehicleImgPlaceholder: {
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(8),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  vehicleCardLabel: { },
  vehicleCardName: { },
  vehicleCardDriver: { },
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
  startBtn: {
    height: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  startBtnText: {
    fontSize: 15,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 0.3,
  },
  btnIconCapsule: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(12),
    borderTopWidth: 1,
  },
});
