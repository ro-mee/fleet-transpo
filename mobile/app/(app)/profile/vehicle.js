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

export default function VehicleInformation() {
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
      AppAlert.alert("Error", "Could not load vehicle info.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
  // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
  const t = setTimeout(load, 0);
  return () => clearTimeout(t);
}, [load]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const vehicle = profile?.assignedVehicle;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.titleLg, styles.headerTitle, { color: colors.onSurface }]}>Assigned Vehicle</Text>
        <View style={{ width: TOUCH_TARGET }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        {vehicle ? (
          <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
            <InfoRow label="Plate Number" value={vehicle.plateNumber} colors={colors} />
            <InfoRow label="Model" value={vehicle.model} colors={colors} />
            <InfoRow label="Name" value={vehicle.name} colors={colors} />
            <InfoRow label="Capacity" value={`${vehicle.seatingCapacity} Seats`} colors={colors} />
            <InfoRow label="Status" value={vehicle.vehicleStatus} colors={colors} />
            <InfoRow 
              label="Assigned Since" 
              value={vehicle.assignedFrom ? new Date(vehicle.assignedFrom).toLocaleDateString() : null} 
              colors={colors} 
              isLast={true}
            />
          </View>
        ) : (
          <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
            <Ionicons name="car-outline" size={48} color={colors.onSurfaceVariant} />
            <Text style={[type.titleLg, styles.emptyTitle, { color: colors.onSurface }]}>No vehicle assigned</Text>
            <Text style={[type.bodyMd, styles.emptySubtitle, { color: colors.onSurfaceVariant }]}>
              You do not have a vehicle actively assigned to you at this time.
            </Text>
          </View>
        )}
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
  
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bodySemiBold, marginTop: 8 },
  emptySubtitle: { fontSize: 14, fontFamily: fonts.body, textAlign: "center", lineHeight: 20 },
});
