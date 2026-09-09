import React from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Image } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET, statusColorForTone } from "../../../lib/theme";
import { useDriverProfile } from "../../../lib/driver-profile";
import { AppAlert } from '../../../components/AppAlert';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { clayShade } from "../../../lib/clay";

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.outlineVariant + "55" }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

export default function VehicleInformation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  // Cached /api/driver/me read — offline falls back to the saved profile
  // silently (the global offline banner is enough on Profile screens).
  // onError fires only when nothing was ever saved (never-synced).
  const { profile, loading } = useDriverProfile({
    onError: () => AppAlert.alert("Error", "Could not load vehicle info."),
  });

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
      <ClayScreenHeader title="Assigned Vehicle" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        {vehicle ? (
          <View style={[styles.sectionCard, clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
            {vehicle.imageUrl ? (
              <Image
                source={{ uri: vehicle.imageUrl }}
                style={styles.vehicleImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.vehicleImagePlaceholder, { backgroundColor: colors.surfaceContainerHigh }]}>
                <Ionicons name="car-sport" size={48} color={colors.onSurfaceVariant} />
              </View>
            )}
            <View style={styles.infoContainer}>
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
          </View>
        ) : (
          <View style={[styles.emptyBox, clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
            <View style={[styles.emptyTile, { backgroundColor: statusColorForTone(colors, "neutral").bg }]}>
              <Ionicons name="car-outline" size={24} color={statusColorForTone(colors, "neutral").fg} />
            </View>
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
    minHeight: TOUCH_TARGET,
  },
  infoLabel: { fontSize: 14, fontFamily: fonts.body, flex: 1 },
  infoValue: { fontSize: 14, fontFamily: fonts.bodyMedium, textAlign: "right", flex: 1 },

  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    borderRadius: 30,
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bodySemiBold, marginTop: 8 },
  emptyTile: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emptySubtitle: { fontSize: 14, fontFamily: fonts.body, textAlign: "center", lineHeight: 20 },

  vehicleImage: {
    width: "100%",
    height: 180,
    backgroundColor: "#E2E8F0",
  },
  vehicleImagePlaceholder: {
    width: "100%",
    height: 180,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  infoContainer: {
    paddingTop: 4,
  },
});
