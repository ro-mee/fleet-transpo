import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";

export default function HelpCenter() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.titleLg, styles.headerTitle, { color: colors.onSurface }]}>Help & Support</Text>
        <View style={{ width: TOUCH_TARGET }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        
        <View style={styles.heroBox}>
          <Ionicons name="headset" size={48} color={colors.primary} />
          <Text style={[styles.heroTitle, { color: colors.onSurface }]}>How can we help?</Text>
          <Text style={[styles.heroSub, { color: colors.onSurfaceVariant }]}>
            Contact dispatch directly or check our frequently asked questions.
          </Text>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.primary }]}>CONTACT</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <Pressable style={styles.contactRow} onPress={() => Linking.openURL('tel:18001234567')}>
            <View style={styles.contactRowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="call" size={18} color={colors.onSurfaceVariant} />
              </View>
              <View>
                <Text style={[styles.contactLabel, { color: colors.onSurface }]}>Dispatch Hotline</Text>
                <Text style={[styles.contactValue, { color: colors.onSurfaceVariant }]}>1-800-123-4567</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>

          <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />

          <Pressable style={styles.contactRow} onPress={() => Linking.openURL('mailto:support@fleetops.com')}>
            <View style={styles.contactRowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="mail" size={18} color={colors.onSurfaceVariant} />
              </View>
              <View>
                <Text style={[styles.contactLabel, { color: colors.onSurface }]}>Email Support</Text>
                <Text style={[styles.contactValue, { color: colors.onSurfaceVariant }]}>support@fleetops.com</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.primary, marginTop: 8 }]}>FAQ</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <Pressable style={styles.faqRow}>
            <Text style={[styles.faqText, { color: colors.onSurface }]}>What do I do in an emergency?</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
          <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
          <Pressable style={styles.faqRow}>
            <Text style={[styles.faqText, { color: colors.onSurface }]}>How do I report a vehicle issue?</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
          <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
          <Pressable style={styles.faqRow}>
            <Text style={[styles.faqText, { color: colors.onSurface }]}>I&apos;m running late for a dispatch.</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  
  heroBox: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16 },
  heroTitle: { fontSize: 24, fontFamily: fonts.displayBold },
  heroSub: { fontSize: 14, fontFamily: fonts.body, textAlign: "center", paddingHorizontal: 32 },

  sectionTitle: {
    fontSize: 12,
    fontFamily: fonts.displayBold,
    letterSpacing: 1,
    marginBottom: -16,
    marginLeft: 8,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  
  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  contactRowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  contactLabel: { fontSize: 16, fontFamily: fonts.bodyMedium },
  contactValue: { fontSize: 13, fontFamily: fonts.body },
  
  divider: { height: 1 },
  
  faqRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, minHeight: TOUCH_TARGET },
  faqText: { fontSize: 14, fontFamily: fonts.body, flex: 1 },
});
