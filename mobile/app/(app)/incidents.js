import { moderateScale } from '../../lib/scaling';
import { useState, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform, Image, InteractionManager, Modal } from 'react-native';
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
  INCIDENT_SEVERITY_REASON_LABELS,
  INCIDENT_SEVERITY_RULE_VERSION,
  recommendIncidentSeverity,
} from "../../../shared/incidents/severity.js";

const INCIDENT_TYPES = [
  { id: "breakdown", label: "Vehicle Breakdown", icon: "car" },
  { id: "accident", label: "Traffic Accident", icon: "warning" },
  { id: "weather", label: "Severe Weather", icon: "thunderstorm" },
  { id: "cargo", label: "Cargo Issue", icon: "cube" },
  { id: "medical", label: "Medical Emergency", icon: "medkit" },
  { id: "other", label: "Other Incident", icon: "ellipsis-horizontal" },
];

// Structured help request sent as driverincidents.assistance_needed (text[]).
// Dispatch sees these as chips next to the report instead of parsing prose.
const ASSISTANCE_OPTIONS = [
  "Tow Truck",
  "Mechanic",
  "Medical Assistance",
  "Police",
  "Alternative Vehicle",
  "Fuel",
];

const SEVERITY_LEVELS = ["Minor", "Moderate", "Major", "Critical"];
const OVERRIDE_REASONS = [
  { value: "situation_changed", label: "The situation changed" },
  { value: "answers_missed_context", label: "I missed context in my answers" },
  { value: "driver_judgment", label: "My judgment is different" },
];
const LEVEL_HELP = {
  Minor: "No current danger or trip disruption was reported.",
  Moderate: "The trip is affected, but no immediate danger was reported.",
  Major: "Urgent review is needed because safety is unclear or a hazard was reported.",
  Critical: "You reported someone is in immediate danger.",
};
const IMMEDIATE_QUESTION = {
  breakdown: "Is anyone in immediate danger, including from a vehicle hazard in traffic?",
  accident: "Does anyone need emergency help or face an immediate danger now?",
  weather: "Does the weather create an immediate danger to people or traffic now?",
  cargo: "Does the cargo create an immediate danger to people or traffic right now?",
  medical: "Does anyone need emergency medical help right now?",
  other: "Is anyone in immediate danger right now?",
};
const RISK_QUESTION = {
  breakdown: "Does the vehicle create a hazard for people or traffic?",
  accident: "Is there still a hazard for people or traffic?",
  weather: "Is there a current hazard to other road users?",
  cargo: "Is there a current hazard to people or traffic?",
  medical: "Is anyone else or traffic at risk right now?",
  other: "Is anyone else or traffic at risk right now?",
};

