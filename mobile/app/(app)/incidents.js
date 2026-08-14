import { moderateScale } from '../../lib/scaling';
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Location from 'expo-location';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";

const INCIDENT_TYPES = [
  { id: "breakdown", label: "Vehicle Breakdown", icon: "car" },
  { id: "accident", label: "Traffic Accident", icon: "warning" },
  { id: "weather", label: "Severe Weather", icon: "thunderstorm" },
  { id: "cargo", label: "Cargo Issue", icon: "cube" },
  { id: "medical", label: "Medical Emergency", icon: "medkit" },
  { id: "other", label: "Other Incident", icon: "ellipsis-horizontal" },
];

export default function IncidentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tripId } = useLocalSearchParams();
  const { colors } = useTheme();

  const [type, setType] = useState(null);
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!type) {
      Alert.alert("Missing Type", "Please select an incident type.");
      return;
    }
    if (!description.trim()) {
      Alert.alert("Required", "Please describe the incident.");
      return;
    }
    try {
      setSubmitting(true);
      
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

      await api.post("/api/driver/incidents", {
        trip_id: tripId ? parseInt(tripId, 10) : null,
        incident_type: type,
        description,
        location: gpsLocation,
        latitude: lat,
        longitude: lng,
        severity,
        incident_date: new Date().toISOString(),
      });
      setShowSuccess(true);
    } catch (e) {
      Alert.alert("Error", e.message || "Could not submit report.");
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
        <Ionicons name="warning" size={24} color={colors.onErrorContainer} />
      </View>

      {/* Emergency Banner */}
      <View style={[styles.emergencyBanner, { backgroundColor: colors.error }]}>
        <Ionicons name="radio-outline" size={18} color={colors.onError} />
        <Text style={[styles.emergencyText, { color: colors.onError }]}>
          Dispatching alert to fleet coordinator immediately upon submission
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Incident Type */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Incident Type
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
                      borderColor: selected ? colors.error : colors.outlineVariant,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={t.icon}
                    size={24}
                    color={selected ? colors.onErrorContainer : colors.onSurfaceVariant}
                  />
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
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Severity</Text>
          <View style={styles.severityRow}>
            {["low", "medium", "high"].map((s) => {
              const selected = severity === s;
              const c =
                s === "low"
                  ? colors.secondary
                  : s === "medium"
                  ? colors.warning || "#D97706"
                  : colors.error;
              return (
                <Pressable
                  key={s}
                  onPress={() => setSeverity(s)}
                  style={[
                    styles.severityBtn,
                    {
                      backgroundColor: selected ? c : colors.surfaceContainerLow,
                      borderColor: selected ? c : colors.outlineVariant,
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
            Current Location
          </Text>
          <View style={[styles.input, { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLow, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }]}>
            <Ionicons name="location" size={20} color={colors.primary} />
            <Text style={{ flex: 1, color: colors.onSurfaceVariant, fontSize: 14, fontFamily: fonts.bodyMedium }}>
              Your live GPS coordinates will be automatically attached to this report for immediate dispatch tracking.
            </Text>
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Description
          </Text>
          <TextInput
            style={[
              styles.input,
              styles.textarea,
              { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLow },
            ]}
            placeholder="Describe what happened, current situation, and any immediate needs..."
            placeholderTextColor={colors.outline}
            multiline
            numberOfLines={5}
            value={description}
            onChangeText={setDescription}
          />
        </View>
      </ScrollView>

      {/* Submit Footer */}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.outlineVariant,
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
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          <Ionicons name="radio" size={20} color={colors.onError} />
          <Text style={[styles.submitBtnText, { color: colors.onError }]}>
            {submitting ? "Sending Alert..." : "Send Emergency Report"}
          </Text>
        </Pressable>
      </View>

      {/* Premium Success Overlay */}
      {showSuccess && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: 32 }]}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.errorContainer + '40', justifyContent: 'center', alignItems: 'center', marginBottom: 32 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.errorContainer, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="shield-checkmark" size={36} color={colors.onErrorContainer} />
            </View>
          </View>
          <Text style={{ fontFamily: fonts.titleLg, fontSize: 26, color: colors.onSurface, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' }}>Help is on the way.</Text>
          <Text style={{ fontFamily: fonts.bodyLg, fontSize: 16, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 40, lineHeight: 26 }}>
            Dispatch has received your exact coordinates and incident details. {"\n\n"}Please prioritize your safety and await further instructions.
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={({pressed}) => [{ backgroundColor: colors.primary, paddingHorizontal: 32, paddingVertical: 18, borderRadius: 100, width: '100%', alignItems: 'center', opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={{ fontFamily: fonts.bodyBold, fontSize: 16, color: colors.onPrimary }}>Return to Dashboard</Text>
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
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(12),
    gap: moderateScale(12),
    height: TOUCH_TARGET + 0,
  },
  closeBtn: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { flex: 1, fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  emergencyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(10),
  },
  emergencyText: { flex: 1, fontSize: moderateScale(13), fontFamily: fonts.body, lineHeight: moderateScale(18) },
  scroll: { paddingHorizontal: moderateScale(16), paddingTop: moderateScale(20), gap: moderateScale(24) },
  section: { gap: moderateScale(10) },
  sectionTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  sectionSub: { fontSize: moderateScale(14), fontFamily: fonts.body, lineHeight: moderateScale(20), marginTop: moderateScale(-4) },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: moderateScale(12) },
  typeCard: {
    width: "47%",
    borderRadius: moderateScale(12),
    borderWidth: 1,
    padding: moderateScale(16),
    alignItems: "center",
    gap: moderateScale(8),
    minHeight: TOUCH_TARGET,
  },
  typeCardText: { fontSize: moderateScale(13), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(18), textAlign: "center" },
  severityRow: { flexDirection: "row", gap: moderateScale(12) },
  severityBtn: {
    flex: 1,
    height: TOUCH_TARGET,
    borderRadius: moderateScale(8),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  severityText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(20) },
  input: {
    borderWidth: 1,
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(12),
    fontSize: moderateScale(16),
    fontFamily: fonts.body,
    lineHeight: moderateScale(24),
    minHeight: TOUCH_TARGET,
  },
  textarea: { minHeight: moderateScale(120), textAlignVertical: "top" },
  footer: {
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(12),
    borderTopWidth: 1,
  },
  submitBtn: {
    height: moderateScale(56),
    borderRadius: moderateScale(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  submitBtnText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(20) },
});
