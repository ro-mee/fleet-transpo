import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts } from '../../lib/theme';
import { isCargoLoad, loadSubtitle } from '../../lib/load-presentation';
import { CoachMarkTarget } from '../coachmarks';
import { clayMaterials } from '../../lib/clay';

// The production Passenger summary, shared with explicitly labeled sample practice.
export default function PassengerMapSummary({ activeTrip, destName, preDeparture = false, pickupAt, isPending = false, isDriverAccepted = false, isState1 = false, isState2 = false, isState3 = false, isState4 = false, routeData, routeStale, routeDisabledReason, activeBlocked = false, profile }) {
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  return <>
              {/* Location Header */}
              <CoachMarkTarget targetId="map.standby_status" style={styles.sheetHeader}>
                <View style={[styles.locationIconWrapper, mats.clayTile, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, shadowColor: colors.shadow }]}>
                  <Ionicons name="location-sharp" size={20} color={colors.primary} />
                </View>
                <CoachMarkTarget targetId="map.current_target" style={{ flex: 1 }}>
                  <View style={styles.locationTextWrapper}>
                    <Text style={[styles.locationIndicator, { color: colors.onSurfaceVariant }]}>
                      {preDeparture && `NEXT TRIP · ${pickupAt || "TBD"}`}
                      {!preDeparture && isPending && "PICK UP LOCATION"}
                      {(isDriverAccepted && !preDeparture) && "READY TO START"}
                      {isState1 && "EN ROUTE TO PICKUP"}
                      {isState2 && "ARRIVED AT PICKUP"}
                      {isState3 && (isCargoLoad(activeTrip) ? "EN ROUTE TO DELIVERY" : "EN ROUTE TO DESTINATION")}
                      {isState4 && (isCargoLoad(activeTrip) ? "AT DELIVERY" : "ARRIVED AT DESTINATION")}
                    </Text>
                    <Text style={[type.cardTitle, { color: colors.onSurface }]}>
                      {preDeparture
                        ? `${activeTrip.origin || "Pickup"} → ${activeTrip.destination || "Destination"}`
                        : destName}
                    </Text>
                  </View>
                </CoachMarkTarget>
                
                {/* ETA & Distance or Contextual Info */}
                {/* Live numbers come ONLY from TomTom ROUTE_CALCULATED. The
                    server's estimated_duration/distance is the PLANNED whole
                    trip (pickup → destination), not remaining live ETA, so it
                    is never substituted into the live slot — it renders as a
                    separate "Planned" line while the live route resolves. The
                    main minutes already INCLUDE traffic; the badge names the
                    traffic portion instead of implying an addition. */}
                <CoachMarkTarget targetId="map.telemetry">
                  <View style={styles.headerStatsRight}>
                    {preDeparture ? null : (isPending || isDriverAccepted || isState1 || isState3) ? (
                      <>
                        {(() => {
                          const live = routeData && !routeStale;
                          const liveMin = live ? Math.ceil(routeData.travelTimeInSeconds / 60) : null;
                          const delayMin = live ? Math.ceil((routeData.trafficDelayInSeconds || 0) / 60) : 0;
                          const liveKm = live ? (routeData.lengthInMeters / 1000).toFixed(1) + " km" : null;
                          const plannedMin = activeTrip.estimated_duration != null ? Math.ceil(activeTrip.estimated_duration) : null;
                          const plannedKm = activeTrip.estimated_distance != null ? Number(activeTrip.estimated_distance).toFixed(1) + " km" : null;
                          const showTraffic = live && delayMin >= 2;
                          const heavyTraffic = live && delayMin >= 5;
                          if (!live) {
                            return (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                                  <Text style={[type.headlineMd, { color: colors.onSurfaceVariant }]}>--</Text>
                                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.onSurfaceVariant, marginBottom: 2 }}> min</Text>
                                </View>
                                <Text style={{ fontFamily: fonts.body, fontSize: 10, color: colors.onSurfaceVariant, marginBottom: 4 }}>
                                  {routeDisabledReason || (routeStale ? "Route unavailable" : "Calculating route…")}
                                </Text>
                                {(plannedMin != null || plannedKm != null) && (
                                  <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant }]}>
                                    Planned{plannedMin != null ? ` ~${plannedMin} min` : ""}{plannedKm != null ? ` · ${plannedKm}` : ""}
                                  </Text>
                                )}
                              </>
                            );
                          }
                          return (
                            <>
                              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
                                <Text style={[type.headlineMd, { color: colors.primary }]}>
                                  {liveMin}
                                </Text>
                                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.primary, marginBottom: 2 }}> min</Text>
                              </View>

                              {showTraffic && (
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -4, marginBottom: 4, backgroundColor: (heavyTraffic ? colors.error : colors.warning) + '1A', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
                                  <Ionicons name="warning" size={10} color={heavyTraffic ? colors.error : colors.warning} />
                                  <Text style={{ fontFamily: fonts.dataSemiBold, fontSize: 10, color: heavyTraffic ? colors.error : colors.warning }}>
                                    {heavyTraffic ? `Heavy traffic · incl. ~${delayMin} min` : `Incl. ~${delayMin} min traffic`}
                                  </Text>
                                </View>
                              )}

                              <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant }]}>
                                {liveKm}
                              </Text>
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                        <Text style={[type.cardTitle, { color: colors.primary }]}>
                          {(activeBlocked ? isCargoLoad(activeTrip) : profile?.driverType === "Cargo")
                            ? loadSubtitle(activeBlocked ? activeTrip : { ...activeTrip, load_type: profile?.driverType }) || 'Cargo consignment'
                            : `${activeTrip.passenger_count || 1} ${activeTrip.passenger_count === 1 ? 'Guest' : 'Guests'}`}
                        </Text>
                        <Text style={[styles.headerDistValue, { color: colors.onSurfaceVariant, marginTop: 4, maxWidth: 80, textAlign: 'right' }]} numberOfLines={2}>
                          {isState2 ? 'Waiting at pickup' : 'Ready for drop-off'}
                        </Text>
                      </View>
                    )}
                  </View>
                </CoachMarkTarget>
              </CoachMarkTarget>

              <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />

  </>;
}
const styles = StyleSheet.create({
divider: {
    height: 1,
    width: '100%',
    opacity: 0.4,
    marginBottom: 16,
  },
headerDistValue: {
    fontFamily: fonts.data || fonts.body,
    fontSize: 13,
    marginTop: 2,
  },
headerStatsRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: 70,
  },
locationIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
locationIndicator: {
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    fontSize: 12,
    marginBottom: 3,
    letterSpacing: 0.5,
  },
locationTextWrapper: {
    flex: 1,
    paddingRight: 10,
  },
sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
});
