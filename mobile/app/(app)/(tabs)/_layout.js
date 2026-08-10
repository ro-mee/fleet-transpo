import { Tabs } from "expo-router";
import { StyleSheet, View, Text } from "react-native";
import { useTheme } from "../../../lib/theme-context";
import { fonts, space } from "../../../lib/theme";
import { Ionicons } from "@expo/vector-icons";

function TabIcon({ active, color, iconName, badge }) {
  const { colors } = useTheme();
  const activeIcon = iconName;
  const inactiveIcon = `${iconName}-outline`;

  return (
    <View>
      <Ionicons name={active ? activeIcon : inactiveIcon} size={24} color={color} />
      {badge ? (
        <View style={[tab.badge, { backgroundColor: colors.error }]}>
          <Text style={[tab.badgeText, { color: colors.onError }]}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * MD3 bottom navigation for the driver app with Home, Trips, Vehicle, Alerts, and Profile.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const active = colors.primary;
  const idle = colors.onSurfaceVariant;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: active,
        tabBarInactiveTintColor: idle,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.outlineVariant,
          borderTopWidth: 1,
          height: 68,
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarLabelStyle: tab.label,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarLabel: "Home",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon active={focused} color={color} iconName="home" />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: "Trips",
          tabBarLabel: "Trips",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon active={focused} color={color} iconName="document-text" />
          ),
        }}
      />
      <Tabs.Screen
        name="vehicle"
        options={{
          title: "Vehicle",
          tabBarLabel: "Vehicle",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon active={focused} color={color} iconName="car" />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarLabel: "Alerts",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon active={focused} color={color} iconName="notifications" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarLabel: "Profile",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon active={focused} color={color} iconName="person" />
          ),
        }}
      />
    </Tabs>
  );
}

const tab = StyleSheet.create({
  label: { fontFamily: fonts.bodySemiBold, fontSize: 10, marginTop: 4 },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.bodySemiBold, fontSize: 10 },
});
