import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { useSettings } from '../../lib/settings-context';
import { homeTripAction } from '../../lib/home-trips';
import { statusColorForTone, tripStatusTone } from '../../lib/theme';
import { QUICK_ACTION_PRESS } from '../../lib/quick-action-press.js';
import { homeMaterials as clayMaterials } from './materials';
import TripMapPreview from '../TripMapPreview';
import RadarPulse from '../RadarPulse';

// Assignment controls retain their scheme-specific clay edges.
const raisedControl = { borderTopWidth: 2, borderTopColor: '#FFFFFF55', borderBottomWidth: 3, borderBottomColor: '#00000028', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 7, elevation: 5 };
// Dark variant for raised controls on scheme-dependent accent surfaces.
const raisedControlDark = { borderTopWidth: 1.5, borderTopColor: 'rgba(255,255,255,0.12)', borderBottomWidth: 1.5, borderBottomColor: 'rgba(0,0,0,0.40)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 9, elevation: 5 };
// Status pill edges, light and dark (geometry lives in s.status).
const pillEdgesLight = { borderTopWidth: 2, borderTopColor: '#FFFFFF60', borderBottomWidth: 2, borderBottomColor: '#00000012' };
const pillEdgesDark = { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)', borderBottomWidth: 1.5, borderBottomColor: 'rgba(0,0,0,0.35)' };
const pressedStyle = ({ pressed }) => pressed ? { opacity: 0.72 } : null;

export function DriverHeroCard({ upcoming, capped, completed, vehicle, confirmed, profileConfirmed, offline, onTrips, onHistory, onVehicle }) {
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  const { settings } = useSettings();
  const [failedImage, setFailedImage] = useState(null);
  const imageUri = vehicle?.imageUri;
  const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  return <View style={[s.heroShell, { ...mats.clayShade, shadowColor: colors.shadow, backgroundColor: colors.surfaceContainerLow }]}>
    <View style={s.hero}>
      <Text style={[type.caption, { color: colors.primary, letterSpacing: 1.2 }]}>{date.toLocaleUpperCase()}</Text>
      <Text style={[type.titleLg, { marginTop: 5 }]}>{offline ? 'Your saved dashboard' : 'Ready for what’s next?'}</Text>
      <View style={s.metrics}>
        {[
          { label: 'Upcoming trips', value: confirmed ? `${upcoming}${capped ? '+' : ''}` : '—', caption: confirmed ? 'View assignments' : 'Not yet confirmed', icon: 'calendar', action: onTrips },
          { label: 'Trips completed', value: completed ?? '—', caption: 'All time', icon: 'checkmark-circle', action: onHistory },
        ].map(m => <Pressable key={m.label} onPress={m.action} accessibilityRole="button" accessibilityLabel={`${m.label}: ${m.value}. ${m.caption}`} style={({ pressed }) => [s.metric, { ...mats.compactShade, backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }, pressed && s.ctaPressed]}>
          {!settings.highContrast && <LinearGradient pointerEvents="none" colors={[colors.surfaceContainerLow + '88', colors.primaryContainer]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 19 }]} />}
          <View style={s.row}><HomeClayIcon name={m.icon} small /><Text style={[type.headlineMd, { color: colors.onPrimaryContainer }]}>{m.value}</Text></View>
          <Text style={[type.labelLg, { color: colors.onPrimaryContainer }]}>{m.label}</Text>
          <View style={s.row}><Text style={[type.caption, s.flex, { color: colors.onPrimaryContainer }]}>{m.caption}</Text><Ionicons name="chevron-forward" size={14} color={colors.onPrimaryContainer} /></View>
        </Pressable>)}
      </View>
      <Pressable onPress={onVehicle} accessibilityRole="button" accessibilityLabel="View assigned vehicle" style={({ pressed }) => [s.vehicle, { ...mats.compactShade, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }, pressed && s.ctaPressed]}>
        <HomeClayIcon name="car-sport" small />
        <View style={s.flex}><Text style={type.caption}>Assigned vehicle</Text><Text style={type.labelLg}>{vehicle?.model || (vehicle ? 'Assigned vehicle' : profileConfirmed ? 'No assigned vehicle' : 'Not yet confirmed')}</Text>{vehicle?.plate ? <Text style={type.caption}>{vehicle.plate}</Text> : null}</View>
        {imageUri && failedImage !== imageUri ? <Image key={imageUri} source={{ uri: imageUri }} resizeMode="contain" style={s.vehicleImage} onError={() => setFailedImage(imageUri)} accessible={false} /> : null}
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
    </View>
  </View>;
}

