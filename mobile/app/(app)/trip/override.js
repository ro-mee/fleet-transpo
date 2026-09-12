import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../lib/theme-context';
import { fonts } from '../../../lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppAlert } from '../../../components/AppAlert';
import { ClayButton, ClayCard, ClayTile, ClayInput } from '../../../components/clay';
import { api, wasQueued } from '../../../lib/api';

// Generic arrival-override screen: the map's proximity pre-check found the
// driver OUTSIDE the geofenced point, and the server gate (setTripStatus)
// would 409 a plain transition. Proceeding here requires a typed reason,
// which the server validates (400 without it) and writes to audit.
// Params: tripId, action (at-pickup | onboard | dropoff), distanceText,
// placeName, needsEnroute (1/0).
const ACTION_COPY = {
  'at-pickup': { title: 'Arrived at pickup', endpoint: 'pickup point', verb: 'CONFIRM ARRIVAL ANYWAY' },
  onboard: { title: 'Picked up guest', endpoint: 'pickup point', verb: 'CONFIRM PICKUP ANYWAY' },
  dropoff: { title: 'Arrived at destination', endpoint: 'destination', verb: 'CONFIRM ARRIVAL ANYWAY' },
};

export default function TripOverrideScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { tripId, action, distanceText, placeName, needsEnroute } = useLocalSearchParams();

  const copy = ACTION_COPY[action] || ACTION_COPY['at-pickup'];
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const overrideBody = (r) => ({ geofence_override: true, geofence_reason: r.slice(0, 500) });

  const confirm = async () => {
    const r = reason.trim();
    if (!r) {
      AppAlert.alert('Reason required', `Tell dispatch why you are confirming ${copy.title.toLowerCase()} away from the ${copy.endpoint}.`);
      return;
    }
    if (tripId == null) {
      AppAlert.alert('Error', 'Missing trip reference. Go back and try again.');
      return;
    }
    setSubmitting(true);
    try {
      const body = overrideBody(r);
      if (action === 'at-pickup') {
        await api.put(`/api/trips/${tripId}/at-pickup`, body);
      } else if (action === 'onboard') {
        const res = await api.put(`/api/trips/${tripId}/onboard`, body);
        if (wasQueued(res)) {
          AppAlert.alert('Saved for sync', "This update will be sent when you're online.");
        }
        // En Route is the ungated mid-leg consequence of onboard.
        await api.put(`/api/trips/${tripId}/enroute`, {});
      } else {
        if (needsEnroute === '1') {
          await api.put(`/api/trips/${tripId}/enroute`, {});
        }
        const res = await api.put(`/api/trips/${tripId}/dropoff`, body);
        if (wasQueued(res)) {
          AppAlert.alert('Saved for sync', "This update will be sent when you're online.");
        }
      }
      router.replace('/(app)/(tabs)/map');
    } catch (e) {
      AppAlert.alert('Error', e.message || 'Could not update trip');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      <ClayCard style={styles.card}>
        <View style={styles.headerRow}>
          <ClayTile icon="location-outline" size={48} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.onSurface }]}>Far from {copy.endpoint}</Text>
            <Text style={[styles.message, { color: colors.onSurfaceVariant }]}>
              You appear to be {distanceText || 'an unknown distance'} from {placeName || `the ${copy.endpoint}`}.
            </Text>
          </View>
        </View>
        <Text style={[styles.submessage, { color: colors.onSurfaceVariant }]}>
          To {copy.title.toLowerCase()} anyway, a reason is required — dispatch will see it on the trip record.
        </Text>
      </ClayCard>

      <ClayCard style={styles.card}>
        <ClayInput
          label="REASON FOR DISPATCH"
          placeholder="e.g. Guest waiting at the gate, GPS drift indoors…"
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          editable={!submitting}
          maxLength={500}
        />
      </ClayCard>

      <ClayButton
        label={copy.verb}
        variant="danger"
        size="lg"
        onPress={confirm}
        loading={submitting}
        disabled={submitting}
        style={styles.action}
      />
      <ClayButton
        label="GO BACK"
        variant="tonal"
        onPress={() => router.back()}
        disabled={submitting}
        style={styles.action}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 16 },
  card: { padding: 18, gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontFamily: fonts.displayBold || fonts.bodySemiBold, fontSize: 18, letterSpacing: -0.2 },
  message: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
  submessage: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  action: { alignSelf: 'stretch' },
});
