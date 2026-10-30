import { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, View, useWindowDimensions } from "react-native";
import LottieView from "lottie-react-native";
import { useTheme } from "../lib/theme-context";
import { useSettings } from "../lib/settings-context";
import { useLaunchSequence } from "../lib/use-launch-sequence";
import { useLaunchAudio } from "../lib/use-launch-audio";

const animations = {
  light: require("../assets/brand/route-reveal-light.json"),
  dark: require("../assets/brand/route-reveal-dark.json"),
  highContrastLight: require("../assets/brand/route-reveal-high-contrast-light.json"),
  highContrastDark: require("../assets/brand/route-reveal-high-contrast-dark.json"),
};

const stills = {
  light: require("../assets/brand/launch-light.png"),
  dark: require("../assets/brand/launch-dark.png"),
  highContrastLight: require("../assets/brand/launch-high-contrast-light.png"),
  highContrastDark: require("../assets/brand/launch-high-contrast-dark.png"),
};
const backgrounds = { light: "#F9F6EF", dark: "#001B15", highContrastLight: "#FFFFFF", highContrastDark: "#000000" };

/** One local composition keeps the hotel, letter landings and reflection in sync. */
export function LaunchScreen({ onComplete }) {
  const { scheme } = useTheme();
  const { settings } = useSettings();
  const { width, height } = useWindowDimensions();
  const { reducedMotion, exit, finish, animationFailed } = useLaunchSequence(onComplete);
  // Settings are hydrated before mounting. Hold this palette for this one launch.
  const [variant] = useState(() => settings.highContrast
    ? (scheme === "dark" ? "highContrastDark" : "highContrastLight")
    : (scheme === "dark" ? "dark" : "light"));
  const composition = animations[variant];
  const stageWidth = Math.min(width, height * composition.w / composition.h);
  const stage = { width: stageWidth, height: stageWidth * composition.h / composition.w };
  const player = useRef(null);
  const started = useRef(false);
  const cancelled = useRef(false);
  // 1,750 ms to the final hold must still fit before the 1,900 ms exit.
  const [loadDeadline] = useState(() => Date.now() + 150);
  const [playing, setPlaying] = useState(false);
  useLaunchAudio(reducedMotion === false && playing);

  useEffect(() => {
    cancelled.current = reducedMotion !== false;
    if (reducedMotion !== false) return undefined;
    // A renderer which never loads must show the static brand, not a blank wait.
    const timeout = setTimeout(() => {
      if (!started.current) {
        cancelled.current = true;
        animationFailed();
      }
    }, Math.max(0, loadDeadline - Date.now()));
    return () => {
      cancelled.current = true;
      clearTimeout(timeout);
    };
  }, [reducedMotion, animationFailed, loadDeadline]);

  const startAnimation = () => {
    if (started.current || cancelled.current || reducedMotion !== false || !player.current) return;
    if (Date.now() >= loadDeadline) {
      cancelled.current = true;
      animationFailed();
      return;
    }
    started.current = true;
    try {
      player.current.play();
      setPlaying(true);
    } catch {
      animationFailed();
    }
  };

  const failAnimation = () => {
    cancelled.current = true;
    animationFailed();
  };

  return (
    <Animated.View
      accessible
      accessibilityLabel="FleetOps"
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[styles.root, { opacity: exit, backgroundColor: backgrounds[variant] }]}
    >
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={stage}
      >
        {reducedMotion === false ? (
          <LottieView
            ref={player}
            autoPlay={false}
            loop={false}
            source={animations[variant]}
            onAnimationLoaded={startAnimation}
            onAnimationFinish={cancelled => { if (!cancelled) finish(); }}
            onAnimationFailure={failAnimation}
            renderMode="HARDWARE"
            resizeMode="contain"
            style={stage}
          />
        ) : reducedMotion === true ? (
          <Image source={stills[variant]} resizeMode="contain" fadeDuration={0} style={stage} />
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 10 },
});
