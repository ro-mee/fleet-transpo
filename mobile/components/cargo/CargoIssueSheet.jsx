import { CoachMarkTarget } from '../coachmarks';
import { View, Text, Image } from "react-native";
import { ClayInput } from "../clay";
import { CargoButton as ClayButton } from "./CargoButton";
import { useTheme } from "../../lib/theme-context";
// Inline issue editor keeps the driver's count visible and avoids a gesture-only sheet.
export function CargoIssueSheet({ line, issue = {}, onChange, onPhoto, onClose, busy = false }) {
  const { type, colors } = useTheme();
  return <View style={{ gap: 12, paddingVertical: 16 }}>
    <Text accessibilityRole="header" style={type.titleLg}>Report an issue</Text>
    <Text style={type.supporting}>Only shortage, excess or damage can be reported as an issue. A remark alone is a note on a clean count.</Text>
    <Text style={type.bodyMd}>{line.name}: {line.expected_quantity} {line.unit} expected</Text>
    <CoachMarkTarget targetId="cargo.issue"><ClayInput label="Reason or remark" accessibilityLabel={`Reason for ${line.name} issue`} accessibilityHint="Explain the shortage, excess or damage." value={issue.remarks || ""} onChangeText={remarks => onChange({ ...issue, remarks, reported: true })} multiline maxLength={2000} editable={!busy} placeholderTextColor={colors.onSurfaceVariant} inputStyle={{ ...type.bodyMd, minWidth: 0 }} style={{ borderWidth: 1.5, borderColor: colors.onSurfaceVariant }} /></CoachMarkTarget>
    <ClayButton label={issue.damaged ? "Damaged — change to intact" : "Mark item damaged"} variant="tonal" disabled={busy} onPress={() => onChange({ ...issue, damaged: !issue.damaged, reported: true })} />
    <ClayButton label="Add observation photo" variant="tonal" disabled={busy || (issue.evidence?.length || 0) >= 5} onPress={onPhoto} />
    <Text style={type.supporting}>{issue.evidence?.length || 0} photos saved with this observation. Photos do not grant approval.</Text>
    {(issue.evidence || []).map((photo, index) => <View key={`${photo.uri}:${index}`} style={{ gap: 8 }}>
      {typeof photo.uri === 'string' && photo.uri.startsWith('file://') ? <Image source={{ uri: photo.uri }} accessibilityLabel={`Observation photo ${index + 1} for ${line.name}`} style={{ width: '100%', height: 180, borderRadius: 12 }} resizeMode="contain" /> : <Text style={type.supporting}>Photo {index + 1} preview unavailable</Text>}
      <ClayButton label={`Remove photo ${index + 1}`} variant="tonal" disabled={busy} onPress={() => { if (!busy) onChange({ ...issue, evidence: issue.evidence.filter((_, position) => position !== index) }); }} />
    </View>)}
    <ClayButton label="Keep issue and return to count" onPress={onClose} disabled={busy} />
  </View>;
}
