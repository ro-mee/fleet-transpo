import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { apiFetch } from "../../../lib/api";
import { useDriverProfile } from "../../../lib/driver-profile";
import { AppAlert } from '../../../components/AppAlert';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { clayShade } from "../../../lib/clay";
import { notify } from "../../../lib/notifications/notify";

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.outlineVariant + "55" }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

export default function PersonalInformation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

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
        <View style={[styles.sectionCard, clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
          <InfoRow label="Full Name" value={driverName} colors={colors} />
          <InfoRow label="Employee ID" value={profile?.employeeId} colors={colors} />
          <InfoRow label="Email" value={profile?.email} colors={colors} />

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
                <Pressable
                  onPress={savePhone}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Save phone number"
                  style={({ pressed }) => [
                    styles.phoneAction,
                    clayShade,
                    { backgroundColor: colors.primary, shadowColor: colors.shadow, opacity: pressed || saving ? 0.75 : 1 },
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => setEditingPhone(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel phone number edit"
                  style={({ pressed }) => [
                    styles.phoneAction,
                    clayShade,
                    { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <Ionicons name="close" size={18} color={colors.onSurfaceVariant} />
                </Pressable>
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
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  root: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 14, gap: 24 },

  sectionCard: {
    borderRadius: 30,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
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
  phoneAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" },
});
