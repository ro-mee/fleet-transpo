import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  ScrollView,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../lib/theme-context';
import { fonts, statusSurfaces } from '../../../lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LottieView from 'lottie-react-native';
import { AppAlert } from '../../../components/AppAlert';

export default function TripCompleteScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Route params
  const { pickup, destination, duration, distance, leg1, leg2, startOdo, endOdo } = useLocalSearchParams();

  // Animation values
  const [heroScale] = useState(() => new Animated.Value(0.4));
  const [heroOpacity] = useState(() => new Animated.Value(0));
  const [cardTranslateY] = useState(() => new Animated.Value(30));
  const [cardOpacity] = useState(() => new Animated.Value(0));
  const [actionsTranslateY] = useState(() => new Animated.Value(20));
  const [actionsOpacity] = useState(() => new Animated.Value(0));

  // Modals for Note & Issue
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savedNote, setSavedNote] = useState('');

  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [issueText, setIssueText] = useState('');
  const [reportedIssue, setReportedIssue] = useState('');

  useEffect(() => {
    // Choreographed staggered fluid entry
    Animated.sequence([
      Animated.parallel([
        Animated.spring(heroScale, {
          toValue: 1,
          friction: 6,
          tension: 70,
          useNativeDriver: true,
        }),
        Animated.timing(heroOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(cardTranslateY, {
          toValue: 0,
          friction: 7,
          tension: 65,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(actionsTranslateY, {
          toValue: 0,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.timing(actionsOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [heroScale, heroOpacity, cardTranslateY, cardOpacity, actionsTranslateY, actionsOpacity]);

  const timeStr = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateStr = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  const handleSaveNote = () => {
    setSavedNote(noteText.trim());
    setNoteModalVisible(false);
    AppAlert.alert('Note Saved', 'Your driver note has been attached to this trip record.');
  };

  const handleReportIssue = () => {
    setReportedIssue(issueText.trim());
    setIssueModalVisible(false);
    AppAlert.alert('Issue Logged', 'Your issue report has been submitted to fleet operations dispatch.');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(insets.top + 20, 36),
            paddingBottom: Math.max(insets.bottom + 24, 32),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Hero Section ─── */}
        <Animated.View
          style={[
            styles.heroSection,
            {
              opacity: heroOpacity,
              transform: [{ scale: heroScale }],
            },
          ]}
        >
          {/* Eyebrow badge */}
          <View style={[styles.eyebrowBadge, { backgroundColor: colors.primary + '14', borderColor: colors.primary + '30' }]}>
            <View style={[styles.pulseDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.eyebrowText, { color: colors.primary }]}>MISSION COMPLETE</Text>
          </View>

          {/* Title Row with Check Animation following after Trip Completed */}
          <View style={styles.titleRow}>
            <Text style={[styles.heroTitle, { color: colors.onBackground }]}>Trip Completed</Text>
            <LottieView
              source={require('../../../assets/Green tick.json')}
              autoPlay
              loop={false}
              style={styles.inlineLottieIcon}
            />
          </View>

          <Text style={[styles.heroSubtitle, { color: colors.onSurfaceVariant }]}>
            Flawless run. Trip telemetry and logs are synchronized.
          </Text>

          {/* Timestamp Pill */}
          <View style={[styles.timePill, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + '30' }]}>
            <Ionicons name="time-outline" size={13} color={colors.outline} />
            <Text style={[styles.timeText, { color: colors.onSurfaceVariant }]}>
              {dateStr} • {timeStr}
            </Text>
          </View>
        </Animated.View>

        {/* ─── Telemetry Double-Bezel Card ─── */}
        <Animated.View
          style={[
            styles.cardContainer,
            {
              opacity: cardOpacity,
              transform: [{ translateY: cardTranslateY }],
            },
          ]}
        >
          {/* Outer Shell */}
          <View style={[styles.cardOuterShell, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant + '35' }]}>
            <View style={styles.topGleam} />

            {/* Inner Core */}
            <View style={styles.cardInner}>

              {/* Waypoint Route Flow */}
              <View style={styles.routeBlock}>
                {/* Pickup Row */}
                <View style={styles.waypointRow}>
                  <View style={styles.waypointIndicatorCol}>
                    <View style={[styles.pickupDot, { backgroundColor: colors.primaryContainer, borderColor: colors.primary }]}>
                      <View style={[styles.pickupDotCore, { backgroundColor: colors.primary }]} />
                    </View>
                    <View style={[styles.routeConnectorLine, { borderColor: colors.outlineVariant }]} />
                  </View>
                  <View style={styles.waypointTextCol}>
                    <Text style={[styles.metaLabel, { color: colors.outline }]}>ORIGIN PICKUP</Text>
                    <Text style={[styles.waypointTitle, { color: colors.onSurface }]} numberOfLines={1}>
                      {pickup || 'Hotel Seda'}
                    </Text>
                  </View>
                </View>

                {/* Dropoff Row */}
                <View style={styles.waypointRow}>
                  <View style={styles.waypointIndicatorCol}>
                    <View style={[styles.destPinBadge, { backgroundColor: colors.secondaryContainer, borderColor: colors.secondary }]}>
                      <Ionicons name="location" size={12} color={colors.secondary} />
                    </View>
                  </View>
                  <View style={styles.waypointTextCol}>
                    <Text style={[styles.metaLabel, { color: colors.outline }]}>FINAL DESTINATION</Text>
                    <Text style={[styles.waypointTitle, { color: colors.onSurface }]} numberOfLines={1}>
                      {destination || 'NAIA Terminal 3'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Divider */}
              <View style={[styles.cardDivider, { backgroundColor: colors.outlineVariant + '35' }]} />

              {/* Key Metrics Bento Grid */}
              <View style={styles.bentoGrid}>
                {/* Duration */}
                <View style={[styles.bentoCell, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '25' }]}>
                  <View style={styles.bentoHeaderRow}>
                    <Ionicons name="timer-outline" size={14} color={colors.primary} />
                    <Text style={[styles.metaLabel, { color: colors.outline }]}>DURATION</Text>
                  </View>
                  <Text style={[styles.bentoValue, { color: colors.onSurface }]}>
                    {duration || '42 min'}
                  </Text>
                </View>

                {/* Total Distance */}
                <View style={[styles.bentoCell, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '25' }]}>
                  <View style={styles.bentoHeaderRow}>
                    <Ionicons name="speedometer-outline" size={14} color={colors.primary} />
                    <Text style={[styles.metaLabel, { color: colors.outline }]}>TOTAL DISTANCE</Text>
                  </View>
                  <Text style={[styles.bentoValue, { color: colors.onSurface }]}>
                    {distance || '11.4 km'}
                  </Text>
                </View>
              </View>

              {/* Legs Sub-Grid (if provided) */}
              {(leg1 != null || leg2 != null) && (
                <View style={[styles.legsGrid, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + '25' }]}>
                  <View style={styles.legItem}>
                    <Text style={[styles.metaMicroLabel, { color: colors.outline }]}>TO PICKUP</Text>
                    <Text style={[styles.legDataValue, { color: colors.onSurfaceVariant }]}>
                      {leg1 ?? '0.0'} <Text style={styles.unitText}>km</Text>
                    </Text>
                  </View>
                  <View style={[styles.verticalDivider, { backgroundColor: colors.outlineVariant + '40' }]} />
                  <View style={styles.legItem}>
                    <Text style={[styles.metaMicroLabel, { color: colors.outline }]}>TO DROP-OFF</Text>
                    <Text style={[styles.legDataValue, { color: colors.onSurfaceVariant }]}>
                      {leg2 ?? '0.0'} <Text style={styles.unitText}>km</Text>
                    </Text>
                  </View>
                </View>
              )}

              {/* Odometer Track */}
              <View style={[styles.odometerTrack, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant + '30' }]}>
                <View style={styles.odoLabelGroup}>
                  <Ionicons name="analytics-outline" size={14} color={colors.outline} />
                  <Text style={[styles.metaLabel, { color: colors.outline }]}>ODOMETER DISPATCH LOG</Text>
                </View>
                <View style={styles.odoReadingRow}>
                  <View style={styles.odoReadingBox}>
                    <Text style={[styles.odoSub, { color: colors.outline }]}>START</Text>
                    <Text style={[styles.odoNum, { color: colors.onSurface }]}>{startOdo || '45,820'}</Text>
                  </View>
                  <View style={styles.odoArrowBox}>
                    <Ionicons name="arrow-forward" size={14} color={colors.outline} />
                  </View>
                  <View style={styles.odoReadingBox}>
                    <Text style={[styles.odoSub, { color: colors.outline }]}>END</Text>
                    <Text style={[styles.odoNum, { color: colors.onSurface }]}>{endOdo || '45,831'}</Text>
                  </View>
                  <View style={styles.kmBadge}>
                    <Text style={[styles.kmBadgeText, { color: colors.outline }]}>KM</Text>
                  </View>
                </View>
              </View>

              {/* Dynamic Attached Notes / Issues */}
              {(savedNote || reportedIssue) ? (
                <View style={styles.attachedMetaBox}>
                  {savedNote ? (
                    <View style={[styles.attachedPill, { backgroundColor: colors.primaryContainer + '40', borderColor: colors.primary + '30' }]}>
                      <Ionicons name="document-text" size={13} color={colors.primary} />
                      <Text style={[styles.attachedText, { color: colors.onSurface }]} numberOfLines={1}>
                        Note: {savedNote}
                      </Text>
                    </View>
                  ) : null}
                  {reportedIssue ? (
                    <View style={[styles.attachedPill, { backgroundColor: colors.errorContainer + '40', borderColor: colors.error + '30' }]}>
                      <Ionicons name="alert-circle" size={13} color={colors.error} />
                      <Text style={[styles.attachedText, { color: colors.onErrorContainer }]} numberOfLines={1}>
                        Issue: {reportedIssue}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

            </View>
          </View>
        </Animated.View>

        {/* ─── Bottom Actions ─── */}
        <Animated.View
          style={[
            styles.actionsWrapper,
            {
              opacity: actionsOpacity,
              transform: [{ translateY: actionsTranslateY }],
            },
          ]}
        >
          {/* Secondary Action Double-Pill Row */}
          <View style={styles.secondaryActionsRow}>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryActionBtn,
                {
                  backgroundColor: pressed ? colors.surfaceVariant : colors.surfaceContainerLowest,
                  borderColor: colors.outlineVariant + '50',
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
              onPress={() => {
                setNoteText(savedNote);
                setNoteModalVisible(true);
              }}
            >
              <View style={[styles.btnIconWrapper, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="document-text-outline" size={16} color={colors.onSurface} />
              </View>
              <Text style={[styles.secondaryActionText, { color: colors.onSurface }]}>
                {savedNote ? 'Edit Note' : 'Add Note'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryActionBtn,
                {
                  backgroundColor: pressed ? colors.surfaceVariant : colors.surfaceContainerLowest,
                  borderColor: colors.outlineVariant + '50',
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
              onPress={() => {
                setIssueText(reportedIssue);
                setIssueModalVisible(true);
              }}
            >
              <View style={[styles.btnIconWrapper, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="warning-outline" size={16} color={colors.onSurface} />
              </View>
              <Text style={[styles.secondaryActionText, { color: colors.onSurface }]}>
                {reportedIssue ? 'Edit Issue' : 'Report Issue'}
              </Text>
            </Pressable>
          </View>

          {/* Primary High-Impact CTA (Island Button Architecture) */}
          <Pressable
            style={({ pressed }) => [
              styles.primaryDoneBtn,
              {
                backgroundColor: colors.primary,
                transform: [{ scale: pressed ? 0.985 : 1 }],
                shadowColor: colors.primary,
              },
            ]}
            onPress={() => router.replace('/(app)/(tabs)/map')}
          >
            <View style={styles.ctaGleam} />
            <Text style={[styles.primaryDoneText, { color: colors.onPrimary }]}>
              COMPLETE & RETURN
            </Text>
            <View style={[styles.trailingIconCircle, { backgroundColor: colors.onPrimary + '20' }]}>
              <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
            </View>
          </Pressable>
        </Animated.View>
      </ScrollView>

      {/* ─── Modal: Add Note ─── */}
      <Modal visible={noteModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + '40' }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="document-text" size={20} color={colors.primary} />
              <Text style={[styles.modalTitle, { color: colors.onSurface }]}>Attach Trip Note</Text>
            </View>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant + '40', color: colors.onSurface }]}
              placeholder="e.g. Passenger requested route change, traffic along Roxas Blvd..."
              placeholderTextColor={colors.outline}
              multiline
              numberOfLines={4}
              value={noteText}
              onChangeText={setNoteText}
            />
            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalCancelBtn, { borderColor: colors.outlineVariant + '50' }]}
                onPress={() => setNoteModalVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.outline }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSubmitBtn, { backgroundColor: colors.primary }]}
                onPress={handleSaveNote}
              >
                <Text style={[styles.modalBtnText, { color: colors.onPrimary }]}>Save Note</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ─── Modal: Report Issue ─── */}
      <Modal visible={issueModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant + '40' }]}>
            <View style={styles.modalHeader}>
              <Ionicons name="warning" size={20} color={colors.error} />
              <Text style={[styles.modalTitle, { color: colors.onSurface }]}>Report Trip Issue</Text>
            </View>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant + '40', color: colors.onSurface }]}
              placeholder="e.g. Flat tire warning, passenger no-show at pickup..."
              placeholderTextColor={colors.outline}
              multiline
              numberOfLines={4}
              value={issueText}
              onChangeText={setIssueText}
            />
            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.modalCancelBtn, { borderColor: colors.outlineVariant + '50' }]}
                onPress={() => setIssueModalVisible(false)}
              >
                <Text style={[styles.modalBtnText, { color: colors.outline }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSubmitBtn, { backgroundColor: colors.error }]}
                onPress={handleReportIssue}
              >
                <Text style={[styles.modalBtnText, { color: colors.onError }]}>Submit Issue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
  },

  // ─── Hero Section ───
  heroSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 6,
  },
  inlineLottieIcon: {
    width: 28,
    height: 28,
    marginTop: 1,
  },
  eyebrowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    gap: 6,
    marginBottom: 12,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  eyebrowText: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 10,
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
    marginBottom: 12,
  },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  timeText: {
    fontFamily: fonts.data,
    fontSize: 11,
    letterSpacing: 0.2,
  },

  // ─── Double-Bezel Card ───
  cardContainer: {
    marginBottom: 24,
  },
  cardOuterShell: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
      },
      android: {
        elevation: 6,
      },
    }),
    overflow: 'hidden',
  },
  topGleam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  cardInner: {
    padding: 20,
    borderRadius: 20,
    gap: 16,
  },

  // ─── Route Flow ───
  routeBlock: {
    gap: 12,
  },
  waypointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  waypointIndicatorCol: {
    alignItems: 'center',
    width: 20,
  },
  pickupDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupDotCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  routeConnectorLine: {
    width: 2,
    height: 24,
    borderStyle: 'dashed',
    borderLeftWidth: 1.5,
    marginTop: 3,
    marginBottom: -3,
  },
  destPinBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waypointTextCol: {
    flex: 1,
    gap: 2,
  },
  metaLabel: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  waypointTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
  },

  // ─── Divider ───
  cardDivider: {
    height: 1,
    width: '100%',
  },

  // ─── Bento Grid ───
  bentoGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  bentoCell: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  bentoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bentoValue: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 24,
  },

  // ─── Legs Grid ───
  legsGrid: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  legItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  verticalDivider: {
    width: 1,
    height: 24,
  },
  metaMicroLabel: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  legDataValue: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 14,
  },
  unitText: {
    fontFamily: fonts.body,
    fontSize: 11,
  },

  // ─── Odometer ───
  odometerTrack: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  odoLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  odoReadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  odoReadingBox: {
    gap: 2,
  },
  odoSub: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  odoNum: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 15,
    letterSpacing: 0.5,
  },
  odoArrowBox: {
    paddingHorizontal: 8,
  },
  kmBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  kmBadgeText: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 10,
  },

  // ─── Attached Metadata ───
  attachedMetaBox: {
    gap: 6,
  },
  attachedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  attachedText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    flex: 1,
  },

  // ─── Bottom Actions ───
  actionsWrapper: {
    gap: 12,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryActionBtn: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  btnIconWrapper: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
  },
  primaryDoneBtn: {
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 18,
      },
      android: {
        elevation: 8,
      },
    }),
    overflow: 'hidden',
  },
  ctaGleam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  primaryDoneText: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    letterSpacing: 0.8,
  },
  trailingIconCircle: {
    position: 'absolute',
    right: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ─── Modal Styles ───
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
  },
  modalSubmitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 20,
  },
  modalBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
  },
});

