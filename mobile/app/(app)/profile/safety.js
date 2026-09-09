import React from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { useDriverProfile } from "../../../lib/driver-profile";
import { AppAlert } from '../../../components/AppAlert';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { clayShade, clayPill } from "../../../lib/clay";

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.outlineVariant + "55" }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

export default function SafetySettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  // Cached /api/driver/me read — offline falls back to the saved profile
  // silently; the alert only fires when nothing was ever saved.
  const { profile, loading } = useDriverProfile({
    onError: () => AppAlert.alert("Error", "Could not load safety info."),
  });

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const consent = profile?.consent;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Safety & Privacy" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.sectionCard, clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>
              Data Privacy Consent
            </Text>
            <View
              style={[
                styles.consentBadge,
                clayPill,
                {
                  backgroundColor: consent?.accepted ? colors.primaryContainer : colors.errorContainer,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <Ionicons
                name={consent?.accepted ? "checkmark-circle" : "close-circle"}
                size={14}
                color={consent?.accepted ? colors.onPrimaryContainer : colors.onErrorContainer}
              />
              <Text
                style={[styles.consentText, { color: consent?.accepted ? colors.onPrimaryContainer : colors.onErrorContainer }]}
              >
                {consent?.accepted ? "GIVEN" : "NOT GIVEN"}
              </Text>
            </View>
          </View>

          <InfoRow
            label="Date Accepted"
            value={consent?.acceptedAt ? new Date(consent.acceptedAt).toLocaleDateString() : null}
            colors={colors}
          />
          <InfoRow
            label="Policy Version"
            value={consent?.acceptedVersion ? `v${consent.acceptedVersion}` : null}
            colors={colors}
            isLast={true}
          />

        </View>

        <Text style={[styles.noteText, { color: colors.onSurfaceVariant }]}>
          Your data privacy consent covers GPS location tracking while on an active trip and essential telematics reporting. Contact dispatch to revoke consent or update your privacy preferences.
        </Text>
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

  consentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 2,
  },
  consentText: { fontSize: 12, fontFamily: fonts.bodySemiBold },

  noteText: { fontSize: 12, fontFamily: fonts.body, textAlign: "center", lineHeight: 18, paddingHorizontal: 16 },
});
