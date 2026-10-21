import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme-context';
import { api, apiFetch, wasQueued } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useConnectivity } from '../../../lib/connectivity-context';
import { useDriverProfile } from '../../../lib/driver-profile';
import { captureCargoSession, isCurrentCargoSession, getCargoSyncState } from '../../../lib/cargo-sync';
import { resolveDriverWorkspace } from '../../../lib/driver-workspace';
import { resolveCargoMapGate, workspaceBlockReason } from '../../../lib/cargo-view-model';
import { cargoApi } from '../../../lib/cargo-api';
import { isCargoLoad, loadTitle, loadSubtitle } from '../../../lib/load-presentation';
import { validateCompletionReading } from '../../../lib/trip-completion';
import { stopBackgroundTracking, updateLegContext } from '../../../lib/background-tracking';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { ClayCard, ClayButton, ClayInput, ClayBadge } from '../../../components/clay';
import OdometerCapture from '../../../components/trips/OdometerCapture';
import { useTripOdometer } from '../../../lib/use-trip-odometer';
import { odometerApi, odometerRequestOptions } from '../../../lib/trip-odometer';

export default function TripCompleteScreen() {
  const router = useRouter();
  const { tripId, needsOverride, farText } = useLocalSearchParams();
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { profile, serverConfirmed } = useDriverProfile();
  const { status: connectivity } = useConnectivity();
  const [trip, setTrip] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState('');
  const [reason, setReason] = useState('');
  const [overrideNeeded, setOverrideNeeded] = useState(needsOverride === '1');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const submitLock = useRef(false);
  const requestNumber = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    const snapshot = captureCargoSession(user?.employeeId);
    const request = ++requestNumber.current;
    setLoading(true);
    setSession(null);
    setError(null);
    try {
      if (!snapshot || !tripId) throw new Error('Open completion from your current trip.');
      const options = odometerRequestOptions(snapshot);
      const [rows, freshProfile] = await Promise.all([
        apiFetch(`/api/mobile/driver/trips?trip_id=${encodeURIComponent(tripId)}`, options),
        apiFetch('/api/driver/me', options),
      ]);
      if (!mounted.current || request !== requestNumber.current || !isCurrentCargoSession(snapshot)) return;
      const current = rows?.find(row => String(row.trip_id) === String(tripId));
      if (!current) throw new Error('This trip could not be confirmed. Return to the map and refresh.');
      const workspace = resolveDriverWorkspace({ driverType: freshProfile?.driverType, trip: current });
      if (workspace.tripReady !== true) throw new Error(workspaceBlockReason(workspace));
      setTrip(current);
      setSession(snapshot);
      if (current.trip_status === 'Completed') setResult('confirmed');
    } catch (e) {
      if (request === requestNumber.current && snapshot && isCurrentCargoSession(snapshot)) setError(e.message);
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }, [user?.employeeId, tripId]);
  useFocusEffect(useCallback(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; requestNumber.current += 1; setSession(null); };
  }, [load]));
  useEffect(() => {
    const clear = () => { setTrip(null); setSession(null); setEnding(''); setReason(''); setResult(null); };
    session?.signal?.addEventListener('abort', clear);
    return () => session?.signal?.removeEventListener('abort', clear);
  }, [session]);

  const workspace = resolveDriverWorkspace({ driverType: profile?.driverType, trip });
  const disabledReason = connectivity !== 'online' ? 'Reconnect before completing this trip.'
    : !serverConfirmed || !isCurrentCargoSession(session) ? 'Refresh your current profile and trip before completing.'
    : workspace.tripReady !== true ? workspaceBlockReason(workspace)
    : !['Drop-off', 'Arrived', 'In Progress', ...(trip?.odometer_capture_required === true ? ['Completed'] : [])].includes(trip?.trip_status) ? 'Return to the map and finish the pickup and delivery steps first.' : null;

  const photoRequired = trip?.odometer_capture_required === true;
  const complete = async captureId => {
    if (submitLock.current || disabledReason || result || !mounted.current) return;
    const reading = photoRequired ? { value: null } : validateCompletionReading(ending, trip?.current_mileage);
    if (reading.error) return setError(reading.error);
    if (overrideNeeded && !reason.trim()) return setError('Enter a reason for completing away from the destination.');
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      // Re-read mileage and cargo authority after the driver has entered the reading.
      const options = odometerRequestOptions(session);
      const [rows, freshProfile] = await Promise.all([
        apiFetch(`/api/mobile/driver/trips?trip_id=${encodeURIComponent(tripId)}`, options),
        apiFetch('/api/driver/me', options),
      ]);
      if (!mounted.current || !isCurrentCargoSession(session)) return;
      const fresh = rows?.find(row => String(row.trip_id) === String(tripId));
      if (!fresh) throw new Error('Refresh the map to confirm this trip before completing.');
      setTrip(fresh);
      const currentWorkspace = resolveDriverWorkspace({ driverType: freshProfile?.driverType, trip: fresh });
      if (currentWorkspace.tripReady !== true) throw new Error(workspaceBlockReason(currentWorkspace));
      if (fresh.odometer_capture_required === true && (!photoRequired || typeof captureId !== 'string')) throw new Error('This trip requires an ending odometer photo. Take a new photo before completing.');
      if (String(fresh.vehicle_id) !== String(trip.vehicle_id)) throw Object.assign(new Error('The assigned vehicle changed. Reopen the trip and take a new photo.'), { code: 'ODOMETER_CAPTURE_MISMATCH' });
      const checked = photoRequired ? { value: null } : validateCompletionReading(ending, fresh.current_mileage);
      if (checked.error) throw new Error(checked.error);
      let replay = false;
      if (photoRequired && fresh.trip_status === 'Completed') {
        const record = await odometerApi.read(tripId, captureId, session);
        if (!mounted.current || !isCurrentCargoSession(session)) return;
        replay = record.state === 'committed' && record.stage === 'end';
        if (!replay) throw new Error('The completed trip could not be matched to this photo. Refresh the map.');
      }
      if (!replay) {
        const gate = await resolveCargoMapGate(fresh, {
        driverType: freshProfile?.driverType,
        readExecution: () => cargoApi.getExecution(tripId, user?.employeeId, session?.signal),
        readSyncState: () => getCargoSyncState(user?.employeeId, tripId),
      });
      if (!mounted.current || !isCurrentCargoSession(session)) return;
      if (!gate.allowed) throw new Error(gate.reason);
      const check = await apiFetch(`/api/trips/${tripId}/destination-check`, options);
      if (!mounted.current || !isCurrentCargoSession(session)) return;
      if (check?.state === 'outside' && !overrideNeeded) {
        setOverrideNeeded(true);
        setError('You are outside the destination area. Return to the destination or enter a reason to complete here.');
        return;
      }
      }
      const response = await api.put(`/api/trips/${tripId}/complete`, {
        ...(photoRequired ? { odometer_capture_id: captureId } : { end_odometer: checked.value }),
        ...(overrideNeeded ? { geofence_override: true, completion_reason: reason.trim().slice(0, 500) } : {}),
      }, { queueOnFailure: false, cargoActorId: user?.employeeId, signal: session?.signal });
      if (!mounted.current || !isCurrentCargoSession(session)) return;
      if (wasQueued(response)) {
        setResult('queued');
        return;
      }
      setResult('confirmed');
      // Only a server-confirmed completion releases the tracked trip.
      updateLegContext({ tripId: null, leg: null }).catch(() => {});
      stopBackgroundTracking().catch(() => {});
    } catch (e) {
      if (mounted.current && isCurrentCargoSession(session)) {
        setError(e.message || 'Could not complete this trip. Your reading is still here.');
        if (photoRequired) throw e;
      }
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };
  const photo = useTripOdometer({ tripId, stage: 'end', session, disabledReason: photoRequired ? disabledReason : 'Legacy completion uses the saved manual form.', onConfirm: complete });

  const confirmed = result === 'confirmed';
  return <KeyboardAvoidingView style={[s.screen, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ClayScreenHeader title={confirmed ? 'Trip completed' : photoRequired ? 'Ending odometer' : 'Complete trip'} onBack={() => router.back()} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}>
      {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading current trip" /> : null}
      {trip ? <ClayCard variant="standard">
        <ClayBadge text={confirmed ? 'Completed' : result === 'queued' ? 'Sync pending' : isCargoLoad(trip) ? 'Cargo delivery' : 'Passenger trip'} tone={confirmed ? 'success' : 'neutral'} />
        <Text style={type.cardTitle}>{trip.dispatch_number || `Trip #${trip.trip_id}`}</Text>
        <Text style={type.labelLg}>{loadTitle(trip)}</Text>
        {loadSubtitle(trip) ? <Text style={type.supporting}>{loadSubtitle(trip)}</Text> : null}
        <Text style={type.supporting}>Pickup: {trip.origin || 'Location not provided'}</Text>
        <Text style={type.supporting}>{isCargoLoad(trip) ? 'Delivery' : 'Drop-off'}: {trip.destination || 'Location not provided'}</Text>
        <Text style={type.supporting}>{[trip.vehicle_model || trip.model, trip.vehicle_plate || trip.plate_number].filter(Boolean).join(' · ') || 'Vehicle details unavailable'}</Text>
      </ClayCard> : null}
      {confirmed ? <ClayCard variant="standard">
        <Ionicons name="checkmark-circle" size={48} color={colors.primary} />
        <Text style={type.cardTitle}>{isCargoLoad(trip) ? 'Cargo delivery completed' : 'Trip completed'}</Text>
        <Text style={type.supporting}>Fleet has confirmed this trip is complete. Return to the map for your next assignment or standby.</Text>
        <ClayButton label="Return to map" onPress={() => router.replace('/(app)/(tabs)/map')} />
        <ClayButton label="View trip details" variant="secondary" onPress={() => router.replace(`/trip/${tripId}`)} />
      </ClayCard> : result === 'queued' ? <ClayCard variant="standard">
        <Text style={type.cardTitle}>Saved for sync</Text>
        <Text style={type.supporting}>This update is waiting to reach Fleet. Trip completion has not been confirmed.</Text>
        <ClayButton label="Return to map" onPress={() => router.replace('/(app)/(tabs)/map')} />
      </ClayCard> : trip && photoRequired ? <>
        {overrideNeeded ? <>
          <Text style={type.supporting}>{farText || 'Completing away from the destination requires a reason.'}</Text>
          <ClayInput label="Reason *" value={reason} onChangeText={setReason} multiline maxLength={500} editable={!busy} accessibilityLabel="Reason for completing away from the destination" />
        </> : null}
        <OdometerCapture {...photo} stage="end" disabledReason={disabledReason} previousReading={trip.start_odometer}
          error={photo.error || error} onCapture={asset => { setError(null); photo.onCapture(asset); }} onRetake={() => { setError(null); photo.onRetake(); }}
          onRead={() => { setError(null); return photo.onRead(); }} onCancel={() => router.back()} />
        <ClayButton label="Report incident" variant="outline" disabled={busy} onPress={() => router.push('/incidents')} />
      </> : trip ? <ClayCard variant="standard">
        <Text style={type.cardTitle}>Ending odometer</Text>
        {trip.start_odometer != null ? <Text style={type.supporting}>Starting reading: {trip.start_odometer} km</Text> : null}
        {trip.current_mileage != null ? <Text style={type.supporting}>Current recorded mileage: {trip.current_mileage} km</Text> : null}
        <ClayInput label="Ending odometer (km) *" value={ending} onChangeText={setEnding} keyboardType="decimal-pad" editable={!busy} accessibilityLabel="Ending odometer in kilometres" helperText="Enter the vehicle's actual reading. It cannot be below its recorded mileage." />
        {overrideNeeded ? <>
          <Text style={type.supporting}>{farText || 'Completing away from the destination requires a reason.'}</Text>
          <ClayInput label="Reason *" value={reason} onChangeText={setReason} multiline maxLength={500} editable={!busy} accessibilityLabel="Reason for completing away from the destination" />
        </> : null}
        {disabledReason ? <Text style={type.supporting}>{disabledReason}</Text> : null}
        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[type.supporting, { color: colors.error }]}>{error}</Text> : null}
        <ClayButton label="Complete trip" onPress={complete} loading={busy} disabled={!!disabledReason || busy || !ending.trim()} />
        <ClayButton label="Cancel" variant="secondary" disabled={busy} onPress={() => router.back()} />
        <ClayButton label="Report incident" variant="outline" disabled={busy} onPress={() => router.push('/incidents')} />
      </ClayCard> : !loading ? <>
        <Text style={type.supporting}>{error || 'No current trip could be confirmed.'}</Text>
        <ClayButton label="Retry" onPress={load} />
      </> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 16, gap: 16 },
});

