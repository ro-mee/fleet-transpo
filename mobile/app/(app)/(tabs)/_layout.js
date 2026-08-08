import { Tabs } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native";
import { useTheme } from "../../../lib/theme-context";
import { fonts, space } from "../../../lib/theme";

/**
 * Minimal geometric tab glyphs drawn with Views — no icon dependency, matching
 * the app's hand-drawn brand mark and license plate. Colours come from the
 * active theme.
 */
function HomeGlyph({ active, color }) {
  return (
    <View style={glyph.ring}>
      <View style={[glyph.roof, { borderTopColor: color }]} />
      <View style={[glyph.body, { backgroundColor: color }]} />
    </View>
  );
}

function HistoryGlyph({ active, color }) {
  return (
    <View style={glyph.ring}>
      <View style={[glyph.clockFace, { borderColor: color }]}>
        <View style={[glyph.clockHand, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

function BellGlyph({ active, color }) {
  return (
    <View style={glyph.ring}>
      <View style={[glyph.bellBody, { borderColor: color }]} />
      <View style={[glyph.bellClapper, { backgroundColor: color }]} />
    </View>
  );
}

function MapGlyph({ active, color }) {
  return (
    <View style={glyph.ring}>
      <View style={[glyph.clockFace, { borderColor: color, borderRadius: 5 }]}>
        <View style={[glyph.clockHand, { backgroundColor: color, left: 6, top: 3, width: 2, height: 6 }]} />
      </View>
    </View>
  );
}

function UserGlyph({ active, color }) {
  return (
    <View style={glyph.ring}>
      <View style={[glyph.userHead, { backgroundColor: color }]} />
      <View style={[glyph.userShoulders, { borderColor: color }]} />
    </View>
  );
}

function TabItem({ label, active, color, glyph, badge }) {
  const { colors } = useTheme();
  return (
    <View style={[tab.item, active && { backgroundColor: colors.surfaceContainerHigh }]}>
      <View>
        {glyph}
        {badge ? (
          <View style={[tab.badge, { backgroundColor: colors.error }]}>
            <Text style={[tab.badgeText, { color: colors.onError }]}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[tab.label, { color }]}>{label}</Text>
    </View>
  );
}

/**
 * MD3 bottom navigation for the driver app with Live Map, Home, History, Alerts, and Profile.
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
          paddingTop: 6,
        },
        tabBarLabelStyle: tab.label,
        tabBarItemStyle: tab.item,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarLabel: ({ focused, color }) => (
            <TabItem label="Home" active={focused} color={focused ? active : idle} glyph={<HomeGlyph active={focused} color={focused ? active : idle} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Live Map",
          tabBarLabel: ({ focused, color }) => (
            <TabItem label="Live Map" active={focused} color={focused ? active : idle} glyph={<MapGlyph active={focused} color={focused ? active : idle} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarLabel: ({ focused, color }) => (
            <TabItem label="History" active={focused} color={focused ? active : idle} glyph={<HistoryGlyph active={focused} color={focused ? active : idle} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarLabel: ({ focused, color }) => (
            <TabItem label="Alerts" active={focused} color={focused ? active : idle} glyph={<BellGlyph active={focused} color={focused ? active : idle} />} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarLabel: ({ focused, color }) => (
            <TabItem label="Profile" active={focused} color={focused ? active : idle} glyph={<UserGlyph active={focused} color={focused ? active : idle} />} />
          ),
        }}
      />
    </Tabs>
  );
}

const tab = StyleSheet.create({
  item: { alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 16, paddingVertical: 4, paddingHorizontal: 10 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 11 },
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

const glyph = StyleSheet.create({
  ring: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  roof: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopWidth: 8,
    marginBottom: -3,
  },
  body: { width: 14, height: 6, borderRadius: 2 },
  clockFace: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5 },
  clockHand: { position: "absolute", top: 4, left: 7.5, width: 1.5, height: 5 },
  bellBody: {
    width: 12,
    height: 10,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  bellClapper: { width: 2, height: 3, marginTop: 1 },
  userHead: { width: 7, height: 7, borderRadius: 4 },
  userShoulders: {
    width: 14,
    height: 8,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    marginTop: -1,
  },
});
