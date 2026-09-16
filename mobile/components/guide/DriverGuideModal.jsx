import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts, TOUCH_TARGET } from '../../lib/theme';
import { clayMaterials } from '../../lib/clay';
import { ClayCard, ClayButton, ClayBadge, ClayTile } from '../clay';
import SwipeButton from '../SwipeButton';
import RadarPulse from '../RadarPulse';

const MOCK_CHECKLIST = [
  { id: 'tires', label: 'Tire Pressure & Tread' },
  { id: 'brakes', label: 'Brake System Responsiveness' },
  { id: 'lights', label: 'Headlights & Turn Signals' },
  { id: 'cabin', label: 'Cabin Cleanliness & Sanitation' },
];

export default function DriverGuideModal({ visible, mission, onClose, onComplete }) {
  const insets = useSafeAreaInsets();
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const mats = clayMaterials(isDark);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [interactiveDone, setInteractiveDone] = useState(false);
  const [completedCelebration, setCompletedCelebration] = useState(false);

  // Interactive Checklist State
  const [checklistAnswers, setChecklistAnswers] = useState({});

  // Interactive Swipe State
  const [swipeTriggered, setSwipeTriggered] = useState(false);

  // Interactive SOS State
  const [sosModalOpen, setSosModalOpen] = useState(false);

  // Interactive Odometer State
  const [odoEnd, setOdoEnd] = useState('');
  const [odoConfirmed, setOdoConfirmed] = useState(false);

  // Interactive Override State
  const [selectedOverride, setSelectedOverride] = useState(null);

  // Interactive Fuel Scan State & Animation
  const [fuelScanning, setFuelScanning] = useState(false);
  const [fuelScanResult, setFuelScanResult] = useState(null);
  const scanAnim = useRef(new Animated.Value(0)).current;
  const scanLoopRef = useRef(null);

  // Interactive Offline State
  const [simOffline, setSimOffline] = useState(false);
  const [simQueued, setSimQueued] = useState(false);
  const [simSyncPhase, setSimSyncPhase] = useState('idle'); // idle | offline | queued | syncing | synced

  // Animate laser sweep smoothly while fuelScanning is active
  useEffect(() => {
    if (fuelScanning) {
      scanAnim.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(scanAnim, {
            toValue: 1,
            duration: 750,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scanAnim, {
            toValue: 0,
            duration: 750,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      scanLoopRef.current = loop;
      loop.start();
    } else {
      if (scanLoopRef.current) {
        scanLoopRef.current.stop();
        scanLoopRef.current = null;
      }
      scanAnim.setValue(0);
    }

    return () => {
      if (scanLoopRef.current) {
        scanLoopRef.current.stop();
        scanLoopRef.current = null;
      }
    };
  }, [fuelScanning, scanAnim]);

  // Reset state whenever a mission opens
  useEffect(() => {
    if (visible && mission) {
      setCurrentStepIndex(0);
      setInteractiveDone(false);
      setCompletedCelebration(false);
      setChecklistAnswers({});
      setSwipeTriggered(false);
      setSosModalOpen(false);
      setOdoEnd('');
      setOdoConfirmed(false);
      setSelectedOverride(null);
      setFuelScanning(false);
      setFuelScanResult(null);
      if (scanLoopRef.current) {
        scanLoopRef.current.stop();
        scanLoopRef.current = null;
      }
      scanAnim.setValue(0);
      setSimOffline(false);
      setSimQueued(false);
      setSimSyncPhase('idle');
    }
  }, [visible, mission, scanAnim]);

  const steps = mission?.steps || [];
  const currentStep = steps[currentStepIndex] || {};
  const isLastStep = currentStepIndex === steps.length - 1;

  // Track interactive requirement fulfillment
  useEffect(() => {
    if (!currentStep.type) {
      setInteractiveDone(true);
      return;
    }

    if (currentStep.type === 'interactive_checklist') {
      const answeredCount = Object.keys(checklistAnswers).length;
      setInteractiveDone(answeredCount >= MOCK_CHECKLIST.length);
    } else if (currentStep.type === 'interactive_swipe') {
      setInteractiveDone(swipeTriggered);
    } else if (currentStep.type === 'interactive_sos') {
      setInteractiveDone(sosModalOpen);
    } else if (currentStep.type === 'interactive_odometer') {
      setInteractiveDone(odoConfirmed);
    } else if (currentStep.type === 'interactive_override') {
      setInteractiveDone(Boolean(selectedOverride));
    } else if (currentStep.type === 'interactive_fuel_scan') {
      setInteractiveDone(Boolean(fuelScanResult));
    } else if (currentStep.type === 'interactive_offline_sync') {
      setInteractiveDone(simSyncPhase === 'synced');
    }
  }, [
    currentStep.type,
    checklistAnswers,
    swipeTriggered,
    sosModalOpen,
    odoConfirmed,
    selectedOverride,
    fuelScanResult,
    simSyncPhase,
  ]);

  const handleNext = () => {
    if (isLastStep) {
      setCompletedCelebration(true);
    } else {
      setCurrentStepIndex((prev) => prev + 1);
      setInteractiveDone(false);
      setSwipeTriggered(false);
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
      setInteractiveDone(false);
      setSwipeTriggered(false);
    }
  };

  const handleFinishMission = () => {
    if (mission?.id && onComplete) {
      onComplete(mission.id);
    }
    if (onClose) {
      onClose();
    }
  };

  if (!visible || !mission) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        
        {/* Top Navigation Bar */}
        <View style={styles.navBar}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close Guide" style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.onSurface} />
          </Pressable>
          <View style={styles.navCenter}>
            <ClayBadge variant="primary" label={mission.badge || 'Guide'} />
            <Text style={[type.label, { color: colors.onSurfaceVariant, marginTop: 2 }]}>
              {completedCelebration ? 'Completed' : `Step ${currentStepIndex + 1} of ${steps.length}`}
            </Text>
          </View>
          <View style={styles.placeholder} />
        </View>

        {/* Step Progress Dots */}
        {!completedCelebration && (
          <View style={styles.progressRow}>
            {steps.map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor:
                      idx === currentStepIndex
                        ? colors.primary
                        : idx < currentStepIndex
                        ? colors.primaryContainer
                        : isDark
                        ? 'rgba(255,255,255,0.1)'
                        : 'rgba(0,0,0,0.08)',
                    width: idx === currentStepIndex ? 24 : 8,
                  },
                ]}
              />
            ))}
          </View>
        )}

        {/* Main Content Area */}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {completedCelebration ? (
            /* Celebration Screen */
            <View style={styles.celebrationBox}>
              <View style={styles.badgePulseWrapper}>
                <RadarPulse active={true} size={140} color={colors.primary} />
                <ClayTile icon="checkmark-done" size={80} variant="primary" style={styles.celebrationTile} />
              </View>
              <Text style={[styles.celebrationTitle, { color: colors.onSurface }]}>Mission Accomplished!</Text>
              <Text style={[styles.celebrationSubtitle, { color: colors.onSurfaceVariant }]}>
                You've successfully mastered {mission.title}.
              </Text>

              <ClayCard variant="standard" style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <Ionicons name="ribbon" size={24} color={colors.primary} />
                  <View style={styles.summaryTextGroup}>
                    <Text style={[styles.summaryItemTitle, { color: colors.onSurface }]}>Training Validated</Text>
                    <Text style={[styles.summaryItemDesc, { color: colors.onSurfaceVariant }]}>
                      This module is marked complete on your driver profile.
                    </Text>
                  </View>
                </View>
              </ClayCard>
            </View>
          ) : (
            /* Step Content */
            <View style={styles.stepContainer}>
              <View style={styles.missionHeader}>
                <Text style={[styles.missionTitle, { color: colors.primary }]}>{mission.title}</Text>
                <Text style={[styles.stepTitle, { color: colors.onSurface }]}>{currentStep.title}</Text>
                <Text style={[styles.stepInstruction, { color: colors.onSurfaceVariant }]}>{currentStep.instruction}</Text>
              </View>

              {/* Pro Tip Box */}
              {currentStep.tip ? (
                <ClayCard variant="compact" style={styles.tipCard}>
                  <View style={styles.tipRow}>
                    <Ionicons name="bulb" size={20} color={colors.primary} />
                    <Text style={[styles.tipText, { color: colors.onSurfaceVariant }]}>
                      <Text style={{ fontFamily: fonts.bodyMedium, color: colors.onSurface }}>Pro-Tip: </Text>
                      {currentStep.tip}
                    </Text>
                  </View>
                </ClayCard>
              ) : null}

              {/* Interactive Area: Checklist */}
              {currentStep.type === 'interactive_checklist' && (
                <ClayCard variant="standard" style={styles.interactiveCard}>
                  <Text style={[styles.interactiveHeader, { color: colors.onSurface }]}>Interactive Inspection Simulator</Text>
                  <Text style={[styles.interactiveSub, { color: colors.onSurfaceVariant }]}>
                    Mark all 4 items to unlock the next step ({Object.keys(checklistAnswers).length}/4 completed):
                  </Text>
                  <View style={styles.checklistList}>
                    {MOCK_CHECKLIST.map((item) => {
                      const answer = checklistAnswers[item.id];
                      return (
                        <View key={item.id} style={styles.checkItemRow}>
                          <Text style={[styles.checkItemLabel, { color: colors.onSurface }]}>{item.label}</Text>
                          <View style={styles.toggleButtonsRow}>
                            <Pressable
                              style={[
                                styles.toggleBtn,
                                answer === 'PASS' && { backgroundColor: colors.primary, borderColor: colors.primary },
                              ]}
                              onPress={() => setChecklistAnswers((prev) => ({ ...prev, [item.id]: 'PASS' }))}
                            >
                              <Ionicons name="checkmark" size={16} color={answer === 'PASS' ? colors.onPrimary : colors.onSurfaceVariant} />
                              <Text style={[styles.toggleBtnText, { color: answer === 'PASS' ? colors.onPrimary : colors.onSurfaceVariant }]}>
                                PASS
                              </Text>
                            </Pressable>
                            <Pressable
                              style={[
                                styles.toggleBtn,
                                answer === 'FAIL' && { backgroundColor: colors.error, borderColor: colors.error },
                              ]}
                              onPress={() => setChecklistAnswers((prev) => ({ ...prev, [item.id]: 'FAIL' }))}
                            >
                              <Ionicons name="warning" size={16} color={answer === 'FAIL' ? '#FFFFFF' : colors.onSurfaceVariant} />
                              <Text style={[styles.toggleBtnText, { color: answer === 'FAIL' ? '#FFFFFF' : colors.onSurfaceVariant }]}>
                                FAIL
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ClayCard>
              )}

              {/* Interactive Area: Swipe Button */}
              {currentStep.type === 'interactive_swipe' && (
                <ClayCard variant="standard" style={styles.interactiveCard}>
                  <Text style={[styles.interactiveHeader, { color: colors.onSurface }]}>Swipe Gesture Simulator</Text>
                  <Text style={[styles.interactiveSub, { color: colors.onSurfaceVariant }]}>
                    Firmly slide the thumb circle to the right side of the track:
                  </Text>
                  <View style={styles.swipeWrapper}>
                    <SwipeButton
                      title={currentStep.swipeTitle || 'Slide to Practice'}
                      onSwipeSuccess={() => setSwipeTriggered(true)}
                    />
                  </View>
                  {swipeTriggered && (
                    <View style={styles.swipeSuccessBadge}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                      <Text style={[styles.swipeSuccessText, { color: colors.primary }]}>
                        {currentStep.successMessage || 'Action confirmed successfully!'}
                      </Text>
                    </View>
                  )}
                </ClayCard>
              )}

              {/* Interactive Area: SOS Trigger */}
              {currentStep.type === 'interactive_sos' && (
                <ClayCard variant="standard" style={styles.interactiveCard}>
                  <Text style={[styles.interactiveHeader, { color: colors.onSurface }]}>Emergency Command Simulator</Text>
                  <Text style={[styles.interactiveSub, { color: colors.onSurfaceVariant }]}>
                    Tap the floating SOS medallion to preview urgent hotline options:
                  </Text>
                  <View style={styles.sosCenterArea}>
                    <Pressable
                      style={styles.mockSosButton}
                      onPress={() => setSosModalOpen(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Open Emergency Menu"
                    >
                      <RadarPulse active={true} size={90} color="#D32F2F" />
                      <View style={styles.mockSosInner}>
                        <Ionicons name="alert" size={32} color="#FFFFFF" />
                        <Text style={styles.mockSosText}>SOS</Text>
                      </View>
                    </Pressable>
                  </View>

                  {sosModalOpen && (
                    <View style={styles.sosPreviewSheet}>
                      <Text style={[styles.sosSheetTitle, { color: colors.onSurface }]}>Simulated Dispatch Hotlines</Text>
                      <View style={styles.sosItemRow}>
                        <ClayTile icon="call" size={34} variant="primary" />
                        <View style={styles.sosItemInfo}>
                          <Text style={[styles.sosItemLabel, { color: colors.onSurface }]}>24/7 Operations Hotline</Text>
                          <Text style={[styles.sosItemSub, { color: colors.onSurfaceVariant }]}>Instant vehicle reassignment</Text>
                        </View>
                      </View>
                      <View style={styles.sosItemRow}>
                        <ClayTile icon="car" size={34} variant="primary" />
                        <View style={styles.sosItemInfo}>
                          <Text style={[styles.sosItemLabel, { color: colors.onSurface }]}>Tow Truck & Field Mechanic</Text>
                          <Text style={[styles.sosItemSub, { color: colors.onSurfaceVariant }]}>Flat tire, battery, or engine fault</Text>
                        </View>
                      </View>
                    </View>
                  )}
                </ClayCard>
              )}

              {/* Interactive Area: Odometer (Mission 3, Step 2) */}
              {currentStep.type === 'interactive_odometer' && (
                <ClayCard variant="standard" style={styles.interactiveCard}>
                  <Text style={[styles.interactiveHeader, { color: colors.onSurface }]}>Odometer & Mileage Simulator</Text>
                  <Text style={[styles.interactiveSub, { color: colors.onSurfaceVariant }]}>
                    Starting Odometer is 45,210 km. Select a test reading to compute distance:
                  </Text>

                  <View style={styles.odoCompareRow}>
                    <View style={[styles.odoBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6' }]}>
                      <Text style={[styles.odoBoxLabel, { color: colors.onSurfaceVariant }]}>START ODOMETER</Text>
                      <Text style={[styles.odoBoxVal, { color: colors.onSurface }]}>45,210 km</Text>
                    </View>
                    <Ionicons name="arrow-forward" size={18} color={colors.onSurfaceVariant} />
                    <View style={[styles.odoBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#F3F4F6' }]}>
                      <Text style={[styles.odoBoxLabel, { color: colors.onSurfaceVariant }]}>ENDING READING</Text>
                      <Text style={[styles.odoBoxVal, { color: odoEnd ? colors.primary : colors.onSurfaceVariant }]}>
                        {odoEnd ? `${odoEnd} km` : 'Select below'}
                      </Text>
                    </View>
                  </View>

                  <Text style={[styles.sectionSubtitle, { color: colors.onSurface }]}>Quick Test Values:</Text>
                  <View style={styles.odoQuickRow}>
                    {[
                      { label: '+18 km (Short City Trip)', val: 45228 },
                      { label: '+35 km (Standard Dispatch)', val: 45245 },
                      { label: '+72 km (Provincial Run)', val: 45282 },
                    ].map((opt) => (
                      <Pressable
                        key={opt.val}
                        style={[
                          styles.odoQuickBtn,
                          odoEnd === opt.val && { backgroundColor: isDark ? 'rgba(21,72,58,0.3)' : '#E5EEE7', borderColor: colors.primary },
                        ]}
                        onPress={() => {
                          setOdoEnd(opt.val);
                          setOdoConfirmed(true);
                        }}
                      >
                        <Text style={[styles.odoQuickText, { color: odoEnd === opt.val ? colors.primary : colors.onSurface }]}>
                          {opt.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {odoConfirmed && (
                    <View style={styles.swipeSuccessBadge}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                      <Text style={[styles.swipeSuccessText, { color: colors.primary }]}>
                        Distance calculated: {odoEnd - 45210} km recorded! Odometer verified.
                      </Text>
                    </View>
                  )}
                </ClayCard>
              )}

              {/* Interactive Area: Geofence Override (Mission 3, Step 3) */}
              {currentStep.type === 'interactive_override' && (
                <ClayCard variant="standard" style={styles.interactiveCard}>
                  <Text style={[styles.interactiveHeader, { color: colors.onSurface }]}>Geofence Detour Simulator</Text>
                  <Text style={[styles.interactiveSub, { color: colors.onSurfaceVariant }]}>
                    Vehicle detected at Terminal 3 (1.4 km from planned pin). Select a reason to authorize completion:
                  </Text>

                  <View style={styles.overrideList}>
                    {[
                      { id: 'guest', label: 'Guest requested alternate terminal drop-off', icon: 'person' },
                      { id: 'security', label: 'Airport gate closed by security detour', icon: 'shield-checkmark' },
                      { id: 'traffic', label: 'Heavy traffic reroute around roadworks', icon: 'warning' },
                    ].map((opt) => (
                      <Pressable
                        key={opt.id}
                        style={[
                          styles.overrideTile,
                          selectedOverride === opt.id && { backgroundColor: isDark ? 'rgba(21,72,58,0.3)' : '#E5EEE7', borderColor: colors.primary },
                        ]}
                        onPress={() => setSelectedOverride(opt.id)}
                      >
                        <Ionicons name={opt.icon} size={18} color={selectedOverride === opt.id ? colors.primary : colors.onSurfaceVariant} />
                        <Text style={[styles.overrideText, { color: selectedOverride === opt.id ? colors.primary : colors.onSurface }]}>
                          {opt.label}
                        </Text>
                        {selectedOverride === opt.id && <Ionicons name="checkmark-circle" size={18} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>

                  {selectedOverride && (
                    <View style={styles.swipeSuccessBadge}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                      <Text style={[styles.swipeSuccessText, { color: colors.primary }]}>
                        Detour logged for dispatch! Trip completion authorized.
                      </Text>
                    </View>
                  )}
                </ClayCard>
              )}

              {/* Interactive Area: Fuel Receipt Scan (Mission 4, Step 2) */}
              {currentStep.type === 'interactive_fuel_scan' && (
                <ClayCard variant="standard" style={styles.interactiveCard}>
                  <Text style={[styles.interactiveHeader, { color: colors.onSurface }]}>AI Receipt Viewfinder Simulator</Text>
                  <Text style={[styles.interactiveSub, { color: colors.onSurfaceVariant }]}>
                    Align the physical gas station receipt inside the targeting frame and tap scan:
                  </Text>

                  {/* Simulated Camera Viewfinder */}
                  <View style={styles.viewfinderBox}>
                    <View style={[styles.vfCorner, styles.vfTopLeft, { borderColor: fuelScanning ? '#00E676' : colors.primary }]} />
                    <View style={[styles.vfCorner, styles.vfTopRight, { borderColor: fuelScanning ? '#00E676' : colors.primary }]} />
                    <View style={[styles.vfCorner, styles.vfBottomLeft, { borderColor: fuelScanning ? '#00E676' : colors.primary }]} />
                    <View style={[styles.vfCorner, styles.vfBottomRight, { borderColor: fuelScanning ? '#00E676' : colors.primary }]} />

                    {/* HUD Status Badge */}
                    {fuelScanning && (
                      <View style={styles.viewfinderHudBadge}>
                        <Ionicons name="sparkles" size={13} color="#00E676" />
                        <Text style={styles.viewfinderHudText}>ANALYZING RECEIPT · GEMINI OCR</Text>
                      </View>
                    )}

                    <View style={styles.mockReceiptPaper}>
                      <Ionicons name="receipt-outline" size={24} color="#666666" />
                      <Text style={styles.mockReceiptTitle}>SHELL SERVICE STATION</Text>
                      <Text style={styles.mockReceiptLine}>Skyway Northbound Exit</Text>
                      <View style={styles.mockReceiptDashed} />
                      <Text style={styles.mockReceiptDetail}>DIESEL MAX · 42.50 LITERS</Text>
                      <Text style={styles.mockReceiptAmount}>TOTAL: ₱2,911.25</Text>
                    </View>

                    {/* Animated Scanning Laser & Glow Aura */}
                    {fuelScanning && (
                      <Animated.View
                        style={[
                          styles.laserWrapper,
                          {
                            transform: [
                              {
                                translateY: scanAnim.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [10, 116],
                                }),
                              },
                            ],
                          },
                        ]}
                      >
                        <View style={styles.laserAura} />
                        <View style={styles.laserBeam} />
                      </Animated.View>
                    )}
                  </View>

                  <ClayButton
                    variant={fuelScanResult ? "standard" : "primary"}
                    label={fuelScanning ? "Scanning with Gemini AI..." : fuelScanResult ? "Scan Again" : "Tap to Scan Receipt"}
                    disabled={fuelScanning}
                    onPress={() => {
                      setFuelScanning(true);
                      setTimeout(() => {
                        setFuelScanning(false);
                        setFuelScanResult({
                          station: 'Shell Skyway North',
                          liters: '42.50 L',
                          amount: '₱2,911.25',
                          fuel: 'Diesel',
                        });
                      }, 1800);
                    }}
                    style={{ width: '100%' }}
                  />

                  {fuelScanResult && (
                    <View style={[styles.fuelResultBox, { backgroundColor: isDark ? 'rgba(21,72,58,0.25)' : '#E5EEE7' }]}>
                      <View style={styles.fuelResultRow}>
                        <ClayTile icon="checkmark" size={28} variant="primary" />
                        <Text style={[styles.fuelResultTitle, { color: colors.primary }]}>OCR Auto-Extracted Values:</Text>
                      </View>
                      <View style={styles.fuelChipsRow}>
                        <ClayBadge variant="primary" label={`Station: ${fuelScanResult.station}`} />
                        <ClayBadge variant="neutral" label={`Volume: ${fuelScanResult.liters}`} />
                        <ClayBadge variant="neutral" label={`Total: ${fuelScanResult.amount}`} />
                        <ClayBadge variant="neutral" label={`Type: ${fuelScanResult.fuel}`} />
                      </View>
                    </View>
                  )}
                </ClayCard>
              )}

              {/* Interactive Area: Offline Sync (Mission 6, Step 2) */}
              {currentStep.type === 'interactive_offline_sync' && (
                <ClayCard variant="standard" style={styles.interactiveCard}>
                  <Text style={[styles.interactiveHeader, { color: colors.onSurface }]}>Underground Tunnel Simulator</Text>
                  <Text style={[styles.interactiveSub, { color: colors.onSurfaceVariant }]}>
                    Experience what happens when your vehicle enters a cellular dead zone:
                  </Text>

                  {/* Simulated Connectivity Banner */}
                  <View
                    style={[
                      styles.simBanner,
                      {
                        backgroundColor:
                          simSyncPhase === 'offline' || simSyncPhase === 'queued'
                            ? '#4A3B2A'
                            : simSyncPhase === 'syncing'
                            ? '#1E40AF'
                            : simSyncPhase === 'synced'
                            ? colors.primary
                            : isDark
                            ? 'rgba(255,255,255,0.08)'
                            : '#EFEFEF',
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        simSyncPhase === 'offline' || simSyncPhase === 'queued'
                          ? 'cloud-offline'
                          : simSyncPhase === 'syncing'
                          ? 'sync'
                          : simSyncPhase === 'synced'
                          ? 'cloud-done'
                          : 'cellular'
                      }
                      size={18}
                      color={simSyncPhase === 'idle' && !isDark ? colors.onSurface : '#FFFFFF'}
                    />
                    <Text
                      style={[
                        styles.simBannerText,
                        simSyncPhase === 'idle' && !isDark && { color: colors.onSurface },
                      ]}
                    >
                      {simSyncPhase === 'idle' && 'Status: Cellular Online (5G)'}
                      {simSyncPhase === 'offline' && "You're offline · GPS still recording"}
                      {simSyncPhase === 'queued' && "You're offline · 1 update queued in outbox"}
                      {simSyncPhase === 'syncing' && 'Back online · Syncing 1 update...'}
                      {simSyncPhase === 'synced' && 'All updates synced with dispatch'}
                    </Text>
                  </View>

                  {/* Simulator Controls */}
                  <View style={styles.simControlsGroup}>
                    {simSyncPhase === 'idle' && (
                      <ClayButton
                        variant="primary"
                        label="1. Enter Tunnel (Lose Signal)"
                        onPress={() => setSimSyncPhase('offline')}
                        style={{ width: '100%' }}
                      />
                    )}

                    {simSyncPhase === 'offline' && (
                      <ClayButton
                        variant="primary"
                        label="2. Complete Trip Action (While Offline)"
                        onPress={() => setSimSyncPhase('queued')}
                        style={{ width: '100%' }}
                      />
                    )}

                    {simSyncPhase === 'queued' && (
                      <ClayButton
                        variant="primary"
                        label="3. Exit Tunnel (Reconnect & Auto-Sync)"
                        onPress={() => {
                          setSimSyncPhase('syncing');
                          setTimeout(() => {
                            setSimSyncPhase('synced');
                          }, 900);
                        }}
                        style={{ width: '100%' }}
                      />
                    )}

                    {simSyncPhase === 'synced' && (
                      <View style={styles.swipeSuccessBadge}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                        <Text style={[styles.swipeSuccessText, { color: colors.primary }]}>
                          Simulation complete! All queued actions safely uploaded.
                        </Text>
                      </View>
                    )}
                  </View>
                </ClayCard>
              )}
            </View>
          )}
        </ScrollView>

        {/* Bottom Actions Bar */}
        <View style={[styles.bottomBar, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
          {completedCelebration ? (
            <ClayButton
              variant="primary"
              label="Finish Mission"
              onPress={handleFinishMission}
              style={{ width: '100%' }}
            />
          ) : (
            <View style={styles.buttonRow}>
              {currentStepIndex > 0 && (
                <ClayButton
                  variant="standard"
                  label="Previous"
                  onPress={handleBack}
                  style={styles.halfBtn}
                />
              )}
              <ClayButton
                variant="primary"
                label={isLastStep ? 'Complete Mission' : 'Next Step'}
                disabled={!interactiveDone}
                onPress={handleNext}
                style={currentStepIndex === 0 ? { width: '100%' } : styles.halfBtn}
              />
            </View>
          )}
        </View>

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  navBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  closeButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navCenter: { alignItems: 'center' },
  placeholder: { width: TOUCH_TARGET },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 40,
  },
  stepContainer: { gap: 16 },

  missionHeader: { gap: 6 },
  missionTitle: {
    fontSize: 12,
    fontFamily: fonts.dataSemiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stepTitle: {
    fontSize: 22,
    fontFamily: fonts.displayBold,
    lineHeight: 28,
  },
  stepInstruction: {
    fontSize: 14,
    fontFamily: fonts.body,
    lineHeight: 21,
  },

  tipCard: {
    padding: 14,
    borderRadius: 16,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tipText: {
    fontSize: 13,
    fontFamily: fonts.body,
    flex: 1,
    lineHeight: 18,
  },

  interactiveCard: {
    padding: 16,
    borderRadius: 22,
    gap: 12,
  },
  interactiveHeader: {
    fontSize: 15,
    fontFamily: fonts.bodyMedium,
  },
  interactiveSub: {
    fontSize: 12,
    fontFamily: fonts.body,
    lineHeight: 17,
  },

  checklistList: { gap: 10, marginTop: 4 },
  checkItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  checkItemLabel: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    flex: 1,
    paddingRight: 8,
  },
  toggleButtonsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  toggleBtnText: {
    fontSize: 11,
    fontFamily: fonts.dataSemiBold,
  },

  swipeWrapper: {
    marginTop: 8,
  },
  swipeSuccessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    justifyContent: 'center',
  },
  swipeSuccessText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
  },

  sosCenterArea: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
    marginVertical: 6,
  },
  mockSosButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#D32F2F',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  mockSosInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockSosText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: fonts.dataSemiBold,
    marginTop: -2,
  },

  sosPreviewSheet: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    gap: 10,
  },
  sosSheetTitle: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    marginBottom: 4,
  },
  sosItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sosItemInfo: { flex: 1 },
  sosItemLabel: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
  },
  odoCompareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginVertical: 4,
  },
  odoBox: {
    flex: 1,
    padding: 10,
    borderRadius: 14,
    alignItems: 'center',
  },
  odoBoxLabel: {
    fontSize: 10,
    fontFamily: fonts.dataSemiBold,
    letterSpacing: 0.6,
  },
  odoBoxVal: {
    fontSize: 15,
    fontFamily: fonts.displayBold,
    marginTop: 2,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
    marginTop: 4,
  },
  odoQuickRow: {
    gap: 8,
  },
  odoQuickBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  odoQuickText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
  },

  overrideList: {
    gap: 8,
    marginTop: 4,
  },
  overrideTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  overrideText: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    flex: 1,
  },

  viewfinderBox: {
    height: 150,
    borderRadius: 16,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    marginVertical: 4,
  },
  vfCorner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderWidth: 3,
  },
  vfTopLeft: { top: 12, left: 12, borderRightWidth: 0, borderBottomWidth: 0 },
  vfTopRight: { top: 12, right: 12, borderLeftWidth: 0, borderBottomWidth: 0 },
  vfBottomLeft: { bottom: 12, left: 12, borderRightWidth: 0, borderTopWidth: 0 },
  vfBottomRight: { bottom: 12, right: 12, borderLeftWidth: 0, borderTopWidth: 0 },
  mockReceiptPaper: {
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
    width: '68%',
  },
  mockReceiptTitle: {
    fontSize: 11,
    fontFamily: fonts.displayBold,
    color: '#111111',
    marginTop: 2,
  },
  mockReceiptLine: {
    fontSize: 9,
    fontFamily: fonts.body,
    color: '#666666',
  },
  mockReceiptDashed: {
    height: 1,
    width: '100%',
    borderStyle: 'dashed',
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    marginVertical: 3,
  },
  mockReceiptDetail: {
    fontSize: 10,
    fontFamily: fonts.dataSemiBold,
    color: '#222222',
  },
  mockReceiptAmount: {
    fontSize: 11,
    fontFamily: fonts.displayBold,
    color: '#09211A',
  },
  laserWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 24,
    pointerEvents: 'none',
    zIndex: 10,
  },
  laserAura: {
    height: 18,
    backgroundColor: 'rgba(0, 230, 118, 0.18)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 230, 118, 0.4)',
  },
  laserBeam: {
    height: 3,
    backgroundColor: '#00E676',
    shadowColor: '#00E676',
    shadowOpacity: 0.95,
    shadowRadius: 8,
    elevation: 6,
  },
  viewfinderHudBadge: {
    position: 'absolute',
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 230, 118, 0.5)',
    zIndex: 12,
  },
  viewfinderHudText: {
    color: '#00E676',
    fontSize: 10,
    fontFamily: fonts.dataSemiBold,
    letterSpacing: 0.5,
  },

  fuelResultBox: {
    gap: 8,
    marginTop: 4,
    padding: 12,
    borderRadius: 14,
  },
  fuelResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fuelResultTitle: {
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
  },
  fuelChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },

  simBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    marginVertical: 4,
  },
  simBannerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bodyMedium,
    flex: 1,
  },
  simControlsGroup: {
    gap: 10,
    marginTop: 6,
  },

  celebrationBox: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 14,
  },
  badgePulseWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 140,
  },
  celebrationTile: {
    position: 'absolute',
  },
  celebrationTitle: {
    fontSize: 24,
    fontFamily: fonts.displayBold,
    textAlign: 'center',
  },
  celebrationSubtitle: {
    fontSize: 14,
    fontFamily: fonts.body,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  summaryCard: {
    width: '100%',
    padding: 16,
    borderRadius: 20,
    marginTop: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  summaryTextGroup: { flex: 1 },
  summaryItemTitle: {
    fontSize: 14,
    fontFamily: fonts.bodyMedium,
  },
  summaryItemDesc: {
    fontSize: 12,
    fontFamily: fonts.body,
    marginTop: 2,
  },

  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  halfBtn: {
    flex: 1,
  },
});
