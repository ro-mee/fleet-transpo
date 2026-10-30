import IncidentCriticalConfirmation from '../../components/incidents/IncidentCriticalConfirmation';
import DriverGuideTrigger from '../../components/coachmarks/DriverGuideTrigger';
import { guardLegacyGuideLinks } from '../../components/coachmarks/LegacyGuideLinkGuard';
import IncidentReportForm, { IncidentSubmitButton } from '../../components/incidents/IncidentReportForm';
import { moderateScale } from '../../lib/scaling';
import { useState, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput, KeyboardAvoidingView, Linking, Platform, Image, InteractionManager, Modal } from 'react-native';
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { resolveDriverId, setCached, CACHE_KEYS } from "../../lib/offline-cache";
import { resolveVehicleContext, getCachedVehicleContext } from "../../lib/driver-context";
import { AppAlert } from '../../components/AppAlert';
import { ClayCard, ClayButton, ClayTile } from '../../components/clay';
import { raisedControl } from '../../lib/clay';
import { useCoachMarkActions, useCoachMarkStatus, CoachMarkTarget } from '../../components/coachmarks';
import {
  INCIDENT_SEVERITY_RULE_VERSION,
  recommendIncidentSeverity,
} from "../../../shared/incidents/severity.js";

async function withLocationTimeout(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Location timed out")), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function IncidentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tripId, tour } = useLocalSearchParams();
  const isTour = tour === "1";
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";
  const raised = raisedControl(isDark);
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  const { triggerMilestone, notifyInteraction, setTutorialTransition } = useCoachMarkActions();
  const { activeMilestone } = useCoachMarkStatus();
  const scrollRef = useRef(null);

  const [type, setType] = useState(null);
  const [description, setDescription] = useState("");
  const [severityAnswers, setSeverityAnswers] = useState({
    immediateDanger: "",
    vehicleSafety: "",
    tripImpact: "",
    hazardToOthers: "",
  });
  const [severityOverride, setSeverityOverride] = useState(null);
  const [overrideReason, setOverrideReason] = useState(null);
  const [lowerCriticalConfirmed, setLowerCriticalConfirmed] = useState(false);
  const [showSeverityChoices, setShowSeverityChoices] = useState(false);
  const [showCriticalConfirm, setShowCriticalConfirm] = useState(false);
  const [assistance, setAssistance] = useState([]);
  const [expense, setExpense] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showTourSuccessModal, setShowTourSuccessModal] = useState(false);
  const [failedPhotos, setFailedPhotos] = useState(0);
  const [submitPhase, setSubmitPhase] = useState("");
  const [queuedOffline, setQueuedOffline] = useState(false);

  const [vehicleId, setVehicleId] = useState(null);
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [photos, setPhotos] = useState([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const recommendation = recommendIncidentSeverity(severityAnswers);
  const finalSeverity = severityOverride || recommendation?.severity || null;

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (!activeMilestone) {
        if (isTour) {
          triggerMilestone("tour_incident_category");
        } else {
          triggerMilestone("incident");
        }
      }
    });
    return () => task?.cancel?.();
  }, [activeMilestone, triggerMilestone, isTour]);
  
  useEffect(() => {
    // Offline driver context: the vehicle shown (and submitted) resolves
    // through the shared chain — explicit trip → active trip → standing
    // assignment → none. Cached first so offline reports keep the vehicle
    // (a report without its vehicle slows dispatch); live revalidate below.
    // NEVER the recent trip's vehicle: a finished trip is not proof of a
    // current assignment.
    async function loadData() {
      const apply = (v) => {
        if (v) {
          setVehicleId(v.vehicleId);
          setVehiclePlate(v.plate ?? "");
        }
      };
      if (driverId) {
        apply(resolveVehicleContext(await getCachedVehicleContext(driverId)));
      }
      InteractionManager.runAfterInteractions(async () => {
        try {
          const [trips, me] = await Promise.all([
            api.get("/api/mobile/driver/trips?status=all").catch(() => null),
            api.get("/api/mobile/driver/me").catch(() => null),
          ]);
          const list = Array.isArray(trips) ? trips : null;
          // Keep the shared trips cache warm for the next offline report.
          if (list && driverId) await setCached(driverId, CACHE_KEYS.TRIPS_ALL, list);
          apply(resolveVehicleContext({ trips: list, me }));
        } catch (e) {
          // Cache already applied above; offline the vehicle simply stays as
          // the saved one (or none) — the submit still queues via apiFetch.
        }
      });
    }
    if (!tripId) {
      loadData();
    }
  }, [tripId, driverId]);

  const pickImage = async (useCamera = true) => {
    if (photos.length >= 3) {
      AppAlert.alert("Limit Reached", "You can only attach up to 3 photos.");
      return;
    }
    try {
      const options = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      };
      let result;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          AppAlert.alert("Camera permission needed", "Allow camera access in device settings, then return and try again.", [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]);
          return;
        }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        result = await ImagePicker.launchImageLibraryAsync(options);
      }
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
          AppAlert.alert("File Too Large", "Please select an image smaller than 5MB.");
          return;
        }
        if (asset.mimeType && asset.mimeType !== "image/jpeg" && asset.mimeType !== "image/png") {
          AppAlert.alert("Invalid Format", "Only JPEG and PNG images are allowed.");
          return;
        }
        setPhotos([...photos, asset]);
      }
    } catch (error) {
      console.warn(error);
    }
  };

  const removePhoto = (index) => {
    setPhotos(photos.filter((_, i) => i !== index));
  };


  const toggleAssistance = (option) => {
    setAssistance((prev) =>
      prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]
    );
  };
  const updateSeverityAnswer = (key, value) => {
    setSeverityAnswers((previous) => ({ ...previous, [key]: value }));
    setSeverityOverride(null);
    setOverrideReason(null);
    setLowerCriticalConfirmed(false);
    setShowSeverityChoices(false);
    setShowCriticalConfirm(false);
  };
  const selectIncidentCategory = categoryId => {

                      if (type !== categoryId) {
                        setSeverityAnswers({
                          immediateDanger: "",
                          vehicleSafety: "",
                          tripImpact: "",
                          hazardToOthers: "",
                        });
                        setSeverityOverride(null);
                        setOverrideReason(null);
                        setLowerCriticalConfirmed(false);
                        setShowSeverityChoices(false);
                        setShowCriticalConfirm(false);
                      }
                      setType(categoryId);
                      if (isTour) {
                        setDescription("Flat tire on right rear wheel, vehicle safely parked on shoulder.");
                        setAssistance(["Tow Truck"]);
                        setSeverityAnswers({
                          immediateDanger: "no",
                          vehicleSafety: "safe",
                          tripImpact: "delayed",
                          hazardToOthers: "no",
                        });
                        setPhotos([{ uri: "https://images.unsplash.com/photo-1578844251758-2f71da64c96f?w=400&q=80", mimeType: "image/jpeg" }]);
                      }
                      notifyInteraction?.("incident.category", categoryId);
  };

  const handleSubmit = async (criticalConfirmed = false) => {
    if (!type) {
      AppAlert.alert("Incident Type Required", "Please select the category of the incident before submitting.");
      return;
    }
    if (isTour) {
      notifyInteraction?.("incident.submit");
      setShowTourSuccessModal(true);
      return;
    }
    if (!recommendation || !finalSeverity) {
      AppAlert.alert("Safety questions required", "Answer each safety and trip question to get a severity recommendation.");
      return;
    }
    if (severityOverride && !overrideReason) {
      AppAlert.alert("Reason required", "Choose why you changed the recommended severity.");
      return;
    }
    if (recommendation.severity === "Critical" && finalSeverity !== "Critical" && !lowerCriticalConfirmed) {
      AppAlert.alert("Recheck immediate danger", "Confirm that you rechecked the immediate danger answer before choosing a lower severity.");
      return;
    }
    if (!description.trim()) {
      AppAlert.alert("Description Required", "Please provide a brief explanation of what occurred.");
      return;
    }
    let expenseValue = null;
    if (expense.trim()) {
      expenseValue = Number(expense);
      if (!Number.isFinite(expenseValue) || expenseValue <= 0) {
        AppAlert.alert("Invalid Expense", "Enter the amount you spent as a positive number, or leave it blank.");
        return;
      }
    }
    if (finalSeverity === "Critical" && !criticalConfirmed) {
      setShowCriticalConfirm(true);
      return;
    }
    try {
      setSubmitting(true);
      setQueuedOffline(false);
      // One id per submit: a later report from the same mounted form is not a
      // replay of the previous report.
      const clientSubmissionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setUploadingPhotos(true);
      setSubmitPhase("Uploading photos…");
      
      const uploadedRefs = [];
      let failedPhotoCount = 0;
      for (const photo of photos) {
        const formData = new FormData();
        formData.append("photo", {
          uri: photo.uri,
          name: photo.uri.split("/").pop() || "photo.jpg",
          type: photo.mimeType || "image/jpeg",
        });
        try {
          const uploadRes = await api.post("/api/driver/incidents/upload", formData, {
            headers: { "Content-Type": "multipart/form-data" },
            queueOnFailure: false,
          });
          if (uploadRes && uploadRes.photo_path) {
            uploadedRefs.push(uploadRes.photo_path);
          } else {
            failedPhotoCount += 1;
          }
        } catch(err) {
          console.warn("Failed to upload photo", err);
          failedPhotoCount += 1;
        }
      }
      setUploadingPhotos(false);
      
      setSubmitPhase("Finding your location…");
      let gpsLocation = "GPS Location unavailable";
      let lat = null;
      let lng = null;
      
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await withLocationTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 10000);
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
          
          try {
            const geocode = await withLocationTimeout(Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }), 3000);
            if (geocode && geocode.length > 0) {
              const place = geocode[0];
              const parts = [place.street, place.city || place.subregion, place.region].filter(Boolean);
              gpsLocation = parts.length > 0 ? parts.join(', ') : `${lat}, ${lng}`;
            } else {
              gpsLocation = `${lat}, ${lng}`;
            }
          } catch (geoErr) {
            console.warn("Reverse geocode failed", geoErr);
            gpsLocation = `${lat}, ${lng}`;
          }
        }
      } catch (locErr) {
        console.warn("Failed to get location for incident report", locErr);
      }

      setSubmitPhase("Sending incident report…");
      const result = await api.post("/api/driver/incidents", {
        trip_id: tripId ? parseInt(tripId, 10) : null,
        vehicle_id: vehicleId,
        incident_type: type,
        description,
        location: gpsLocation,
        latitude: lat,
        longitude: lng,
        severity: finalSeverity,
        severity_assessment: {
          version: INCIDENT_SEVERITY_RULE_VERSION,
          answers: severityAnswers,
          override_reason_code: severityOverride ? overrideReason : null,
          critical_confirmed: finalSeverity === "Critical" && criticalConfirmed,
          lower_severity_confirmed:
            recommendation.severity === "Critical" && finalSeverity !== "Critical",
        },
        incident_date: new Date().toISOString(),
        client_submission_id: clientSubmissionId,
        assistance_needed: assistance.length ? assistance : null,
        expense_amount: expenseValue,
        photo_urls: uploadedRefs.length ? uploadedRefs : undefined,
      });
      // apiFetch queues POSTs during network failures and resolves
      // { queued: true } — the report has NOT reached dispatch yet.
      setFailedPhotos(failedPhotoCount);
      setQueuedOffline(result?.queued === true);
      setShowSuccess(true);
    } catch (e) {
      AppAlert.alert("Unable to Submit Incident Report", e.message || "Please check your network connection and try submitting again.");
    } finally {
      setUploadingPhotos(false);
      setSubmitPhase("");
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <DriverGuideTrigger guideId={'incident.report'} enabled={!isTour} />
      {/* Top App Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.primaryContainer, paddingTop: insets.top },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onPrimaryContainer} />
        </Pressable>
        <Text style={[styles.topBarTitle, { color: colors.onPrimaryContainer }]}>
          Report Incident
        </Text>
        <Ionicons name="document-text-outline" size={22} color={colors.onPrimaryContainer} />
      </View>

      {/* Incident guidance */}
      <CoachMarkTarget id="incident.banner" targetId="incident.banner" radius={10} padding={6}>
        <View style={[styles.emergencyBanner, { backgroundColor: colors.surfaceContainerHigh }]}>
          <Ionicons name="information-circle-outline" size={17} color={colors.primary} />
          <Text style={[styles.emergencyText, { color: colors.onSurfaceVariant }]}>
            This form records an incident for dispatch review. Use SOS or call emergency services if someone needs immediate help.
          </Text>
        </View>
      </CoachMarkTarget>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        
        {/* Vehicle Selection */}
        {!tripId && vehiclePlate && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
              Vehicle
            </Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
              You are reporting this incident for this vehicle.
            </Text>
            <ClayCard style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ClayTile icon="car-outline" size={38} />
              <Text style={{ flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: 'bold' }}>{vehiclePlate}</Text>
            </ClayCard>
          </View>
        )}

        <IncidentReportForm values={{ type, severityAnswers, recommendation, finalSeverity, showSeverityChoices, severityOverride, overrideReason, lowerCriticalConfirmed, vehicleId, description, assistance, expense, photos }} actions={{ onCategory: selectIncidentCategory, updateSeverityAnswer, setShowSeverityChoices, setSeverityOverride, setOverrideReason, setLowerCriticalConfirmed, setDescription, toggleAssistance, setExpense, removePhoto, pickImage }} scrollRef={scrollRef} styles={styles} raised={raised} />
      </ScrollView>

      {/* Submit Footer */}
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
        {submitting ? <Text accessibilityLiveRegion="polite" style={{ color: colors.onSurfaceVariant, textAlign: "center" }}>{submitPhase}</Text> : null}
        <IncidentSubmitButton onSubmit={handleSubmit} submitting={submitting} uploadingPhotos={uploadingPhotos} />
      </View>

      <IncidentCriticalConfirmation visible={showCriticalConfirm} recommendation={recommendation} onClose={() => setShowCriticalConfirm(false)} onConfirm={() => { setShowCriticalConfirm(false); handleSubmit(true); }} styles={styles} />

      {/* Tour Mode Success Modal */}
      {showTourSuccessModal && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 24 }]}>
          <ClayCard style={{ width: '100%', maxWidth: 400, padding: 28, alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryContainer, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Ionicons name="shield-checkmark" size={36} color={colors.primary} />
            </View>
            <Text style={{ fontFamily: fonts.displayBold, fontSize: 20, color: colors.onSurface, letterSpacing: -0.4, marginBottom: 4, textAlign: 'center' }}>
              Incident Report Preview
            </Text>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.primary, marginBottom: 12, textAlign: 'center' }}>
              TUTORIAL SIMULATION
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
              This is a practice report only. In a real immediate emergency, use SOS or call emergency services.
            </Text>
            <View style={{ width: '100%', backgroundColor: colors.surfaceContainerLow, borderRadius: 12, padding: 14, marginBottom: 20, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Category:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.onSurface }}>Vehicle Breakdown</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Assistance:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.onSurface }}>Tow Truck</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.onSurfaceVariant }}>Live GPS:</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }}>14.5995° N, 120.9842° E</Text>
              </View>
            </View>
            <ClayButton
              label="Next: Fuel Logging →"
              variant="primary"
              size="lg"
              onPress={() => {
                setShowTourSuccessModal(false);
                setTutorialTransition?.(true, "tour_fuel");
                router.replace("/(app)/(tabs)?tour_step=fuel");
              }}
              style={{ width: '100%' }}
            />
          </ClayCard>
        </View>
      )}

      {/* Success Overlay */}
      {showSuccess && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 24 }]}>
          <ClayCard style={{ width: '100%', maxWidth: 400, padding: 0, maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center', gap: 8 }}>
            {failedPhotos ? <Text accessibilityLiveRegion="polite" style={{ color: colors.error, marginBottom: 12 }}>{failedPhotos} photo{failedPhotos === 1 ? "" : "s"} could not be uploaded and remain only on this device. {queuedOffline ? "The report is saved offline and has not reached dispatch." : "The report was received without these photos."} Do not submit a second report for the same incident. Ask dispatch how to share the missing evidence.</Text> : null}
            <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.errorContainer + '40', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.errorContainer, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="shield-checkmark" size={32} color={colors.onErrorContainer} />
              </View>
            </View>
            <Text style={{ fontFamily: fonts.displayBold, fontSize: 22, color: colors.onSurface, letterSpacing: -0.4, marginBottom: 8, textAlign: 'center' }}>
              {queuedOffline ? "Report saved offline" : "Report received"}
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
              {queuedOffline
                ? "You appear to be offline. Your report is saved on this device and will be sent automatically when you're back online — dispatch has NOT received it yet. Please prioritize safety and call for immediate help if needed."
                : "Dispatch has received your incident report. Please prioritize safety and await instructions."}
            </Text>
            <ClayButton
              label="Return to Dashboard"
              variant="primary"
              size="lg"
              onPress={() => router.back()}
              style={{ width: '100%' }}
            />
            </ScrollView>
          </ClayCard>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { flex: 1, fontSize: 17, fontFamily: fonts.displayBold },
  emergencyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  emergencyText: { flex: 1, fontSize: 12, fontFamily: fonts.bodyMedium },
  scroll: { paddingHorizontal: 16, paddingTop: 18, gap: 20 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold, letterSpacing: -0.2 },
  sectionSub: { fontSize: 13, fontFamily: fonts.body },
  guidedQuestion: { gap: 7, marginTop: 8 },
  guidedQuestionTitle: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  answerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
  answerOption: {
    minWidth: "47%",
    flexGrow: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  recommendationCard: { padding: 16, gap: 8, borderWidth: 1, borderRadius: 16 },
  recommendationEyebrow: { fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 0.7 },
  recommendationHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
  recommendationLevel: { fontSize: 23, fontFamily: fonts.displayBold },
  overrideTag: { fontSize: 12, fontFamily: fonts.bodyMedium },
  levelHelp: { fontSize: 13, fontFamily: fonts.body, lineHeight: 19 },
  changeSeverityButton: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", paddingRight: 12 },
  overrideSection: { gap: 4, marginTop: 4 },
  overrideReason: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 40 },
  lowerCriticalCheck: { flexDirection: "row", alignItems: "center", gap: 9, paddingTop: 8 },
  operationalNote: { fontSize: 12, fontFamily: fonts.body, lineHeight: 17, paddingTop: 8 },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  confirmCard: { width: "100%", maxWidth: 420, padding: 24, alignItems: "center", gap: 12 },
  confirmTitle: { fontSize: 21, fontFamily: fonts.displayBold, textAlign: "center" },
  confirmCopy: { fontSize: 14, fontFamily: fonts.body, lineHeight: 20, textAlign: "center" },
  confirmBasis: { fontSize: 13, fontFamily: fonts.bodySemiBold, lineHeight: 19, textAlign: "center" },
  reviewAnswersButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeCard: {
    width: "48%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 8,
  },
  typeCardText: { fontSize: 13, fontFamily: fonts.bodySemiBold, textAlign: "center" },
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  textarea: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    fontFamily: fonts.body,
    minHeight: 110,
    textAlignVertical: "top",
  },
  assistGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  assistChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    minHeight: TOUCH_TARGET - 10,
  },
  assistChipText: { fontSize: 12, fontFamily: fonts.bodySemiBold },
  expenseRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: TOUCH_TARGET,
  },
  expensePrefix: { fontSize: 16, fontFamily: fonts.bodySemiBold, marginRight: 6 },
  expenseInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.body,
    paddingVertical: 12,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
});

export default guardLegacyGuideLinks(IncidentsScreen);
