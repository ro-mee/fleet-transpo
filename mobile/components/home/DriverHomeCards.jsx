import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Image, LayoutAnimation, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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

const HOTEL_IMAGE = require('../../assets/images/hotel.png');
const MAP_IMAGE = require('../../assets/images/map.png');

// Memoized presentational layer: Home re-renders on 30 s ticks, poster and
// notification publishes — cards with stable props skip reconciliation. The
// countdown-driven trip cards still update via nowMs (by design).
export const DriverHeroCard = memo(function DriverHeroCard({ upcoming, capped, completed, vehicle, confirmed, profileConfirmed, onTrips, onHistory, onVehicle }) {
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  const { settings } = useSettings();
  const [failedImage, setFailedImage] = useState(null);
  const imageUri = vehicle?.imageUri;
  const isDark = scheme === 'dark';
  const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  // Light mode pale mint clay background matching reference 1:1; dark mode uses primaryContainer
  const kpiBgColor = isDark ? colors.primaryContainer : '#E5EEE7';
  const kpiTextColor = isDark ? colors.onPrimaryContainer : '#09211A';
  const kpiActionColor = isDark ? colors.onPrimaryContainer : '#15483A';
  const iconTileBg = isDark ? colors.surfaceContainerLow : '#F3F7F4';

  return <View style={[s.heroShell, { ...mats.clayShade, shadowColor: colors.shadow, backgroundColor: colors.surfaceContainerLow }]}>
    <View style={s.hero}>
      {/* 3D Hotel Background Scenery matching reference 1:1 */}
      <Image
        source={HOTEL_IMAGE}
        resizeMode="contain"
        accessible={false}
        style={[s.hotelBg, isDark && { opacity: 0.65 }]}
      />

      {/* Header Text */}
      <View style={s.heroHeader}>
        <Text style={[type.caption, s.heroDate, { color: colors.primary }]}>{date.toLocaleUpperCase()}</Text>
        <Text style={[type.body, s.heroSubtitle, { color: colors.onSurfaceVariant }]}>
          Smooth rides. Happy guests.
        </Text>
      </View>

      {/* 2 KPI Stat Cards */}
      <View style={s.metrics}>
        {[
          { label: 'Upcoming trips', value: confirmed ? `${upcoming}${capped ? '+' : ''}` : '—', caption: confirmed ? 'View assignments' : 'Not yet confirmed', icon: 'calendar', action: onTrips },
          { label: 'Trips completed', value: completed ?? '—', caption: 'All time', icon: 'checkmark-circle', action: onHistory },
        ].map(m => <Pressable key={m.label} onPress={m.action} accessibilityRole="button" accessibilityLabel={`${m.label}: ${m.value}. ${m.caption}`} style={({ pressed }) => [s.metric, { ...mats.compactShade, backgroundColor: kpiBgColor, shadowColor: colors.shadow }, pressed && s.ctaPressed]}>
          {!settings.highContrast && Platform.OS !== 'android' && <LinearGradient pointerEvents="none" colors={isDark ? ['rgba(255,255,255,0.05)', 'transparent'] : ['rgba(255,255,255,0.6)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} />}
          <View style={s.metricTopRow}>
            <View style={[s.metricIconTile, { ...mats.clayTile, backgroundColor: iconTileBg, shadowColor: colors.shadow }]}>
              <Ionicons name={m.icon} size={18} color={colors.primary} />
            </View>
            <Text style={[s.metricValue, { color: kpiTextColor }]}>{m.value}</Text>
          </View>
          <Text style={[s.metricLabel, { color: kpiTextColor }]}>{m.label}</Text>
          <View style={s.metricActionRow}>
            <Text style={[s.metricActionText, { color: kpiActionColor }]}>{m.caption}</Text>
            <Ionicons name="chevron-forward" size={12} color={kpiActionColor} />
          </View>
        </Pressable>)}
      </View>

      {/* Assigned Vehicle Section (preserved untouched per instructions) */}
      <Pressable onPress={onVehicle} accessibilityRole="button" accessibilityLabel="View assigned vehicle" style={({ pressed }) => [s.vehicle, { ...mats.compactShade, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }, pressed && s.ctaPressed]}>
        <HomeClayIcon name="car-sport" small />
        <View style={s.flex}><Text style={type.caption}>Assigned vehicle</Text><Text style={type.labelLg}>{vehicle?.model || (vehicle ? 'Assigned vehicle' : profileConfirmed ? 'No assigned vehicle' : 'Not yet confirmed')}</Text>{vehicle?.plate ? <Text style={type.caption}>{vehicle.plate}</Text> : null}</View>
        {imageUri && failedImage !== imageUri ? <Image key={imageUri} source={{ uri: imageUri }} resizeMode="contain" fadeDuration={0} style={s.vehicleImage} onError={() => setFailedImage(imageUri)} accessible={false} /> : null}
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
    </View>
  </View>;
});

// One molded icon treatment for the Home metrics, vehicle and shortcuts.
function HomeClayIcon({ name, small = false }) {
  const { colors, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  return <View style={[s.actionIcon, small && s.smallIcon, { ...mats.clayTile, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    <Ionicons name={name} size={small ? 21 : 25} color={colors.primary} />
  </View>;
}

export const HomeQuickActions = memo(function HomeQuickActions({ actions }) {
  const [expanded, setExpanded] = useState(false);
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  const { settings } = useSettings();
  const { width, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3 || settings.textSize === 'large';
  const wide = width >= 700 && fontScale <= 1.15 && !largeText;
  const visible = wide || expanded ? actions : actions.slice(0, 4);

  const toggleExpanded = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  return <View style={[s.actions, { ...mats.clayShade, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    {[...visible, ...(!wide ? [{ label: expanded ? 'Less' : 'More', icon: expanded ? 'chevron-up' : 'ellipsis-horizontal', action: toggleExpanded, toggle: true }] : [])].map(a => <Pressable key={a.label} onPress={a.action} disabled={a.disabled} accessibilityRole="button" accessibilityLabel={a.label} accessibilityState={{ disabled: !!a.disabled, ...(a.toggle ? { expanded } : {}) }} style={({ pressed }) => [s.shortcut, { flexBasis: wide ? '13%' : largeText || width < 350 ? '30%' : '18%', opacity: a.disabled ? 0.5 : pressed ? QUICK_ACTION_PRESS.pressedOpacity : 1 }, pressed ? { transform: [{ scale: QUICK_ACTION_PRESS.scale }] } : null]}>
      <HomeClayIcon name={a.icon} />
      <Text style={[type.caption, { color: colors.onSurface, textAlign: 'center' }]}>{a.label}</Text>
    </Pressable>)}
  </View>;
});

/** Variant language for the assignment cards. Current = forest green; the
 *  next/then scheduled cards share a muted teal accent so "active now" and
 *  "coming up" are distinguishable at a glance within the green brand. */
const VARIANT = {
  current: { label: 'CURRENT TRIP', isCurrent: true },
  next: { label: 'NEXT TRIP', isCurrent: false },
  then: { label: 'THEN', isCurrent: false },
  upcoming: { label: 'UPCOMING', isCurrent: false },
};

export const DriverTripCard = memo(function DriverTripCard({ trip, current, confirmed, offline, nowMs, canManage, busy, trackingText, onAction, onDetails, variant }) {
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
  const stops = useMemo(() => [
    { label: 'Pickup', value: trip?.origin, time: depTime, first: true },
    { label: 'Drop-off', value: trip?.destination, time: null, first: false },
  ], [trip?.origin, trip?.destination, depTime]);

  return <View style={[s.trip, { ...mats.clayShade, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    {/* Inner top highlight — clay's "light from above". Skipped in
        high-contrast mode where decoration must not soften legibility. */}
    {!settings.highContrast && Platform.OS !== 'android' ? <LinearGradient pointerEvents="none" colors={scheme === 'dark' ? ['rgba(255,253,252,0.07)', 'rgba(255,253,252,0)'] : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.tripSheen} /> : null}
    <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
      <View style={[s.cardTag, pillEdges, { backgroundColor: accent }]}>
        <Text style={[type.label, { color: onAccent, letterSpacing: 0.8 }]}>{v.label}</Text>
      </View>
      {trip ? <View style={[s.status, pillEdges, { backgroundColor: sc.bg }]}>
        <View style={[s.statusDot, { backgroundColor: sc.fg }]} />
        <Text style={[type.caption, { color: sc.fg }]}>{trip.trip_status}</Text>
      </View> : null}
    </View>
    {!trip ? <View style={[s.empty, { flexDirection: 'row', alignItems: 'center', gap: 12 }, isCurrent && { gap: 14, minHeight: 90 }]}>
      {isCurrent && confirmed && !offline ? (
        <RadarPulse size={38} color={accent} icon="radio" />
      ) : null}
      <View style={s.flex}>
        <Text style={type.cardTitle}>{!confirmed ? offline ? 'No saved trips yet' : 'Assignments not confirmed' : isCurrent ? 'No active trip right now.' : 'No upcoming trip.'}</Text>
        <Text style={type.supporting}>{!confirmed ? offline ? 'Connect once to save your assignments.' : 'Pull to refresh or try again.' : offline ? 'Based on your last synced assignments.' : isCurrent ? 'Your active assignment will appear here when the trip begins.' : 'You’re all caught up for now.'}</Text>
      </View>
      {/* Decorative 3D map scenery for the non-current empty states (Next /
          Upcoming) — flex row keeps it right-aligned and vertically centered
          at any width, with no overlap into the text column. */}
      {!isCurrent ? <Image source={MAP_IMAGE} resizeMode="contain" accessible={false} style={[s.mapArt, scheme === 'dark' && { opacity: 0.85 }]} /> : null}
    </View> : <>
      <Text style={type.labelLg}>{validDate ? `${depDate} · ${depTime}` : 'Departure time not provided'}</Text>
      <View style={[s.tripBody, horizontal && { flexDirection: 'row' }]}>
        <View style={s.flex}>
          {stops.map(stop => <View key={stop.label} style={s.stop}>
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
          <TripMapPreview staticMode key={`${trip.trip_id}:${trip.origin_latitude}:${trip.origin_longitude}:${trip.destination_latitude}:${trip.destination_longitude}:${offline}`} trip={trip} offline={offline} airport={isCurrent && /\b(airport|NAIA)\b/i.test(trip.destination || '')} />
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
});

export const AssignmentsHeading = memo(function AssignmentsHeading({ onPress, title = 'Today’s Assignments' }) {
  const { colors, type } = useTheme();
  return <View style={[s.row, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
    <Text style={[type.titleLg, { flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="View full schedule" style={({ pressed }) => [s.scheduleLink, { flexShrink: 0 }, pressedStyle({ pressed })]}><Text style={[type.labelLg, { color: colors.primary }]}>View Full Schedule</Text><Ionicons name="chevron-forward" color={colors.primary} size={16} /></Pressable>
  </View>;
});

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroShell: { borderRadius: 28 },
  hero: { position: 'relative', overflow: 'hidden', borderRadius: 26, padding: 14 },
  hotelBg: { position: 'absolute', top: -4, right: -12, width: 275, height: 160, pointerEvents: 'none' },
  heroHeader: { maxWidth: '62%', zIndex: 1 },
  heroDate: { letterSpacing: 1.4, fontWeight: '700' },
  heroSubtitle: { marginTop: 3, fontSize: 14, lineHeight: 18 },
  metrics: { flexDirection: 'row', gap: 8, marginTop: 10, zIndex: 2 },
  metric: { flex: 1, minWidth: 120, padding: 10, borderRadius: 18, gap: 5 },
  metricTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricIconTile: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  metricValue: { fontSize: 26, fontWeight: '800', lineHeight: 28 },
  metricLabel: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  metricActionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metricActionText: { fontSize: 12, fontWeight: '600' },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, borderRadius: 20, padding: 10, minHeight: 64, zIndex: 2 },
  vehicleImage: { width: 64, height: 48, borderRadius: 10 }, smallIcon: { width: 38, height: 38, borderRadius: 15 },
  actions: { padding: 10, borderRadius: 24, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  shortcut: { alignItems: 'center', gap: 6, paddingVertical: 4, minWidth: 48 }, actionIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  trip: { borderRadius: 24, padding: 14, gap: 12 }, status: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  tripSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: 30, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  cardTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, justifyContent: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  placeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 }, place: { flex: 1, minWidth: 0 },
  ctaPressed: { transform: [{ scale: 0.98 }], opacity: 0.94 },
  tripBody: { gap: 10 }, stop: { flexDirection: 'row', gap: 10 }, track: { width: 22, alignItems: 'center', paddingTop: 4 }, node: { width: 20, height: 20, borderRadius: 10, borderWidth: 2.5 }, line: { width: 2, flex: 1, marginBottom: -4 }, stopText: { flex: 1, minWidth: 0, paddingBottom: 12, gap: 2 },
  cta: { minHeight: 48, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8 },
  empty: { minHeight: 84, gap: 8, justifyContent: 'center', paddingVertical: 8 }, mapArt: { width: 112, height: 90, transform: [{ translateY: -20 }] }, scheduleLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4 },
});
