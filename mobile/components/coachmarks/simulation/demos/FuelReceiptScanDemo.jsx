import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "../../../../lib/theme-context";
import { fonts } from "../../../../lib/theme";
import { moderateScale } from "../../../../lib/scaling";
import DemoStatusLine from "../DemoStatusLine";
import {
  SAMPLE_FUEL_RECEIPT,
  formatSampleCurrency,
} from "./sample-receipt-fixture";
import {
  isCorrectSampleTotal,
  nextFuelScanDemoPhase,
} from "../../../../lib/fuel-scan-demo";

const DETECTED_MS = 450;
const LIFT_MS = 400;
const SCAN_MS = 2200;
const EXTRACT_ROW_MS = 220;

export default function FuelReceiptScanDemo({ onComplete, onSkip }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState("idle");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [revealedRows, setRevealedRows] = useState(0);
  const [selectedTotal, setSelectedTotal] = useState(null);
  const [reviewMessage, setReviewMessage] = useState("");
  const [scanStage, setScanStage] = useState(0);
  const timersRef = useRef(new Set());
  const [receiptX] = useState(() => new Animated.Value(34));
  const [receiptY] = useState(() => new Animated.Value(-22));
  const [receiptRotate] = useState(() => new Animated.Value(1));
  const [receiptScale] = useState(() => new Animated.Value(0.92));
  const [scanLine] = useState(() => new Animated.Value(0));

  const scanMessages = [
    "Reading receipt…",
    "Finding fuel details…",
    "Checking values…",
  ];
  const scanMessage = scanMessages[Math.min(scanStage, scanMessages.length - 1)];

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const schedule = useCallback((fn, ms) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      fn();
    }, ms);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const resetVisuals = useCallback(() => {
    receiptX.setValue(34);
    receiptY.setValue(-22);
    receiptRotate.setValue(1);
    receiptScale.setValue(0.92);
    scanLine.setValue(0);
  }, [receiptX, receiptY, receiptRotate, receiptScale, scanLine]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase("idle");
    setRevealedRows(0);
    setSelectedTotal(null);
    setReviewMessage("");
    setScanStage(0);
    resetVisuals();
  }, [clearTimers, resetVisuals]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(false));
    return () => {
      clearTimers();
      receiptX.stopAnimation();
      receiptY.stopAnimation();
      receiptRotate.stopAnimation();
      receiptScale.stopAnimation();
      scanLine.stopAnimation();
    };
  }, [
    clearTimers,
    receiptX,
    receiptY,
    receiptRotate,
    receiptScale,
    scanLine,
  ]);

  const setNextPhase = useCallback((expected) => {
    setPhase((current) => {
      const next = nextFuelScanDemoPhase(current);
      return next === expected ? next : current;
    });
  }, []);

  const beginDetection = useCallback(() => {
    if (phase !== "aligning") return;
    clearTimers();

    Animated.parallel([
      Animated.timing(receiptX, {
        toValue: 0,
        duration: reduceMotion ? 1 : 220,
        useNativeDriver: true,
      }),
      Animated.timing(receiptY, {
        toValue: 0,
        duration: reduceMotion ? 1 : 220,
        useNativeDriver: true,
      }),
      Animated.timing(receiptRotate, {
        toValue: 0,
        duration: reduceMotion ? 1 : 220,
        useNativeDriver: true,
      }),
    ]).start();

    setPhase("detected");
  }, [
    phase,
    clearTimers,
    receiptX,
    receiptY,
    receiptRotate,
    reduceMotion,
  ]);

  useEffect(() => {
    if (phase === "detected") {
      schedule(() => setNextPhase("lifting"), reduceMotion ? 30 : DETECTED_MS);
      return;
    }

    if (phase === "lifting") {
      Animated.parallel([
        Animated.timing(receiptScale, {
          toValue: 1.04,
          duration: reduceMotion ? 1 : LIFT_MS,
          useNativeDriver: true,
        }),
        Animated.timing(receiptY, {
          toValue: -6,
          duration: reduceMotion ? 1 : LIFT_MS,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setScanStage(0);
        setNextPhase("scanning");
      });
      return;
    }

    if (phase === "scanning") {
      schedule(() => setScanStage(1), reduceMotion ? 60 : 700);
      schedule(() => setScanStage(2), reduceMotion ? 120 : 1500);

      Animated.timing(scanLine, {
        toValue: 1,
        duration: reduceMotion ? 1 : SCAN_MS,
        useNativeDriver: true,
      }).start(() => setNextPhase("extracting"));
      return;
    }

    if (phase === "extracting") {
      const spacing = reduceMotion ? 20 : EXTRACT_ROW_MS;
      [1, 2, 3, 4].forEach((count, index) => {
        schedule(() => setRevealedRows(count), spacing * index);
      });
      schedule(
        () => setNextPhase("review"),
        spacing * 4 + (reduceMotion ? 20 : 260)
      );
    }
  }, [
    phase,
    reduceMotion,
    schedule,
    setNextPhase,
    receiptScale,
    receiptY,
    scanLine,
  ]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => phase === "aligning",
        onMoveShouldSetPanResponder: () => phase === "aligning",
        onPanResponderMove: (_event, gesture) => {
          receiptX.setValue(34 + gesture.dx);
          receiptY.setValue(-22 + gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          const closeEnough =
            Math.abs(34 + gesture.dx) <= 28 &&
            Math.abs(-22 + gesture.dy) <= 28;
          if (closeEnough) {
            beginDetection();
          } else {
            Animated.parallel([
              Animated.spring(receiptX, {
                toValue: 34,
                useNativeDriver: true,
              }),
              Animated.spring(receiptY, {
                toValue: -22,
                useNativeDriver: true,
              }),
            ]).start();
          }
        },
      }),
    [phase, receiptX, receiptY, beginDetection]
  );

  const handleVerify = (value) => {
    setSelectedTotal(value);
    if (
      isCorrectSampleTotal(value, SAMPLE_FUEL_RECEIPT.printedTotal)
    ) {
      setReviewMessage(
        "Correct. Always verify scanned values against the receipt before saving."
      );
      setPhase("complete");
    } else {
      setReviewMessage("Check the value printed on the sample receipt.");
    }
  };

  const receiptRows = [
    ["Station", SAMPLE_FUEL_RECEIPT.station],
    ["Fuel", SAMPLE_FUEL_RECEIPT.fuelType],
    ["Volume", `${SAMPLE_FUEL_RECEIPT.liters} L`],
    ["Total", formatSampleCurrency(SAMPLE_FUEL_RECEIPT.simulatedOcrTotal)],
  ];

  if (phase === "idle") {
    return (
      <View style={styles.stack}>
        <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>
          See how FleetOps reads a receipt before you use the real camera.
        </Text>
        <Pressable
          onPress={() => setPhase("aligning")}
          accessibilityRole="button"
          accessibilityLabel="Try sample receipt scan"
          style={[styles.primary, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
            Try sample scan
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View
        style={[
          styles.scanner,
          {
            borderColor:
              phase === "detected" ||
              phase === "lifting" ||
              phase === "scanning" ||
              phase === "extracting" ||
              phase === "review" ||
              phase === "complete"
                ? colors.primary
                : colors.outline,
            backgroundColor: colors.surfaceContainerLowest,
          },
        ]}
      >
        <Animated.View
          {...pan.panHandlers}
          style={[
            styles.receipt,
            {
              backgroundColor: colors.surfaceContainerLow,
              borderColor: colors.outlineVariant,
              transform: [
                { translateX: receiptX },
                { translateY: receiptY },
                {
                  rotate: receiptRotate.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "5deg"],
                  }),
                },
                { scale: receiptScale },
              ],
            },
          ]}
          accessible
          accessibilityLabel="Training sample fuel receipt"
        >
          <Text style={[styles.sampleLabel, { color: colors.primary }]}>
            SAMPLE • TRAINING ONLY
          </Text>
          <Text style={[styles.receiptTitle, { color: colors.onSurface }]}>
            {SAMPLE_FUEL_RECEIPT.station}
          </Text>
          <Text style={[styles.receiptLine, { color: colors.onSurfaceVariant }]}>
            {SAMPLE_FUEL_RECEIPT.date} • {SAMPLE_FUEL_RECEIPT.fuelType}
          </Text>
          <View style={styles.receiptValues}>
            <Text style={[styles.receiptLine, { color: colors.onSurface }]}>
              Volume
            </Text>
            <Text style={[styles.receiptLineBold, { color: colors.onSurface }]}>
              {SAMPLE_FUEL_RECEIPT.liters} L
            </Text>
          </View>
          <View style={styles.receiptValues}>
            <Text style={[styles.receiptLine, { color: colors.onSurface }]}>
              TOTAL
            </Text>
            <Text style={[styles.receiptLineBold, { color: colors.onSurface }]}>
              {formatSampleCurrency(SAMPLE_FUEL_RECEIPT.printedTotal)}
            </Text>
          </View>
        </Animated.View>

        {phase === "scanning" ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.scanLine,
              {
                backgroundColor: colors.primary,
                transform: [
                  {
                    translateY: scanLine.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-70, 70],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
      </View>

      {phase === "aligning" ? (
        <>
          <DemoStatusLine
            text="Move the full sample receipt inside the frame."
            icon="move-outline"
          />
          <Pressable
            onPress={beginDetection}
            accessibilityRole="button"
            accessibilityLabel="Align sample receipt automatically"
            style={[styles.secondary, { borderColor: colors.outlineVariant }]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              Align sample
            </Text>
          </Pressable>
        </>
      ) : null}

      {phase === "detected" ? (
        <DemoStatusLine
          text="Receipt detected. Hold steady while FleetOps reads the details."
          icon="checkmark-circle-outline"
          success
        />
      ) : null}

      {phase === "lifting" ? (
        <DemoStatusLine text="Preparing sample receipt…" />
      ) : null}

      {phase === "scanning" ? (
        <DemoStatusLine text={scanMessage} />
      ) : null}

      {(phase === "extracting" ||
        phase === "review" ||
        phase === "complete") && (
        <View style={styles.extractionStack}>
          {receiptRows.slice(0, revealedRows || 4).map(([label, value]) => (
            <View
              key={label}
              style={[
                styles.resultRow,
                {
                  backgroundColor: colors.surfaceContainerLow,
                  borderColor: colors.outlineVariant,
                },
              ]}
            >
              <Text style={[styles.resultLabel, { color: colors.onSurfaceVariant }]}>
                {label}
              </Text>
              <Text style={[styles.resultValue, { color: colors.onSurface }]}>
                {value}
              </Text>
            </View>
          ))}
        </View>
      )}

      {phase === "review" ? (
        <View style={styles.review}>
          <Text style={[styles.reviewTitle, { color: colors.onSurface }]}>
            Which total should be saved?
          </Text>
          <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>
            Compare the printed receipt with the simulated OCR result.
          </Text>
          <View style={styles.choiceRow}>
            {[SAMPLE_FUEL_RECEIPT.simulatedOcrTotal, SAMPLE_FUEL_RECEIPT.printedTotal].map(
              (value) => (
                <Pressable
                  key={value}
                  onPress={() => handleVerify(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedTotal === value }}
                  style={[
                    styles.choice,
                    {
                      borderColor:
                        selectedTotal === value
                          ? colors.primary
                          : colors.outlineVariant,
                      backgroundColor: colors.surfaceContainerLowest,
                    },
                  ]}
                >
                  <Text style={[styles.choiceText, { color: colors.onSurface }]}>
                    {formatSampleCurrency(value)}
                  </Text>
                </Pressable>
              )
            )}
          </View>
          {reviewMessage ? (
            <DemoStatusLine
              text={reviewMessage}
              icon={
                isCorrectSampleTotal(
                  selectedTotal,
                  SAMPLE_FUEL_RECEIPT.printedTotal
                )
                  ? "checkmark-circle-outline"
                  : "information-circle-outline"
              }
              success={isCorrectSampleTotal(
                selectedTotal,
                SAMPLE_FUEL_RECEIPT.printedTotal
              )}
            />
          ) : null}
        </View>
      ) : null}

      {phase === "complete" ? (
        <View style={styles.complete}>
          <DemoStatusLine
            text="Ready. FleetOps extracts the details; you verify them before saving."
            icon="checkmark-circle-outline"
            success
          />
          <View style={styles.actionRow}>
            <Pressable
              onPress={reset}
              accessibilityRole="button"
              accessibilityLabel="Replay sample receipt scan"
              style={[styles.secondary, styles.flexButton, { borderColor: colors.outlineVariant }]}
            >
              <Text style={[styles.secondaryText, { color: colors.primary }]}>
                Replay
              </Text>
            </Pressable>
            <Pressable
              onPress={onComplete}
              accessibilityRole="button"
              accessibilityLabel="Continue to the real scan receipt control"
              style={[styles.primary, styles.flexButton, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
                Scan my receipt
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase !== "idle" && phase !== "complete" && onSkip ? (
        <Pressable
          onPress={() => {
            clearTimers();
            onSkip();
          }}
          accessibilityRole="button"
          accessibilityLabel="Skip sample receipt demonstration"
          style={styles.skipLink}
        >
          <Text style={[styles.skipText, { color: colors.onSurfaceVariant }]}>
            Skip demo
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: moderateScale(10) },
  body: {
    fontFamily: fonts.body,
    fontSize: moderateScale(12.5),
    lineHeight: moderateScale(18),
  },
  scanner: {
    height: moderateScale(196),
    borderRadius: moderateScale(18),
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  receipt: {
    width: "72%",
    minHeight: moderateScale(150),
    borderRadius: moderateScale(10),
    borderWidth: StyleSheet.hairlineWidth,
    padding: moderateScale(12),
    gap: moderateScale(5),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 6,
  },
  sampleLabel: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: moderateScale(9),
    letterSpacing: 0.7,
  },
  receiptTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13),
  },
  receiptLine: {
    fontFamily: fonts.body,
    fontSize: moderateScale(10.5),
  },
  receiptLineBold: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: moderateScale(11),
  },
  receiptValues: {
    marginTop: moderateScale(5),
    flexDirection: "row",
    justifyContent: "space-between",
    gap: moderateScale(8),
  },
  scanLine: {
    position: "absolute",
    width: "82%",
    height: moderateScale(2),
    borderRadius: moderateScale(2),
    opacity: 0.85,
  },
  primary: {
    minHeight: moderateScale(44),
    borderRadius: moderateScale(12),
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(16),
  },
  primaryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13),
  },
  secondary: {
    minHeight: moderateScale(44),
    borderRadius: moderateScale(12),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(16),
  },
  secondaryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13),
  },
  extractionStack: { gap: moderateScale(6) },
  resultRow: {
    minHeight: moderateScale(34),
    borderRadius: moderateScale(10),
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: moderateScale(11),
  },
  resultLabel: {
    fontFamily: fonts.body,
    fontSize: moderateScale(11),
  },
  resultValue: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: moderateScale(11.5),
  },
  review: { gap: moderateScale(8) },
  reviewTitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13.5),
  },
  choiceRow: { flexDirection: "row", gap: moderateScale(8) },
  choice: {
    flex: 1,
    minHeight: moderateScale(44),
    borderWidth: 1,
    borderRadius: moderateScale(11),
    alignItems: "center",
    justifyContent: "center",
  },
  choiceText: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: moderateScale(12),
  },
  complete: { gap: moderateScale(10) },
  actionRow: { flexDirection: "row", gap: moderateScale(8) },
  flexButton: { flex: 1 },
  skipLink: {
    minHeight: moderateScale(40),
    alignItems: "center",
    justifyContent: "center",
  },
  skipText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(12),
  },
});
