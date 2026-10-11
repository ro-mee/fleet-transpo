import { View, Text } from "react-native";
import { CargoItemReceiptRow } from "./CargoItemReceiptRow";
import { useTheme } from "../../lib/theme-context";
export function CargoManifestList({ manifest, counts, stage, lines = [], issues = {}, errors = {}, evidence = [], onChange, onIssue, editable = true }) {
  const { type } = useTheme();
  if (!manifest?.lines?.length) return <Text style={type.bodyMd}>Manifest items are unavailable. Refresh online.</Text>;
  return <View>{manifest.lines.map(line => <CargoItemReceiptRow key={line.line_id} line={line} value={counts?.[line.line_id] ?? ""} stage={stage} pickupQuantity={lines.find(item => item.line_id === line.line_id)?.pickup_quantity} issue={issues[line.line_id]} error={errors[line.line_id]} imageUrl={evidence.find(item => item.evidence_id === line.reference_image_ref)?.url} onChange={onChange ? value => onChange(line.line_id, value) : undefined} onIssue={onIssue ? () => onIssue(line.line_id) : undefined} editable={editable} />)}</View>;
}
