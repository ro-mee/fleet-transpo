import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { api, apiFetch } from "../../../lib/api";
import { useDriverProfile } from "../../../lib/driver-profile";
import { AppAlert } from '../../../components/AppAlert';
import { notify } from "../../../lib/notifications/notify";

function InfoRow({ label, value, colors }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh }]}>
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
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.titleLg, styles.headerTitle, { color: colors.onSurface }]}>Personal Information</Text>
        <View style={{ width: TOUCH_TARGET }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <InfoRow label="Full Name" value={driverName} colors={colors} />
          <InfoRow label="Employee ID" value={profile?.employeeId} colors={colors} />
          <InfoRow label="Email" value={profile?.email} colors={colors} />
          
          {/* Editable Phone Row */}
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>Phone</Text>
            {editingPhone ? (
              <View style={styles.phoneEdit}>
                <TextInput
                  style={[styles.phoneInput, { borderColor: colors.outline, color: colors.onSurface }]}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="Phone number"
                  placeholderTextColor={colors.outline}
                />
                <Pressable onPress={savePhone} disabled={saving}>
                  {saving ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
                  )}
                </Pressable>
                <Pressable onPress={() => setEditingPhone(false)}>
                  <Ionicons name="close-circle" size={24} color={colors.outline} />
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.phoneRow} onPress={() => setEditingPhone(true)}>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center" },
  scroll: { padding: 16, paddingTop: 24, gap: 24 },
  
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    minHeight: TOUCH_TARGET,
  },
  infoLabel: { fontSize: 14, fontFamily: fonts.body, flex: 1 },
  infoValue: { fontSize: 14, fontFamily: fonts.bodyMedium, textAlign: "right", flex: 1 },
  phoneEdit: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  phoneInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
    fontFamily: fonts.body,
    height: 36,
  },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" },
});
