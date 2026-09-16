import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts, TOUCH_TARGET } from '../../lib/theme';
import ClayScreenHeader from '../../components/ClayScreenHeader';
import { ClayCard, ClayButton, ClayBadge, ClayTile } from '../../components/clay';
import { AppAlert } from '../../components/AppAlert';
import { useAuth } from '../../lib/auth';
import { resolveDriverId } from '../../lib/offline-cache';
import {
  MISSIONS,
  getGuideProgress,
  markMissionComplete,
  resetGuideProgress,
  calculateProgress,
} from '../../lib/driver-guide';
import DriverGuideModal from '../../components/guide/DriverGuideModal';

export default function DriverGuideScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const driverId = resolveDriverId(user);
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === 'dark';

  const [completedMissions, setCompletedMissions] = useState([]);
  const [activeMission, setActiveMission] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const loadProgress = useCallback(async () => {
    const res = await getGuideProgress(driverId);
    setCompletedMissions(res.completedMissions);
  }, [driverId]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  const progress = calculateProgress(completedMissions);
  const nextMission = MISSIONS.find((m) => !completedMissions.includes(m.id));

  const handleLaunchMission = (mission) => {
    setActiveMission(mission);
    setModalVisible(true);
  };

  const handleMissionComplete = async (missionId) => {
    await markMissionComplete(missionId, driverId);
    const res = await getGuideProgress(driverId);
    setCompletedMissions(res.completedMissions);
    const updatedProg = calculateProgress(res.completedMissions);

    // If training remains incomplete, automatically advance to the next mission modal
    const currentIndex = MISSIONS.findIndex((m) => m.id === missionId);
    if (currentIndex >= 0 && currentIndex < MISSIONS.length - 1 && !updatedProg.isComplete) {
      const nextM = MISSIONS[currentIndex + 1];
      setActiveMission(nextM);
      setModalVisible(true);
    }
  };

  const handleReset = () => {
    AppAlert.alert(
      'Reset Training Progress?',
      'This will clear your completed mission stamps so you can retake the full academy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Progress',
          style: 'destructive',
          onPress: async () => {
            await resetGuideProgress(driverId);
            await loadProgress();
          },
        },
      ],
      { type: 'warning' }
    );
  };

  const handleBack = () => {
    if (progress.isComplete) {
      router.back();
    } else {
      AppAlert.alert(
        'Training Required',
        'All drivers must complete the Driver Academy before accessing vehicle dispatches. Do you want to sign out?',
        [
          { text: 'Continue Training', style: 'cancel' },
          {
            text: 'Sign Out',
            style: 'destructive',
            onPress: () => signOut(),
          },
        ],
        { type: 'warning' }
      );
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader
        title={progress.isComplete ? "Driver Academy" : "Driver Academy (Required)"}
        onBack={handleBack}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 30 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Readiness Hero Card */}
        <ClayCard variant="standard" style={styles.heroCard}>
          <View style={styles.heroTop}>
            <ClayTile icon={progress.isComplete ? "ribbon" : "school"} size={52} variant="primary" />
            <View style={styles.heroInfo}>
              <ClayBadge
                variant={progress.isComplete ? "primary" : "neutral"}
                label={progress.isComplete ? "Certified Road-Ready" : "Readiness Training"}
              />
              <Text style={[styles.heroTitle, { color: colors.onSurface }]}>
                {progress.isComplete ? "FleetOps Certified Driver" : "In-App Interactive Guide"}
              </Text>
              <Text style={[styles.heroSub, { color: colors.onSurfaceVariant }]}>
                {progress.completedCount} of {progress.totalCount} interactive missions completed ({progress.percent}%)
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={[styles.progressBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
            <View style={[styles.progressFill, { width: `${progress.percent}%`, backgroundColor: colors.primary }]} />
          </View>

          {/* Prominent Action Button: Start/Continue or Dashboard */}
          {!progress.isComplete && nextMission ? (
            <ClayButton
              variant="primary"
              label={`Continue: Mission ${MISSIONS.indexOf(nextMission) + 1} (${nextMission.title})`}
              onPress={() => handleLaunchMission(nextMission)}
              style={{ width: '100%', marginTop: 4 }}
            />
          ) : progress.isComplete ? (
            <ClayButton
              variant="primary"
              label="Proceed to FleetOps Dashboard 🚀"
              onPress={() => router.replace('/(tabs)')}
              style={{ width: '100%', marginTop: 4 }}
            />
          ) : null}

          {progress.completedCount > 0 && (
            <View style={styles.resetRow}>
              <Pressable onPress={handleReset} style={styles.resetBtn} accessibilityRole="button" accessibilityLabel="Reset guide progress">
                <Ionicons name="refresh" size={14} color={colors.onSurfaceVariant} />
                <Text style={[styles.resetText, { color: colors.onSurfaceVariant }]}>Reset Progress</Text>
              </Pressable>
            </View>
          )}
        </ClayCard>

        {/* Mandatory Policy Warning Banner when not complete */}
        {!progress.isComplete && (
          <ClayCard variant="compact" style={styles.mandatoryCard}>
            <View style={styles.mandatoryRow}>
              <ClayTile icon="alert-circle" size={36} variant="primary" />
              <View style={styles.mandatoryTextGroup}>
                <Text style={[styles.mandatoryTitle, { color: colors.onSurface }]}>
                  Mandatory Driver Onboarding
                </Text>
                <Text style={[styles.mandatoryDesc, { color: colors.onSurfaceVariant }]}>
                  All drivers must complete all 6 interactive missions before vehicle dispatch and live trip controls are unlocked.
                </Text>
              </View>
            </View>
          </ClayCard>
        )}

        {/* Section Heading */}
        <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>TRAINING MISSIONS</Text>

        {/* Missions List */}
        <View style={styles.missionsList}>
          {MISSIONS.map((mission, index) => {
            const isDone = completedMissions.includes(mission.id);
            return (
              <ClayCard key={mission.id} variant="standard" style={styles.missionCard}>
                <View style={styles.missionCardTop}>
                  <ClayTile icon={mission.icon} size={42} variant={isDone ? "primary" : "neutral"} />
                  <View style={styles.missionCardInfo}>
                    <View style={styles.missionTagRow}>
                      <Text style={[styles.missionNumber, { color: colors.primary }]}>MISSION {index + 1}</Text>
                      <Text style={[styles.missionDuration, { color: colors.onSurfaceVariant }]}>
                        {mission.durationMinutes} min
                      </Text>
                      {isDone && (
                        <View style={[styles.doneBadge, { backgroundColor: isDark ? 'rgba(21,72,58,0.3)' : '#E5EEE7' }]}>
                          <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
                          <Text style={[styles.doneText, { color: colors.primary }]}>Done</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.missionName, { color: colors.onSurface }]}>{mission.title}</Text>
                    <Text style={[styles.missionDesc, { color: colors.onSurfaceVariant }]}>{mission.description}</Text>
                  </View>
                </View>

                <View style={styles.missionCardBottom}>
                  <ClayButton
                    variant={isDone ? "standard" : "primary"}
                    label={isDone ? "Practice Again" : "Start Mission"}
                    onPress={() => handleLaunchMission(mission)}
                    style={{ width: '100%' }}
                  />
                </View>
              </ClayCard>
            );
          })}
        </View>
      </ScrollView>

      {/* Active Mission Interactive Simulator Modal */}
      <DriverGuideModal
        visible={modalVisible}
        mission={activeMission}
        onClose={() => setModalVisible(false)}
        onComplete={handleMissionComplete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 16,
  },
  heroCard: {
    padding: 18,
    borderRadius: 24,
    gap: 14,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroInfo: {
    flex: 1,
    gap: 3,
  },
  heroTitle: {
    fontSize: 16,
    fontFamily: fonts.displayBold,
    marginTop: 2,
  },
  heroSub: {
    fontSize: 12,
    fontFamily: fonts.body,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  resetRow: {
    alignItems: 'flex-end',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  resetText: {
    fontSize: 11,
    fontFamily: fonts.body,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: fonts.dataSemiBold,
    letterSpacing: 0.8,
    marginLeft: 6,
    marginBottom: -4,
  },
  missionsList: {
    gap: 14,
  },
  missionCard: {
    padding: 16,
    borderRadius: 22,
    gap: 14,
  },
  missionCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  missionCardInfo: {
    flex: 1,
    gap: 4,
  },
  missionTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  missionNumber: {
    fontSize: 11,
    fontFamily: fonts.dataSemiBold,
    letterSpacing: 0.6,
  },
  missionDuration: {
    fontSize: 11,
    fontFamily: fonts.body,
  },
  doneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 'auto',
  },
  doneText: {
    fontSize: 11,
    fontFamily: fonts.dataSemiBold,
  },
  missionName: {
    fontSize: 15,
    fontFamily: fonts.displayBold,
  },
  missionDesc: {
    fontSize: 13,
    fontFamily: fonts.body,
    lineHeight: 18,
  },
  missionCardBottom: {
    paddingTop: 4,
  },
  mandatoryCard: {
    padding: 14,
    borderRadius: 18,
  },
  mandatoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mandatoryTextGroup: {
    flex: 1,
    gap: 2,
  },
  mandatoryTitle: {
    fontSize: 14,
    fontFamily: fonts.displayBold,
  },
  mandatoryDesc: {
    fontSize: 12,
    fontFamily: fonts.body,
    lineHeight: 17,
  },
});
