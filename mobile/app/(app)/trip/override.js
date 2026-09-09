import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../../lib/theme-context';
import { fonts } from '../../../lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppAlert } from '../../../components/AppAlert';
import { FilledButton, TonalButton } from '../../../components/ui';
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
      <View style={[styles.iconWrap, { backgroundColor: colors.warning + '1A' }]}>
        <Ionicons name="location-outline" size={32} color={colors.warning} />
      </View>
      <Text style={[styles.title, { color: colors.onSurface }]}>Far from {copy.endpoint}</Text>
      <Text style={[styles.message, { color: colors.onSurfaceVariant }]}>
        You appear to be {distanceText || 'an unknown distance'} from {placeName || `the ${copy.endpoint}`}.
        {`\n\n`}To {copy.title.toLowerCase()} anyway, a reason is required — dispatch will see it on the trip record.
      </Text>

      <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>REASON FOR DISPATCH</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, color: colors.onSurface }]}
        placeholder="e.g. Guest waiting at the gate, GPS drift indoors…"
        placeholderTextColor={colors.outline}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        value={reason}
        onChangeText={setReason}
        editable={!submitting}
        maxLength={500}
      />

      <FilledButton
        label={copy.verb}
        onPress={confirm}
        loading={submitting}
        style={styles.action}
      />
      <TonalButton
        label="GO BACK"
        onPress={() => router.back()}
        style={styles.action}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, gap: 12 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  title: { fontFamily: fonts.displayBold || fonts.bodySemiBold, fontSize: 22 },
  message: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, marginBottom: 8 },
  label: { fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, fontSize: 11, letterSpacing: 0.6, marginTop: 8 },
  input: {
    borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 110,
    fontFamily: fonts.body, fontSize: 14, lineHeight: 20,
  },
  action: { alignSelf: 'stretch', marginTop: 8 },
});
