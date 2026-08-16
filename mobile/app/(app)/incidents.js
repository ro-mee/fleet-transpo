import { moderateScale } from '../../lib/scaling';
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform,  } from 'react-native';
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Location from 'expo-location';
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
      AppAlert.alert("Missing Type", "Please select an incident type.");
      return;
    }
    if (!description.trim()) {
      AppAlert.alert("Required", "Please describe the incident.");
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
      AppAlert.alert("Error", e.message || "Could not submit report.");
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
            {submitting ? "Sending Alert..." : "Send Emergency Report"}
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
          <Text style={{ fontFamily: fonts.displayBold, fontSize: 24, color: colors.onSurface, letterSpacing: -0.4, marginBottom: 12, textAlign: 'center' }}>Help is on the way</Text>
          <Text style={{ fontFamily: fonts.body, fontSize: 15, color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: 32, lineHeight: 22 }}>
            Dispatch has received your exact coordinates and incident report. Please prioritize safety and await instructions.
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
