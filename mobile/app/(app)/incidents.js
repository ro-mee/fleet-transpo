import { moderateScale } from '../../lib/scaling';
import { useState, useEffect as _unused } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform, Image,  } from 'react-native';
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { useEffect } from 'react';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";
import { AppAlert } from '../../components/AppAlert';

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

export default function IncidentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tripId } = useLocalSearchParams();
  const { colors } = useTheme();

  const [type, setType] = useState(null);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [assistance, setAssistance] = useState([]);
  const [expense, setExpense] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const [vehicleId, setVehicleId] = useState(null);
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [photos, setPhotos] = useState([]);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  
  useEffect(() => {
    async function loadData() {
      try {
        const me = await api.get("/api/mobile/driver/me");
        if (me.activeTrip?.vehicle_id) {
          setVehicleId(me.activeTrip.vehicle_id);
          setVehiclePlate(me.activeTrip.plate_number);
        } else if (me.recentTrip?.vehicle_id) {
          setVehicleId(me.recentTrip.vehicle_id);
          setVehiclePlate(me.recentTrip.plate_number);
        }
      } catch(e) { }
    }
    if (!tripId) {
      loadData();
    }
  }, [tripId]);

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
  const handleSubmit = async () => {
    if (!type) {
      AppAlert.alert("Incident Type Required", "Please select the category of the incident before submitting.");
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
        severity: ({ low: "Minor", medium: "Moderate", high: "Major", critical: "Critical" }[severity] || "Minor"),
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
          { backgroundColor: colors.errorContainer, paddingTop: insets.top },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onErrorContainer} />
        </Pressable>
        <Text style={[styles.topBarTitle, { color: colors.onErrorContainer }]}>
          Report Incident
        </Text>
        <Ionicons name="warning" size={22} color={colors.onErrorContainer} />
      </View>

      {/* Emergency Banner */}
      <View style={[styles.emergencyBanner, { backgroundColor: colors.error }]}>
        <Ionicons name="radio-outline" size={16} color={colors.onError} />
        <Text style={[styles.emergencyText, { color: colors.onError }]}>
          Fleet Coordinator will be notified immediately upon submission.
        </Text>
      </View>

      <ScrollView
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
            <View style={{ backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40', borderWidth: 1, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="car-outline" size={24} color={colors.primary} style={{ marginRight: 12 }} />
              <Text style={{ flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: 'bold' }}>{vehiclePlate}</Text>
            </View>
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
          <View style={styles.typeGrid}>
            {INCIDENT_TYPES.map((t) => {
              const selected = type === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setType(t.id)}
                  style={({ pressed }) => [
                    styles.typeCard,
                    {
                      backgroundColor: selected
                        ? colors.errorContainer
                        : colors.surfaceContainerLow,
                      borderColor: selected ? colors.error : colors.outlineVariant + '40',
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <View style={[styles.typeIconWrap, { backgroundColor: selected ? colors.error + '20' : colors.surfaceContainerHighest }]}>
                    <Ionicons
                      name={t.icon}
                      size={20}
                      color={selected ? colors.onErrorContainer : colors.onSurfaceVariant}
                    />
                  </View>
                  <Text
                    style={[
                      styles.typeCardText,
                      { color: selected ? colors.onErrorContainer : colors.onSurface },
                    ]}
                  >
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Severity */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Severity Level</Text>
          <View style={styles.severityRow}>
            {["low", "medium", "high", "critical"].map((s) => {
              const selected = severity === s;
              const c =
                s === "low"
                  ? colors.secondary
                  : s === "medium"
                  ? colors.warning
                  : colors.error;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSeverity(s)}
                  style={({ pressed }) => [
                    styles.severityBtn,
                    {
                      backgroundColor: selected ? c : colors.surfaceContainerLow,
                      borderColor: selected ? c : colors.outlineVariant + '40',
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
              <Text
                style={[
                  styles.severityText,
                  {
                    color: selected
                      ? "#FFFFFF"
                      : colors.onSurface,
                  },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {s.toUpperCase()}
              </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Location (Auto) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Live Location
          </Text>
          <View style={[styles.locationCard, { borderColor: colors.outlineVariant + '40', backgroundColor: colors.surfaceContainerLow }]}>
            <View style={[styles.locIconWrap, { backgroundColor: colors.primaryContainer }]}>
              <Ionicons name="location" size={18} color={colors.onPrimaryContainer} />
            </View>
            <Text style={{ flex: 1, color: colors.onSurfaceVariant, fontSize: 13, fontFamily: fonts.body, lineHeight: 18 }}>
              Your exact GPS coordinates are automatically tagged to this report for rapid response.
            </Text>
          </View>
        </View>

        {/* Description */}
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
                    {
                      backgroundColor: selected ? colors.primary : colors.surfaceContainerLow,
                      borderColor: selected ? colors.primary : colors.outlineVariant + '40',
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
        <Pressable
          onPress={handleSubmit}
          disabled={submitting}
          style={({ pressed }) => [
            styles.submitBtn,
            {
              backgroundColor: colors.error,
              transform: [{ scale: pressed ? 0.97 : 1 }],
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Text style={[styles.submitBtnText, { color: colors.onError }]}>
            {uploadingPhotos ? "Uploading Photos..." : submitting ? "Sending Alert..." : "Send Emergency Report"}
          </Text>
          <View style={[styles.btnIconCapsule, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <Ionicons name="radio" size={17} color={colors.onError} />
          </View>
        </Pressable>
      </View>

      {/* Success Overlay */}
      {showSuccess && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 24 }]}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.errorContainer + '40', justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}>
            <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.errorContainer, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="shield-checkmark" size={32} color={colors.onErrorContainer} />
            </View>
          </View>
          <Text style={{ fontFamily: fonts.displayBold, fontSize: 24, color: colors.onSurface, letterSpacing: -0.4, marginBottom: 12, textAlign: 'center' }}>
            {queuedOffline ? "Report saved offline" : "Report received"}
          </Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 15, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 32, lineHeight: 22 }}>
            {queuedOffline
              ? "You appear to be offline. Your report is saved on this device and will be sent automatically when you're back online — dispatch has NOT received it yet. Please prioritize safety and call for immediate help if needed."
              : "Dispatch has received your incident report. Please prioritize safety and await instructions."}
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={({pressed}) => [{ backgroundColor: colors.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, width: '100%', alignItems: 'center', opacity: pressed ? 0.9 : 1 }]}
          >
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.onPrimary }}>Return to Dashboard</Text>
          </Pressable>
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
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  typeCard: {
    width: "48%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 8,
  },
  typeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
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
  locIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
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
  submitBtn: {
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
  submitBtnText: {
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
});
