import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { loadTitle, loadSubtitle } from '../../lib/load-presentation';
import { CoachMarkTarget } from '../coachmarks';

// Presentation only: the canonical Map keeps every progression/clearance handler.
export default function MapTripSummary({ trip, cargo, preStart, readinessText, routeData, routeStale, routeDisabledReason, routePhase, expanded, pickupAt }) {
  const { colors, type } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const status = trip.trip_status;
  const pickup = preStart || ['Driver Accepted', 'Trip Started', 'At Pickup'].includes(status);
  const atStop = ['At Pickup', 'Drop-off', 'Arrived', 'In Progress'].includes(status);
  const stage = preStart || status === 'Driver Accepted' ? 'Ready to start' : status === 'At Pickup' ? 'At pickup' : atStop ? cargo ? 'At delivery' : 'At destination' : pickup ? 'To pickup' : cargo ? 'To delivery' : 'To destination';
  const live = !!routeData && !routeStale && Number.isFinite(routeData.lengthInMeters) && routeData.lengthInMeters >= 0 && Number.isFinite(routeData.travelTimeInSeconds) && routeData.travelTimeInSeconds >= 0;
  const reason = routeDisabledReason || (routePhase === 'refreshing' ? 'Recalculating…' : routePhase === 'failed' || routeStale ? 'Route unavailable' : 'Calculating route…');
  const stack = width < 350 || fontScale > 1.25;
  const target = (pickup ? trip.origin : trip.destination) || 'Location needs verification';
  const vehicle = [trip.vehicle_model || trip.model, trip.vehicle_plate || trip.plate_number].filter(Boolean).join(' · ');
  const plannedDistance = Number(trip.estimated_distance), plannedMinutes = Number(trip.estimated_duration);
  const finish = ['Drop-off', 'Arrived', 'In Progress'].includes(status);
  return <CoachMarkTarget targetId="map.standby_status"><View style={s.summary} testID="map-trip-summary">
    {expanded ? <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{trip.dispatch_number || `TRP-${trip.trip_id}`} · {cargo ? 'Cargo' : 'Passenger'}</Text> : null}
    <View style={[s.row, stack && s.stacked]}>
      <CoachMarkTarget targetId="map.current_target" style={s.target}>
        <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{stage}</Text>
        <Text style={[type.labelLg, { color: colors.onSurface }]}>{target}</Text>
      </CoachMarkTarget>
      <CoachMarkTarget targetId="map.telemetry" style={[s.telemetry, stack && s.telemetryStacked]}>
        {atStop ? <><Text style={[type.labelLg, { color: colors.primary }]}>{cargo ? 'Cargo checks' : 'At stop'}</Text><Text style={[type.caption, { color: colors.onSurfaceVariant }]}>Required next step</Text></> : <>
          <Text style={[type.labelLg, { color: live ? colors.primary : colors.onSurfaceVariant }]}>{live ? `${Math.ceil(routeData.travelTimeInSeconds / 60)} min` : '— min'}</Text>
          <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{live ? `${(routeData.lengthInMeters / 1000).toFixed(1)} km · incl. traffic` : reason}</Text>
          {live && routePhase === 'refreshing' ? <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>Recalculating…</Text> : null}
        </>}
      </CoachMarkTarget>
    </View>
    {preStart && cargo ? <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{readinessText || 'Start eligibility not confirmed. Refresh the assignment.'}</Text> : null}
    {finish ? <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{cargo ? 'Verify delivery, then record the ending odometer to finish.' : 'Record the ending odometer to finish the trip.'}</Text> : null}
    {expanded ? <View style={[s.details, { borderTopColor: colors.outlineVariant }]}>
      <View style={s.detailRow}><Ionicons name={cargo ? 'cube-outline' : 'people-outline'} size={20} color={colors.primary} /><View style={s.target}>
        <Text style={[type.labelLg, { color: colors.onSurface }]}>{loadTitle({ ...trip, load_type: cargo ? 'Cargo' : 'Passenger' })}</Text>
        <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{loadSubtitle({ ...trip, load_type: cargo ? 'Cargo' : 'Passenger' }) || (cargo ? 'Declared weight not supplied' : 'Passenger count not supplied')}</Text>
      </View></View>
      <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{vehicle || 'Assigned vehicle details unavailable'}</Text>
      <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>Pickup</Text><Text style={[type.supporting, { color: colors.onSurface }]}>{trip.origin || 'Location not supplied'}</Text>
      <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{cargo ? 'Delivery' : 'Destination'}</Text><Text style={[type.supporting, { color: colors.onSurface }]}>{trip.destination || 'Location not supplied'}</Text>
      {pickupAt ? <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>Scheduled departure · {pickupAt}</Text> : null}
      {!live && (trip.estimated_distance != null && Number.isFinite(plannedDistance) && plannedDistance >= 0 || trip.estimated_duration != null && Number.isFinite(plannedMinutes) && plannedMinutes >= 0) ? <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>Planned pickup to {cargo ? 'delivery' : 'destination'}{trip.estimated_distance != null && Number.isFinite(plannedDistance) && plannedDistance >= 0 ? ` · ${plannedDistance.toFixed(1)} km` : ''}{trip.estimated_duration != null && Number.isFinite(plannedMinutes) && plannedMinutes >= 0 ? ` · ${Math.ceil(plannedMinutes)} min` : ''}</Text> : null}
    </View> : null}
  </View></CoachMarkTarget>;
}

const s = StyleSheet.create({
  summary: { gap: 10, paddingBottom: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, stacked: { flexDirection: 'column', alignItems: 'stretch' },
  target: { flex: 1, minWidth: 0, gap: 3 }, telemetry: { flexShrink: 1, maxWidth: '45%', alignItems: 'flex-end', gap: 3 }, telemetryStacked: { maxWidth: '100%', alignItems: 'flex-start' },
  details: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 8 }, detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
