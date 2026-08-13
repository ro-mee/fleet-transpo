import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { api } from "../../../lib/api";

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh, borderBottomWidth: isLast ? 0 : 1 }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

export default function SafetySettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const me = await api.get("/api/driver/me");
      setProfile(me);
    } catch {
      Alert.alert("Error", "Could not load safety info.");
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

  const consent = profile?.consent;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.onSurface }]}>Safety Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          
          <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh }]}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>
              Data Privacy Consent
            </Text>
            <View style={[styles.consentBadge, { backgroundColor: consent?.accepted ? colors.secondaryContainer : colors.errorContainer }]}>
              <Ionicons
                name={consent?.accepted ? "checkmark-circle" : "close-circle"}
                size={14}
                color={consent?.accepted ? colors.onSecondaryContainer : colors.onErrorContainer}
              />
              <Text
                style={[styles.consentText, { color: consent?.accepted ? colors.onSecondaryContainer : colors.onErrorContainer }]}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: fonts.displayBold },
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
  
  consentBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  consentText: { fontSize: 12, fontFamily: fonts.bodySemiBold },
  
  noteText: { fontSize: 12, fontFamily: fonts.body, textAlign: "center", lineHeight: 18, paddingHorizontal: 16 },
});
