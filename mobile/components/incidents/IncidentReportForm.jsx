import React from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts, TOUCH_TARGET } from '../../lib/theme';
import { moderateScale } from '../../lib/scaling';
import { raisedControl } from '../../lib/clay';
import { ClayCard, ClayTile, ClayButton } from '../clay';
import { CoachMarkTarget } from '../coachmarks';
import { INCIDENT_SEVERITY_REASON_LABELS } from '../../../shared/incidents/severity.js';

const INCIDENT_TYPES = [
  { id: "breakdown", label: "Vehicle Breakdown", icon: "car" },
  { id: "accident", label: "Traffic Accident", icon: "warning" },
  { id: "weather", label: "Severe Weather", icon: "thunderstorm" },
  { id: "cargo", label: "Cargo Issue", icon: "cube" },
  { id: "medical", label: "Medical Emergency", icon: "medkit" },
  { id: "other", label: "Other Incident", icon: "ellipsis-horizontal" },
];

// Structured help request sent as driverincidents.assistance_needed (text[]).
// Dispatch sees these as chips next to the report instead of parsing prose.
const ASSISTANCE_OPTIONS = [
  "Tow Truck",
  "Mechanic",
  "Medical Assistance",
  "Police",
  "Alternative Vehicle",
  "Fuel",
];

const SEVERITY_LEVELS = ["Minor", "Moderate", "Major", "Critical"];
const OVERRIDE_REASONS = [
  { value: "situation_changed", label: "The situation changed" },
  { value: "answers_missed_context", label: "I missed context in my answers" },
  { value: "driver_judgment", label: "My judgment is different" },
];
const LEVEL_HELP = {
  Minor: "No current danger or trip disruption was reported.",
  Moderate: "The trip is affected, but no immediate danger was reported.",
  Major: "Urgent review is needed because safety is unclear or a hazard was reported.",
  Critical: "You reported someone is in immediate danger.",
};
const IMMEDIATE_QUESTION = {
  breakdown: "Is anyone in immediate danger, including from a vehicle hazard in traffic?",
  accident: "Does anyone need emergency help or face an immediate danger now?",
  weather: "Does the weather create an immediate danger to people or traffic now?",
  cargo: "Does the cargo create an immediate danger to people or traffic right now?",
  medical: "Does anyone need emergency medical help right now?",
  other: "Is anyone in immediate danger right now?",
};
const RISK_QUESTION = {
  breakdown: "Does the vehicle create a hazard for people or traffic?",
  accident: "Is there still a hazard for people or traffic?",
  weather: "Is there a current hazard to other road users?",
  cargo: "Is there a current hazard to people or traffic?",
  medical: "Is anyone else or traffic at risk right now?",
  other: "Is anyone else or traffic at risk right now?",
};

