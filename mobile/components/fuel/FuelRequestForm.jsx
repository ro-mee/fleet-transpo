import React from 'react';
import { fuelLevelError } from '../../lib/fuel-request-validation';
import { View, Text, TextInput, Pressable, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../../lib/theme-context';
import { fonts } from '../../lib/theme';
import { ClayButton } from '../clay';
import { CoachMarkTarget } from '../coachmarks';

export default function FuelRequestForm({ latestFuelRequest, fuelLevelPercent, setFuelLevelPercent, gaugePhotoUrl, setGaugePhotoUrl, gaugeScanEstimate, setGaugeScanEstimate, gaugeBusy = false, requestingFuel = false, requestPurpose, setRequestPurpose, hasAssignedVehicle, fuelLevelInputRef, onCaptureGauge, requestFuel, styles: providedStyles }) {
  const { colors } = useTheme();
  const styles = providedStyles || defaultStyles;
  const levelError = fuelLevelError(fuelLevelPercent);
  return <>
              <>
                {latestFuelRequest?.status === "Rejected" ? (
                  <Text style={[styles.requestRejected, { color: colors.error }]}>Previous request rejected: {latestFuelRequest.review_notes || "No reason provided"}</Text>
                ) : latestFuelRequest?.status === "Cancelled" ? (
                  <Text style={[styles.requestRejected, { color: colors.onSurfaceVariant }]}>Previous request was cancelled.</Text>
                ) : null}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>CURRENT FUEL LEVEL (%)</Text>
                  <TextInput
                    ref={fuelLevelInputRef}
                    style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                    placeholder="e.g. 25"
                    placeholderTextColor={colors.outline}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Current dashboard fuel level percent"
                    value={fuelLevelPercent}
                    onChangeText={setFuelLevelPercent}
                  />
                </View>
                {levelError ? <Text accessibilityLiveRegion="polite" style={{ color: colors.error }}>{levelError}</Text> : null}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>GAUGE PHOTO (REQUIRED)</Text>
                  {gaugePhotoUrl ? (
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Image
                        source={{ uri: gaugePhotoUrl }}
                        style={{ width: 96, height: 72, borderRadius: 10, borderWidth: 1, borderColor: colors.outline }}
                        resizeMode="cover"
                        accessibilityLabel="Attached fuel gauge photo"
                      />
                      <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={{ color: colors.onSurfaceVariant, fontSize: 12 }}>
                          {gaugeScanEstimate != null ? `AI read ~${gaugeScanEstimate}% from this photo` : "Evidence attached"}
                        </Text>
                        <Pressable onPress={() => { setGaugePhotoUrl(''); setGaugeScanEstimate(null); }} accessibilityRole="button" accessibilityLabel="Remove gauge photo and retake" style={{ marginTop: 6, minHeight: 48, justifyContent: 'center' }}>
                          <Text style={{ color: colors.error, fontWeight: '600' }}>Retake photo</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <CoachMarkTarget targetId="fuel.gauge_entry" radius={16} padding={6}>
                      <ClayButton label="Capture gauge with camera" variant="tonal" icon="camera-outline" disabled={gaugeBusy} onPress={onCaptureGauge} style={{ alignSelf: 'stretch' }} />
                    </CoachMarkTarget>
                  )}
                  {gaugeBusy ? <ActivityIndicator size="small" style={{ marginTop: 8 }} /> : null}
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>PURPOSE (OPTIONAL)</Text>
                  <TextInput
                    style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                    placeholder="Why fuel is needed"
                    placeholderTextColor={colors.outline}
                    maxLength={500}
                    accessibilityLabel="Fuel request purpose"
                    value={requestPurpose}
                    onChangeText={setRequestPurpose}
                  />
                </View>
                <CoachMarkTarget targetId="fuel.request_button" radius={16} padding={6}>
                  <ClayButton
                    label={requestingFuel ? "Submitting…" : "Request fuel"}
                    variant="primary"
                    icon="send-outline"
                    loading={requestingFuel}
                    disabled={requestingFuel || !hasAssignedVehicle || !gaugePhotoUrl || gaugeBusy || !!levelError}
                    onPress={requestFuel}
                    style={{ alignSelf: 'stretch', marginTop: 8 }}
                  />
                </CoachMarkTarget>
              </>
  </>;
}
const defaultStyles = StyleSheet.create({
fieldGroup: { gap: 6 },
fieldLabel: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6, textTransform: "uppercase" },
input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: fonts.body,
  },
requestRejected: { fontSize: 12, lineHeight: 17, fontFamily: fonts.bodySemiBold },
});
