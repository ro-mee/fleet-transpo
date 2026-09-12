import { memo } from "react";
import {
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";

const waveLight = require("../assets/images/clay_wave_light.png");
const waveDark = require("../assets/images/clay_wave_dark.png");

// Visual token specs from 1-to-1 claymorphism reference design
const BAR_HEIGHT = 64;
const PILL_RADIUS = 36;
const CENTER_BTN_SIZE = 54;
const DOT_SIZE = 4.5;
// Compact 92dp wave with gentle 10dp peak height
const WAVE_WIDTH = 92;
const WAVE_HEIGHT = 28;
const CONTAINER_PAD_TOP = 16;

/**
 * Computes a dynamic bottom offset that keeps the floating nav bar
 * elegantly low across all device form factors:
 * - 3-button Android nav: safely floats 4dp above buttons
 * - Gesture nav (Android/iOS): cleanly drops down closer to the gesture bar
 * - Zero insets (older screens/desktop): tight 10dp gap
 */
function getDynamicBottomOffset(insetsBottom) {
  if (!insetsBottom || insetsBottom <= 0) return 10;
  if (insetsBottom >= 40) return insetsBottom + 4;
  return Math.max(Math.round(insetsBottom * 0.55), 10);
}

export const CurvedPillTabBar = memo(function CurvedPillTabBar({
  state,
  navigation,
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { scheme } = useTheme();
  const isDark = scheme === "dark";

  // Light/Dark token mappings matching the exact reference palette
  const palette = isDark
    ? {
        barBg: "#17221D",
        barBorderTop: "rgba(255,255,255,0.12)",
        barBorderBottom: "rgba(0,0,0,0.50)",
        barBorderSide: "rgba(255,255,255,0.06)",
        activeText: "#4ADE80",
        activeIcon: "#4ADE80",
        activeDot: "#4ADE80",
        inactiveText: "#8E9E96",
        inactiveIcon: "#8E9E96",
        btnGradient: ["#2E634F", "#193E2F"],
        barShadow: "#000000",
      }
    : {
        barBg: "#FFFFFF",
        barBorderTop: "#FFFFFF",
        barBorderBottom: "rgba(0,0,0,0.06)",
        barBorderSide: "rgba(0,0,0,0.03)",
        activeText: "#1B4332",
        activeIcon: "#1B4332",
        activeDot: "#1B4332",
        inactiveText: "#55606F",
        inactiveIcon: "#55606F",
        btnGradient: ["#204E3C", "#143828"],
        barShadow: "#000000",
      };

  // 4 primary navigation tabs
  const tabsConfig = [
    {
      routeName: "index",
      label: "Home",
      activeIcon: "home",
      inactiveIcon: "home-outline",
    },
    {
      routeName: "map",
      label: "Live Map",
      activeIcon: "map",
      inactiveIcon: "map-outline",
    },
    {
      routeName: "trips",
      label: "Trips",
      activeIcon: "list",
      inactiveIcon: "list-outline",
    },
    {
      routeName: "profile",
      label: "Profile",
      activeIcon: "person",
      inactiveIcon: "person-outline",
    },
  ];

  // Resolve currently active tab
  const currentRoute = state?.routes ? state.routes[state.index] : null;
  const activeRouteName = currentRoute ? currentRoute.name : "index";

  const handleTabPress = (routeName) => {
    if (!navigation || !state) {
      router.push(`/(app)/(tabs)/${routeName === "index" ? "" : routeName}`);
      return;
    }

    const route = state.routes.find((r) => r.name === routeName);
    if (!route) {
      router.push(`/(app)/(tabs)/${routeName === "index" ? "" : routeName}`);
      return;
    }

    const isFocused = activeRouteName === routeName;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });

    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(routeName);
    }
  };

  const handleScanPress = () => {
    router.push({ pathname: "/fuel-report", params: { scan: "1" } });
  };

  // Dynamic low bottom clearance across all phone types
  const bottomOffset = getDynamicBottomOffset(insets.bottom);

  const renderTabItem = (tab) => {
    const isFocused = activeRouteName === tab.routeName;
    const iconColor = isFocused ? palette.activeIcon : palette.inactiveIcon;
    const textColor = isFocused ? palette.activeText : palette.inactiveText;

    return (
      <Pressable
        key={tab.routeName}
        onPress={() => handleTabPress(tab.routeName)}
        accessibilityRole="tab"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={`${tab.label} tab`}
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        style={({ pressed }) => [
          styles.tabItem,
          pressed && { opacity: 0.75, transform: [{ scale: 0.95 }] },
        ]}
      >
        <Ionicons
          name={isFocused ? tab.activeIcon : tab.inactiveIcon}
          size={23}
          color={iconColor}
        />
        <Text
          style={[
            styles.tabLabel,
            {
              color: textColor,
              fontFamily: isFocused ? fonts.bodySemiBold : fonts.bodyMedium,
            },
          ]}
          numberOfLines={1}
        >
          {tab.label}
        </Text>
        {/* Active indicator dot underneath label with stable layout height */}
        <View
          style={[
            styles.activeDot,
            {
              backgroundColor: palette.activeDot,
              opacity: isFocused ? 1 : 0,
            },
          ]}
        />
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.outerContainer,
        {
          bottom: bottomOffset,
        },
      ]}
    >
      {/* Floating Pill Bar with Claymorphism depth */}
      <View
        style={[
          styles.pillContainer,
          {
            backgroundColor: palette.barBg,
            borderTopColor: palette.barBorderTop,
            borderBottomColor: palette.barBorderBottom,
            borderLeftColor: palette.barBorderSide,
            borderRightColor: palette.barBorderSide,
            shadowColor: palette.barShadow,
          },
        ]}
      >
        {/* Left cluster: Home & Live Map */}
        <View style={styles.tabCluster}>
          {renderTabItem(tabsConfig[0])}
          {renderTabItem(tabsConfig[1])}
        </View>

        {/* Center empty spacer slot for elevated scan button */}
        <View style={styles.centerSlot} pointerEvents="none" />

        {/* Right cluster: Trips & Profile */}
        <View style={styles.tabCluster}>
          {renderTabItem(tabsConfig[2])}
          {renderTabItem(tabsConfig[3])}
        </View>
      </View>

      {/* Seamless mathematical S-curve clay wave (92dp compact width, lowered 10dp peak) */}
      <Image
        source={isDark ? waveDark : waveLight}
        style={styles.waveImage}
        resizeMode="stretch"
        pointerEvents="none"
      />

      {/* Center Action Button (Scan) - lowered so it sits nestled gently in the cradle */}
      <View style={styles.centerBtnPositioner} pointerEvents="box-none">
        <Pressable
          onPress={handleScanPress}
          accessibilityRole="button"
          accessibilityLabel="Scan fuel gauge or receipt"
          hitSlop={10}
          style={({ pressed }) => [
            styles.centerBtnWrapper,
            pressed && {
              transform: [{ scale: 0.93 }],
              opacity: 0.92,
            },
          ]}
        >
          <LinearGradient
            colors={palette.btnGradient}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.centerBtnGradient}
          >
            {/* Viewfinder scanner reticle [ ] */}
            <Ionicons name="scan-outline" size={25} color="#FFFFFF" />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    position: "absolute",
    left: 16,
    right: 16,
    paddingTop: CONTAINER_PAD_TOP,
    alignItems: "center",
    zIndex: 100,
  },
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: BAR_HEIGHT,
    borderRadius: PILL_RADIUS,
    // Clay edge highlights: top light sheen + bottom shade
    borderTopWidth: 2,
    borderBottomWidth: 2.5,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    // Soft ambient clay drop shadow
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 18,
    elevation: 8,
    zIndex: 100,
  },
  // Seamless mathematical cubic Hermite spline S-curve wave:
  // 92dp wide, gentle 10dp peak height. Baseline aligns with pill top at y = CONTAINER_PAD_TOP (16)
  waveImage: {
    position: "absolute",
    alignSelf: "center",
    width: WAVE_WIDTH,
    height: WAVE_HEIGHT,
    top: CONTAINER_PAD_TOP - 10,
    zIndex: 102,
  },
  // High zIndex ensures tab items are always above any background elements
  tabCluster: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    height: "100%",
    zIndex: 120,
  },
  centerSlot: {
    width: 72,
    height: "100%",
    zIndex: 105,
  },
  // Lowered button position: sits at top: 4 (only 12dp above pillContainer at y = 16)
  centerBtnPositioner: {
    position: "absolute",
    top: CONTAINER_PAD_TOP - 12,
    alignSelf: "center",
    zIndex: 130,
  },
  centerBtnWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerBtnGradient: {
    width: CENTER_BTN_SIZE,
    height: CENTER_BTN_SIZE,
    borderRadius: CENTER_BTN_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    // Clean flush button surface - zero harsh bottom borders or dark elevation shadows
    borderWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabItem: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    paddingBottom: 4,
    zIndex: 125,
  },
  tabLabel: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    letterSpacing: -0.1,
  },
  activeDot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginTop: 3,
  },
});
