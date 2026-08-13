import React, { useState, useCallback, useEffect } from "react";
import { StyleSheet, View, ActivityIndicator, Text } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Location from 'expo-location';
import TomTomMap from "../../../components/TomTomMap";
import { api } from "../../../lib/api";
import { useTheme } from "../../../lib/theme-context";
import { fonts } from "../../../lib/theme";

export default function MapTab() {
  const { colors } = useTheme();
  const [activeTrip, setActiveTrip] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadTrip = useCallback(async () => {
    try {
      const data = await api.get("/api/mobile/driver/trips");
      const active = data.find(t => !["Completed", "Cancelled"].includes(t.trip_status));
      setActiveTrip(active || null);
    } catch (e) {
      console.warn("Could not load trip for map", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadTrip(); }, [loadTrip]));

  useEffect(() => {
    let subscription = null;
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      
      // Get initial location with highest accuracy so it doesn't calculate the route from a wrong/approximate spot!
      let loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setDriverLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude, heading: loc.coords.heading });

      // Subscribe to real-time updates (every 5 meters or 3 seconds)
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, distanceInterval: 5, timeInterval: 3000 },
        (newLoc) => {
          setDriverLocation(prev => {
            // Prevent map spinning/glitching when stopped: only update heading if driving > 1 m/s
            let updatedHeading = prev?.heading;
            if (newLoc.coords.speed > 1 && newLoc.coords.heading >= 0) {
              updatedHeading = newLoc.coords.heading;
            } else if (!prev && newLoc.coords.heading >= 0) {
              updatedHeading = newLoc.coords.heading;
            }

            return { 
              lat: newLoc.coords.latitude, 
              lng: newLoc.coords.longitude,
              heading: updatedHeading
            };
          });
        }
      );
    })();
    return () => {
      if (subscription) subscription.remove();
    };
  }, []);

  if (loading || !driverLocation) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 12, color: colors.onSurfaceVariant, fontFamily: fonts.bodyMedium }}>Acquiring GPS Signal...</Text>
      </View>
    );
  }

  // If no active trip, just show driver location
  if (!activeTrip) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <TomTomMap 
          origin={{ lat: driverLocation.lat, lng: driverLocation.lng, heading: driverLocation.heading }}
          destination={{ lat: driverLocation.lat, lng: driverLocation.lng }}
          scrollEnabled={true}
        />
        <View style={[styles.overlay, { backgroundColor: colors.surface }]}>
          <Text style={[styles.overlayText, { color: colors.onSurface }]}>No active trips assigned today.</Text>
        </View>
      </View>
    );
  }

  // Determine if driver is heading to pickup or dropoff
  const isEnRouteToPickup = ["Assigned", "Driver Accepted", "En Route", "Pending"].includes(activeTrip.trip_status);
  
  const destLat = isEnRouteToPickup ? activeTrip.origin_latitude : activeTrip.destination_latitude;
  const destLng = isEnRouteToPickup ? activeTrip.origin_longitude : activeTrip.destination_longitude;
  const destName = isEnRouteToPickup ? activeTrip.origin : activeTrip.destination;

  // Use driver location as start, fallback to trip origin if GPS not ready
  const startLat = driverLocation?.lat || activeTrip.origin_latitude;
  const startLng = driverLocation?.lng || activeTrip.origin_longitude;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <TomTomMap 
        origin={{ lat: startLat, lng: startLng, heading: driverLocation?.heading }}
        destination={{ lat: destLat, lng: destLng }}
        originAddress={isEnRouteToPickup ? "My Location" : activeTrip.origin}
        destAddress={destName}
        scrollEnabled={true}
        pickupLabel="Your Location"
        dropoffLabel={isEnRouteToPickup ? `Pickup: ${destName || 'TBD'}` : `Drop-off: ${destName || 'TBD'}`}
        showCarIcon={true}
        autoSwoop={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  overlay: {
    position: "absolute",
    bottom: 32,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  overlayText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
  }
});
