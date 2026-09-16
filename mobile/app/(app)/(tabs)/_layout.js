import { Tabs, Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { useAuth } from "../../../lib/auth";
import { resolveDriverId } from "../../../lib/offline-cache";
import { getGuideProgress, calculateProgress } from "../../../lib/driver-guide";
import { CurvedPillTabBar } from "../../../components/CurvedPillTabBar";
import { DriverSos } from "../../../components/DriverSos";

export default function TabsLayout() {
  const { user } = useAuth();
  const driverId = resolveDriverId(user);
  const [guideDone, setGuideDone] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getGuideProgress(driverId)
        .then((res) => {
          if (!active) return;
          const p = calculateProgress(res?.completedMissions || []);
          setGuideDone(p.isComplete);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [driverId])
  );

  if (!guideDone) {
    return <Redirect href="/guide" />;
  }
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

