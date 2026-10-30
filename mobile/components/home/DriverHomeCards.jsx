import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, Image, LayoutAnimation, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { useSettings } from '../../lib/settings-context';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { homeTripAction, homeTripReadiness } from '../../lib/home-trips';
import { statusColorForTone, tripStatusTone, fonts } from '../../lib/theme';
import { moderateScale } from '../../lib/scaling';
import { QUICK_ACTION_PRESS } from '../../lib/quick-action-press.js';
import { isCargoLoad, loadTitle, loadSubtitle, tripStatusLabel } from '../../lib/load-presentation.js';
import { homeMaterials as clayMaterials } from './materials';
import { ClayCard } from '../clay';
import TripMapPreview from '../TripMapPreview';
import RadarPulse from '../RadarPulse';
import OffDutyIllustration from '../OffDutyIllustration';
import { CoachMarkTarget, useCoachMarkActions, useCoachMarkStatus } from '../coachmarks';

// Assignment controls retain their scheme-specific clay edges.
const raisedControl = { borderTopWidth: 2, borderTopColor: '#FFFFFF55', borderBottomWidth: 3, borderBottomColor: '#00000028', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 7, elevation: 5 };
// Dark variant for raised controls on scheme-dependent accent surfaces.
const raisedControlDark = { borderTopWidth: 1.5, borderTopColor: 'rgba(255,255,255,0.12)', borderBottomWidth: 1.5, borderBottomColor: 'rgba(0,0,0,0.40)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 9, elevation: 5 };
// Status pill edges, light and dark (geometry lives in s.status).
const pillEdgesLight = { borderTopWidth: 2, borderTopColor: '#FFFFFF60', borderBottomWidth: 2, borderBottomColor: '#00000012' };
const pillEdgesDark = { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)', borderBottomWidth: 1.5, borderBottomColor: 'rgba(0,0,0,0.35)' };
const pressedStyle = ({ pressed }) => pressed ? { opacity: 0.72 } : null;

const HOTEL_IMAGE = require('../../assets/images/hotel.png');
const CARGO_IMAGE = require('../../assets/images/cargo-depot.png');
const MAP_IMAGE = require('../../assets/images/map.png');

export const DriverDutyStatus = memo(function DriverDutyStatus({ duty, activeTrip, workspaceMode, ink }) {
  const { colors, type } = useTheme();
  const known = duty?.loaded;
  const onDuty = known && duty.checkedIn;
  const state = !known ? 'Checking duty status' : !onDuty ? 'Off Duty' : activeTrip
    ? `On Duty · ${tripStatusLabel(activeTrip.trip_status, activeTrip.load_type)}`
    : duty.busy ? 'On Duty · Busy' : 'On Duty · Standby';
  const detail = !known ? 'Connect and refresh to confirm your current duty.' : activeTrip
    ? `Follow your current ${workspaceMode === 'cargo' ? 'cargo' : 'passenger'} assignment.`
    : !onDuty ? duty.today?.blocked ? 'No duty scheduled today. Check your work schedule.' : 'Start with your Pre-Shift inspection.'
    : duty.busy ? 'Finish your current work before ending duty.' : 'Waiting for your next assignment.';
  return <View style={[s.dutyRibbon, { borderTopColor: (ink || colors.onSurface) + '40' }]}>
    <Ionicons name={onDuty ? 'shield-checkmark-outline' : 'time-outline'} size={20} color={ink || colors.primary} accessible={false} />
    <View style={s.flex}>
      <Text accessibilityLiveRegion="polite" style={[type.labelLg, { color: ink || colors.onSurface }]}>{state}</Text>
      <Text style={[type.caption, { color: ink || colors.onSurfaceVariant }]}>{detail}</Text>
    </View>
  </View>;
});

// Memoized presentational layer: Home re-renders on 30 s ticks, poster and
// notification publishes — cards with stable props skip reconciliation. The
// countdown-driven trip cards still update via nowMs (by design).
export const DriverHeroCard = memo(function DriverHeroCard({ upcoming, capped, completed, vehicle, confirmed, profileConfirmed, onTrips, onHistory, onVehicle, workspaceMode = 'unclassified', duty = null, activeTrip = null, showDuty = true }) {
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  const { settings } = useSettings();
  const { width, fontScale } = useWindowDimensions();
  const [failedImage, setFailedImage] = useState(null);
  const imageUri = vehicle?.imageUri;
  const isDark = scheme === 'dark';
  const cargo = workspaceMode === 'cargo';
  const spacious = width < 360 || fontScale > 1.3 || settings.textSize === 'large';
  const textScale = (type.caption?.fontSize ?? moderateScale(12)) / moderateScale(12);
  const date = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const illustrated = !settings.highContrast && (cargo || workspaceMode === 'passenger');
  const sceneBg = settings.highContrast ? colors.surface : cargo ? (isDark ? colors.primaryContainer : colors.primary) : colors.secondaryContainer;
  const sceneInk = settings.highContrast ? colors.onSurface : cargo ? (isDark ? colors.onPrimaryContainer : colors.onPrimary) : colors.onSecondaryContainer;

  return <View style={[s.heroShell, { ...mats.clayShade, shadowColor: colors.shadow, backgroundColor: colors.surfaceContainerLow }]}>
    <View style={[s.heroScene, { backgroundColor: sceneBg }]}>
      <Text style={[type.caption, { color: sceneInk }]}>{date}</Text>
      <View style={[s.sceneComposition, spacious && s.sceneCompositionStacked, !illustrated && s.sceneCompositionPlain]}>
        <Text accessibilityRole="header" style={[s.sceneTitle, { color: sceneInk, fontSize: moderateScale(24) * textScale, lineHeight: moderateScale(30) * textScale }, (!illustrated || spacious) && s.sceneTitleWide]}>
          {cargo ? 'Cargo work. Clear deliveries.' : workspaceMode === 'passenger' ? 'Smooth rides. Happy guests.' : 'Your workday at a glance.'}
        </Text>
        {illustrated ? <Image source={cargo ? CARGO_IMAGE : HOTEL_IMAGE} resizeMode="contain" accessible={false} style={[s.sceneArt, spacious && s.sceneArtStacked]} /> : null}
      </View>
      {showDuty ? <DriverDutyStatus duty={duty} activeTrip={activeTrip} workspaceMode={workspaceMode} ink={sceneInk} /> : null}
    </View>
    <View style={s.heroSummary}>
      <View style={[s.metrics, spacious && s.metricsStacked]}>
        {[
          { label: 'Upcoming trips', value: confirmed ? `${upcoming}${capped ? '+' : ''}` : '—', caption: confirmed ? cargo ? 'Assigned queue' : 'View assignments' : 'Not yet confirmed', action: onTrips },
          { label: 'Trips completed', value: completed ?? '—', caption: 'All time', action: onHistory },
        ].map((m, index) => <Pressable key={m.label} onPress={m.action} accessibilityRole="button" accessibilityLabel={`${m.label}: ${m.value}. ${m.caption}`} style={({ pressed }) => [s.metric, spacious && s.metricStacked, index === 1 && (spacious ? { borderTopWidth: 1, borderTopColor: colors.outlineVariant, paddingTop: 12 } : { borderLeftWidth: 1, borderLeftColor: colors.outlineVariant, paddingLeft: 16 }), pressed && s.ctaPressed]}>
          <Text style={[s.metricValue, { fontSize: moderateScale(30) * textScale, lineHeight: moderateScale(36) * textScale, color: colors.primary }]}>{m.value}</Text>
          <View style={spacious ? s.flex : null}>
            <Text style={[type.labelLg, { color: colors.onSurface }]}>{m.label}</Text>
            <View style={s.metricActionRow}>
              <Text style={[type.caption, s.flex, { color: colors.onSurfaceVariant }]}>{m.caption}</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.primary} accessible={false} />
            </View>
          </View>
        </Pressable>)}
      </View>
      <Pressable onPress={onVehicle} accessibilityRole="button" accessibilityLabel="View assigned vehicle" style={({ pressed }) => [s.vehicle, { borderTopColor: colors.outlineVariant }, pressed && s.ctaPressed]}>
        <View style={[s.vehicleIcon, { backgroundColor: cargo ? colors.primaryContainer : colors.secondaryContainer }]}><MaterialCommunityIcons name={cargo ? 'truck-outline' : 'car-outline'} size={23} color={cargo ? colors.onPrimaryContainer : colors.onSecondaryContainer} accessible={false} /></View>
        <View style={s.flex}><Text style={type.caption}>Assigned vehicle</Text><Text style={type.labelLg}>{vehicle?.model || (vehicle ? 'Assigned vehicle' : profileConfirmed ? 'No assigned vehicle' : 'Not yet confirmed')}</Text>{vehicle?.plate ? <Text style={type.caption}>{vehicle.plate}</Text> : null}</View>
        {imageUri && failedImage !== imageUri && !spacious ? <Image key={imageUri} source={{ uri: imageUri }} resizeMode="contain" fadeDuration={0} style={s.vehicleImage} onError={() => setFailedImage(imageUri)} accessible={false} /> : null}
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
    </View>
  </View>;
});

