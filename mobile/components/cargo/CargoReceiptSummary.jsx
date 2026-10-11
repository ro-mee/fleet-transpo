import { View, Text } from "react-native";
import { useTheme } from "../../lib/theme-context";
export function CargoReceiptSummary({ manifest, lines = [], counts, stage }) {
  const { type, colors } = useTheme();
  return <View style={{ gap: 16 }}><Text accessibilityRole="header" style={type.titleLg}>Receipt summary</Text>
    {(manifest?.lines || []).map(line => {
      const row = lines.find(item => item.line_id === line.line_id) || {};
      const quantity = value => value == null ? "Not recorded" : `${value} ${line.unit}`;
      return <View key={line.line_id} style={{ gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }}>
        <Text style={type.cardTitle}>{line.name}</Text>
        <Text style={type.bodyMd}>Expected: {quantity(line.expected_quantity)}</Text>
        <Text style={type.bodyMd}>Picked up: {quantity(row.pickup_quantity)}</Text>
        <Text style={type.bodyMd}>Delivered: {quantity(row.delivery_quantity)}</Text>
        <Text style={type.supporting}>Order shortage: {quantity(row.order_shortage)}</Text>
        <Text style={type.supporting}>Delivery shortage: {quantity(row.delivery_shortage)}</Text>
        {counts && <Text style={type.bodyMd}>Your {stage?.toLowerCase()} observation: {quantity(counts[line.line_id])}</Text>}
      </View>;
    })}
  </View>;
}
