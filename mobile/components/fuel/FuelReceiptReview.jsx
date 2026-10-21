import React from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts } from '../../lib/theme';
import { ClayCard, ClayButton } from '../clay';
import { CoachMarkTarget } from '../coachmarks';

export default function FuelReceiptReview({ entryMethod, liters, setLiters, cost, setCost, setPricePerLiter, station, setStation, fuelDate, setFuelDate, pricePerLiter, receiptAsset, receiptUrl, scanning = false, submitting = false, scanVisualPhase, openReceiptCamera, pickReceipt, scanReceipt, canSubmit, handleSubmit, scrollRef, styles: providedStyles }) {
  const { colors } = useTheme();
  const styles = providedStyles || defaultStyles;
  return <>
          <ClayCard style={styles.formCard}>
            <View style={styles.formHeading}>
              <View>
                <Text style={[styles.formTitle, { color: colors.onSurface }]}>Refuel Details</Text>
                <Text style={[styles.formSubtitle, { color: colors.onSurfaceVariant }]}>
                  {entryMethod === "scan" ? "Scanned details. Review before saving." : "Enter the receipt values exactly as shown."}
                </Text>
              </View>
              <View style={[styles.methodBadge, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name={entryMethod === "scan" ? "scan-outline" : "create-outline"} size={14} color={colors.onPrimaryContainer} />
                <Text style={[styles.methodBadgeText, { color: colors.onPrimaryContainer }]}>{entryMethod === "scan" ? "Receipt scan" : "Manual"}</Text>
              </View>
            </View>

            <CoachMarkTarget targetId="fuel.verify" scrollRef={scrollRef}>
              <View style={styles.fieldRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>VOLUME (L)</Text>
                  <TextInput
                    style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                    placeholder="e.g. 45.5"
                    placeholderTextColor={colors.outline}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Fuel volume in litres"
                    value={liters}
                    onChangeText={(value) => { setLiters(value); setPricePerLiter(""); }}
                  />
                </View>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>TOTAL COST (₱)</Text>
                  <TextInput
                    style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                    placeholder="e.g. 3500"
                    placeholderTextColor={colors.outline}
                    keyboardType="decimal-pad"
                    accessibilityLabel="Total fuel cost in pesos"
                    value={cost}
                    onChangeText={(value) => { setCost(value); setPricePerLiter(""); }}
                  />
                </View>
              </View>
            </CoachMarkTarget>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>STATION NAME</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                placeholder="e.g. Shell NLEX"
                placeholderTextColor={colors.outline}
                value={station}
                onChangeText={setStation}
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>REFUEL DATE</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.outline}
                  value={String(fuelDate).slice(0, 10)}
                  onChangeText={setFuelDate}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>PRICE / LITER</Text>
                <View style={[styles.input, styles.readOnlyInput, { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerHighest }]}>
                  <Text style={{ color: colors.onSurface }}>
                    {Number(pricePerLiter) > 0
                      ? `₱${Number(pricePerLiter).toFixed(2)}`
                      : Number(liters) > 0 && Number(cost) > 0
                        ? `₱${(Number(cost) / Number(liters)).toFixed(2)}`
                        : "—"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.evidenceBlock}>
              <View style={styles.evidenceHeader}>
                <View style={styles.evidenceCopy}>
                  <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>RECEIPT PHOTO *</Text>
                  <Text style={[styles.evidenceHint, { color: colors.onSurfaceVariant }]}>Attach proof for the details you entered.</Text>
                </View>
                {receiptAsset ? (
                  <Image source={{ uri: receiptAsset.uri }} style={styles.receiptThumb} />
                ) : (
                  <View style={[styles.receiptThumbPlaceholder, { backgroundColor: colors.surfaceContainerHighest }]}>
                    <Ionicons name="receipt-outline" size={22} color={colors.onSurfaceVariant} />
                  </View>
                )}
              </View>
              {entryMethod === "manual" ? <View style={styles.evidenceButtons}>
                <Pressable
                  onPress={() => openReceiptCamera("upload")}
                  disabled={scanning}
                  style={({ pressed }) => [
                    styles.evidenceBtn,
                    { backgroundColor: colors.primary, opacity: pressed || scanning ? 0.8 : 1 },
                  ]}
                >
                  <Ionicons name="camera-outline" size={18} color={colors.onPrimary} />
                  <Text style={[styles.evidenceBtnText, { color: colors.onPrimary }]}>{scanning ? "Uploading..." : "Take photo"}</Text>
                </Pressable>
                <Pressable
                  onPress={pickReceipt}
                  disabled={scanning}
                  style={({ pressed }) => [
                    styles.evidenceBtn,
                    styles.evidenceBtnSecondary,
                    { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant, opacity: pressed || scanning ? 0.8 : 1 },
                  ]}
                >
                  <Ionicons name="images-outline" size={18} color={colors.primary} />
                  <Text style={[styles.evidenceBtnText, { color: colors.primary }]}>Gallery</Text>
                </Pressable>
              </View> : (
                <Pressable
                  onPress={() => receiptAsset && !receiptUrl ? scanReceipt({ asset: receiptAsset }) : openReceiptCamera("scan")}
                  disabled={scanning}
                  style={({ pressed }) => [
                    styles.rescanBtn,
                    { borderColor: colors.outlineVariant, opacity: pressed || scanning ? 0.75 : 1 },
                  ]}
                >
                  <Ionicons name="scan-outline" size={18} color={colors.primary} />
                  <Text style={[styles.evidenceBtnText, { color: colors.primary }]}>
                    {scanning ? "Scanning..." : receiptAsset && !receiptUrl ? "Retry scan" : "Scan receipt again"}
                  </Text>
                </Pressable>
              )}
              {scanning ? (
                <Text style={[styles.evidencePending, { color: colors.onSurfaceVariant }]}>
                  {entryMethod === "scan"
                    ? scanVisualPhase === "preparing"
                      ? "Preparing receipt image..."
                      : scanVisualPhase === "uploading"
                        ? "Uploading receipt..."
                        : scanVisualPhase === "reading"
                          ? "Reading receipt and extracting fuel details..."
                          : "Reading receipt..."
                    : "Uploading receipt photo..."}
                </Text>
              ) : receiptUrl ? (
                <Text style={[styles.evidenceReady, { color: colors.success || colors.primary }]}>Receipt attached and ready for review</Text>
              ) : receiptAsset ? (
                <Text style={[styles.evidenceError, { color: colors.error }]}>Photo has not uploaded. Try again before saving.</Text>
              ) : null}
            </View>

            <CoachMarkTarget id="fuel.submit_button" targetId="fuel.submit_button" radius={16} padding={6}>
              <ClayButton
                label={submitting ? "Saving Entry..." : scanning ? "Uploading Receipt..." : "Save Fuel Entry"}
                variant="primary"
                size="lg"
                icon="checkmark"
                iconPosition="right"
                disabled={!canSubmit || submitting || scanning}
                loading={submitting || scanning}
                onPress={handleSubmit}
                style={{ marginTop: 16 }}
              />
            </CoachMarkTarget>
          </ClayCard>
  </>;
}
const defaultStyles = StyleSheet.create({
evidenceBlock: { gap: 10, marginTop: 2 },
evidenceBtn: { flex: 1, minHeight: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
evidenceBtnSecondary: { borderWidth: 1 },
evidenceBtnText: { fontSize: 13, fontFamily: fonts.bodySemiBold },
evidenceButtons: { flexDirection: "row", gap: 10 },
evidenceCopy: { flex: 1, gap: 4 },
evidenceError: { fontSize: 12, fontFamily: fonts.bodySemiBold },
evidenceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
evidenceHint: { fontSize: 12, fontFamily: fonts.body, lineHeight: 17 },
evidencePending: { fontSize: 12, fontFamily: fonts.bodyMedium || fonts.body },
evidenceReady: { fontSize: 12, fontFamily: fonts.bodySemiBold },
fieldGroup: { gap: 6 },
fieldLabel: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6, textTransform: "uppercase" },
fieldRow: { flexDirection: "row", gap: 12 },
formCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
formHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
formSubtitle: { fontSize: 12, lineHeight: 17, fontFamily: fonts.body, marginTop: 3 },
formTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: fonts.body,
  },
methodBadge: { minHeight: 28, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
methodBadgeText: { fontSize: 11, fontFamily: fonts.bodySemiBold },
readOnlyInput: { justifyContent: "center" },
receiptThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: "#ddd" },
receiptThumbPlaceholder: { width: 56, height: 56, borderRadius: 10, alignItems: "center", justifyContent: "center" },
rescanBtn: { minHeight: 46, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
});
