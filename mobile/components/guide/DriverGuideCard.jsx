import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts, TOUCH_TARGET } from '../../lib/theme';
import { ClayCard, ClayButton, ClayTile, ClayBadge } from '../clay';

export default function DriverGuideCard({ completedCount = 0, totalCount = 6, onPress, onDismiss }) {
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === 'dark';

  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isComplete = completedCount === totalCount && totalCount > 0;

  return (
    <ClayCard variant="standard" style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.leftGroup}>
          <ClayTile icon={isComplete ? "ribbon" : "school"} size={42} variant="primary" />
          <View style={styles.textGroup}>
            <View style={styles.badgeRow}>
              <ClayBadge variant={isComplete ? "primary" : "neutral"} label={isComplete ? "Certified" : "Readiness Training"} />
              <Text style={[styles.percentText, { color: colors.primary }]}>{percent}%</Text>
            </View>
            <Text style={[styles.title, { color: colors.onSurface }]}>Driver Academy Guide</Text>
          </View>
        </View>

        {onDismiss && (
          <Pressable onPress={onDismiss} hitSlop={10} style={styles.dismissBtn} accessibilityRole="button" accessibilityLabel="Dismiss guide banner">
            <Ionicons name="close" size={18} color={colors.onSurfaceVariant} />
          </Pressable>
        )}
      </View>

      <Text style={[styles.description, { color: colors.onSurfaceVariant }]}>
        {isComplete
          ? "All 6 interactive missions completed! You are fully trained on FleetOps protocols."
          : `Interactive walkthrough: ${completedCount} of ${totalCount} missions complete. Practice gestures and emergency protocols.`}
      </Text>

      {/* Progress Track */}
      <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
        <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: colors.primary }]} />
      </View>

      <View style={styles.actionRow}>
        <Text style={[styles.actionPrompt, { color: colors.onSurfaceVariant }]}>
          {isComplete ? "Review modules anytime" : "Hands-on simulation"}
        </Text>
        <ClayButton
          variant={isComplete ? "standard" : "primary"}
          label={isComplete ? "View Academy" : completedCount > 0 ? "Continue" : "Start Guide"}
          onPress={onPress}
          style={styles.actionBtn}
        />
      </View>
    </ClayCard>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 22,
    gap: 12,
    marginVertical: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  textGroup: {
    flex: 1,
    gap: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  percentText: {
    fontSize: 12,
    fontFamily: fonts.dataSemiBold,
  },
  title: {
    fontSize: 15,
    fontFamily: fonts.displayBold,
  },
  dismissBtn: {
    padding: 4,
  },
  description: {
    fontSize: 13,
    fontFamily: fonts.body,
    lineHeight: 18,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  actionPrompt: {
    fontSize: 12,
    fontFamily: fonts.body,
  },
  actionBtn: {
    minWidth: 110,
  },
});