export default function IncidentsScreen() {
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
        if (status !== 'granted') return;
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
      
      let gpsLocation = "GPS Location unavailable";
      let lat = null;
      let lng = null;
      
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
          
          try {
            const geocode = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
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
      if (failedPhotoCount > 0) {
        AppAlert.alert(
          "Report sent without all photos",
          `${failedPhotoCount} photo${failedPhotoCount === 1 ? "" : "s"} could not be uploaded. You can submit the report again with the missing evidence.`
        );
      }
      setQueuedOffline(result?.queued === true);
      setShowSuccess(true);
    } catch (e) {
      AppAlert.alert("Unable to Submit Incident Report", e.message || "Please check your network connection and try submitting again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
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

        {/* Incident Type */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Incident Category
          </Text>
          <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
            Select the category that best describes the situation
          </Text>
          <CoachMarkTarget id="incident.category" targetId="incident.category" scrollRef={scrollRef}>
            <View style={styles.typeGrid}>
              {INCIDENT_TYPES.map((t) => {
                const selected = type === t.id;
                return (
                  <ClayCard
                    key={t.id}
                    onPress={() => {
                      if (type !== t.id) {
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
                      setType(t.id);
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
                      notifyInteraction?.("incident.category", t.id);
                    }}
                    style={[
                      styles.typeCard,
                      selected && { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
                    ]}
                  >
                    <ClayTile
                      icon={t.icon}
                      size={38}
                      style={{ backgroundColor: selected ? colors.primary + '20' : undefined }}
                    />
                    <Text
                      style={[
                        styles.typeCardText,
                        { color: selected ? colors.onPrimaryContainer : colors.onSurface },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </ClayCard>
                );
              })}
            </View>
          </CoachMarkTarget>
        </View>

        {/* Guided severity questions */}
        {type ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Check the situation</Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
              Your answers recommend a level. Choose “Unsure” if you cannot tell.
            </Text>
            {[
              {
                key: "immediateDanger",
                title: "Immediate danger",
                prompt: IMMEDIATE_QUESTION[type] || IMMEDIATE_QUESTION.other,
                options: [
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "unsure", label: "Unsure" },
                ],
              },
              {
                key: "vehicleSafety",
                title: "Vehicle safety",
                prompt: "If this involves a vehicle, can it be moved safely?",
                options: [
                  { value: "safe", label: "Yes, safe" },
                  { value: "unsafe", label: "No, stop" },
                  { value: "unsure", label: "Unsure" },
                  { value: "not_applicable", label: "Not applicable" },
                ],
              },
              {
                key: "tripImpact",
                title: "Trip impact",
                prompt: "How is the trip affected?",
                options: [
                  { value: "none", label: "Not affected" },
                  { value: "delayed", label: "Delayed" },
                  { value: "stopped", label: "Stopped" },
                ],
              },
              {
                key: "hazardToOthers",
                title: "People and traffic",
                prompt: RISK_QUESTION[type] || RISK_QUESTION.other,
                options: [
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "unsure", label: "Unsure" },
                  { value: "not_applicable", label: "Not applicable" },
                ],
              },
            ].map((question) => (
              <View key={question.key} style={styles.guidedQuestion}>
                <Text style={[styles.guidedQuestionTitle, { color: colors.onSurface }]}>{question.title}</Text>
                <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>{question.prompt}</Text>
                <View style={styles.answerGrid}>
                  {question.options.map((option) => {
                    const selected = severityAnswers[question.key] === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => updateSeverityAnswer(question.key, option.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={[
                          styles.answerOption,
                          {
                            backgroundColor: selected ? colors.primaryContainer : colors.surfaceContainerLow,
                            borderColor: selected ? colors.primary : colors.outlineVariant + "70",
                          },
                        ]}
                      >
                        <Text style={{ color: selected ? colors.onPrimaryContainer : colors.onSurface, fontFamily: fonts.bodySemiBold, fontSize: 13 }}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            {recommendation ? (
              <ClayCard style={[styles.recommendationCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + "70" }]}>
                <Text style={[styles.recommendationEyebrow, { color: colors.onSurfaceVariant }]}>RECOMMENDED SEVERITY</Text>
                <View style={styles.recommendationHeading}>
                  <Text style={[styles.recommendationLevel, { color: recommendation.severity === "Critical" ? colors.error : recommendation.severity === "Major" ? colors.warning : colors.primary }]}>
                    {recommendation.severity}
                  </Text>
                  {finalSeverity !== recommendation.severity && (
                    <Text style={[styles.overrideTag, { color: colors.onSurfaceVariant }]}>Your level: {finalSeverity} · driver override</Text>
                  )}
                </View>
                <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
                  {INCIDENT_SEVERITY_REASON_LABELS[recommendation.reasonCode]}
                </Text>
                <Text style={[styles.levelHelp, { color: colors.onSurface }]}>
                  {finalSeverity === recommendation.severity
                    ? LEVEL_HELP[recommendation.severity]
                    : "Your selected level: " + LEVEL_HELP[finalSeverity]}
                </Text>
                <Pressable
                  onPress={() => setShowSeverityChoices((visible) => !visible)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showSeverityChoices }}
                  style={styles.changeSeverityButton}
                >
                  <Text style={{ color: colors.primary, fontFamily: fonts.bodySemiBold, fontSize: 14 }}>
                    {showSeverityChoices ? "Keep recommendation" : "Change severity"}
                  </Text>
                </Pressable>
                {showSeverityChoices && (
                  <View style={styles.answerGrid}>
                    {SEVERITY_LEVELS.map((level) => {
                      const selected = finalSeverity === level;
                      return (
                        <Pressable
                          key={level}
                          onPress={() => {
                            setSeverityOverride(level === recommendation.severity ? null : level);
                            setOverrideReason(null);
                            setLowerCriticalConfirmed(false);
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          style={[
                            styles.answerOption,
                            {
                              backgroundColor: selected ? colors.primaryContainer : colors.surface,
                              borderColor: selected ? colors.primary : colors.outlineVariant + "70",
                            },
                          ]}
                        >
                          <Text style={{ color: selected ? colors.onPrimaryContainer : colors.onSurface, fontFamily: fonts.bodySemiBold, fontSize: 13 }}>
                            {level}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {severityOverride && severityOverride !== recommendation.severity && (
                  <View style={styles.overrideSection}>
                    <Text style={[styles.guidedQuestionTitle, { color: colors.onSurface }]}>Why did you change it?</Text>
                    {OVERRIDE_REASONS.map((reason) => {
                      const selected = overrideReason === reason.value;
                      return (
                        <Pressable
                          key={reason.value}
                          onPress={() => setOverrideReason(reason.value)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          style={styles.overrideReason}
                        >
                          <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={19} color={selected ? colors.primary : colors.onSurfaceVariant} />
                          <Text style={{ color: colors.onSurface, fontFamily: fonts.body, fontSize: 13, flex: 1 }}>{reason.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {recommendation.severity === "Critical" && finalSeverity !== "Critical" && (
                  <Pressable
                    onPress={() => setLowerCriticalConfirmed((confirmed) => !confirmed)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: lowerCriticalConfirmed }}
                    style={styles.lowerCriticalCheck}
                  >
                    <Ionicons name={lowerCriticalConfirmed ? "checkbox" : "square-outline"} size={20} color={lowerCriticalConfirmed ? colors.primary : colors.onSurfaceVariant} />
                    <Text style={{ color: colors.onSurface, fontFamily: fonts.body, fontSize: 13, flex: 1 }}>
                      I rechecked: nobody is in immediate danger right now.
                    </Text>
                  </Pressable>
                )}
                {((vehicleId && (finalSeverity === "Major" || finalSeverity === "Critical")) || type === "breakdown") && (
                  <Text style={[styles.operationalNote, { color: colors.onSurfaceVariant }]}>
                    {type === "breakdown"
                      ? "A breakdown report may pause the vehicle for maintenance."
                      : "Fleet may keep the assigned vehicle out of service while safety is checked."}
                  </Text>
                )}
              </ClayCard>
            ) : (
              <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
                Answer all four questions to see the recommendation.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Severity guidance</Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>Choose an incident category to answer a few safety questions and get a recommendation.</Text>
          </View>
        )}

        {/* Location (Auto) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Live Location
          </Text>
          <ClayCard style={[styles.locationCard, { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <ClayTile icon="location" size={38} />
            <Text style={{ flex: 1, color: colors.onSurfaceVariant, fontSize: 13, fontFamily: fonts.body, lineHeight: 18 }}>
              Your coordinates are included when location permission and a GPS fix are available.
            </Text>
          </ClayCard>
        </View>

        {/* Description & Assistance */}
        <CoachMarkTarget id="incident.details" targetId="incident.details" scrollRef={scrollRef} radius={16} padding={8}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
              Incident Details
            </Text>
            <TextInput
              style={[
                styles.textarea,
                { borderColor: colors.outlineVariant + '50', color: colors.onSurface, backgroundColor: colors.surfaceContainerLow },
              ]}
              placeholder="Describe what happened, current situation, and any immediate needs..."
              placeholderTextColor={colors.outline}
              multiline
              numberOfLines={5}
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {/* Assistance Needed (optional) */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
              Assistance Needed
            </Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
              Optional — tell dispatch what help you need so they can send it with the response.
            </Text>
            <View style={styles.assistGrid}>
              {ASSISTANCE_OPTIONS.map((option) => {
                const selected = assistance.includes(option);
                return (
                  <Pressable
                    key={option}
                    onPress={() => toggleAssistance(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option} assistance${selected ? ", selected" : ""}`}
                    style={({ pressed }) => [
                      styles.assistChip,
                      raised,
                      {
                        backgroundColor: selected ? colors.primary : colors.surfaceContainerLow,
                        borderColor: selected ? colors.primary : 'transparent',
                        opacity: pressed ? 0.85 : 1,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                      },
                    ]}
                  >
                    <Ionicons
                      name={selected ? "checkmark" : "add"}
                      size={14}
                      color={selected ? colors.onPrimary : colors.onSurfaceVariant}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.assistChipText,
                        { color: selected ? colors.onPrimary : colors.onSurface },
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </CoachMarkTarget>

        {/* Expense (optional) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Expense Incurred
          </Text>
          <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
            Optional — money you already spent because of this incident (e.g., towing, tire repair). Fleet staff review it before booking any cost.
          </Text>
          <View style={[styles.expenseRow, { borderColor: colors.outlineVariant + '50', backgroundColor: colors.surfaceContainerLow }]}>
            <Text style={[styles.expensePrefix, { color: colors.onSurfaceVariant }]}>₱</Text>
            <TextInput
              style={[styles.expenseInput, { color: colors.onSurface }]}
              placeholder="0.00"
              placeholderTextColor={colors.outline}
              keyboardType="decimal-pad"
              value={expense}
              onChangeText={setExpense}
              accessibilityLabel="Expense amount in Philippine pesos"
            />
          </View>
        </View>
      
        {/* Photo Evidence */}
        <CoachMarkTarget id="incident.photos" targetId="incident.photos" scrollRef={scrollRef} radius={16} padding={6}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
              Photo Evidence (Optional)
            </Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
              Attach up to 3 photos of the damage or incident scene.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
              {photos.map((photo, index) => (
                <View key={index} style={{ position: 'relative' }}>
                  <Image source={{ uri: photo.uri }} style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: colors.surfaceContainerHighest }} />
                  <Pressable onPress={() => removePhoto(index)} style={{ position: 'absolute', top: -8, right: -8, backgroundColor: colors.error, borderRadius: 12, padding: 4, zIndex: 10 }}>
                    <Ionicons name="close" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ))}
              {photos.length < 3 && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => pickImage(true)} style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: colors.surfaceContainerLow, borderWidth: 1, borderColor: colors.outlineVariant + '50', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="camera-outline" size={32} color={colors.onSurfaceVariant} />
                    <Text style={{ fontSize: 10, color: colors.onSurfaceVariant, marginTop: 4 }}>Camera</Text>
                  </Pressable>
                  <Pressable onPress={() => pickImage(false)} style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: colors.surfaceContainerLow, borderWidth: 1, borderColor: colors.outlineVariant + '50', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="image-outline" size={32} color={colors.onSurfaceVariant} />
                    <Text style={{ fontSize: 10, color: colors.onSurfaceVariant, marginTop: 4 }}>Gallery</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </CoachMarkTarget>

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
        <CoachMarkTarget id="incident.submit" targetId="incident.submit" radius={16} padding={6}>
          <ClayButton
            label={uploadingPhotos ? "Uploading Photos..." : submitting ? "Submitting Report..." : "Send Incident Report"}
            variant="primary"
            size="lg"
            icon="send"
            iconPosition="right"
            disabled={submitting}
            loading={submitting || uploadingPhotos}
            onPress={handleSubmit}
          />
        </CoachMarkTarget>
      </View>

      <Modal
        visible={showCriticalConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowCriticalConfirm(false)}
      >
        <View accessibilityViewIsModal style={styles.confirmBackdrop}>
          <ClayCard
            style={[styles.confirmCard, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="warning" size={34} color={colors.error} />
            <Text style={[styles.confirmTitle, { color: colors.onSurface }]}>Send as Critical?</Text>
            <Text style={[styles.confirmCopy, { color: colors.onSurfaceVariant }]}>
              Critical marks this as an immediate emergency for dispatch. If someone needs help now, use SOS or call emergency services.
            </Text>
            <Text style={[styles.confirmBasis, { color: colors.onSurface }]}>
              Your answers: {INCIDENT_SEVERITY_REASON_LABELS[recommendation?.reasonCode]}
            </Text>
            <ClayButton
              label="Confirm and send Critical report"
              variant="danger"
              size="lg"
              onPress={() => {
                setShowCriticalConfirm(false);
                handleSubmit(true);
              }}
              style={{ width: "100%", marginTop: 8 }}
            />
            <Pressable
              onPress={() => setShowCriticalConfirm(false)}
              accessibilityRole="button"
              style={styles.reviewAnswersButton}
            >
              <Text style={{ color: colors.primary, fontFamily: fonts.bodySemiBold, fontSize: 14 }}>
                Review answers
              </Text>
            </Pressable>
          </ClayCard>
        </View>
      </Modal>

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
          <ClayCard style={{ width: '100%', maxWidth: 400, padding: 28, alignItems: 'center' }}>
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
  severityRow: { flexDirection: "row", gap: 10 },
  severityBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  severityText: { fontSize: 13, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.5 },
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
  tourSimulationCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: 16,
  },
  tourNextBtn: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
