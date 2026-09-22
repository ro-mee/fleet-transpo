import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts } from "../../../lib/theme";
import { moderateScale } from "../../../lib/scaling";
import { ClayCard, ClayButton } from "../../clay";

export function FuelGaugeTutorialModal({ visible, onClose, onComplete }) {
  const { colors, scheme, type } = useTheme();
  const isDark = scheme === "dark";

  const [step, setStep] = useState("capture"); // 'capture' | 'analyzing' | 'approved'
  const [shutterFlash] = useState(() => new Animated.Value(0));
  const [scanBarAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      // Animate vertical scanning reticle line
      Animated.loop(
        Animated.sequence([
          Animated.timing(scanBarAnim, {
            toValue: 1,
            duration: 1600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scanBarAnim, {
            toValue: 0,
            duration: 1600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [visible, scanBarAnim]);

  const handleCapture = () => {
    // Trigger shutter flash
    Animated.sequence([
      Animated.timing(shutterFlash, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.timing(shutterFlash, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();

    setStep("analyzing");
    setTimeout(() => {
      setStep("extracted");
    }, 1100);
  };

  const handleFinish = () => {
    onComplete?.({
      level: 75,
      photoUrl: "https://images.unsplash.com/photo-1551830820-330a71b99659?w=400&q=80",
    });
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.contentWrap}>
          <ClayCard
            variant="elevated"
            style={[
              styles.card,
              { backgroundColor: isDark ? "#17221D" : "#FFFFFF" },
            ]}
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <View
                style={[
                  styles.headerIconTile,
                  { backgroundColor: colors.primaryContainer },
                ]}
              >
                <Ionicons name="speedometer-outline" size={22} color={colors.onPrimaryContainer} />
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={[type.cardTitle, { color: colors.onSurface }]}>
                  Fuel Gauge AI Scan
                </Text>
                <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                  Tutorial Mode · Simulated Capture
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close tutorial"
              >
                <Ionicons name="close" size={20} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>

            {/* Instruction banner */}
            <View
              style={[
                styles.instructionBanner,
                { backgroundColor: colors.surfaceContainerHighest },
              ]}
            >
              <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
              <Text style={[type.caption, { color: colors.onSurface, flex: 1, lineHeight: 18 }]}>
                {step === "capture" && "Center the dashboard fuel gauge needle inside the frame and hold level."}
                {step === "analyzing" && "AI scanning dashboard cluster and estimating fuel percentage..."}
                {(step === "approved" || step === "extracted") && "Fuel gauge verified at 75% full. Tap Use Extracted Level to proceed."}
              </Text>
            </View>

            {/* Simulated Gauge Viewfinder */}
            <View style={[styles.viewfinder, { backgroundColor: isDark ? "#0A100D" : "#1B2822" }]}>
              {/* Corner Reticle Brackets */}
              <View style={[styles.reticleCorner, styles.topLeft, { borderColor: colors.primary }]} />
              <View style={[styles.reticleCorner, styles.topRight, { borderColor: colors.primary }]} />
              <View style={[styles.reticleCorner, styles.bottomLeft, { borderColor: colors.primary }]} />
              <View style={[styles.reticleCorner, styles.bottomRight, { borderColor: colors.primary }]} />

              {/* Animated Scanning Line */}
              {step === "analyzing" && (
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      backgroundColor: colors.primary,
                      transform: [
                        {
                          translateY: scanBarAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-60, 60],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              )}

              {/* Sample Vector Gauge Graphic */}
              <View style={styles.gaugeGraphicContainer}>
                {/* Arc representation */}
                <View style={styles.gaugeDial}>
                  <View style={styles.gaugeArcBg}>
                    <View style={[styles.needle, { transform: [{ rotate: "35deg" }] }]} />
                  </View>
                  <View style={styles.needlePivot} />
                  {/* Gauge Tick Labels */}
                  <Text style={styles.gaugeLabelE}>E</Text>
                  <Text style={styles.gaugeLabelHalf}>1/2</Text>
                  <Text style={styles.gaugeLabelF}>F</Text>
                  <Ionicons name="funnel-outline" size={16} color="#FFFFFF99" style={styles.fuelIcon} />
                </View>

                {/* Level Tag */}
                <View style={[styles.levelTag, { backgroundColor: colors.primary }]}>
                  <Text style={styles.levelTagText}>
                    {step === "approved" || step === "extracted" ? "Reading: ~75% (3/4 Tank)" : "Simulated Dashboard Gauge"}
                  </Text>
                </View>
              </View>

              {/* Shutter Flash Animation */}
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: "#FFFFFF",
                    opacity: shutterFlash,
                  },
                ]}
              />
            </View>

            {/* Results or Action Area */}
            {step === "extracted" ? (
              <View
                style={[
                  styles.approvalCard,
                  {
                    backgroundColor: isDark
                      ? "rgba(74, 222, 128, 0.12)"
                      : "rgba(40, 84, 72, 0.08)",
                    borderColor: colors.primary + "40",
                  },
                ]}
              >
                <View style={styles.approvalHeader}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                  <Text style={[type.labelLg, { color: colors.primary }]}>
                    Reading Extracted: 75%
                  </Text>
                </View>
                <Text style={[type.supporting, { color: colors.onSurfaceVariant, marginTop: 4 }]}>
                  AI read ~75% fuel tank level. Now tap Use Extracted Level to request fuel.
                </Text>
                <ClayButton
                  label="Use Extracted Level →"
                  variant="primary"
                  size="md"
                  onPress={handleFinish}
                  style={{ marginTop: 12 }}
                />
              </View>
            ) : (
              <View style={styles.footerActions}>
                <ClayButton
                  label={step === "analyzing" ? "Analyzing..." : "Capture Gauge"}
                  variant="primary"
                  size="lg"
                  loading={step === "analyzing"}
                  disabled={step === "analyzing"}
                  onPress={handleCapture}
                  style={{ flex: 1 }}
                />
              </View>
            )}
          </ClayCard>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 15, 13, 0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: moderateScale(16),
  },
  contentWrap: {
    width: "100%",
    maxWidth: moderateScale(360),
  },
  card: {
    borderRadius: moderateScale(24),
    padding: moderateScale(18),
    gap: moderateScale(14),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
  },
  headerIconTile: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(14),
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  closeBtn: {
    padding: 4,
  },
  instructionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: moderateScale(10),
    borderRadius: moderateScale(12),
  },
  viewfinder: {
    height: moderateScale(170),
    borderRadius: moderateScale(16),
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  reticleCorner: {
    position: "absolute",
    width: 20,
    height: 20,
  },
  topLeft: {
    top: 12,
    left: 12,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderTopLeftRadius: 6,
  },
  topRight: {
    top: 12,
    right: 12,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderTopRightRadius: 6,
  },
  bottomLeft: {
    bottom: 12,
    left: 12,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 6,
  },
  bottomRight: {
    bottom: 12,
    right: 12,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 6,
  },
  scanLine: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 2,
    zIndex: 10,
    shadowColor: "#4ADE80",
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },
  gaugeGraphicContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  gaugeDial: {
    width: 110,
    height: 65,
    borderTopLeftRadius: 60,
    borderTopRightRadius: 60,
    backgroundColor: "#1F2F28",
    borderWidth: 2,
    borderColor: "#426757",
    borderBottomWidth: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    position: "relative",
    paddingBottom: 4,
  },
  gaugeArcBg: {
    position: "absolute",
    width: 90,
    height: 45,
    bottom: 0,
    borderTopLeftRadius: 50,
    borderTopRightRadius: 50,
    borderWidth: 1,
    borderColor: "#5F877480",
    borderBottomWidth: 0,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  needle: {
    position: "absolute",
    bottom: 0,
    width: 2.5,
    height: 42,
    backgroundColor: "#EF4444",
    borderRadius: 1,
  },
  needlePivot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    zIndex: 5,
  },
  gaugeLabelE: {
    position: "absolute",
    left: 10,
    bottom: 6,
    color: "#EF4444",
    fontFamily: fonts.dataBold || "monospace",
    fontSize: 10,
  },
  gaugeLabelHalf: {
    position: "absolute",
    top: 4,
    color: "#FFFFFF",
    fontFamily: fonts.data || "monospace",
    fontSize: 9,
  },
  gaugeLabelF: {
    position: "absolute",
    right: 10,
    bottom: 6,
    color: "#4ADE80",
    fontFamily: fonts.dataBold || "monospace",
    fontSize: 10,
  },
  fuelIcon: {
    position: "absolute",
    bottom: 18,
  },
  levelTag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  levelTagText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
  },
  approvalCard: {
    borderRadius: moderateScale(14),
    padding: moderateScale(12),
    borderWidth: 1,
  },
  approvalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  footerActions: {
    flexDirection: "row",
    gap: 10,
  },
});

export default FuelGaugeTutorialModal;
