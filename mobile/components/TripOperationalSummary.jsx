import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme-context';
import { fonts, statusColors } from '../lib/theme';
import { loadTitle, loadSubtitle, tripStatusLabel } from '../lib/load-presentation';
import { ClayCard } from './clay/ClayCard';
import { ClayButton } from './clay/ClayButton';
import { CoachMarkTarget } from './coachmarks';

// Presentation only. The Map owns routing, tracking, clearance and transitions.
// Passenger keeps its existing subtree, including its coachmark targets.
export default function TripOperationalSummary({ cargo, trip, target, preStart, readinessText, pickupAt, routeData, routePhase, routeStale, routeDisabledReason, expanded, children }) {
  const { colors, type } = useTheme();
  if (!cargo) return children;
  const status = statusColors(colors, trip.trip_status);
  const delivery = ['Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress'].includes(trip.trip_status);
  const atStop = ['At Pickup', 'Drop-off', 'Arrived'].includes(trip.trip_status);
  const stage = preStart ? 'Cargo assignment' : trip.trip_status === 'Trip Started' ? 'To pickup' : trip.trip_status === 'At Pickup' ? 'Arrived at pickup' : delivery && !atStop ? 'En route to delivery' : tripStatusLabel(trip.trip_status, 'Cargo');
  const live = routeData && !routeStale;
  const reason = routeDisabledReason || (routePhase === 'refreshing' ? 'Recalculating route…' : routePhase === 'failed' || routeStale ? 'Route unavailable' : 'Calculating route…');
  const vehicle = [trip.vehicle_model || trip.model, trip.vehicle_plate || trip.plate_number].filter(Boolean).join(' · ');
  return <CoachMarkTarget targetId="map.standby_status"><View testID="cargo-map-summary" style={styles.summary}>
    <View style={styles.titleRow}>
      <Text style={[type.cardTitle, styles.reference, { color: colors.onSurface }]}>{trip.dispatch_number || `TRP-${trip.trip_id}`}</Text>
      <View style={[styles.badge, { backgroundColor: status.bg }]}><Text style={[styles.badgeText, { color: status.fg }]}>{stage}</Text></View>
    </View>
    <CoachMarkTarget targetId="map.current_target" style={styles.targetRow}>
      <Ionicons name={atStop ? 'checkmark-circle' : 'location'} size={21} color={colors.primary} />
      <View style={styles.flex}>
        <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{preStart ? 'Pickup' : delivery ? 'Delivery target' : 'Pickup target'}</Text>
        <Text style={[type.labelLg, { color: colors.onSurface }]}>{target || (delivery ? trip.destination : trip.origin) || 'Location not supplied'}</Text>
      </View>
    </CoachMarkTarget>
    {preStart && !expanded ? <Stop label="Delivery" value={trip.destination} colors={colors} type={type} icon="flag-outline" /> : null}
    {!atStop && <CoachMarkTarget targetId="map.telemetry"><View accessibilityLiveRegion="polite" style={[styles.telemetry, { backgroundColor: colors.primaryContainer }]}>
      <Ionicons name="navigate-outline" size={18} color={colors.onPrimaryContainer} />
      <View style={styles.flex}>
        <Text style={[type.labelLg, { color: colors.onPrimaryContainer }]}>{live ? `${(routeData.lengthInMeters / 1000).toFixed(1)} km · ${Math.ceil(routeData.travelTimeInSeconds / 60)} min` : reason}</Text>
        <Text style={[type.caption, { color: colors.onPrimaryContainer }]}>{live ? preStart ? 'Route preview' : delivery ? 'To delivery' : 'To pickup' : 'Live distance and arrival time need a valid route.'}</Text>
        {routePhase === 'refreshing' && live ? <Text style={[type.caption, { color: colors.onPrimaryContainer }]}>Recalculating…</Text> : null}
        {!live && (trip.estimated_distance != null || trip.estimated_duration != null) ? <Text style={[type.caption, { color: colors.onPrimaryContainer }]}>Planned pickup to delivery{trip.estimated_distance != null ? ` · ${Number(trip.estimated_distance).toFixed(1)} km` : ''}{trip.estimated_duration != null ? ` · ${Math.ceil(trip.estimated_duration)} min` : ''}</Text> : null}
      </View>
    </View></CoachMarkTarget>}
    <View style={[styles.loadRow, { borderTopColor: colors.outlineVariant }]}>
      <Ionicons name="cube-outline" size={26} color={colors.primary} />
      <View style={styles.flex}>
        <Text style={[type.labelLg, { color: colors.onSurface }]}>{loadTitle({ ...trip, load_type: 'Cargo' })}</Text>
        <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{loadSubtitle({ ...trip, load_type: 'Cargo' }) || 'Declared weight not supplied'}</Text>
      </View>
    </View>
    {expanded ? <View style={styles.targetRow}>
      <Ionicons name="car-outline" size={18} color={colors.onSurfaceVariant} />
      <Text style={[type.supporting, styles.flex, { color: colors.onSurfaceVariant }]}>{vehicle || 'Assigned vehicle details unavailable'}</Text>
    </View> : null}
    {preStart ? <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{readinessText || 'Start eligibility not confirmed. Refresh the assignment.'}</Text> : null}
    {expanded ? <View style={[styles.stops, { borderTopColor: colors.outlineVariant }]}>
      <Stop label="Pickup" value={trip.origin} colors={colors} type={type} icon="location-outline" />
      <Stop label="Delivery" value={trip.destination} colors={colors} type={type} icon="flag-outline" />
      {pickupAt ? <Stop label="Scheduled departure" value={pickupAt} colors={colors} type={type} icon="time-outline" /> : null}
      {Number(trip.cargo_capacity_kg) > 0 ? <Stop label="Vehicle cargo capacity" value={`${trip.cargo_capacity_kg} kg`} colors={colors} type={type} icon="cube-outline" /> : null}
    </View> : null}
  </View></CoachMarkTarget>;
}

function Stop({ label, value, colors, type, icon }) {
  return <View style={styles.targetRow}><Ionicons name={icon} size={18} color={colors.primary} /><View style={styles.flex}><Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{label}</Text><Text style={[type.supporting, { color: colors.onSurface }]}>{value || 'Not supplied'}</Text></View></View>;
}

export function CargoMapStandby({ completed, onViewDetails, onDismiss } = {}) {
  const { colors, type } = useTheme();
  return <ClayCard variant="compact" contentStyle={{ gap: 12, padding: 4 }} accessibilityLabel={completed ? 'Trip completed. Returning to standby.' : 'On standby. Waiting for a cargo assignment.'}>
    <View style={styles.standby}>
      <Ionicons name={completed ? 'checkmark-circle' : 'cube-outline'} size={23} color={colors.primary} />
      <View style={styles.flex}><Text style={[type.labelLg, { color: colors.onSurface }]}>{completed ? 'Trip completed' : "You're on standby"}</Text><Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{completed ? `${completed.reference} · Returning to standby.` : 'Waiting for a cargo assignment.'}</Text></View>
    </View>
    {completed ? <View style={{ gap: 8 }}><ClayButton label="View trip details" variant="tonal" onPress={onViewDetails} /><ClayButton label="Dismiss" variant="outline" onPress={onDismiss} /></View> : null}
  </ClayCard>;
}

const styles = StyleSheet.create({
  summary: { gap: 12, paddingBottom: 16 },
  flex: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  reference: { flexGrow: 1, flexShrink: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, maxWidth: '100%' },
  badgeText: { fontFamily: fonts.bodySemiBold, fontSize: 12 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  telemetry: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 12 },
  loadRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  stops: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 12 },
  standby: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 4 },
});
