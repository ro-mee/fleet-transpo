import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Linking,
  LayoutAnimation,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { ClayCard, ClayTile } from "../../../components/clay";

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

function FAQItem({ item, colors, isLast, isDark }) {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <View style={!isLast && { borderBottomWidth: 1, borderBottomColor: isDark ? colors.outlineVariant + "55" : "transparent" }}>
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
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Help & Support" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>

        <View style={styles.heroBox}>
          <ClayTile icon="headset" size={56} variant="primary" style={{ marginBottom: 4 }} />
          <Text style={[styles.heroTitle, { color: colors.onSurface }]}>How can we help?</Text>
          <Text style={[styles.heroSub, { color: colors.onSurfaceVariant }]}>
            Contact dispatch directly or check our frequently asked questions.
          </Text>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>CONTACT</Text>
        <ClayCard variant="standard" style={styles.sectionCard}>
          <Pressable
            style={({ pressed }) => [styles.contactRow, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
            onPress={() => Linking.openURL('tel:18001234567')}
          >
            <View style={styles.contactRowLeft}>
              <ClayTile icon="call" size={38} variant="primary" />
              <View>
                <Text style={[styles.contactLabel, { color: colors.onSurface }]}>Dispatch Hotline</Text>
                <Text style={[styles.contactValue, { color: colors.onSurfaceVariant }]}>1-800-123-4567</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>

          <View style={[styles.divider, { backgroundColor: isDark ? colors.outlineVariant + "55" : "transparent" }]} />

          <Pressable
            style={({ pressed }) => [styles.contactRow, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
            onPress={() => Linking.openURL('mailto:support@fleetops.com')}
          >
            <View style={styles.contactRowLeft}>
              <ClayTile icon="mail" size={38} variant="primary" />
              <View>
                <Text style={[styles.contactLabel, { color: colors.onSurface }]}>Email Support</Text>
                <Text style={[styles.contactValue, { color: colors.onSurfaceVariant }]}>support@fleetops.com</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </ClayCard>

        <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>FAQ</Text>
        <ClayCard variant="standard" style={styles.sectionCard}>
          {FAQS.map((faq, index) => (
            <FAQItem
              key={index}
              item={faq}
              colors={colors}
              isDark={isDark}
              isLast={index === FAQS.length - 1}
            />
          ))}
        </ClayCard>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 14, gap: 24 },

  heroBox: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16 },
  heroTitle: { fontSize: 24, fontFamily: fonts.displayBold },
  heroSub: { fontSize: 14, fontFamily: fonts.body, textAlign: "center", paddingHorizontal: 32 },

  sectionTitle: {
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

  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, minHeight: TOUCH_TARGET },
  contactRowLeft: { flexDirection: "row", alignItems: "center", gap: 14, flexShrink: 1 },
  contactLabel: { fontSize: 16, fontFamily: fonts.bodyMedium },
  contactValue: { fontSize: 13, fontFamily: fonts.body },

  divider: { height: 1, marginHorizontal: 20 },

  faqRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, minHeight: TOUCH_TARGET },
  faqText: { fontSize: 14, fontFamily: fonts.bodyMedium, flex: 1, paddingRight: 12 },
  faqAnswerContainer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4 },
  faqAnswerText: { fontSize: 13, fontFamily: fonts.body, lineHeight: 20 },
});
