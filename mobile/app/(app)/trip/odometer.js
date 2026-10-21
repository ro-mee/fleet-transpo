import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, apiFetch, wasQueued } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useConnectivity } from '../../../lib/connectivity-context';
import { useTheme } from '../../../lib/theme-context';
import { captureCargoSession, isCurrentCargoSession, getCargoSyncState } from '../../../lib/cargo-sync';
import { resolveDriverWorkspace } from '../../../lib/driver-workspace';
import { resolveCargoMapGate, workspaceBlockReason } from '../../../lib/cargo-view-model';
import { cargoApi } from '../../../lib/cargo-api';
import { readinessFor } from '../../../lib/trip-detail';
import { PRE_START } from '../../../lib/trips-queue';
import { odometerApi, odometerRequestOptions } from '../../../lib/trip-odometer';
import { useTripOdometer } from '../../../lib/use-trip-odometer';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import OdometerCapture from '../../../components/trips/OdometerCapture';
import { ClayButton } from '../../../components/clay';
import { guardLegacyGuideLinks } from '../../../components/coachmarks/LegacyGuideLinkGuard';

function TripOdometerScreen() {
  const { tripId, stage, tour } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { colors, type } = useTheme();
  const { status: connectivity } = useConnectivity();
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestNumber = useRef(0);
  const mounted = useRef(false);
  const submitLock = useRef(false);
  const practice = tour === '1';

  const readContext = useCallback(async session => {
    const options = odometerRequestOptions(session);
    const [rows, profile, duty] = await Promise.all([
      apiFetch(`/api/mobile/driver/trips?trip_id=${encodeURIComponent(tripId)}`, options),
      apiFetch('/api/driver/me', options),
      apiFetch('/api/mobile/driver/duty', options),
    ]);
    if (!mounted.current || !isCurrentCargoSession(session)) return null;
    const trip = rows?.find(row => String(row.trip_id) === String(tripId));
    if (!trip) throw new Error('This trip is no longer assigned to you. Return to the map and refresh.');
    const workspace = resolveDriverWorkspace({ driverType: profile?.driverType, trip });
    if (workspace.tripReady !== true) throw new Error(workspaceBlockReason(workspace));
    return { trip, profile, duty, session };
  }, [tripId]);
  const load = useCallback(async () => {
    if (practice) { setLoading(false); return; }
    const request = ++requestNumber.current;
    const session = captureCargoSession(user?.employeeId);
    setContext(null); setLoading(true); setError(null);
    try {
      if (stage !== 'start' || !/^\d+$/.test(String(tripId))) throw new Error('Open the starting camera from your assigned trip.');
      const fresh = await readContext(session);
      if (!fresh || request !== requestNumber.current) return;
      if (!PRE_START.includes(fresh.trip.trip_status)) throw new Error('This route has already moved on. Return to the map to continue.');
      if (fresh.trip.pre_trip_status !== 'Passed') {
        router.replace({ pathname: '/inspection', params: { tripId: String(tripId), continuation: 'odometer-start' } });
        return;
      }
      setContext(fresh);
    } catch (e) { if (mounted.current && request === requestNumber.current && isCurrentCargoSession(session)) setError(e.message); }
    finally { if (mounted.current && request === requestNumber.current) setLoading(false); }
  }, [practice, stage, tripId, user?.employeeId, readContext, router]);
  useFocusEffect(useCallback(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; requestNumber.current += 1; setContext(null); };
  }, [load]));

  const session = context?.session;
  const disabledReason = connectivity !== 'online' ? 'Reconnect before recording and starting this trip.'
    : !context || !isCurrentCargoSession(session) ? 'Refresh your current trip before continuing.' : null;
  const start = async captureId => {
    if (submitLock.current || disabledReason || !mounted.current || !isCurrentCargoSession(session)) return;
    submitLock.current = true;
    try {
      const fresh = await readContext(session);
      if (!fresh) return;
      if (String(fresh.trip.vehicle_id) !== String(context.trip.vehicle_id)) throw Object.assign(new Error('The assigned vehicle changed. Reopen the trip and take a new photo.'), { code: 'ODOMETER_CAPTURE_MISMATCH' });
      const options = odometerRequestOptions(session);
      if (!PRE_START.includes(fresh.trip.trip_status)) {
        // A lost start acknowledgement may be replayed with this exact capture.
        const record = await odometerApi.read(tripId, captureId, session);
        if (!mounted.current || !isCurrentCargoSession(session)) return;
        if (record.state !== 'committed' || record.stage !== 'start') throw new Error('The trip changed. Return to the map and refresh.');
      } else {
        const ready = readinessFor(fresh.trip, Date.now(), { preShiftPassed: fresh.duty?.checkedIn === true });
        if (!ready.startReady) throw new Error(ready.unavailableReason === 'inspection' ? 'Complete a passed Pre-Trip inspection before starting.' : ready.unavailableReason === 'pre_shift' ? 'Complete Pre-Shift and start your duty before starting.' : 'The departure window is not open. Check the trip schedule.');
        const gate = await resolveCargoMapGate(fresh.trip, { driverType: fresh.profile?.driverType, readExecution: () => cargoApi.getExecution(tripId, session.actorId, session.signal), readSyncState: () => getCargoSyncState(session.actorId, tripId) });
        if (!mounted.current || !isCurrentCargoSession(session)) return;
        if (!gate.allowed) throw new Error(gate.reason);
        if (fresh.trip.trip_status !== 'Driver Accepted') {
          const accepted = await api.put(`/api/trips/${tripId}/accept`, { accept: true }, options);
          if (!mounted.current || !isCurrentCargoSession(session)) return;
          if (wasQueued(accepted)) throw new Error('Acceptance was not confirmed. Retry online before starting.');
        }
      }
      const saved = await api.put(`/api/trips/${tripId}/start`, { odometer_capture_id: captureId }, options);
      if (!mounted.current || !isCurrentCargoSession(session)) return;
      if (wasQueued(saved)) throw new Error('Starting this route was not confirmed. Retry online.');
      router.replace('/(app)/(tabs)/map');
    } finally { submitLock.current = false; }
  };
  const flow = useTripOdometer({ tripId, stage: 'start', session, disabledReason, onConfirm: start });
  return <View style={[s.screen, { backgroundColor: colors.background }]}>
    <ClayScreenHeader title="Starting odometer" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={s.content}>
      {practice ? <><Text style={type.supporting}>Practice only. A parked driver photographs the total odometer, checks the detected km reading, then confirms the start.</Text><ClayButton label="Return to practice" onPress={() => router.back()} /></>
        : loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading current trip" />
          : context && isCurrentCargoSession(session) ? <OdometerCapture {...flow} stage="start" disabledReason={disabledReason} plate={context.trip.vehicle_plate || context.trip.plate_number}
            tripReference={context.trip.dispatch_number || `Trip #${tripId}`} preTripComplete={context.trip.pre_trip_status === 'Passed'} previousReading={context.trip.current_mileage} onCancel={() => router.back()} />
            : <><Text accessibilityRole="alert" style={type.supporting}>{error || 'Your account changed. Reopen this trip from the map.'}</Text><ClayButton label="Retry" onPress={load} /><ClayButton label="Return to map" variant="secondary" onPress={() => router.replace('/(app)/(tabs)/map')} /></>}
    </ScrollView>
  </View>;
}

// The odometer screen is an operational screen: in guidance v2 an old
// tour/tutorial link must not open it as a sample capability, exactly like
// the incident, fuel, inspection and map screens.
export default guardLegacyGuideLinks(TripOdometerScreen);
const s = StyleSheet.create({ screen: { flex: 1 }, content: { padding: 20, gap: 24, maxWidth: 640, width: '100%', alignSelf: 'center' } });
