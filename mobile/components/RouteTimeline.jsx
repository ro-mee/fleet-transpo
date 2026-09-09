// Shared pickup→drop-off timeline for the Trips list and Trip Details.
// Extracted from Home's DriverTripCard visual language (clay nodes + accent
// track) so both reworked screens render routes identically. Home keeps its
// own copy — its files are another session's WIP and stay untouched.

import { Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../lib/theme-context';

/**
 * Props:
 *  - stops: [{ label, value, time }] — rendered in order; `value` missing shows
 *    "Location not provided", `time` (pre-formatted string) is optional.
 *  - accent: color for nodes/track (defaults to theme primary).
 */
export default function RouteTimeline({ stops, accent }) {
  const { colors, type } = useTheme();
  const line = accent || colors.primary;
  return <View style={s.wrap}>
    {stops.map((stop, i) => (
      <View key={stop.label + ':' + i} style={s.stop}>
        <View style={s.track}>
          <View style={[s.node, { backgroundColor: i === 0 ? line : colors.surfaceContainerLow, borderColor: line, shadowColor: colors.shadow }]} />
          {i === 0 ? <View style={[s.rail, { backgroundColor: line }]} /> : null}
        </View>
        <View style={s.stopText}>
          <Text style={type.caption}>{stop.label}{stop.time ? ` · ${stop.time}` : ''}</Text>
          <Text style={type.cardTitle}>{stop.value || 'Location not provided'}</Text>
        </View>
      </View>
    ))}
  </View>;
}

const s = StyleSheet.create({
  wrap: { gap: 0 },
  stop: { flexDirection: 'row', gap: 12 },
  track: { width: 26, alignItems: 'center', paddingTop: 4 },
  node: { width: 24, height: 24, borderRadius: 12, borderWidth: 3, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
  rail: { width: 2, flex: 1, marginBottom: -4 },
  stopText: { flex: 1, minWidth: 0, paddingBottom: 18, gap: 3 },
});
