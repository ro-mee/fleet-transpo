import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  LayoutAnimation,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { ClayCard, ClayTile, ClayButton } from "../../../components/clay";
import { AppAlert } from "../../../components/AppAlert";
import DriverGuideLibrary from '../../../components/coachmarks/DriverGuideLibrary';
import { DRIVER_GUIDES_V2 } from '../../../lib/driver-guidance-config';
import { useCoachMarkActions } from "../../../components/coachmarks";

const FAQS = [
  {
    question: "What do I do in an emergency?",
    answer: "Prioritize your safety first. If driving, pull over to a safe location. Use SOS for an immediate emergency; it sends a direct Critical report. For other incidents, use Report Incident and answer the safety questions to get a severity recommendation. You can change the recommendation and give a reason. If someone needs emergency help now, call emergency services."
  },
  {
    question: "How do I report a vehicle issue?",
    answer: "Navigate to the home screen and tap 'Report Incident'. Select the appropriate category (e.g., Vehicle Breakdown) and attach any relevant photos. You can also specify if you need a Mechanic or Tow Truck."
  },
  {
    question: "I'm running late for a dispatch.",
    answer: "Contact your dispatcher using the contact details provided by your fleet manager. Tell them which assignment is delayed so they can adjust the schedule."
  }
];

function FAQItem({ item, colors, isLast, isDark }) {
  const { type } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <View style={!isLast && { borderBottomWidth: 1, borderBottomColor: isDark ? colors.outlineVariant + "55" : "transparent" }}>
      <Pressable style={styles.faqRow} onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded }}>
        <Text style={[styles.faqText, type.bodyMd, { color: colors.onSurface }]}>{item.question}</Text>
        <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={16} color={colors.onSurfaceVariant} />
      </Pressable>
      {expanded && (
        <View style={styles.faqAnswerContainer}>
          <Text style={[styles.faqAnswerText, type.supporting, { color: colors.onSurfaceVariant }]}>
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
  const { colors, scheme, type } = useTheme();
  const isDark = scheme === "dark";
  const { resetTips } = useCoachMarkActions();

  const handleResetTips = () => {
    AppAlert.alert(
      "Reset In-App Tips?",
      "Contextual coach marks and workflow tips will appear again as you use the app.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset Tips",
          onPress: async () => {
            const saved = await resetTips();
            AppAlert.alert(saved === false ? "Could not reset tips" : "In-App Tips Reset", saved === false ? "Please try again. Your operational records were not changed." : "Helpful tips will appear again as you use the app.");
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Help & Support" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>

        <View style={styles.heroBox}>
          <ClayTile icon="headset" size={56} variant="primary" style={{ marginBottom: 4 }} />
          <Text style={[styles.heroTitle, { color: colors.onSurface }]}>How can we help?</Text>
          <Text style={[styles.heroSub, type.supporting, { color: colors.onSurfaceVariant }]}>
            Check frequently asked questions and guidance for your work.
          </Text>
        </View>

        {DRIVER_GUIDES_V2 ? <DriverGuideLibrary /> : null}
        <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>IN-APP GUIDANCE</Text>
        <ClayCard variant="standard" style={styles.trainingCard}>
          <View style={styles.trainingTop}>
            <ClayTile icon="bulb" size={44} variant="primary" />
            <View style={styles.trainingInfo}>
              <Text style={[styles.trainingTitle, type.bodyMd, { color: colors.onSurface }]}>In-App Guidance Tips</Text>
              <Text style={[styles.trainingSub, type.supporting, { color: colors.onSurfaceVariant }]}>
                {DRIVER_GUIDES_V2 ? "Tips explain the controls on your current screen. Read a section again above, or reset tips to see them during your normal work." : "Tips explain controls as you use the app. Reset tips to see them again during your normal work."}
              </Text>
            </View>
          </View>
          <ClayButton
            variant="tonal"
            label="Reset In-App Tips"
            icon="refresh"
            onPress={handleResetTips}
            style={{ width: '100%', marginTop: 8 }}
          />
        </ClayCard>

        <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>CONTACT</Text>
        <ClayCard variant="standard" style={styles.sectionCard}>
          <View style={{ padding: 20, gap: 8 }}>
            <Text style={{ color: colors.onSurface }}>Support contact information is not configured.</Text>
            <Text style={{ color: colors.onSurfaceVariant }}>Ask your fleet manager for the correct dispatch contact. For an immediate emergency, use SOS or call emergency services.</Text>
          </View>
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

  trainingCard: {
    padding: 16,
    borderRadius: 24,
    gap: 12,
  },
  trainingTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  trainingInfo: {
    flex: 1,
    gap: 3,
  },
  trainingTitle: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
  },
  trainingSub: {
    fontSize: 13,
    fontFamily: fonts.body,
    lineHeight: 18,
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