function workspaceHeading(workspace) {
  return workspace.mode === 'unclassified' ? 'Driver type needs setup' : workspace.mode === 'cargo' ? 'Cargo workspace' : 'Passenger workspace';
}

function workspaceProblem(workspace) {
  if (workspace.reason === 'missing_driver_type' || workspace.reason === 'unsupported_driver_type') return 'Ask Fleet or Dispatch to set your driver type to Cargo or Passenger before continuing.';
  if (workspace.reason === 'driver_vehicle_mismatch') return 'The vehicle work type does not match your driver type. Ask Fleet or Dispatch to correct the assignment before continuing.';
  if (workspace.reason === 'no_vehicle') return 'No vehicle is assigned. Ask Fleet or Dispatch to assign your vehicle.';
  if (workspace.reason === 'missing_operational_use') return 'Your vehicle work type is missing. Ask Fleet or Dispatch to confirm Cargo or Passenger use.';
  if (workspace.reason === 'trip_type_mismatch') return 'The saved trip type does not match your driver type. Ask Fleet or Dispatch to correct the assignment before continuing.';
  return 'The saved trip type is missing. Ask Fleet or Dispatch to confirm it before continuing.';
}

// Saved driver type chooses this workspace; service metadata only labels its source.
export const DriverWorkspaceCard = memo(function DriverWorkspaceCard({ workspace, trip, assignedVehicle, loading = false, compact = false }) {
  const { colors, type } = useTheme();
  const cargo = workspace.mode === 'cargo';
  const unassigned = workspace.mode === 'unclassified';
  const blocked = workspace.reason != null;
  // Never borrow the standing plate for a different active-trip vehicle.
  const plate = trip ? trip.vehicle_plate || trip.plate_number : assignedVehicle?.plate || assignedVehicle?.plateNumber || assignedVehicle?.plate_number;
  const service = `${trip?.service_code || ''} ${trip?.service_name || ''}`;
  const source = /\bRESTAURANT(?:_|\b)/i.test(service) ? 'Restaurant cargo' : /\bHOTEL(?:_|\b)/i.test(service) ? 'Hotel cargo' : 'Cargo assignment';
  const heading = loading ? "Checking driver type" : workspaceHeading(workspace);
  const problem = loading ? "Confirming your saved driver profile." : workspaceProblem(workspace);
  if (compact && !loading && !unassigned && !blocked) return <View style={[s.row, { paddingHorizontal: 4 }]}><Ionicons name={cargo ? 'cube-outline' : 'car-outline'} size={16} color={colors.primary} /><Text style={type.caption}>{heading}</Text></View>;
  return <ClayCard variant="standard">
    <View style={[s.row, { alignItems: 'flex-start' }]}>
      <Ionicons name={unassigned ? 'help-circle-outline' : cargo ? 'cube-outline' : 'car-outline'} size={24} color={colors.primary} accessible={false} />
      <View style={s.flex}>
        <Text style={[type.cardTitle, { color: colors.onSurface }]}>{heading}</Text>
        {plate ? <Text style={[type.labelLg, { color: colors.onSurfaceVariant }]}>{plate}</Text> : null}
      </View>
    </View>
    {unassigned || blocked ? <Text style={[type.supporting, { color: colors.onSurface }]} accessibilityLiveRegion="polite">{problem}</Text> : trip ? <>
      <Text style={[type.labelLg, { color: colors.primary }]}>{cargo ? source : 'Hotel transportation'}</Text>
      <Text style={[type.cardTitle, { color: colors.onSurface }]}>{loadTitle(trip)}</Text>
      {loadSubtitle(trip) ? <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{loadSubtitle(trip)}</Text> : null}
      {!cargo && trip.is_vip ? <Text style={[type.labelLg, { color: colors.primary }]}>VIP guest</Text> : null}
      <Text style={[type.supporting, { color: colors.onSurface }]}>{tripStatusLabel(trip.trip_status, cargo ? 'Cargo' : 'Passenger')}</Text>
    </> : <>
      <Text style={[type.labelLg, { color: colors.onSurface }]}>{cargo ? 'No active cargo trip' : 'No active passenger trip'}</Text>
      <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{cargo ? 'Your cargo manifest and pickup or delivery progress will appear here when a trip begins.' : 'Your hotel transportation and guest transfer details will appear here when a trip begins.'}</Text>
    </>}
  </ClayCard>;
});