export default function IncidentReportForm({ values, actions, scrollRef, styles: providedStyles, raised: providedRaised }) {
  const { type, severityAnswers, recommendation, finalSeverity, showSeverityChoices, severityOverride, overrideReason, lowerCriticalConfirmed, vehicleId, description, assistance, expense, photos } = values;
  const { onCategory, updateSeverityAnswer, setShowSeverityChoices, setSeverityOverride, setOverrideReason, setLowerCriticalConfirmed, setDescription, toggleAssistance, setExpense, removePhoto, pickImage } = actions;
  const { colors, scheme } = useTheme();
  const raised = providedRaised || raisedControl(scheme === 'dark');
  const styles = providedStyles || defaultStyles;
  return <>
        {/* Incident Type */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Incident Category
          </Text>
          <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
            Select the category that best describes the situation
          </Text>
          <CoachMarkTarget id="incident.category" targetId="incident.category" scrollRef={scrollRef}>
            <View style={styles.typeGrid}>
              {INCIDENT_TYPES.map((t) => {
                const selected = type === t.id;
                return (
                  <ClayCard
                    key={t.id}
                    onPress={() => onCategory(t.id)}
                    style={[
                      styles.typeCard,
                      selected && { backgroundColor: colors.primaryContainer, borderColor: colors.primary },
                    ]}
                  >
                    <ClayTile
                      icon={t.icon}
                      size={38}
                      style={{ backgroundColor: selected ? colors.primary + '20' : undefined }}
                    />
                    <Text
                      style={[
                        styles.typeCardText,
                        { color: selected ? colors.onPrimaryContainer : colors.onSurface },
                      ]}
                    >
                      {t.label}
                    </Text>
                  </ClayCard>
                );
              })}
            </View>
          </CoachMarkTarget>
        </View>

        {/* Guided severity questions */}
        {type ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Check the situation</Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
              Your answers recommend a level. Choose “Unsure” if you cannot tell.
            </Text>
            {[
              {
                key: "immediateDanger",
                title: "Immediate danger",
                prompt: IMMEDIATE_QUESTION[type] || IMMEDIATE_QUESTION.other,
                options: [
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "unsure", label: "Unsure" },
                ],
              },
              {
                key: "vehicleSafety",
                title: "Vehicle safety",
                prompt: "If this involves a vehicle, can it be moved safely?",
                options: [
                  { value: "safe", label: "Yes, safe" },
                  { value: "unsafe", label: "No, stop" },
                  { value: "unsure", label: "Unsure" },
                  { value: "not_applicable", label: "Not applicable" },
                ],
              },
              {
                key: "tripImpact",
                title: "Trip impact",
                prompt: "How is the trip affected?",
                options: [
                  { value: "none", label: "Not affected" },
                  { value: "delayed", label: "Delayed" },
                  { value: "stopped", label: "Stopped" },
                ],
              },
              {
                key: "hazardToOthers",
                title: "People and traffic",
                prompt: RISK_QUESTION[type] || RISK_QUESTION.other,
                options: [
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                  { value: "unsure", label: "Unsure" },
                  { value: "not_applicable", label: "Not applicable" },
                ],
              },
            ].map((question) => (
              <View key={question.key} style={styles.guidedQuestion}>
                <Text style={[styles.guidedQuestionTitle, { color: colors.onSurface }]}>{question.title}</Text>
                <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>{question.prompt}</Text>
                <View style={styles.answerGrid}>
                  {question.options.map((option) => {
                    const selected = severityAnswers[question.key] === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => updateSeverityAnswer(question.key, option.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={[
                          styles.answerOption,
                          {
                            backgroundColor: selected ? colors.primaryContainer : colors.surfaceContainerLow,
                            borderColor: selected ? colors.primary : colors.outlineVariant + "70",
                          },
                        ]}
                      >
                        <Text style={{ color: selected ? colors.onPrimaryContainer : colors.onSurface, fontFamily: fonts.bodySemiBold, fontSize: 13 }}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            {recommendation ? (
              <ClayCard style={[styles.recommendationCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + "70" }]}>
                <Text style={[styles.recommendationEyebrow, { color: colors.onSurfaceVariant }]}>RECOMMENDED SEVERITY</Text>
                <View style={styles.recommendationHeading}>
                  <Text style={[styles.recommendationLevel, { color: recommendation.severity === "Critical" ? colors.error : recommendation.severity === "Major" ? colors.warning : colors.primary }]}>
                    {recommendation.severity}
                  </Text>
                  {finalSeverity !== recommendation.severity && (
                    <Text style={[styles.overrideTag, { color: colors.onSurfaceVariant }]}>Your level: {finalSeverity} · driver override</Text>
                  )}
                </View>
                <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
                  {INCIDENT_SEVERITY_REASON_LABELS[recommendation.reasonCode]}
                </Text>
                <Text style={[styles.levelHelp, { color: colors.onSurface }]}>
                  {finalSeverity === recommendation.severity
                    ? LEVEL_HELP[recommendation.severity]
                    : "Your selected level: " + LEVEL_HELP[finalSeverity]}
                </Text>
                <Pressable
                  onPress={() => setShowSeverityChoices((visible) => !visible)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showSeverityChoices }}
                  style={styles.changeSeverityButton}
                >
                  <Text style={{ color: colors.primary, fontFamily: fonts.bodySemiBold, fontSize: 14 }}>
                    {showSeverityChoices ? "Keep recommendation" : "Change severity"}
                  </Text>
                </Pressable>
                {showSeverityChoices && (
                  <View style={styles.answerGrid}>
                    {SEVERITY_LEVELS.map((level) => {
                      const selected = finalSeverity === level;
                      return (
                        <Pressable
                          key={level}
                          onPress={() => {
                            setSeverityOverride(level === recommendation.severity ? null : level);
                            setOverrideReason(null);
                            setLowerCriticalConfirmed(false);
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          style={[
                            styles.answerOption,
                            {
                              backgroundColor: selected ? colors.primaryContainer : colors.surface,
                              borderColor: selected ? colors.primary : colors.outlineVariant + "70",
                            },
                          ]}
                        >
                          <Text style={{ color: selected ? colors.onPrimaryContainer : colors.onSurface, fontFamily: fonts.bodySemiBold, fontSize: 13 }}>
                            {level}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {severityOverride && severityOverride !== recommendation.severity && (
                  <View style={styles.overrideSection}>
                    <Text style={[styles.guidedQuestionTitle, { color: colors.onSurface }]}>Why did you change it?</Text>
                    {OVERRIDE_REASONS.map((reason) => {
                      const selected = overrideReason === reason.value;
                      return (
                        <Pressable
                          key={reason.value}
                          onPress={() => setOverrideReason(reason.value)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          style={styles.overrideReason}
                        >
                          <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={19} color={selected ? colors.primary : colors.onSurfaceVariant} />
                          <Text style={{ color: colors.onSurface, fontFamily: fonts.body, fontSize: 13, flex: 1 }}>{reason.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {recommendation.severity === "Critical" && finalSeverity !== "Critical" && (
                  <Pressable
                    onPress={() => setLowerCriticalConfirmed((confirmed) => !confirmed)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: lowerCriticalConfirmed }}
                    style={styles.lowerCriticalCheck}
                  >
                    <Ionicons name={lowerCriticalConfirmed ? "checkbox" : "square-outline"} size={20} color={lowerCriticalConfirmed ? colors.primary : colors.onSurfaceVariant} />
                    <Text style={{ color: colors.onSurface, fontFamily: fonts.body, fontSize: 13, flex: 1 }}>
                      I rechecked: nobody is in immediate danger right now.
                    </Text>
                  </Pressable>
                )}
                {((vehicleId && (finalSeverity === "Major" || finalSeverity === "Critical")) || type === "breakdown") && (
                  <Text style={[styles.operationalNote, { color: colors.onSurfaceVariant }]}>
                    {type === "breakdown"
                      ? "A breakdown report may pause the vehicle for maintenance."
                      : "Fleet may keep the assigned vehicle out of service while safety is checked."}
                  </Text>
                )}
              </ClayCard>
            ) : (
              <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
                Answer all four questions to see the recommendation.
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Severity guidance</Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>Choose an incident category to answer a few safety questions and get a recommendation.</Text>
          </View>
        )}

        {/* Location (Auto) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Live Location
          </Text>
          <ClayCard style={[styles.locationCard, { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <ClayTile icon="location" size={38} />
            <Text style={{ flex: 1, color: colors.onSurfaceVariant, fontSize: 13, fontFamily: fonts.body, lineHeight: 18 }}>
              Your coordinates are included when location permission and a GPS fix are available.
            </Text>
          </ClayCard>
        </View>

        {/* Description & Assistance */}
        <CoachMarkTarget id="incident.details" targetId="incident.details" scrollRef={scrollRef} radius={16} padding={8}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
              Incident Details
            </Text>
            <TextInput
              style={[
                styles.textarea,
                { borderColor: colors.outlineVariant + '50', color: colors.onSurface, backgroundColor: colors.surfaceContainerLow },
              ]}
              placeholder="Describe what happened, current situation, and any immediate needs..."
              placeholderTextColor={colors.outline}
              multiline
              numberOfLines={5}
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {/* Assistance Needed (optional) */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
              Assistance Needed
            </Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
              Optional — tell dispatch what help you need so they can send it with the response.
            </Text>
            <View style={styles.assistGrid}>
              {ASSISTANCE_OPTIONS.map((option) => {
                const selected = assistance.includes(option);
                return (
                  <Pressable
                    key={option}
                    onPress={() => toggleAssistance(option)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option} assistance${selected ? ", selected" : ""}`}
                    style={({ pressed }) => [
                      styles.assistChip,
                      raised,
                      {
                        backgroundColor: selected ? colors.primary : colors.surfaceContainerLow,
                        borderColor: selected ? colors.primary : 'transparent',
                        opacity: pressed ? 0.85 : 1,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                      },
                    ]}
                  >
                    <Ionicons
                      name={selected ? "checkmark" : "add"}
                      size={14}
                      color={selected ? colors.onPrimary : colors.onSurfaceVariant}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.assistChipText,
                        { color: selected ? colors.onPrimary : colors.onSurface },
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </CoachMarkTarget>

        {/* Expense (optional) */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
            Expense Incurred
          </Text>
          <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
            Optional — money you already spent because of this incident (e.g., towing, tire repair). Fleet staff review it before booking any cost.
          </Text>
          <View style={[styles.expenseRow, { borderColor: colors.outlineVariant + '50', backgroundColor: colors.surfaceContainerLow }]}>
            <Text style={[styles.expensePrefix, { color: colors.onSurfaceVariant }]}>₱</Text>
            <TextInput
              style={[styles.expenseInput, { color: colors.onSurface }]}
              placeholder="0.00"
              placeholderTextColor={colors.outline}
              keyboardType="decimal-pad"
              value={expense}
              onChangeText={setExpense}
              accessibilityLabel="Expense amount in Philippine pesos"
            />
          </View>
        </View>
      
        {/* Photo Evidence */}
        <CoachMarkTarget id="incident.photos" targetId="incident.photos" scrollRef={scrollRef} radius={16} padding={6}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>
              Photo Evidence (Optional)
            </Text>
            <Text style={[styles.sectionSub, { color: colors.onSurfaceVariant }]}>
              Attach up to 3 photos of the damage or incident scene.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
              {photos.map((photo, index) => (
                <View key={index} style={{ position: 'relative' }}>
                  <Image source={{ uri: photo.uri }} style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: colors.surfaceContainerHighest }} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove incident photo ${index + 1}`} onPress={() => removePhoto(index)} style={{ position: 'absolute', top: -8, right: -8, backgroundColor: colors.error, borderRadius: 24, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                    <Ionicons name="close" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ))}
              {photos.length < 3 && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => pickImage(true)} style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: colors.surfaceContainerLow, borderWidth: 1, borderColor: colors.outlineVariant + '50', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="camera-outline" size={32} color={colors.onSurfaceVariant} />
                    <Text style={{ fontSize: 10, color: colors.onSurfaceVariant, marginTop: 4 }}>Camera</Text>
                  </Pressable>
                  <Pressable onPress={() => pickImage(false)} style={{ width: 100, height: 100, borderRadius: 12, backgroundColor: colors.surfaceContainerLow, borderWidth: 1, borderColor: colors.outlineVariant + '50', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="image-outline" size={32} color={colors.onSurfaceVariant} />
                    <Text style={{ fontSize: 10, color: colors.onSurfaceVariant, marginTop: 4 }}>Gallery</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </CoachMarkTarget>


  </>;
}

export function IncidentSubmitButton({ onSubmit, submitting = false, uploadingPhotos = false }) {
  return (
        <CoachMarkTarget id="incident.submit" targetId="incident.submit" radius={16} padding={6}>
          <ClayButton
            label={uploadingPhotos ? "Uploading Photos..." : submitting ? "Submitting Report..." : "Send Incident Report"}
            variant="primary"
            size="lg"
            icon="send"
            iconPosition="right"
            disabled={submitting}
            loading={submitting || uploadingPhotos}
            onPress={onSubmit}
          />
        </CoachMarkTarget>
  );
}
const defaultStyles = StyleSheet.create({
answerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 },
answerOption: {
    minWidth: "47%",
    flexGrow: 1,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
  },
assistChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    minHeight: TOUCH_TARGET - 10,
  },
assistChipText: { fontSize: 12, fontFamily: fonts.bodySemiBold },
assistGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
changeSeverityButton: { alignSelf: "flex-start", minHeight: 42, justifyContent: "center", paddingRight: 12 },
expenseInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.body,
    paddingVertical: 12,
  },
expensePrefix: { fontSize: 16, fontFamily: fonts.bodySemiBold, marginRight: 6 },
expenseRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: TOUCH_TARGET,
  },
guidedQuestion: { gap: 7, marginTop: 8 },
guidedQuestionTitle: { fontSize: 14, fontFamily: fonts.bodySemiBold },
levelHelp: { fontSize: 13, fontFamily: fonts.body, lineHeight: 19 },
locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
lowerCriticalCheck: { flexDirection: "row", alignItems: "center", gap: 9, paddingTop: 8 },
operationalNote: { fontSize: 12, fontFamily: fonts.body, lineHeight: 17, paddingTop: 8 },
overrideReason: { flexDirection: "row", alignItems: "center", gap: 9, minHeight: 40 },
overrideSection: { gap: 4, marginTop: 4 },
overrideTag: { fontSize: 12, fontFamily: fonts.bodyMedium },
recommendationCard: { padding: 16, gap: 8, borderWidth: 1, borderRadius: 16 },
recommendationEyebrow: { fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 0.7 },
recommendationHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 },
recommendationLevel: { fontSize: 23, fontFamily: fonts.displayBold },
section: { gap: 8 },
sectionSub: { fontSize: 13, fontFamily: fonts.body },
sectionTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold, letterSpacing: -0.2 },
textarea: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    fontFamily: fonts.body,
    minHeight: 110,
    textAlignVertical: "top",
  },
typeCard: {
    width: "48%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 8,
  },
typeCardText: { fontSize: 13, fontFamily: fonts.bodySemiBold, textAlign: "center" },
typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
