import { Image, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { onboardingTheme } from "./onboardingTheme";

export function OnboardingBackground({ children, showMapBg = false, style }) {
  return (
    <View style={[styles.container, style]}>
      {showMapBg && (
        <Image
          source={require("../../assets/images/onboarding/map-bg.png")}
          style={styles.mapBg}
          resizeMode="contain"
          pointerEvents="none"
        />
      )}
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: onboardingTheme.colors.background,
    overflow: "hidden",
  },
  mapBg: {
    position: "absolute",
    top: -20,
    right: -40,
    width: 320,
    height: 320,
    opacity: 0.28,
  },
  safeArea: {
    flex: 1,
  },
});

