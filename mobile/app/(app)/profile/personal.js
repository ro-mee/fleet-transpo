import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { moderateScale } from "../../../lib/scaling";
import { apiFetch } from "../../../lib/api";
import { useDriverProfile } from "../../../lib/driver-profile";
import { AppAlert } from '../../../components/AppAlert';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import ClayMenuRow from '../../../components/ClayMenuRow';
import { ClayCard, ClayButton } from "../../../components/clay";
import { notify } from "../../../lib/notifications/notify";

function InfoRow({ label, value, colors, isLast = false, isDark = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: isDark ? colors.outlineVariant + "40" : "transparent" }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

export default function PersonalInformation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

  // Cached /api/driver/me read — offline falls back to the saved profile
  // silently instead of erroring (the phone PATCH below still needs a
  // connection and says so on failure).
  const { profile, loading, reload } = useDriverProfile({
    onError: () => AppAlert.alert("Unable to Load Profile", "Please check your network connection and pull down to retry."),
  });

  // Editable field: mirrors the profile's phone (cached or live) until the
  // driver types. Derived, not synced via effect.
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneEdited, setPhoneEdited] = useState(false);
  const phone = phoneEdited ? phoneInput : (profile?.phone ?? "");
  const setPhone = (v) => {
    setPhoneEdited(true);
    setPhoneInput(v);
  };
  const [editingPhone, setEditingPhone] = useState(false);
  const [saving, setSaving] = useState(false);

  const savePhone = async () => {
    if (!phone.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/api/driver/me", {
        method: "PATCH",
        body: JSON.stringify({ phone: phone.trim() }),
      });
      setEditingPhone(false);
      // Refresh cache + state so the new number survives offline, and let
      // the display mirror the reloaded profile again.
      await reload();
      setPhoneEdited(false);
      notify.toast({ message: "Phone number updated successfully.", tone: "success" });
    } catch (e) {
      AppAlert.alert("Unable to Save Phone Number", e.message || "Please check your input and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const driverName = profile?.firstName && profile?.lastName
    ? `${profile.firstName} ${profile.lastName}`
    : profile?.name || "Driver";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Personal Information" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <ClayCard variant="standard" style={styles.sectionCard}>
          <InfoRow label="Full Name" value={driverName} colors={colors} isDark={isDark} />
          <InfoRow label="Employee ID" value={profile?.employeeId} colors={colors} isDark={isDark} />
          <InfoRow label="Email" value={profile?.email} colors={colors} isDark={isDark} />

          {/* Editable Phone Row */}
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>Phone</Text>
            {editingPhone ? (
              <View style={styles.phoneEdit}>
                <TextInput
                  style={[styles.phoneInput, { backgroundColor: colors.surfaceContainerHigh, color: colors.onSurface }]}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="Phone number"
                  placeholderTextColor={colors.outline}
                />
                <ClayButton
                  icon="checkmark"
                  variant="primary"
                  size="sm"
                  loading={saving}
                  disabled={saving}
                  onPress={savePhone}
                  accessibilityLabel="Save phone number"
                  style={{ minWidth: 44, paddingHorizontal: 0 }}
                />
                <ClayButton
                  icon="close"
                  variant="tonal"
                  size="sm"
                  disabled={saving}
                  onPress={() => setEditingPhone(false)}
                  accessibilityLabel="Cancel phone number edit"
                  style={{ minWidth: 44, paddingHorizontal: 0 }}
                />
              </View>
            ) : (
              <Pressable style={styles.phoneRow} onPress={() => setEditingPhone(true)} accessibilityRole="button" accessibilityLabel="Edit phone number">
                <Text style={[styles.infoValue, { color: colors.onSurface }]}>
                  {phone || "—"}
                </Text>
                <Ionicons name="pencil-outline" size={16} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </ClayCard>

        {/* Hub: related compliance screens live inside Personal Information */}
        <ClayCard variant="standard" style={styles.sectionCard}>
          <ClayMenuRow
            title="License & Compliance"
            icon="card-outline"
            onPress={() => router.push("/profile/license")}
          />
          <ClayMenuRow
            title="Assigned Vehicle"
            icon="car-outline"
            onPress={() => router.push("/profile/vehicle")}
            isLast
          />
        </ClayCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 12, gap: 14 },

  sectionCard: {
    borderRadius: 24,
    paddingVertical: 4,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: moderateScale(9),
    borderBottomWidth: 1,
    minHeight: TOUCH_TARGET,
  },
  infoLabel: { fontSize: 14, fontFamily: fonts.body, flex: 1 },
  infoValue: { fontSize: 14, fontFamily: fonts.bodyMedium, textAlign: "right", flex: 1 },
  phoneEdit: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, justifyContent: "flex-end" },
  phoneInput: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    fontSize: 14,
    fontFamily: fonts.body,
    minHeight: 44,
    maxWidth: 180,
  },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" },
});
