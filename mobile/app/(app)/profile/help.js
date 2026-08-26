import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  LayoutAnimation,
  Platform,
  UIManager
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";

const FAQS = [
  {
    question: "What do I do in an emergency?",
    answer: "Prioritize your safety first. If driving, pull over to a safe location. Use the 'Report Incident' button on the home screen, select 'Critical' severity, and optionally request Police or Medical assistance. This immediately notifies dispatch."
  },
  {
    question: "How do I report a vehicle issue?",
    answer: "Navigate to the home screen and tap 'Report Incident'. Select the appropriate category (e.g., Vehicle Breakdown) and attach any relevant photos. You can also specify if you need a Mechanic or Tow Truck."
  },
  {
    question: "I'm running late for a dispatch.",
    answer: "Please call the Dispatch Hotline immediately using the contact button above. This allows our coordinators to quickly adjust schedules and notify waiting passengers or clients."
  }
];

function FAQItem({ item, colors, isLast }) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <View style={!isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }}>
      <Pressable style={styles.faqRow} onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded }}>
        <Text style={[styles.faqText, { color: colors.onSurface }]}>{item.question}</Text>
        <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={16} color={colors.onSurfaceVariant} />
      </Pressable>
      {expanded && (
        <View style={styles.faqAnswerContainer}>
          <Text style={[styles.faqAnswerText, { color: colors.onSurfaceVariant }]}>
            {item.answer}
          </Text>
        </View>
      )}
    </View>
  );
}

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
          {FAQS.map((faq, index) => (
            <FAQItem 
              key={index} 
              item={faq} 
              colors={colors} 
              isLast={index === FAQS.length - 1} 
            />
          ))}
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
  faqText: { fontSize: 14, fontFamily: fonts.bodyMedium, flex: 1, paddingRight: 12 },
  faqAnswerContainer: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4 },
  faqAnswerText: { fontSize: 13, fontFamily: fonts.body, lineHeight: 20 },
});
