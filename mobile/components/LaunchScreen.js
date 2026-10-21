import { Animated, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import LottieView from "lottie-react-native";
import { useTheme } from "../lib/theme-context";
import { useSettings } from "../lib/settings-context";
import { fonts } from "../lib/theme";
import { useLaunchSequence } from "../lib/use-launch-sequence";
import { FleetOpsMark, FleetOpsWordmark } from "./logo";

const animations = {
  light: require("../assets/brand/route-reveal-light.json"),
  dark: require("../assets/brand/route-reveal-dark.json"),
  highContrastLight: require("../assets/brand/route-reveal-high-contrast-light.json"),
  highContrastDark: require("../assets/brand/route-reveal-high-contrast-dark.json"),
};

/** One local route-to-mark composition; the live navigator stays behind it. */
export function LaunchScreen({ onComplete }) {
  const { colors, scheme } = useTheme();
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const { reducedMotion, reveal, tagline, exit, finish, animationFailed } = useLaunchSequence(onComplete);
  const variant = settings.highContrast
    ? (scheme === "dark" ? "highContrastDark" : "highContrastLight")
    : (scheme === "dark" ? "dark" : "light");
  const stageSize = Math.min(320, width - 32, height * 0.48);

  return (
    <Animated.View
      accessible
      accessibilityLabel="FleetOps. Moving operations, further together."
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[styles.root, { opacity: exit, backgroundColor: colors.background }]}
    >
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.identity}
      >
        <View style={{ width: stageSize, height: stageSize, alignItems: "center", justifyContent: "center" }}>
          {reducedMotion === false ? (
            <LottieView
              autoPlay
              loop={false}
              source={animations[variant]}
              onAnimationFinish={cancelled => { if (!cancelled) finish(); }}
              onAnimationFailure={animationFailed}
              renderMode="HARDWARE"
              style={{ width: stageSize, height: stageSize }}
            />
          ) : (
            <FleetOpsMark size={stageSize * 184 / 320} variant={variant} />
          )}
        </View>
        <Animated.View style={[styles.wordmark, { opacity: reveal }]}>
          <FleetOpsWordmark size={Math.min(44, width * 0.12)} variant={variant} />
        </Animated.View>
        <Animated.View style={[styles.tagline, { opacity: tagline }]}>
          <Text style={[styles.motto, { color: colors.onSurfaceVariant }]}>Moving operations.</Text>
          <Text style={[styles.motto, { color: colors.onSurfaceVariant }]}>Further together.</Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 10 },
  identity: { alignItems: "center", width: "100%", paddingHorizontal: 24, paddingBottom: 44 },
  wordmark: { marginTop: -40, alignItems: "center" },
  tagline: { alignItems: "center", marginTop: 22, gap: 4 },
  motto: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 20, letterSpacing: 1.4, textAlign: "center" },
});