// One molded icon treatment for the Home metrics, vehicle and shortcuts.
function HomeClayIcon({ name, small = false }) {
  const { colors, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  return <View style={[s.actionIcon, small && s.smallIcon, { ...mats.clayTile, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    <Ionicons name={name} size={small ? 21 : 25} color={colors.primary} />
  </View>;
}

export function HomeQuickActions({ actions }) {
  const [expanded, setExpanded] = useState(false);
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  const { settings } = useSettings();
  const { width, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3 || settings.textSize === 'large';
  const wide = width >= 700 && fontScale <= 1.15 && !largeText;
  const visible = wide || expanded ? actions : actions.slice(0, 4);
  return <View style={[s.actions, { ...mats.clayShade, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    {[...visible, ...(!wide ? [{ label: expanded ? 'Less' : 'More', icon: expanded ? 'chevron-up' : 'ellipsis-horizontal', action: () => setExpanded(!expanded), toggle: true }] : [])].map(a => <Pressable key={a.label} onPress={a.action} disabled={a.disabled} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{ disabled: !!a.disabled, ...(a.toggle ? { expanded } : {}) }} style={({ pressed }) => [s.shortcut, { flexBasis: wide ? '13%' : largeText || width < 350 ? '30%' : '18%', opacity: a.disabled ? 0.5 : pressed ? QUICK_ACTION_PRESS.pressedOpacity : 1, transform: pressed ? [{ scale: QUICK_ACTION_PRESS.scale }] : undefined }]}>
      <HomeClayIcon name={a.icon} />
      <Text style={[type.caption, { color: colors.onSurface, textAlign: 'center' }]}>{a.label}</Text>
    </Pressable>)}
  </View>;
}

/** Variant language for the assignment cards. Current = forest green; the
 *  next/then scheduled cards share a muted teal accent so "active now" and
 *  "coming up" are distinguishable at a glance within the green brand. */
const VARIANT = {
  current: { label: 'CURRENT TRIP', isCurrent: true },
  next: { label: 'NEXT TRIP', isCurrent: false },
  then: { label: 'THEN', isCurrent: false },
};

export function DriverTripCard({ trip, current, confirmed, offline, nowMs, canManage, busy, trackingText, onAction, onDetails, variant }) {
  const { colors, type, scheme } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const { settings } = useSettings();
  const mats = clayMaterials(scheme === 'dark');
  // Raised-control and pill edges for the scheme-dependent surfaces in this
  // card (accent tag, primary CTA, status pill) — the light recipe washes
  // out on dark's pale accents.
  const raised = scheme === 'dark' ? raisedControlDark : raisedControl;
  const pillEdges = scheme === 'dark' ? pillEdgesDark : pillEdgesLight;
  const v = VARIANT[variant] ?? (current ? VARIANT.current : VARIANT.next);
  const isCurrent = v.isCurrent;
  // Current card: forest green. Scheduled cards: muted teal.
  const accent = isCurrent ? colors.primary : colors.info;
  const onAccent = isCurrent ? colors.onPrimary : '#FFFFFF';
  const action = trip ? homeTripAction(trip, nowMs) : null;
  const date = trip?.departure_time ? new Date(trip.departure_time) : null;
  const validDate = date && Number.isFinite(date.getTime());
  const depTime = validDate ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const depDate = validDate ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;
  // Live trip status — the real trip_status, never a hardcoded label.
  const sc = statusColorForTone(colors, tripStatusTone(trip?.trip_status));
  const horizontal = width >= 420 && fontScale < 1.2 && settings.textSize !== 'large';
  return <View style={[s.trip, { ...mats.clayShade, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    {/* Inner top highlight — clay's "light from above". Skipped in
        high-contrast mode where decoration must not soften legibility. */}
    {!settings.highContrast ? <LinearGradient pointerEvents="none" colors={scheme === 'dark' ? ['rgba(255,253,252,0.07)', 'rgba(255,253,252,0)'] : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.tripSheen} /> : null}
    <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
      <View style={[s.cardTag, raised, { backgroundColor: accent }]}>
        <Text style={[type.label, { color: onAccent, letterSpacing: 0.8 }]}>{v.label}</Text>
      </View>
      {trip ? <View style={[s.status, pillEdges, { backgroundColor: sc.bg }]}>
        <View style={[s.statusDot, { backgroundColor: sc.fg }]} />
        <Text style={[type.caption, { color: sc.fg }]}>{trip.trip_status}</Text>
      </View> : null}
    </View>
    {!trip ? <View style={[s.empty, isCurrent && { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 90 }]}>
      {isCurrent && confirmed && !offline ? (
        <RadarPulse size={38} color={accent} icon="radio" />
      ) : null}
      <View style={s.flex}>
        <Text style={type.cardTitle}>{!confirmed ? offline ? 'No saved trips yet' : 'Assignments not confirmed' : isCurrent ? 'No active trip right now.' : 'No upcoming trip.'}</Text>
        <Text style={type.supporting}>{!confirmed ? offline ? 'Connect once to save your assignments.' : 'Pull to refresh or try again.' : offline ? 'Based on your last synced assignments.' : isCurrent ? 'Your active assignment will appear here when the trip begins.' : 'You’re all caught up for now.'}</Text>
      </View>
    </View> : <>
      <Text style={type.labelLg}>{validDate ? `${depDate} · ${depTime}` : 'Departure time not provided'}</Text>
      <View style={[s.tripBody, horizontal && { flexDirection: 'row' }]}>
        <View style={s.flex}>
          {[
            { label: 'Pickup', value: trip.origin, time: depTime, first: true },
            { label: 'Drop-off', value: trip.destination, time: null, first: false },
          ].map(stop => <View key={stop.label} style={s.stop}>
            <View style={s.track}><View style={[s.node, { backgroundColor: stop.first ? accent : colors.surfaceContainerLow, borderColor: accent }]} />{stop.first ? <View style={[s.line, { backgroundColor: accent }]} /> : null}</View>
            <View style={s.stopText}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={type.caption}>{stop.label}</Text>
                {stop.time ? <Text style={[type.labelLg, { color: colors.onSurface }]}>{stop.time}</Text> : null}
              </View>
              <View style={s.placeRow}>
                <Ionicons name="location-outline" size={16} color={accent} />
                <Text style={[type.cardTitle, s.place]}>{stop.value || 'Location not provided'}</Text>
              </View>
            </View>
          </View>)}
          {trip.passenger_count != null ? <View style={s.row}><Ionicons name="people" size={16} color={accent} /><Text style={type.supporting}>{trip.passenger_count} {Number(trip.passenger_count) === 1 ? 'passenger' : 'passengers'}</Text></View> : null}
        </View>
        <View style={horizontal ? { width: '42%', gap: 12 } : { gap: 12 }}>
          <TripMapPreview key={`${trip.trip_id}:${trip.origin_latitude}:${trip.origin_longitude}:${trip.destination_latitude}:${trip.destination_longitude}:${offline}`} trip={trip} offline={offline} airport={isCurrent && /\b(airport|NAIA)\b/i.test(trip.destination || '')} />
      <Pressable onPress={() => isCurrent && canManage && action !== 'Trip Details' ? onAction(trip) : onDetails(trip)} disabled={busy} accessibilityRole="button" accessibilityLabel={isCurrent && canManage ? action : 'Trip Details'} accessibilityState={{ disabled: !!busy, busy: !!busy }} style={({ pressed }) => [s.cta, raised, { backgroundColor: colors.primary, shadowColor: colors.shadow }, busy ? { opacity: 0.6 } : pressed ? s.ctaPressed : null]}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name={isCurrent && action !== 'Trip Details' ? 'play' : 'document-text-outline'} size={20} color={colors.onPrimary} />}
        <Text style={[type.labelLg, { color: colors.onPrimary }]}>{isCurrent && canManage ? action : 'Trip Details'}</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.onPrimary} />
      </Pressable>
        </View>
      </View>
      {trackingText ? <Text style={type.caption}>{trackingText}</Text> : null}

    </>}
  </View>;
}

export function AssignmentsHeading({ onPress }) {
  const { colors, type } = useTheme();
  return <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
    <Text style={type.titleLg}>Today’s Assignments</Text>
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="View full schedule" style={({ pressed }) => [s.scheduleLink, pressedStyle({ pressed })]}><Text style={[type.labelLg, { color: colors.primary }]}>View Full Schedule</Text><Ionicons name="chevron-forward" color={colors.primary} size={16} /></Pressable>
  </View>;
}

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroShell: { borderRadius: 28 }, hero: { overflow: 'hidden', borderRadius: 26, padding: 14 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }, metric: { flex: 1, minWidth: 120, padding: 10, gap: 4, borderRadius: 20 },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, borderRadius: 20, padding: 10, minHeight: 64 },
  vehicleImage: { width: 64, height: 48, borderRadius: 10 }, smallIcon: { width: 38, height: 38, borderRadius: 15 },
  actions: { padding: 10, borderRadius: 24, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  shortcut: { alignItems: 'center', gap: 6, paddingVertical: 4, minWidth: 48 }, actionIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  trip: { borderRadius: 24, padding: 14, gap: 12 }, status: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  tripSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: 30, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  cardTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, justifyContent: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  placeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 }, place: { flex: 1, minWidth: 0 },
  ctaPressed: { transform: [{ scale: 0.98 }], opacity: 0.94 },
  tripBody: { gap: 10 }, stop: { flexDirection: 'row', gap: 10 }, track: { width: 22, alignItems: 'center', paddingTop: 4 }, node: { width: 20, height: 20, borderRadius: 10, borderWidth: 2.5, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 }, line: { width: 2, flex: 1, marginBottom: -4 }, stopText: { flex: 1, minWidth: 0, paddingBottom: 12, gap: 2 },
  preview: { height: 126, overflow: 'hidden', borderRadius: 16 }, mapMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 },
  cta: { minHeight: 48, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8 },
  empty: { minHeight: 84, gap: 8, justifyContent: 'center', paddingVertical: 8 }, scheduleLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4 },
});
