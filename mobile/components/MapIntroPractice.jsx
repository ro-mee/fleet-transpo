import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { clayMaterials } from "../lib/clay";
import { moderateScale } from "../lib/scaling";
import {
  advanceMapIntroStage,
  MAP_INTRO_STAGE_COUNT,
  MAP_INTRO_STAGES,
} from "../lib/map-intro";

const TRACK_HEIGHT = 56;
const THUMB_SIZE = 46;
const THUMB_MARGIN = 5;
const SWIPE_THRESHOLD = 0.48;

function TutorialSwipeButton({ stage, onSuccess, reduceMotion, colors, mats }) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const [thumbX] = useState(() => new Animated.Value(0));
  const [thumbScale] = useState(() => new Animated.Value(1));
  const [successOpacity] = useState(() => new Animated.Value(0));
  const maxXRef = useRef(260);
  const swipedRef = useRef(false);
  const reduceMotionRef = useRef(reduceMotion);
  const onSuccessRef = useRef(onSuccess);
  const timerRef = useRef(null);
  const completeRef = useRef(null);

  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    if (containerWidth > 0) {
      maxXRef.current = Math.max(
        0,
        containerWidth - THUMB_SIZE - THUMB_MARGIN * 2
      );
    }
  }, [containerWidth]);
  const maxX = Math.max(
    0,
    containerWidth - THUMB_SIZE - THUMB_MARGIN * 2
  );

  const resetThumb = useCallback(() => {
    if (reduceMotionRef.current) {
      thumbX.setValue(0);
      thumbScale.setValue(1);
      return;
    }

    Animated.spring(thumbX, {
      toValue: 0,
      bounciness: 12,
      speed: 16,
      useNativeDriver: true,
    }).start();
    Animated.spring(thumbScale, {
      toValue: 1,
      bounciness: 0,
      speed: 22,
      useNativeDriver: true,
    }).start();
  }, [thumbScale, thumbX]);

  const completeStage = useCallback(() => {
    if (swipedRef.current || maxXRef.current <= 0) return;

    swipedRef.current = true;
    setSwiped(true);

    if (reduceMotionRef.current) {
      thumbX.setValue(maxXRef.current);
      successOpacity.setValue(1);
    } else {
      Animated.parallel([
        Animated.spring(thumbX, {
          toValue: maxXRef.current,
          bounciness: 0,
          speed: 22,
          useNativeDriver: true,
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }

    if (typeof Vibration?.vibrate === "function") {
      Vibration.vibrate(10);
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => onSuccessRef.current?.({ success: true, stage: stage.key }),
      reduceMotionRef.current ? 0 : 420
    );
  }, [stage.key, successOpacity, thumbX]);

  useEffect(() => {
    completeRef.current = completeStage;
  }, [completeStage]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const panResponder = useRef(
    // eslint-disable-next-line react-hooks/refs -- PanResponder reads live gesture refs after render.
    PanResponder.create({
      onStartShouldSetPanResponder: () => !swipedRef.current,
      onStartShouldSetPanResponderCapture: () => !swipedRef.current,
      onMoveShouldSetPanResponder: () => !swipedRef.current,
      onMoveShouldSetPanResponderCapture: () => !swipedRef.current,
      onPanResponderGrant: () => {
        if (swipedRef.current) return;
        if (reduceMotionRef.current) {
          thumbScale.setValue(0.96);
        } else {
          Animated.spring(thumbScale, {
            toValue: 0.93,
            speed: 30,
            bounciness: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderMove: (_, gesture) => {
        if (swipedRef.current) return;
        const clamped = Math.max(0, Math.min(gesture.dx, maxXRef.current));
        thumbX.setValue(clamped);
        if (gesture.dx > 4) thumbScale.setValue(1);
      },
      onPanResponderRelease: (_, gesture) => {
        if (swipedRef.current) return;
        thumbScale.setValue(1);
        const max = maxXRef.current;
        if (max > 0 && (gesture.dx >= max * SWIPE_THRESHOLD || gesture.vx >= 0.6)) {
          completeRef.current?.();
        } else {
          resetThumb();
        }
      },
      onPanResponderTerminate: () => {
        if (!swipedRef.current) resetThumb();
      },
    })
  ).current;

  const handleActivate = () => {
    completeRef.current?.();
  };

  const fillTranslate = Animated.add(
    thumbX,
    THUMB_MARGIN + THUMB_SIZE / 2
  );
  const labelOpacity = thumbX.interpolate({
    inputRange: [0, Math.max(24, maxX * 0.3), Math.max(25, maxX)],
    outputRange: [1, 0.25, 0],
    extrapolate: "clamp",
  });

  return (
    <View
      style={[styles.swipeShell, mats.clayCta, { borderColor: `${colors.primary}28` }]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Swipe ${stage.action}`}
      accessibilityHint="Swipe right to practice this tutorial step, or activate with your screen reader."
      accessibilityState={{ disabled: swiped }}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={handleActivate}
    >
      <View
        style={[styles.swipeTrack, { backgroundColor: colors.primary }]}
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        // eslint-disable-next-line react-hooks/refs -- spreading the once-created responder's handlers
        {...panResponder.panHandlers}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.swipeFill,
            {
              backgroundColor: colors.primaryContainer,
              opacity: thumbX.interpolate({
                inputRange: [0, 20],
                outputRange: [0, 1],
                extrapolate: "clamp",
              }),
              transform: [{ translateX: fillTranslate }],
            },
          ]}
        />
        <Animated.View pointerEvents="none" style={[styles.swipeLabelWrap, { opacity: labelOpacity }]}>
          <Text style={[styles.swipeLabel, { color: colors.onPrimary }]}>
            SWIPE {stage.action} →
          </Text>
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.successWash,
            { backgroundColor: colors.success, opacity: successOpacity },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeThumb,
            mats.clayTile,
            {
              backgroundColor: colors.surface,
              transform: [{ translateX: thumbX }, { scale: thumbScale }],
            },
          ]}
        >
          <Ionicons
            name={swiped ? "checkmark" : "chevron-forward"}
            size={22}
            color={swiped ? colors.success : colors.primary}
          />
        </Animated.View>
      </View>
    </View>
  );
}

function MapIntroPractice({ onStageSuccess }) {
  const { colors, scheme, type } = useTheme();
  const isDark = scheme === "dark";
  const mats = clayMaterials(isDark);
  const router = useRouter();
  const params = useLocalSearchParams();
  const pretripPassedFromRoute = params?.pretrip === "passed";

  // Returning from the pre-trip inspection must not cost a second Start Route
  // swipe.
  //
  // Seeded here rather than corrected in an effect because this card REMOUNTS on
  // the way back: the Map tour is parked while the inspection screen covers the
  // tab, which unmounts the card, so the initializer runs again with the
  // parameter already true. (An effect would also have to write state
  // synchronously, which is a cascading render and a lint failure under
  // `--max-warnings 0`.)
  const [tutorialStage, setTutorialStage] = useState(() =>
    pretripPassedFromRoute ? advanceMapIntroStage(0, true) : 0
  );
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.(
      "reduceMotionChanged",
      setReduceMotion
    );
    return () => {
      if (typeof sub?.remove === "function") sub.remove();
      else if (typeof sub === "function") sub();
    };
  }, []);

  const [showPretripPrompt, setShowPretripPrompt] = useState(false);
  const [pretripCompleted, setPretripCompleted] = useState(
    () => pretripPassedFromRoute
  );

  const isComplete = tutorialStage >= MAP_INTRO_STAGE_COUNT;
  const stage = MAP_INTRO_STAGES[Math.min(tutorialStage, MAP_INTRO_STAGE_COUNT - 1)];
  const handleStageSuccess = useCallback(
    (data) => {
      if (tutorialStage === 0 && !pretripCompleted) {
        setShowPretripPrompt(true);
        return;
      }
      setTutorialStage((current) => advanceMapIntroStage(current, true));
      onStageSuccess?.({ success: true, ...data });
    },
    [tutorialStage, pretripCompleted, onStageSuccess]
  );

  // The tour has to advance past the start step the inspection just satisfied.
  // This reports it once; the stage itself was seeded above, so nothing local is
  // written here — and nothing may be, since writing state synchronously in an
  // effect is both a cascading render and a lint failure.
  //
  // Guarded by a ref because the parameter keeps its value for the rest of the
  // session, and a repeat report would skip a real practice stage.
  const pretripReturnReportedRef = useRef(false);
  useEffect(() => {
    if (!pretripPassedFromRoute) return;
    if (pretripReturnReportedRef.current) return;
    pretripReturnReportedRef.current = true;
    onStageSuccess?.({ success: true, stage: "start", pretrip: "passed" });
  }, [pretripPassedFromRoute, onStageSuccess]);

  return (
    <View
      style={[
        styles.card,
        mats.clayShade,
        {
          backgroundColor: colors.surfaceContainerLow,
          shadowColor: colors.shadow,
        },
      ]}
      accessibilityLabel={isComplete ? "Map tutorial complete" : "Map trip practice"}
    >
      <View style={styles.titleRow}>
        <View style={[styles.titleIcon, mats.clayTile, { backgroundColor: colors.primaryContainer }]}>
          <Ionicons
            name={isComplete ? "checkmark-circle" : "navigate-outline"}
            size={20}
            color={isComplete ? colors.success : colors.primary}
          />
        </View>
        <View style={styles.titleCopy}>
          <Text style={[type.cardTitle, { color: colors.onSurface }]}>
            {isComplete ? "You're ready" : "How your trip works"}
          </Text>
          <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
            {isComplete
              ? "During a real assignment, FleetOps will show the correct action automatically based on your current trip stage."
              : "Practice the same swipe gesture you'll use during a real trip. This is only a tutorial — no trip status will be changed."}
          </Text>
        </View>
      </View>

      <View style={styles.lifecycle} accessibilityLabel={`Tutorial stage ${tutorialStage} of ${MAP_INTRO_STAGE_COUNT}`}>
        {MAP_INTRO_STAGES.map((item, index) => {
          const complete = tutorialStage > index;
          const active = !isComplete && tutorialStage === index;
          return (
            <React.Fragment key={item.key}>
              <View
                style={[
                  styles.lifecycleDot,
                  {
                    backgroundColor: complete || active ? colors.primary : colors.outlineVariant,
                    borderColor: complete || active ? colors.primary : colors.outline,
                  },
                ]}
              >
                {complete && <Ionicons name="checkmark" size={9} color={colors.onPrimary} />}
              </View>
              {index < MAP_INTRO_STAGE_COUNT - 1 && (
                <View
                  style={[
                    styles.lifecycleLine,
                    { backgroundColor: tutorialStage > index ? colors.primary : colors.outlineVariant },
                  ]}
                />
              )}
            </React.Fragment>
          );
        })}
      </View>
      <View style={styles.lifecycleLabels}>
        {[
          "Start",
          "Pickup",
          "Guest",
          "Destination",
          "Done",
        ].map((label) => (
          <Text key={label} style={[styles.lifecycleLabel, { color: colors.outline }]}>
            {label}
          </Text>
        ))}
      </View>

      {isComplete ? (
        <View style={styles.completeWrap}>
          <View style={[styles.completeRow, { backgroundColor: colors.success + "14" }]}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
            <Text style={[styles.completeText, { color: colors.onSurface }]}>
              All five practice stages completed!
            </Text>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.stageRow}>
            <Text style={[styles.stageStatus, { color: colors.primary }]}>{stage.status}</Text>
            <Text style={[styles.stageSuccess, { color: colors.onSurfaceVariant }]}>
              {stage.success}
            </Text>
          </View>
          <TutorialSwipeButton
            key={stage.key}
            stage={stage}
            onSuccess={handleStageSuccess}
            reduceMotion={reduceMotion}
            colors={colors}
            mats={mats}
          />
        </>
      )}

      {/* Pre-Trip Inspection Prompt Modal */}
      <Modal
        visible={showPretripPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPretripPrompt(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: isDark ? "#141D19" : "#FFFFFF" },
            ]}
          >
            <View style={[styles.modalIconTile, { backgroundColor: colors.primaryContainer }]}>
              <Ionicons name="shield-checkmark" size={28} color={colors.onPrimaryContainer} />
            </View>
            <Text style={[type.titleLg, { color: colors.onSurface, textAlign: "center", marginBottom: 6 }]}>
              Pre-Trip Inspection Required
            </Text>
            <Text style={[type.supporting, { color: colors.onSurfaceVariant, textAlign: "center", marginBottom: 20 }]}>
              In real operations, safety regulations require completing the vehicle safety check before departure.
            </Text>
            <View style={{ width: "100%", gap: 10 }}>
              <Pressable
                onPress={() => {
                  setShowPretripPrompt(false);
                  router.push("/(app)/inspection?tour=1&from=map");
                }}
                accessibilityRole="button"
                accessibilityLabel="Open Inspection Screen"
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <Ionicons name="clipboard-outline" size={18} color={colors.onPrimary} />
                <Text style={[type.labelLg, { color: colors.onPrimary }]}>
                  Open Inspection Screen →
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default React.memo(MapIntroPractice);

const styles = StyleSheet.create({
  card: {
    width: "100%",
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  titleIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  titleCopy: {
    flex: 1,
    gap: 4,
  },
  lifecycle: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    marginTop: 2,
  },
  lifecycleDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  lifecycleLine: {
    flex: 1,
    height: 2,
    marginHorizontal: 4,
  },
  lifecycleLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 0,
    marginTop: -6,
  },
  lifecycleLabel: {
    fontFamily: fonts.data,
    fontSize: moderateScale(9),
    letterSpacing: 0.1,
  },
  stageRow: {
    gap: 4,
  },
  stageStatus: {
    fontFamily: fonts.dataSemiBold,
    fontSize: moderateScale(11),
    letterSpacing: 0.6,
  },
  stageSuccess: {
    fontFamily: fonts.body,
    fontSize: moderateScale(11),
  },
  swipeShell: {
    borderRadius: 18,
    padding: 4,
    overflow: "hidden",
  },
  swipeTrack: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: "hidden",
    justifyContent: "center",
  },
  swipeFill: {
    width: 1000,
    left: -500,
  },
  swipeLabelWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: THUMB_SIZE + 16,
  },
  swipeLabel: {
    fontFamily: fonts.dataSemiBold,
    fontSize: moderateScale(11),
    letterSpacing: 0.5,
  },
  successWash: {
    borderRadius: TRACK_HEIGHT / 2,
  },
  swipeThumb: {
    position: "absolute",
    left: THUMB_MARGIN,
    top: THUMB_MARGIN,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  completeWrap: {
    gap: 10,
    width: "100%",
  },
  completeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
  },
  completeText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: moderateScale(11),
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    zIndex: 9999,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalIconTile: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  modalPrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    width: "100%",
  },
});
