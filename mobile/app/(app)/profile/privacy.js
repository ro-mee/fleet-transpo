import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, LayoutAnimation } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { useDriverProfile } from "../../../lib/driver-profile";
import { AppAlert } from '../../../components/AppAlert';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { clayMaterials } from "../../../lib/clay";

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.outlineVariant + "55" }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

/** One policy section, expandable like the Help Center FAQ rows. */
function PolicySection({ heading, body, colors, type, isLast }) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <View style={!isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" }}>
      <Pressable style={styles.policyRow} onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded }}>
        <Text style={[styles.policyHeading, { color: colors.onSurface }]}>{heading}</Text>
        <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={16} color={colors.onSurfaceVariant} />
      </Pressable>
      {expanded && (
        <View style={styles.policyBody}>
          <Text style={[styles.policyBodyText, { color: colors.onSurfaceVariant }]}>{body}</Text>
        </View>
      )}
    </View>
  );
}

export default function PrivacyConsent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");

  // Cached /api/driver/me read — the policy text arrives with the consent
  // payload, so it is readable offline after one prior sync. Offline falls
  // back to the saved profile silently; the alert only fires when nothing
  // was ever saved.
  const { profile, loading } = useDriverProfile({
    onError: () => AppAlert.alert("Error", "Could not load your privacy & consent info."),
  });

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const consent = profile?.consent;
  const policy = consent?.policy;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Privacy & Consent" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.sectionCard, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>

          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>
              Data Privacy Consent
            </Text>
            <View
              style={[
                styles.consentBadge,
                mats.clayPill,
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

        {policy ? (
          <>
            <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
              PRIVACY POLICY & USER AGREEMENT
            </Text>
            <View style={[styles.sectionCard, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
              <View style={styles.policyMeta}>
                <Text style={[styles.policyTitle, { color: colors.onSurface }]}>{policy.title}</Text>
                <Text style={[styles.policyCaption, { color: colors.onSurfaceVariant }]}>
                  Version {policy.version} · Effective {new Date(policy.effectiveDate).toLocaleDateString()}
                </Text>
              </View>
              {policy.sections?.map((section, index) => (
                <PolicySection
                  key={section.heading}
                  heading={section.heading}
                  body={section.body}
                  colors={colors}
                  type={type}
                  isLast={index === policy.sections.length - 1}
                />
              ))}
            </View>
            <Text style={[styles.noteText, { color: colors.onSurfaceVariant }]}>
              Read-only record. If the policy changes, you will be asked to review and accept the new version the next time you sign in.
            </Text>
          </>
        ) : (
          <View style={[styles.sectionCard, mats.clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow, padding: 20 }]}>
            <Text style={[styles.policyTitle, { color: colors.onSurface }]}>Privacy policy not saved on this device</Text>
            <Text style={[styles.noteText, { color: colors.onSurfaceVariant, textAlign: "left", marginTop: 6 }]}>
              The policy is saved for offline reading after your profile syncs once. Connect to the internet and open your profile, then come back.
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

  policyMeta: { paddingHorizontal: 20, paddingVertical: 16, gap: 2 },
  policyTitle: { fontSize: 16, fontFamily: fonts.bodySemiBold },
  policyCaption: { fontSize: 12, fontFamily: fonts.body },
  policyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    paddingTop: 14,
    paddingBottom: 14,
    minHeight: TOUCH_TARGET,
  },
  policyHeading: { fontSize: 14, fontFamily: fonts.bodyMedium, flex: 1, paddingRight: 12 },
  policyBody: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 },
  policyBodyText: { fontSize: 13, fontFamily: fonts.body, lineHeight: 20 },

  noteText: { fontSize: 12, fontFamily: fonts.body, textAlign: "center", lineHeight: 18, paddingHorizontal: 16 },
});
