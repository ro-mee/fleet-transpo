import React from 'react';
import { Modal, ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts } from '../../lib/theme';
import { INCIDENT_SEVERITY_REASON_LABELS } from '../../../shared/incidents/severity';
import { ClayCard, ClayButton } from '../clay';

export default function IncidentCriticalConfirmation({ visible, recommendation, onClose, onConfirm, practiceLabel = false, onExit, styles: providedStyles }) {
  const { colors, type } = useTheme();
  const styles = providedStyles || defaultStyles;
  return (      <Modal
        visible={visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <View accessibilityViewIsModal style={styles.confirmBackdrop}>
          <ClayCard
            style={[styles.confirmCard, { backgroundColor: colors.surface, maxHeight: "90%", padding: 0 }]}
          >
            <ScrollView contentContainerStyle={{ padding: 24, alignItems: "center", gap: 12 }}>
            {practiceLabel ? <Text accessibilityRole="alert" style={type.bodyMd}>Practice mode - Sample data. Nothing will be sent.</Text> : null}
            {practiceLabel ? <ClayButton label="Exit practice" variant="tonal" onPress={onExit} /> : null}
            <Ionicons name="warning" size={34} color={colors.error} />
            <Text style={[styles.confirmTitle, { color: colors.onSurface }]}>Send as Critical?</Text>
            <Text style={[styles.confirmCopy, { color: colors.onSurfaceVariant }]}>
              Critical marks this as an immediate emergency for dispatch. If someone needs help now, use SOS or call emergency services.
            </Text>
            <Text style={[styles.confirmBasis, { color: colors.onSurface }]}>
              Your answers: {INCIDENT_SEVERITY_REASON_LABELS[recommendation?.reasonCode]}
            </Text>
            <ClayButton
              label="Confirm and send Critical report"
              variant="danger"
              size="lg"
              onPress={onConfirm}
              style={{ width: "100%", marginTop: 8 }}
            />
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={styles.reviewAnswersButton}
            >
              <Text style={{ color: colors.primary, fontFamily: fonts.bodySemiBold, fontSize: 14 }}>
                Review answers
              </Text>
            </Pressable>
            </ScrollView>
          </ClayCard>
        </View>
      </Modal>);
}
const defaultStyles = StyleSheet.create({
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  confirmCard: { width: "100%", maxWidth: 420, padding: 24, alignItems: "center", gap: 12 },
  confirmTitle: { fontSize: 21, fontFamily: fonts.displayBold, textAlign: "center" },
  confirmCopy: { fontSize: 14, fontFamily: fonts.body, lineHeight: 20, textAlign: "center" },
  confirmBasis: { fontSize: 13, fontFamily: fonts.bodySemiBold, lineHeight: 19, textAlign: "center" },
  reviewAnswersButton: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12 },
});
