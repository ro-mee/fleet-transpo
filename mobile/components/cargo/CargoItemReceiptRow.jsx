import { useState } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { ClayInput } from "../clay";
import { CargoButton as ClayButton } from "./CargoButton";
import { useTheme } from "../../lib/theme-context";
export function CargoItemReceiptRow({ line, value = "", stage = "PICKUP", pickupQuantity, onChange, onIssue, issue, error, imageUrl, editable = true }) {
  const { colors, type } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  return <View style={[styles.row, { borderBottomColor: colors.outlineVariant }]}>
    <Text style={type.titleLg}>{line.name}</Text>
    <Text style={type.supporting}>Expected</Text>
    <Text style={type.headlineMd}>{line.expected_quantity} {line.unit}</Text>
    {stage === "DELIVERY" && <Text style={type.bodyMd}>Picked up: {pickupQuantity ?? "Not recorded"} {pickupQuantity != null ? line.unit : ""}</Text>}
    {imageUrl && !imageFailed ? <Image source={{ uri: imageUrl }} style={styles.image} accessibilityLabel={`Reference image for ${line.name}`} onError={() => setImageFailed(true)} /> : <Text style={type.supporting}>Reference image unavailable</Text>}
    {!!line.handling?.length && <Text style={type.supporting}>Handling: {line.handling.map(value => value.replace(/_/g, " ").toLowerCase()).join(" · ")}</Text>}
    <ClayInput label={`Actual ${stage === "DELIVERY" ? "delivery" : "pickup"} count (${line.unit})`} accessibilityLabel={`${line.name}, actual ${stage.toLowerCase()} count in ${line.unit}`} accessibilityHint={error || "Count what is physically present. Do not copy the expected amount."} value={value} onChangeText={onChange} keyboardType={line.quantity_basis === "TRANSPORT_PACKAGE" ? "number-pad" : "decimal-pad"} editable={editable} error={error} placeholder="Enter counted amount" placeholderTextColor={colors.onSurfaceVariant} inputStyle={{ ...type.bodyMd, minWidth: 0 }} style={{ borderWidth: 1.5, borderColor: error ? colors.error : colors.onSurfaceVariant }} />
    {issue?.remarks && <Text style={type.bodyMd}>Issue: {issue.remarks}</Text>}
    {onIssue && <ClayButton label={`Report issue: ${line.name}`} variant="tonal" onPress={onIssue} disabled={!editable} textStyle={styles.wrap} />}
  </View>;
}
const styles = StyleSheet.create({ row: { gap: 8, paddingVertical: 16, borderBottomWidth: 1 }, image: { width: 96, height: 96, borderRadius: 16 }, wrap: { flexShrink: 1 } });
