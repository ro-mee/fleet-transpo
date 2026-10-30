import React from 'react';
import { View, Text } from 'react-native';
import { useTheme } from '../../lib/theme-context';
import { ClayButton } from '../clay/ClayButton';

// A list entry remains available when an assigned pickup cannot have a map pin.
export default function MapAssignmentNotice({ trips, confirmed, onOpen }) {
  const { colors, type } = useTheme();
  const unresolved = trips.some(trip => trip.origin_latitude == null || trip.origin_longitude == null || String(trip.origin_latitude).trim() === '' || String(trip.origin_longitude).trim() === '' || !Number.isFinite(Number(trip.origin_latitude)) || Math.abs(Number(trip.origin_latitude)) > 90 || !Number.isFinite(Number(trip.origin_longitude)) || Math.abs(Number(trip.origin_longitude)) > 180 || trip.pickup_location_provenance && trip.pickup_location_provenance !== 'canonical_registry');
  if (!trips.length) return null;
  return <View style={{ gap: 8, paddingTop: 8 }}>
    <Text style={[type.labelLg, { color: colors.onSurface }]}>{trips.length} assignment{trips.length === 1 ? '' : 's'}{confirmed ? ' available' : ' saved'}</Text>
    {!confirmed ? <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>Refresh to confirm your assignments before acting.</Text> : null}
    {unresolved ? <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>A pickup location needs verification. Review the assignment in Trips.</Text> : null}
    <ClayButton label="View assignments" variant="tonal" onPress={onOpen} />
  </View>;
}
