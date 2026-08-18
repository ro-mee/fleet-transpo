import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import LottieView from "lottie-react-native";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";

export function LaunchScreen({ onComplete }) {
  const { colors } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const reveal = useRef(new Animated.Value(0)).current;
  const route = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;
  const finished = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription?.remove();
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    Animated.timing(exit, {
      toValue: 0,
      duration: reduceMotion ? 1 : 360,
      easing: Easing.bezier(0.32, 0.72, 0, 1),
      useNativeDriver: true,
    }).start(({ finished: completed }) => completed && onComplete(reduceMotion));
  }, [exit, onComplete, reduceMotion]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(route, {
        toValue: 1,
        duration: reduceMotion ? 1 : 1100,
        delay: reduceMotion ? 0 : 180,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      Animated.timing(reveal, {
        toValue: 1,
        duration: reduceMotion ? 1 : 820,
        delay: reduceMotion ? 0 : 620,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [reduceMotion, reveal, route]);

  useEffect(() => {
    const timer = setTimeout(finish, reduceMotion ? 850 : 6500);
    return () => clearTimeout(timer);
  }, [finish, reduceMotion]);

  const translateY = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });
  const dialRotate = route.interpolate({
    inputRange: [0, 1],
    outputRange: ["-10deg", "0deg"],
  });

  return (
    <Animated.View
      accessible
      accessibilityLabel="FleetOps loading"
      style={[styles.root, { opacity: exit }]}
    >
      <LinearGradient
        colors={[colors.background, colors.primaryContainer, colors.background]}
        locations={[0, 0.48, 1]}
        start={{ x: 0.08, y: 0 }}
        end={{ x: 0.92, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.mapField} pointerEvents="none">
        <View style={[styles.mapLineVertical, { backgroundColor: colors.outlineVariant }]} />
        <View style={[styles.mapLineHorizontal, { backgroundColor: colors.outlineVariant }]} />
        <View style={[styles.mapLineDiagonal, { backgroundColor: colors.outlineVariant }]} />
        <View style={[styles.node, styles.nodeOne, { backgroundColor: colors.secondary }]} />
        <View style={[styles.node, styles.nodeTwo, { backgroundColor: colors.primary }]} />
      </View>
      <View style={[styles.corner, styles.cornerTopLeft, { borderColor: colors.primary }]} />
      <View style={[styles.corner, styles.cornerBottomRight, { borderColor: colors.primary }]} />

      <View style={styles.stage}>
        <Animated.View
          style={[
            styles.dial,
            {
              borderColor: colors.outlineVariant,
              opacity: route,
              transform: [{ rotate: dialRotate }, { scale: route }],
            },
          ]}
        >
          <View style={[styles.dialInner, { borderColor: colors.primary }]} />
          <View style={[styles.tick, styles.tickTop, { backgroundColor: colors.secondary }]} />
          <View style={[styles.tick, styles.tickRight, { backgroundColor: colors.secondary }]} />
          <View style={[styles.tick, styles.tickBottom, { backgroundColor: colors.secondary }]} />
          <View style={[styles.tick, styles.tickLeft, { backgroundColor: colors.secondary }]} />
        </Animated.View>
        {!reduceMotion && (
          <LottieView
            autoPlay
            loop={false}
            speed={1.2}
            source={require("../assets/car animation.json")}
            onAnimationFinish={finish}
            onAnimationFailure={finish}
            pointerEvents="none"
            style={styles.car}
          />
        )}
      </View>

      <Animated.View
        style={[
          styles.routeTrack,
          {
            backgroundColor: colors.secondary,
            opacity: route,
            transform: [{ scaleX: route }],
          },
        ]}
      >
        <View style={[styles.routeHead, { backgroundColor: colors.secondary }]} />
      </Animated.View>

      <Animated.View style={[styles.brand, { opacity: reveal, transform: [{ translateY }] }]}> 
        <View style={styles.wordmarkRow}>
          <View style={styles.wordmarkText}>
            <View style={styles.wordmarkLetters}>
              <Text style={[styles.wordmark, { color: colors.onBackground }]}>Fleet</Text>
              <Text style={[styles.wordmark, { color: colors.primary }]}>Ops</Text>
            </View>
          </View>
          {!reduceMotion && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.locationBeacon,
                {
                  opacity: reveal,
                  transform: [
                    {
                      translateX: reveal.interpolate({
                        inputRange: [0, 1],
                        outputRange: [14, 0],
                      }),
                    },
                    { scale: reveal },
                  ],
                },
              ]}
            >
              <LottieView
                autoPlay
                loop
                speed={0.9}
                source={require("../assets/PRt4x4Ds0p.json")}
                colorFilters={[{ keypath: "Location", color: colors.primary }]}
                style={styles.location}
              />
            </Animated.View>
          )}
        </View>
        <Animated.Text
          style={[
            styles.motto,
            { color: colors.foregroundSecondary, opacity: reveal },
          ]}
        >
          Move smarter. Drive better.
        </Animated.Text>
      </Animated.View>
      <View style={styles.footerMark}>
        <View style={[styles.footerLine, { backgroundColor: colors.primary }]} />
        <View style={[styles.footerDot, { backgroundColor: colors.secondary }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  mapField: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  mapLineVertical: {
    position: "absolute",
    left: "20%",
    top: 0,
    width: 1,
    height: "72%",
    transform: [{ rotate: "12deg" }],
  },
  mapLineHorizontal: {
    position: "absolute",
    right: 0,
    top: "28%",
    width: "58%",
    height: 1,
    transform: [{ rotate: "-8deg" }],
  },
  mapLineDiagonal: {
    position: "absolute",
    left: "8%",
    bottom: "22%",
    width: "76%",
    height: 1,
    transform: [{ rotate: "28deg" }],
  },
  node: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  nodeOne: {
    top: "26%",
    right: "21%",
  },
  nodeTwo: {
    left: "18%",
    bottom: "34%",
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    opacity: 0.45,
  },
  cornerTopLeft: {
    left: 24,
    top: 52,
    borderLeftWidth: 1,
    borderTopWidth: 1,
  },
  cornerBottomRight: {
    right: 24,
    bottom: 52,
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  stage: {
    width: 310,
    height: 310,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: -20,
  },
  dial: {
    position: "absolute",
    width: 274,
    height: 274,
    borderRadius: 137,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dialInner: {
    width: 232,
    height: 232,
    borderRadius: 116,
    borderWidth: 1,
    opacity: 0.32,
  },
  tick: {
    position: "absolute",
    width: 12,
    height: 2,
  },
  tickTop: {
    top: -1,
    transform: [{ rotate: "90deg" }],
  },
  tickRight: {
    right: -6,
  },
  tickBottom: {
    bottom: -1,
    transform: [{ rotate: "90deg" }],
  },
  tickLeft: {
    left: -6,
  },
  car: {
    position: "absolute",
    width: 274,
    height: 274,
  },
  locationBeacon: {
    marginLeft: 5,
    marginTop: 1,
    alignSelf: "center",
  },
  location: {
    width: 112,
    height: 149,
  },
  routeTrack: {
    width: 190,
    height: 2,
    marginBottom: 28,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  routeHead: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  brand: {
    alignItems: "center",
  },
  wordmarkRow: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "92%",
  },
  wordmarkText: {
    flexShrink: 1,
  },
  wordmarkLetters: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  wordmark: {
    fontFamily: fonts.displayBold,
    fontSize: 44,
    lineHeight: 54,
    letterSpacing: 0,
  },
  motto: {
    marginTop: 6,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    letterSpacing: 0,
  },
  footerMark: {
    position: "absolute",
    bottom: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  footerLine: {
    width: 32,
    height: 1,
  },
  footerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});
