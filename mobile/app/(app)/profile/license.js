import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { api } from "../../../lib/api";
import { AppAlert } from '../../../components/AppAlert';

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh, borderBottomWidth: isLast ? 0 : 1 }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

export default function LicenseInformation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const me = await api.get("/api/driver/me");
      setProfile(me);
    } catch {
      AppAlert.alert("Error", "Could not load license info.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const license = profile?.license;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.titleLg, styles.headerTitle, { color: colors.onSurface }]}>License & Compliance</Text>
        <View style={{ width: TOUCH_TARGET }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <InfoRow label="License Number" value={license?.number} colors={colors} />
          <InfoRow label="License Class" value={license?.class} colors={colors} />
          <InfoRow label="License Type" value={license?.type} colors={colors} />
          <InfoRow 
            label="Expiry Date" 
            value={license?.expiry ? new Date(license.expiry).toLocaleDateString() : null} 
            colors={colors} 
          />
          <InfoRow label="Years Experience" value={`${license?.yearsExperience || 0} Years`} colors={colors} isLast={true} />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant, padding: 16, gap: 16 }]}>
          <Text style={[type.label, styles.sectionHeading, { color: colors.primary }]}>Document Scans</Text>
          
          <View style={[styles.scanBox, { borderColor: colors.outlineVariant }]}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: colors.onSurface }]}>Front of License</Text>
              {license?.frontScanImageUrl ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : (
                <Ionicons name="alert-circle" size={20} color={colors.warning} />
              )}
            </View>
            <Pressable 
              style={[styles.uploadBtn, { backgroundColor: license?.canUploadFront ? colors.primary : colors.surfaceContainerHigh }]}
              disabled={!license?.canUploadFront}
            >
              <Text style={[styles.uploadBtnText, { color: license?.canUploadFront ? colors.onPrimary : colors.onSurfaceVariant }]}>
                {license?.frontScanImageUrl ? "Update Scan" : "Upload Scan"}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.scanBox, { borderColor: colors.outlineVariant }]}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: colors.onSurface }]}>Back of License</Text>
              {license?.backScanImageUrl ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : (
                <Ionicons name="alert-circle" size={20} color={colors.warning} />
              )}
            </View>
            <Pressable 
              style={[styles.uploadBtn, { backgroundColor: license?.canUploadBack ? colors.primary : colors.surfaceContainerHigh }]}
              disabled={!license?.canUploadBack}
            >
              <Text style={[styles.uploadBtnText, { color: license?.canUploadBack ? colors.onPrimary : colors.onSurfaceVariant }]}>
                {license?.backScanImageUrl ? "Update Scan" : "Upload Scan"}
              </Text>
            </Pressable>
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
    minHeight: TOUCH_TARGET,
  },
  infoLabel: { fontSize: 14, fontFamily: fonts.body, flex: 1 },
  infoValue: { fontSize: 14, fontFamily: fonts.bodyMedium, textAlign: "right", flex: 1 },

  sectionHeading: {},
  scanBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
  },
  scanHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  scanTitle: { fontSize: 14, fontFamily: fonts.bodyMedium },
  uploadBtn: {
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold },
});
