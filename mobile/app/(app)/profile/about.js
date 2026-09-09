import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import ClayScreenHeader from "../../../components/ClayScreenHeader";
import { Logo } from "../../../components/logo";
import { clayShade, clayTile } from "../../../lib/clay";

// Currently configured support contacts — reused from the Help Center.
// TODO(production): verify these are the real hotline/email before release.
const SUPPORT_PHONE = "1-800-123-4567";
const SUPPORT_EMAIL = "support@fleetops.com";

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: colors.outlineVariant + "55", borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.outlineVariant + "55" }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

export default function AboutFleetOps() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  const sectionCard = [
    styles.sectionCard,
    clayShade,
    { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="About FleetOps" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>

        <View style={styles.brandBlock}>
          <Logo size={64} />
        </View>

        <View style={sectionCard}>
          <View style={styles.aboutBlock}>
            <Text style={[styles.aboutText, { color: colors.onSurfaceVariant }]}>
              FleetOps is the companion app for drivers of the organization. It shows your assigned trips with navigation, lets you report incidents, log fuel, complete pre-trip inspections, and keep track of your work schedule.
            </Text>
          </View>
          <InfoRow label="App Version" value={Constants.expoConfig?.version} colors={colors} isLast />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>SUPPORT</Text>
        <View style={sectionCard}>
          <Pressable
            style={({ pressed }) => [styles.contactRow, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
            onPress={() => Linking.openURL('tel:18001234567')}
          >
            <View style={styles.contactRowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="call" size={18} color={colors.onPrimaryContainer} />
              </View>
              <View>
                <Text style={[styles.contactLabel, { color: colors.onSurface }]}>Dispatch Hotline</Text>
                <Text style={[styles.contactValue, { color: colors.onSurfaceVariant }]}>{SUPPORT_PHONE}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>

          <View style={[styles.divider, { backgroundColor: colors.outlineVariant + "55" }]} />

          <Pressable
            style={({ pressed }) => [styles.contactRow, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          >
            <View style={styles.contactRowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="mail" size={18} color={colors.onPrimaryContainer} />
              </View>
              <View>
                <Text style={[styles.contactLabel, { color: colors.onSurface }]}>Email Support</Text>
                <Text style={[styles.contactValue, { color: colors.onSurfaceVariant }]}>{SUPPORT_EMAIL}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 14, gap: 24 },

  brandBlock: { alignItems: "center", paddingVertical: 16 },

  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.dataSemiBold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: -12,
    marginLeft: 8,
  },
  sectionCard: {
    borderRadius: 30,
    overflow: "hidden",
  },
  aboutBlock: { padding: 20 },
  aboutText: { fontSize: 14, fontFamily: fonts.body, lineHeight: 22 },
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

  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, minHeight: TOUCH_TARGET },
  contactRowLeft: { flexDirection: "row", alignItems: "center", gap: 14, flexShrink: 1 },
  iconTile: { width: 38, height: 38, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  contactLabel: { fontSize: 16, fontFamily: fonts.bodyMedium },
  contactValue: { fontSize: 13, fontFamily: fonts.body },
  divider: { height: 1, marginHorizontal: 20 },
});
