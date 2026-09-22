import React, { useState, useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { fonts } from "../../../lib/theme";
import { ClayCard, ClayButton } from "../../clay";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export function ReceiptScanTutorialModal({ visible, onClose, onScanComplete }) {
  const { colors, scheme, type } = useTheme();
  const isDark = scheme === "dark";

  const [scanPhase, setScanPhase] = useState("ready"); // 'ready' | 'scanning' | 'done'
  const [shutterFlash] = useState(() => new Animated.Value(0));
  const [scanLaserAnim] = useState(() => new Animated.Value(0));
  const laserLoopRef = useRef(null);

  useEffect(() => {
    if (visible && scanPhase === "ready") {
      // Gentle floating animation of alignment brackets
      laserLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(scanLaserAnim, {
            toValue: 1,
            duration: 1800,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(scanLaserAnim, {
            toValue: 0,
            duration: 1800,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );
      laserLoopRef.current.start();
    } else {
      laserLoopRef.current?.stop();
    }
    return () => laserLoopRef.current?.stop();
  }, [visible, scanPhase, scanLaserAnim]);

  const handleCapture = () => {
    // Shutter flash
    Animated.sequence([
      Animated.timing(shutterFlash, { toValue: 1, duration: 80, useNativeDriver: true }),
      Animated.timing(shutterFlash, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();

    setScanPhase("scanning");

    setTimeout(() => {
      setScanPhase("done");
      setTimeout(() => {
        onScanComplete?.({
          liters: "35.50",
          cost: "2350.00",
          station: "Shell Station #1042",
          fuelType: "diesel",
        });
      }, 700);
    }, 1400);
  };

  if (!visible) return null;

  const laserTranslateY = scanLaserAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 240],
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.contentWrap}>
          <ClayCard
            variant="elevated"
            style={[
              styles.card,
              { backgroundColor: isDark ? "#141D19" : "#FFFFFF" },
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
                <Ionicons name="receipt-outline" size={22} color={colors.onPrimaryContainer} />
              </View>
              <View style={styles.headerTextWrap}>
                <Text style={[type.cardTitle, { color: colors.onSurface }]}>
                  Receipt OCR Scanner
                </Text>
                <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                  Tutorial Mode · Interactive Sample Scan
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

            {/* Guidance Tip Box */}
            <View
              style={[
                styles.guidanceBanner,
                {
                  backgroundColor: isDark
                    ? "rgba(40, 84, 72, 0.25)"
                    : "rgba(234, 245, 240, 0.95)",
                  borderColor: colors.primary + "35",
                },
              ]}
            >
              <Ionicons name="information-circle" size={16} color={colors.primary} />
              <Text style={[type.supporting, styles.guidanceText, { color: colors.onSurface }]}>
                Center the receipt inside the viewfinder. Ensure liters, cost, and station name are clearly visible.
              </Text>
            </View>

            {/* Simulated Camera Viewfinder */}
            <View style={styles.viewfinderShell}>
              {/* Corner Alignment Brackets */}
              <View style={[styles.corner, styles.cornerTL, { borderColor: colors.primary }]} />
              <View style={[styles.corner, styles.cornerTR, { borderColor: colors.primary }]} />
              <View style={[styles.corner, styles.cornerBL, { borderColor: colors.primary }]} />
              <View style={[styles.corner, styles.cornerBR, { borderColor: colors.primary }]} />

              {/* Sample Paper Receipt Graphic */}
              <View style={styles.sampleReceipt}>
                <View style={styles.receiptHeader}>
                  <Text style={styles.receiptBrand}>SHELL STATION #1042</Text>
                  <Text style={styles.receiptAddress}>North Diversion Rd, Quezon City</Text>
                  <Text style={styles.receiptMeta}>TAX INVOICE · SHIFT REFUEL</Text>
                </View>

                <View style={styles.receiptDivider} />

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptItem}>Fuel Type:</Text>
                  <Text style={styles.receiptValue}>Shell FuelSave Diesel</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptItem}>Volume (L):</Text>
                  <Text style={[styles.receiptValue, styles.receiptHighlight]}>35.50 L</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptItem}>Price / L:</Text>
                  <Text style={styles.receiptValue}>₱66.20</Text>
                </View>
                <View style={[styles.receiptRow, { marginTop: 4 }]}>
                  <Text style={[styles.receiptItem, { fontWeight: "700" }]}>TOTAL DUE:</Text>
                  <Text style={[styles.receiptValue, styles.receiptTotal]}>₱2,350.00</Text>
                </View>

                <View style={styles.receiptDivider} />

                <View style={styles.receiptFooter}>
                  <Text style={styles.receiptBarcode}>||||| |||| |||||| |||| |||||</Text>
                  <Text style={styles.receiptAuth}>AUTH #984210 · APPROVED</Text>
                </View>
              </View>

              {/* Scanning Laser Beam */}
              {scanPhase === "scanning" && (
                <Animated.View
                  style={[
                    styles.scanLaser,
                    {
                      backgroundColor: colors.primary,
                      transform: [{ translateY: laserTranslateY }],
                    },
                  ]}
                />
              )}

              {/* Status Badge */}
              <View style={[styles.badgeWrap, { backgroundColor: colors.primary }]}>
                <Text style={styles.badgeText}>
                  {scanPhase === "done"
                    ? "✓ Data Extracted"
                    : scanPhase === "scanning"
                    ? "AI Analyzing Receipt..."
                    : "Sample Receipt in Frame"}
                </Text>
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

            {/* Shutter Coaching Tooltip Bubble */}
            {scanPhase === "ready" && (
              <View
                style={[
                  styles.shutterTooltipBubble,
                  {
                    backgroundColor: isDark ? "rgba(40, 84, 72, 0.35)" : "rgba(234, 245, 240, 0.98)",
                    borderColor: colors.primary + "60",
                  },
                ]}
              >
                <Ionicons name="sparkles" size={15} color={colors.primary} />
                <Text style={[type.labelMd, { color: colors.onSurface, flex: 1 }]}>
                  Align receipt and tap Scan Receipt to simulate AI capture
                </Text>
                <Ionicons name="arrow-down" size={14} color={colors.primary} />
              </View>
            )}

            {/* Action Footer */}
            <View style={styles.footerWrap}>
              <ClayButton
                label={
                  scanPhase === "done"
                    ? "Success!"
                    : scanPhase === "scanning"
                    ? "Reading Receipt..."
                    : "Scan Receipt"
                }
                icon="camera"
                variant="primary"
                size="lg"
                disabled={scanPhase !== "ready"}
                loading={scanPhase === "scanning"}
                onPress={handleCapture}
                style={{ width: "100%" }}
              />
            </View>
          </ClayCard>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.70)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    zIndex: 9999,
  },
  contentWrap: {
    width: "100%",
    maxWidth: Math.min(SCREEN_WIDTH - 32, 410),
  },
  card: {
    borderRadius: 24,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  headerIconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  closeBtn: {
    padding: 6,
  },
  guidanceBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  guidanceText: {
    flex: 1,
    lineHeight: 18,
    fontSize: 12.5,
  },
  viewfinderShell: {
    height: 270,
    backgroundColor: "#161B18",
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    marginBottom: 16,
  },
  corner: {
    position: "absolute",
    width: 24,
    height: 24,
    borderWidth: 3,
    zIndex: 10,
  },
  cornerTL: {
    top: 14,
    left: 14,
    borderBottomWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: 6,
  },
  cornerTR: {
    top: 14,
    right: 14,
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderTopRightRadius: 6,
  },
  cornerBL: {
    bottom: 14,
    left: 14,
    borderTopWidth: 0,
    borderRightWidth: 0,
    borderBottomLeftRadius: 6,
  },
  cornerBR: {
    bottom: 14,
    right: 14,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderBottomRightRadius: 6,
  },
  sampleReceipt: {
    width: "78%",
    backgroundColor: "#FAF8F5",
    borderRadius: 8,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  receiptHeader: {
    alignItems: "center",
    marginBottom: 6,
  },
  receiptBrand: {
    fontFamily: fonts.displayBold,
    fontSize: 13,
    color: "#222222",
    letterSpacing: 0.5,
  },
  receiptAddress: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: "#666666",
    marginTop: 1,
  },
  receiptMeta: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: "#888888",
    marginTop: 2,
    letterSpacing: 0.3,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: "#E0DDD5",
    borderStyle: "dashed",
    borderWidth: 0.5,
    borderColor: "#D0CDC5",
    marginVertical: 6,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 2,
  },
  receiptItem: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: "#555555",
  },
  receiptValue: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: "#222222",
    fontWeight: "600",
  },
  receiptHighlight: {
    color: "#15483A",
    fontWeight: "700",
  },
  receiptTotal: {
    color: "#15483A",
    fontSize: 13,
    fontWeight: "800",
  },
  receiptFooter: {
    alignItems: "center",
    marginTop: 4,
  },
  receiptBarcode: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 2,
    color: "#777777",
  },
  receiptAuth: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: "#999999",
    marginTop: 2,
  },
  scanLaser: {
    position: "absolute",
    left: 14,
    right: 14,
    height: 3,
    borderRadius: 2,
    shadowColor: "#4ADE80",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 12,
  },
  badgeWrap: {
    position: "absolute",
    bottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    zIndex: 15,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: fonts.bodySemiBold,
  },
  footerWrap: {
    width: "100%",
  },
  shutterTooltipBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
});

export default ReceiptScanTutorialModal;