// One molded icon treatment for the Home metrics, vehicle and shortcuts.
function HomeClayIcon({ name, warm = false }) {
  const { colors, scheme } = useTheme();
  const mats = clayMaterials(scheme === 'dark');
  return <View style={[s.actionIcon, { ...mats.clayTile, backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    <Ionicons name={name} size={24} color={warm ? colors.secondary : colors.primary} />
  </View>;
}

export const HomeQuickActions = memo(function HomeQuickActions({ actions, scrollRef, cargo = false }) {
  const reduceMotion = useReducedMotion();
  const { activeMilestone, walkthroughActive, tutorialTransitioning, pendingTourDestination } = useCoachMarkStatus();
  const { notifyInteraction, isTourShortcutActive } = useCoachMarkActions();
  const [expanded, setExpanded] = useState(false);
  const { colors, type } = useTheme();
  const { settings } = useSettings();
  const { width, fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3 || settings.textSize === 'large';
  const wide = width >= 700 && fontScale <= 1.15 && !largeText;
  const visible = wide || expanded ? actions : actions.slice(0, 4);

  const toggleExpanded = () => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  return <View style={s.actions}>
    {[...visible, ...(!wide ? [{ label: expanded ? 'Less' : 'More', icon: expanded ? 'chevron-up' : 'ellipsis-horizontal', action: toggleExpanded, toggle: true }] : [])].map(a => {
      const targetId = a.targetId || (a.label === 'Report Incident' ? 'home.shortcut_incident' : a.label === 'Fuel' ? 'home.shortcut_fuel' : null);
      const handlePress = async () => {
        const isIncidentTour =
          activeMilestone === 'tour_incident' ||
          (isTourShortcutActive ? isTourShortcutActive('Report Incident') : (
            walkthroughActive && (tutorialTransitioning || pendingTourDestination === 'tour_incident' || pendingTourDestination === '/incidents?tour=1')
          ));

        if (a.label === 'Report Incident') {
          if (isIncidentTour) {
            await notifyInteraction('home.shortcut_incident');
            return;
          }
          if (walkthroughActive || tutorialTransitioning) {
            return;
          }
        }

        const isFuelTour =
          activeMilestone === 'tour_fuel' ||
          (isTourShortcutActive ? isTourShortcutActive('Fuel') : (
            walkthroughActive && (tutorialTransitioning || pendingTourDestination === 'tour_fuel' || pendingTourDestination === '/fuel-report?tour=1')
          ));

        if (a.label === 'Fuel') {
          if (isFuelTour) {
            await notifyInteraction('home.shortcut_fuel');
            return;
          }
          if (walkthroughActive || tutorialTransitioning) {
            return;
          }
        }

        if (a.label === 'Pre-Shift') {
          if (walkthroughActive || tutorialTransitioning) {
            return;
          }
        }

        a.action?.();
      };

      const pressableNode = (
        <Pressable
          key={a.label}
          onPress={handlePress}
          disabled={a.disabled}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          accessibilityState={{ disabled: !!a.disabled, ...(a.toggle ? { expanded } : {}) }}
          style={({ pressed }) => [
            s.shortcut,
            !targetId && { flexBasis: wide ? '13%' : largeText || width < 350 ? '30%' : '18%' },
            { opacity: a.disabled ? 0.5 : pressed ? QUICK_ACTION_PRESS.pressedOpacity : 1 },
            pressed ? { transform: [{ scale: QUICK_ACTION_PRESS.scale }] } : null,
          ]}
        >
          <HomeClayIcon name={a.icon} warm={!cargo} />
          <Text style={[type.caption, { color: colors.onSurface, textAlign: 'center' }]}>{a.label}</Text>
        </Pressable>
      );

      if (targetId) {
        return (
          <CoachMarkTarget
            key={a.label}
            targetId={targetId}
            radius={18}
            padding={4}
            scrollRef={scrollRef}
            style={{ flexBasis: wide ? '13%' : largeText || width < 350 ? '30%' : '18%' }}
          >
            {pressableNode}
          </CoachMarkTarget>
        );
      }
      return pressableNode;
    })}
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

export const DriverTripCard = memo(function DriverTripCard({ trip, current, confirmed, offline, nowMs, canManage, busy, trackingText, onAction, onDetails, variant, interactivePreview = false, previewActive = true, preShiftPassed = true, emptyState = null, workspace = null }) {
  const workspaceBlocked = workspace?.tripReady === false;
  const { colors, type, scheme } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const { settings } = useSettings();
  const mats = clayMaterials(scheme === 'dark');
  const raised = scheme === 'dark' ? raisedControlDark : raisedControl;
  const pillEdges = scheme === 'dark' ? pillEdgesDark : pillEdgesLight;
  const v = VARIANT[variant] ?? (current ? VARIANT.current : VARIANT.next);
  const isCurrent = v.isCurrent;
  // Current card: forest green. Scheduled cards: muted teal.
  const accent = isCurrent ? colors.primary : colors.info;
  const scheduleTone = statusColorForTone(colors, 'info');
  const tagBackground = isCurrent ? colors.primary : scheduleTone.bg;
  const onAccent = isCurrent ? colors.onPrimary : scheduleTone.fg;
  const action = trip ? homeTripAction(trip, nowMs, { preShiftPassed }) : null;
  const date = trip?.departure_time ? new Date(trip.departure_time) : null;
  const validDate = date && Number.isFinite(date.getTime());
  const depTime = validDate ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const depDate = validDate ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;
  // Live trip status — the real trip_status, never a hardcoded label.
  const sc = statusColorForTone(colors, tripStatusTone(trip?.trip_status));
  const horizontal = width >= 420 && fontScale < 1.2 && settings.textSize !== 'large';
  const cargo = isCargoLoad(trip);
  const readiness = trip ? homeTripReadiness(trip, nowMs, { preShiftPassed }) : null;
  const showRoutePreview = !cargo || (isCurrent && readiness == null);
  const splitLayout = horizontal && showRoutePreview;
  const stops = useMemo(() => [
    { label: 'Pickup', value: trip?.origin, time: depTime, first: true },
    { label: cargo ? 'Delivery' : 'Drop-off', value: trip?.destination, time: null, first: false },
  ], [trip?.origin, trip?.destination, cargo, depTime]);

  return <View style={[s.trip, cargo && s.cargoTrip, { ...(cargo ? mats.compactShade : mats.clayShade), backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
    {!settings.highContrast && Platform.OS !== 'android' ? <LinearGradient pointerEvents="none" colors={scheme === 'dark' ? ['rgba(255,253,252,0.07)', 'rgba(255,253,252,0)'] : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.tripSheen} /> : null}
    <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'space-between' }]}>
      <View style={[s.cardTag, pillEdges, { backgroundColor: tagBackground }]}>
        <Text style={[type.label, { color: onAccent, letterSpacing: 0.8 }]}>{v.label}</Text>
      </View>
      {trip ? <View style={[s.status, pillEdges, { backgroundColor: sc.bg }]}>
        <View style={[s.statusDot, { backgroundColor: sc.fg }]} />
        <Text style={[type.caption, { color: sc.fg }]}>{tripStatusLabel(trip.trip_status, trip.load_type)}</Text>
      </View> : null}
    </View>
    {!trip ? <View style={[s.empty, { flexDirection: 'row', alignItems: 'center', gap: 12 }, isCurrent && { gap: 14, minHeight: 90 }]}>
      {isCurrent && confirmed && !offline ? (
        emptyState && emptyState.key ? (
          emptyState.iconType === 'off_duty' ? (
            <OffDutyIllustration size="compact" />
          ) : (
            <View style={[s.emptyStatusIconWrap, { backgroundColor: colors.surfaceContainerHigh }]}>
              {emptyState.iconType === 'rest_day' && (
                <MaterialCommunityIcons name="calendar-minus" size={26} color={accent} />
              )}
              {emptyState.iconType === 'on_leave' && (
                <View style={s.calendarSlashIconWrap}>
                  <MaterialCommunityIcons name="calendar-blank-outline" size={26} color={accent} />
                  <View style={[s.calendarSlashBar, { backgroundColor: accent }]} />
                </View>
              )}
            </View>
          )
        ) : (
          <RadarPulse size={38} color={accent} icon="radio" />
        )
      ) : null}
      <View style={s.flex}>
        <Text style={type.cardTitle}>
          {!confirmed
            ? offline ? 'No saved trips yet' : 'Assignments not confirmed'
            : isCurrent
            ? (emptyState?.homeTitle || 'No active trip right now.')
            : 'No upcoming trip.'}
        </Text>
        <Text style={type.supporting}>
          {!confirmed
            ? offline ? 'Connect once to save your assignments.' : 'Pull to refresh or try again.'
            : offline ? 'Based on your last synced assignments.'
            : isCurrent
            ? (emptyState?.homeDescription || 'Your active assignment will appear here when the trip begins.')
            : 'You’re all caught up for now.'}
        </Text>
      </View>
      {/* Decorative 3D map scenery for the non-current empty states (Next /
          Upcoming) — flex row keeps it right-aligned and vertically centered
          at any width, with no overlap into the text column. */}
      {!isCurrent ? <Image source={MAP_IMAGE} resizeMode="contain" accessible={false} style={[s.mapArt, scheme === 'dark' && { opacity: 0.85 }]} /> : null}
    </View> : <>
      {!workspaceBlocked ? <View style={s.tripIdentity}>
        <View style={[s.tripIdentityIcon, { backgroundColor: cargo ? colors.primaryContainer : colors.secondaryContainer }]}><Ionicons name={cargo ? 'cube-outline' : 'people-outline'} size={24} color={cargo ? colors.onPrimaryContainer : colors.onSecondaryContainer} accessible={false} /></View>
        <View style={s.flex}><Text style={type.caption}>{cargo ? 'Cargo delivery' : trip.is_vip ? 'VIP guest' : 'Guest transfer'}</Text><Text style={type.cardTitle}>{loadTitle(trip)}</Text>{loadSubtitle(trip) ? <Text style={type.supporting}>{loadSubtitle(trip)}</Text> : null}</View>
      </View> : null}
      <Text style={type.caption}>{trip.dispatch_number || `Trip #${trip.trip_id}`}</Text>
      <Text style={type.labelLg}>{validDate ? `${depDate} · ${depTime}` : 'Departure time not provided'}</Text>
      <View style={[s.tripBody, splitLayout && { flexDirection: 'row' }]}>
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
          {cargo && (trip.vehicle_model || trip.model || trip.vehicle_plate || trip.plate_number) ? <View style={s.row}>
            <Ionicons name="car-outline" size={16} color={accent} />
            <Text style={[type.supporting, s.flex]}>{[trip.vehicle_model || trip.model, trip.vehicle_plate || trip.plate_number].filter(Boolean).join(' · ')}</Text>
          </View> : null}
          {cargo && Number(trip.cargo_capacity_kg) > 0 ? <Text style={type.supporting}>Vehicle capacity: {trip.cargo_capacity_kg} kg</Text> : null}
          {cargo && readiness ? <View style={[s.cargoReadiness, { backgroundColor: colors.surfaceContainer }]}><Ionicons name={readiness === 'Ready to start' ? 'checkmark-circle-outline' : 'shield-checkmark-outline'} size={20} color={colors.primary} /><Text accessibilityLiveRegion="polite" style={[type.supporting, s.flex, { color: colors.onSurface }]}>{readiness}</Text></View> : null}
        </View>
        <View style={splitLayout ? { width: '42%', gap: 12 } : { gap: 12 }}>
          {/* Hidden Home keeps its layout without retaining WebGL route renderers. */}
          {showRoutePreview ? previewActive ? <TripMapPreview staticMode={!interactivePreview} key={`${trip.trip_id}:${trip.origin_latitude}:${trip.origin_longitude}:${trip.destination_latitude}:${trip.destination_longitude}:${offline}:${interactivePreview}`} trip={trip} offline={offline} airport={isCurrent && /\b(airport|NAIA)\b/i.test(trip.destination || '')} /> : <View style={{ width: '100%', aspectRatio: 1.9 }} /> : null}
      {workspaceBlocked ? <View style={{ gap: 8 }}>
        <Text style={[type.labelLg, { color: colors.onSurface }]}>{workspaceHeading(workspace)}</Text>
        <Text style={[type.supporting, { color: colors.onSurfaceVariant }]} accessibilityLiveRegion="polite">{workspaceProblem(workspace)}</Text>
      </View> : null}
      <Pressable onPress={() => !workspaceBlocked && (isCurrent && canManage && action !== 'Trip Details' ? onAction(trip) : onDetails(trip))} disabled={busy || workspaceBlocked} accessibilityRole="button" accessibilityLabel={workspaceBlocked ? 'Trip action unavailable' : isCurrent && canManage ? action : 'Trip Details'} accessibilityState={{ disabled: !!busy || workspaceBlocked, busy: !!busy }} style={({ pressed }) => [s.cta, raised, { backgroundColor: colors.primary, shadowColor: colors.shadow }, busy || workspaceBlocked ? { opacity: 0.6 } : pressed ? s.ctaPressed : null]}>
        {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Ionicons name={isCurrent && action !== 'Trip Details' ? 'play' : 'document-text-outline'} size={20} color={colors.onPrimary} />}
        <Text style={[type.labelLg, { color: colors.onPrimary }]}>{workspaceBlocked ? 'Trip action unavailable' : isCurrent && canManage ? action : 'Trip Details'}</Text>
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
  const { width, fontScale } = useWindowDimensions();
  const { settings } = useSettings();
  const stacked = width < 380 || fontScale > 1.3 || settings.textSize === 'large';
  return <View style={[s.row, s.headingRow, stacked && { flexDirection: 'column', alignItems: 'flex-start', gap: 0 }]}>
    <Text style={[type.cardTitle, s.headingTitle, { color: colors.onSurface }]}>{title}</Text>
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="View full schedule" hitSlop={6} style={({ pressed }) => [s.scheduleLink, pressedStyle({ pressed })]}>
      <Text style={[type.caption, { color: colors.primary }]}>View Full Schedule</Text>
      <Ionicons name="chevron-forward" color={colors.primary} size={14} />
    </Pressable>
  </View>;
});

const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingRow: { justifyContent: 'space-between', flexWrap: 'nowrap', marginTop: 4, marginBottom: 2 },
  headingTitle: { flexShrink: 1, letterSpacing: -0.2 },
  scheduleLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  heroShell: { borderRadius: 28 },
  heroScene: { padding: 18, paddingBottom: 14, borderRadius: 26, overflow: 'hidden' },
  sceneComposition: { minHeight: 136, justifyContent: 'center', position: 'relative', marginTop: 8 },
  sceneCompositionStacked: { minHeight: 0, gap: 6 },
  sceneCompositionPlain: { minHeight: 0, paddingVertical: 12 },
  sceneTitle: { width: '51%', fontFamily: fonts.display, letterSpacing: -0.65, zIndex: 1 },
  sceneTitleWide: { width: '100%' },
  sceneArt: { position: 'absolute', right: -32, bottom: -8, width: '65%', height: 156, pointerEvents: 'none' },
  sceneArtStacked: { position: 'relative', right: 0, bottom: 0, width: '90%', maxWidth: 340, height: undefined, aspectRatio: 1.65, alignSelf: 'flex-end' },
  dutyRibbon: { borderTopWidth: 1, paddingTop: 10, marginTop: 6, gap: 10, flexDirection: 'row', alignItems: 'center' },
  heroSummary: { paddingHorizontal: 18, paddingBottom: 14 },
  metrics: { flexDirection: 'row', paddingVertical: 12, gap: 16 },
  metricsStacked: { flexDirection: 'column', gap: 10 },
  metric: { flex: 1, minWidth: 0, minHeight: 72, justifyContent: 'center' },
  metricStacked: { flexDirection: 'row', alignItems: 'center', gap: 16, justifyContent: 'flex-start' },
  metricValue: { fontFamily: fonts.display, fontVariant: ['tabular-nums'], letterSpacing: -0.7 },
  metricActionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 12, minHeight: 64 },
  vehicleIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  vehicleImage: { width: 64, height: 48, borderRadius: 10 },
  cargoTrip: { borderRadius: 24, padding: 16 },
  tripIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tripIdentityIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  cargoReadiness: { minHeight: 48, padding: 10, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  actions: { paddingVertical: 4, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  shortcut: { alignItems: 'center', gap: 6, paddingVertical: 4, minWidth: 48 }, actionIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  trip: { borderRadius: 24, padding: 14, gap: 12 }, status: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  tripSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: 30, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  cardTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, justifyContent: 'center' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  placeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 }, place: { flex: 1, minWidth: 0 },
  ctaPressed: { transform: [{ scale: 0.98 }], opacity: 0.94 },
  tripBody: { gap: 10 }, stop: { flexDirection: 'row', gap: 10 }, track: { width: 22, alignItems: 'center', paddingTop: 4 }, node: { width: 20, height: 20, borderRadius: 10, borderWidth: 2.5 }, line: { width: 2, flex: 1, marginBottom: -4 }, stopText: { flex: 1, minWidth: 0, paddingBottom: 12, gap: 2 },
  cta: { minHeight: 48, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8 },
  empty: { minHeight: 84, gap: 8, justifyContent: 'center', paddingVertical: 8 }, mapArt: { width: 112, height: 90, transform: [{ translateY: -20 }] },
  emptyStatusIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarSlashIconWrap: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarSlashBar: {
    position: 'absolute',
    width: 30,
    height: 2,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
});
