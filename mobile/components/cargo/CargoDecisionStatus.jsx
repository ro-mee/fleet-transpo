import { CoachMarkTarget } from '../coachmarks';
import { View, Text } from "react-native";
import { ClayCard } from "../clay";
import { useTheme } from "../../lib/theme-context";
const TITLES = { PICKUP: "Count cargo at pickup", AWAITING_DECISION: "Awaiting source decision", WAITING: "Waiting for clearance", REJECTED: "Pickup rejected — contact Fleet", STALE_REVIEW: "Manifest changed — recount required", READY: "Ready to depart", DELIVERY: "Delivery observation", CONFIRMED: "Delivery confirmed", UNAVAILABLE: "Cargo verification unavailable" };
export function CargoDecisionStatus({ view }) {
  const { type } = useTheme();
  return <ClayCard showSheen={false} contentStyle={{ gap: 12 }}>
    <Text accessibilityRole="header" style={type.titleLg}>{view.statusTitle || TITLES[view.stage] || "Status unavailable"}</Text>
    {Object.entries(view.summary || {}).filter(([key]) => ["syncLabel", "feedbackLabel", "sourceDecisionLabel", "clearanceLabel", "securementLabel", "receiverLabel"].includes(key)).map(([key, value]) => key === 'clearanceLabel' ? <CoachMarkTarget key={key} targetId="cargo.departure_status"><Text style={type.supporting}>{value}</Text></CoachMarkTarget> : <Text key={key} style={type.supporting}>{value}</Text>)}
    <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>{(view.blockers || []).map((row, index) => <Text key={`${row.code}-${index}`} style={type.bodyMd}>{row.message}</Text>)}</View>
  </ClayCard>;
}
