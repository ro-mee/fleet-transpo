import { CoachMarkTarget } from '../coachmarks';
import { View, Text, StyleSheet } from "react-native";
import { ReferencePhotoGuide } from "../ReferencePhotoGuide";
import { cargoItemIllustrationFor } from "../../lib/cargo-item-illustrations";
import { ClayInput } from "../clay";
import { CargoButton as ClayButton } from "./CargoButton";
import { useTheme } from "../../lib/theme-context";
export function CargoPhysicalDetails({ line, showName = false }) {
  const { type } = useTheme();
  const physical = line?.physical;
  if (!physical) return null;
  return <View style={{ gap: 6 }}>
    {showName && <Text style={type.cardTitle}>{line.name}</Text>}
    <Text style={type.supporting}>{physical.transport_package_count ?? "Count unavailable"} packages{physical.package_description ? ` (${physical.package_description})` : ""} · {physical.gross_weight_kg_per_package ?? "Weight unavailable"} kg/package</Text>
    <Text style={type.supporting}>Package dimensions: {physical.dimensions_m ? `${physical.dimensions_m.length} × ${physical.dimensions_m.width} × ${physical.dimensions_m.height} m` : "not recorded"}</Text>
    <Text style={type.supporting}>Rotation: {physical.package_can_rotate === true ? "permitted" : physical.package_can_rotate === false ? "not permitted" : "not recorded"}</Text>
    <Text style={type.supporting}>Temperature: {physical.temperature_c ? `${physical.temperature_c.min_c} to ${physical.temperature_c.max_c} °C` : physical.temperature_c === null ? "no requirement declared" : "not recorded"}</Text>
  </View>;
}

export function CargoPhysicalManifest({ manifest }) {
  const { type } = useTheme();
  const lines = manifest?.lines?.filter(line => line.physical) ?? [];
  if (!lines.length) return null;
  return <View style={{ gap: 16, marginTop: 24 }}>
    <Text accessibilityRole="header" style={type.titleLg}>Transport requirements</Text>
    {lines.map(line => <CargoPhysicalDetails key={line.line_id} line={line} showName />)}
    <Text style={type.supporting}>Source-declared package facts do not confirm capacity, Fleet clearance or post-load securement.</Text>
  </View>;
}

export function CargoItemReceiptRow({ line, value = "", stage = "PICKUP", pickupQuantity, onChange, onIssue, issue, error, imageUrl, editable = true, guideTarget = false }) {
  const { colors, type } = useTheme();
  const illustration = cargoItemIllustrationFor(line.name);
  const countHint = line.quantity_basis === 'TRANSPORT_PACKAGE'
    ? 'Count the packages physically present. Do not copy the expected amount.'
    : `Measure the amount physically present in ${line.unit}. Do not copy the expected amount.`;
  return <View style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
    <Text style={type.titleLg}>{line.name}</Text>
    <View style={[styles.expectation, { backgroundColor: colors.surfaceContainerLow }]}>
      <Text style={type.supporting}>Expected from source</Text>
      <Text style={type.headlineMd}>{line.expected_quantity} {line.unit}</Text>
    </View>
    <CargoPhysicalDetails line={line} />
    {stage === "DELIVERY" && <Text style={type.bodyMd}>Picked up: {pickupQuantity ?? "Not recorded"} {pickupQuantity != null ? line.unit : ""}</Text>}
    {!imageUrl && <Text style={type.supporting}>Source photo unavailable. An illustrative example is available below.</Text>}
    <ReferencePhotoGuide source={imageUrl ? { uri: imageUrl } : illustration.source} subject={line.name} caption={imageUrl ? 'Source reference only — not this pickup or delivery’s actual condition.' : illustration.caption} />
    {!!line.handling?.length && <Text style={type.supporting}>Handling: {line.handling.map(value => value.replace(/_/g, " ").toLowerCase()).join(" · ")}</Text>}
    <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>{countHint}</Text>
    {guideTarget ? <CoachMarkTarget targetId={stage === 'DELIVERY' ? 'cargo.delivery' : 'cargo.counts'}><ClayInput label={`Actual ${stage === "DELIVERY" ? "delivery" : "pickup"} count (${line.unit})`} accessibilityLabel={`${line.name}, actual ${stage.toLowerCase()} count in ${line.unit}`} accessibilityHint={error || countHint} value={value} onChangeText={onChange} keyboardType={line.quantity_basis === "TRANSPORT_PACKAGE" ? "number-pad" : "decimal-pad"} editable={editable} error={error} placeholder="Enter counted amount" placeholderTextColor={colors.onSurfaceVariant} inputStyle={{ ...type.bodyMd, minWidth: 0 }} style={{ borderWidth: 1.5, borderColor: error ? colors.error : colors.onSurfaceVariant }} /></CoachMarkTarget> : <ClayInput label={`Actual ${stage === "DELIVERY" ? "delivery" : "pickup"} count (${line.unit})`} accessibilityLabel={`${line.name}, actual ${stage.toLowerCase()} count in ${line.unit}`} accessibilityHint={error || countHint} value={value} onChangeText={onChange} keyboardType={line.quantity_basis === "TRANSPORT_PACKAGE" ? "number-pad" : "decimal-pad"} editable={editable} error={error} placeholder="Enter counted amount" placeholderTextColor={colors.onSurfaceVariant} inputStyle={{ ...type.bodyMd, minWidth: 0 }} style={{ borderWidth: 1.5, borderColor: error ? colors.error : colors.onSurfaceVariant }} />}
    {issue?.remarks && <Text style={type.bodyMd}>Issue: {issue.remarks}</Text>}
    {onIssue && (guideTarget ? <CoachMarkTarget targetId="cargo.issue"><ClayButton label={`Report issue: ${line.name}`} variant="tonal" onPress={onIssue} disabled={!editable} textStyle={styles.wrap} /></CoachMarkTarget> : <ClayButton label={`Report issue: ${line.name}`} variant="tonal" onPress={onIssue} disabled={!editable} textStyle={styles.wrap} />)}
  </View>;
}
const styles = StyleSheet.create({ row: { gap: 8, paddingVertical: 16, borderBottomWidth: 1 }, expectation: { gap: 4, padding: 12, borderRadius: 12 }, wrap: { flexShrink: 1 } });
