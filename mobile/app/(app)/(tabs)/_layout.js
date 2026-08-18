import { Tabs } from "expo-router";
import { useTheme } from "../../../lib/theme-context";
import { useAuth } from "../../../lib/auth";
import { fonts } from "../../../lib/theme";
import { Ionicons } from "@expo/vector-icons";
import { DriverSos } from "../../../components/DriverSos";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { user } = useAuth();

  return (
    <>
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.outlineVariant,
          height: 72,
          paddingBottom: 10,
          paddingTop: 10,
          paddingHorizontal: 8,
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -2 },
          elevation: 6,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarActiveBackgroundColor: "transparent",
        tabBarInactiveBackgroundColor: "transparent",
        tabBarLabelStyle: {
          fontFamily: fonts.bodyMedium,
          fontSize: 11,
          lineHeight: 16,
          marginTop: 1,
        },
        tabBarItemStyle: {
          height: 48,
          alignSelf: "center",
          borderRadius: 14,
          marginHorizontal: 4,
          paddingVertical: 0,
        },
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Live Map",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? "map" : "map-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: "Trips",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? "list" : "list-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          href: null, // Hidden from bottom tabs
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          href: null, // Hidden from bottom tabs, accessed from top header
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? "person" : "person-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="vehicle"
        options={{
          href: null, // Hide vehicle from bottom tabs as we just need the 5 main ones
        }}
      />
    </Tabs>
    <DriverSos />
    </>
  );
}
