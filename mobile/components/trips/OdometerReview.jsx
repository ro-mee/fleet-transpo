import { CoachMarkTarget } from '../coachmarks';
import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { ClayButton } from '../clay';

// Evidence review only; the production owner supplies camera/network callbacks.
export default function OdometerReview({ guideTarget = false, stage, phase, asset, reading, previousReading, label, busy, disabledReason, retakeRequired, onRead, onConfirm, onRetake, colors, type }) {
  const previousKm = previousReading != null && previousReading !== '' && Number.isFinite(Number(previousReading)) ? Number(previousReading).toLocaleString() : null;
  return <>
      {asset?.uri ? (guideTarget ? <CoachMarkTarget targetId="odometer.photo"><Image source={{ uri: asset.uri }} resizeMode="contain" accessibilityLabel={`${stage === 'end' ? 'Ending' : 'Starting'} odometer photo`} style={[s.preview, { backgroundColor: colors.surfaceContainer }]} /></CoachMarkTarget> : <Image source={{ uri: asset.uri }} resizeMode="contain" accessibilityLabel={`${stage === 'end' ? 'Ending' : 'Starting'} odometer photo`} style={[s.preview, { backgroundColor: colors.surfaceContainer }]} />) : null}
      {reading != null ? <View style={s.reading}>
        <Text style={type.supporting}>Detected reading</Text>
        <Text style={[type.headlineLg, s.number, { fontFamily: type.data?.fontFamily || type.headlineLg?.fontFamily }]}>{Number(reading).toLocaleString()} <Text style={type.labelLg}>km</Text></Text>
        <Text style={type.supporting}>Check every digit. If this is wrong, retake the photo.</Text>
      </View> : null}
      {previousKm != null ? <Text style={type.supporting}>{stage === 'end' ? 'Starting reading' : 'Previously recorded'}: {previousKm} km</Text> : null}
      {label ? <Text accessibilityLiveRegion="polite" style={type.labelLg}>{label}</Text> : null}
      {phase === 'review' || phase === 'saving' ? <ClayButton label={stage === 'end' ? 'Confirm and complete trip' : 'Confirm and start route'} onPress={onConfirm} loading={busy} disabled={!!disabledReason || reading == null} />
        : <ClayButton label={phase === 'error' ? 'Retry' : 'Read odometer'} onPress={onRead} loading={busy} disabled={!!disabledReason || retakeRequired || !asset} />}
      <ClayButton label="Retake photo" variant="secondary" onPress={onRetake} disabled={busy} />

  </>;
}
const s = StyleSheet.create({ preview: { width: '100%', aspectRatio: 4 / 3, maxHeight: 360, borderRadius: 20, overflow: 'hidden' }, reading: { gap: 8, paddingVertical: 12 }, number: { fontVariant: ['tabular-nums'] } });
