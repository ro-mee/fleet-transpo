import { Tabs } from "expo-router";
import { CurvedPillTabBar } from "../../../components/CurvedPillTabBar";
import { DriverSos } from "../../../components/DriverSos";

export default function TabsLayout() {
  return (
    <>
      <Tabs
        tabBar={(props) => <CurvedPillTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: "Live Map",
          }}
        />
        <Tabs.Screen
          name="fuel_action"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="trips"
          options={{
            title: "Trips",
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
          }}
        />
        <Tabs.Screen
          name="vehicle"
          options={{
            href: null,
          }}
        />
      </Tabs>
      <DriverSos />
    </>
  );
}

