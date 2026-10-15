import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme-context';
import { api, wasQueued } from '../../../lib/api';
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

  const load = useCallback(async () => {
    const snapshot = captureCargoSession(user?.employeeId);
    const request = ++requestNumber.current;
    setLoading(true);
    setSession(null);
    setError(null);
    try {
      if (!snapshot || !tripId) throw new Error('Open completion from your current trip.');
      const rows = await api.get('/api/mobile/driver/trips?status=all');
      if (request !== requestNumber.current || !isCurrentCargoSession(snapshot)) return;
      const current = rows?.find(row => String(row.trip_id) === String(tripId));
      if (!current) throw new Error('This trip could not be confirmed. Return to the map and refresh.');
      setTrip(current);
      setSession(snapshot);
      if (current.trip_status === 'Completed') setResult('confirmed');
    } catch (e) {
      if (request === requestNumber.current && snapshot && isCurrentCargoSession(snapshot)) setError(e.message);
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }, [user?.employeeId, tripId]);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => { if (active) load(); });
    return () => { active = false; };
  }, [load]);

  const workspace = resolveDriverWorkspace({ driverType: profile?.driverType, trip });
  const disabledReason = connectivity !== 'online' ? 'Reconnect before completing this trip.'
    : !serverConfirmed || !isCurrentCargoSession(session) ? 'Refresh your current profile and trip before completing.'
    : workspace.tripReady !== true ? workspaceBlockReason(workspace)
    : !['Drop-off', 'Arrived', 'In Progress'].includes(trip?.trip_status) ? 'Return to the map and finish the pickup and delivery steps first.' : null;

  const complete = async () => {
    if (submitLock.current || disabledReason || result) return;
    const reading = validateCompletionReading(ending, trip?.current_mileage);
    if (reading.error) return setError(reading.error);
    if (overrideNeeded && !reason.trim()) return setError('Enter a reason for completing away from the destination.');
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      // Re-read mileage and cargo authority after the driver has entered the reading.
      const rows = await api.get('/api/mobile/driver/trips');
      if (!isCurrentCargoSession(session)) return;
      const fresh = rows?.find(row => String(row.trip_id) === String(tripId));
      if (!fresh) throw new Error('Refresh the map to confirm this trip before completing.');
      setTrip(fresh);
      const checked = validateCompletionReading(ending, fresh.current_mileage);
      if (checked.error) throw new Error(checked.error);
      const gate = await resolveCargoMapGate(fresh, {
        driverType: profile?.driverType,
        readExecution: () => cargoApi.getExecution(tripId, user?.employeeId, session?.signal),
        readSyncState: () => getCargoSyncState(user?.employeeId, tripId),
      });
      if (!isCurrentCargoSession(session)) return;
      if (!gate.allowed) throw new Error(gate.reason);
      const check = await api.get(`/api/trips/${tripId}/destination-check`);
      if (!isCurrentCargoSession(session)) return;
      if (check?.state === 'outside' && !overrideNeeded) {
        setOverrideNeeded(true);
        setError('You are outside the destination area. Return to the destination or enter a reason to complete here.');
        return;
      }
      const response = await api.put(`/api/trips/${tripId}/complete`, {
        end_odometer: checked.value,
        ...(overrideNeeded ? { geofence_override: true, completion_reason: reason.trim().slice(0, 500) } : {}),
      }, { queueOnFailure: false, cargoActorId: user?.employeeId, signal: session?.signal });
      if (!isCurrentCargoSession(session)) return;
      if (wasQueued(response)) {
        setResult('queued');
        return;
      }
      setResult('confirmed');
      // Only a server-confirmed completion releases the tracked trip.
      updateLegContext({ tripId: null, leg: null }).catch(() => {});
      stopBackgroundTracking().catch(() => {});
    } catch (e) {
      if (isCurrentCargoSession(session)) setError(e.message || 'Could not complete this trip. Your reading is still here.');
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const confirmed = result === 'confirmed';
  return <KeyboardAvoidingView style={[s.screen, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ClayScreenHeader title={confirmed ? 'Trip completed' : 'Complete trip'} onBack={() => router.back()} />
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
      </ClayCard> : trip ? <ClayCard variant="standard">
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

