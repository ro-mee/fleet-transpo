import { View, Text } from "react-native";
import { CargoButton as ClayButton } from "./CargoButton";
import { useTheme } from "../../lib/theme-context";
import { CargoManifestList } from "./CargoManifestList";
import { CargoReceiptSummary } from "./CargoReceiptSummary";
import { CargoDecisionStatus } from "./CargoDecisionStatus";
import { cargoFormHasIssue } from "../../lib/cargo-view-model";
import { CargoIssueSheet } from "./CargoIssueSheet";
export function CargoWorkflowContent({ mode, execution, trip, view, form, errors, issueLine, review, loading, busy, pending, stale, error, message, onRefresh, onOpen, onChange, onIssue, onIssueChange, onPhoto, onCloseIssue, onReview, onSubmit, onRecount }) {
  const { type, colors } = useTheme();
  const manifest = execution?.manifest;
  const stage = mode === "delivery" ? "DELIVERY" : "PICKUP";
  const hasIssue = cargoFormHasIssue(execution, form, stage);
  const atStage = stage === "PICKUP" ? trip?.trip_status === "At Pickup" : ["Drop-off", "Arrived"].includes(trip?.trip_status);
  const canObserve = execution?.capabilities?.observe === true && atStage && !stale;
  const editable = canObserve && !busy && !pending;
  return <View style={{ gap: 24 }}>
    {loading && <Text accessibilityLiveRegion="polite" style={type.bodyMd}>Loading cargo verification…</Text>}
    {error && <Text accessibilityRole="alert" style={[type.bodyMd, { color: colors.error }]}>{error}</Text>}
    {message && <Text accessibilityLiveRegion="polite" style={type.bodyMd}>{message}</Text>}
    {view.legacyHold && <Text accessibilityRole="alert" style={type.bodyMd}>{view.legacyHold}</Text>}
    <CargoDecisionStatus view={view} />
    <ClayButton label="Refresh cargo status" variant="tonal" onPress={onRefresh} disabled={busy || loading} />
    {view.stage !== "UNAVAILABLE" && <>
      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={type.headlineMd}>{view.summary.serviceLabel}</Text>
        <Text style={type.supporting}>{view.summary.sourceLabel}</Text>
        <Text style={type.supporting}>{view.summary.itemCount} items · Manifest revision {view.summary.revision}</Text>
        <Text style={type.bodyMd}>Pickup: {trip?.origin || "Location unavailable"}</Text>
        <Text style={type.bodyMd}>Delivery: {trip?.destination || "Location unavailable"}</Text>
        <Text style={type.supporting}>{view.summary.progress}</Text>
      </View>
      {mode === "overview" ? <>
        <CargoReceiptSummary manifest={manifest} lines={execution.lines} />
        {trip?.trip_status === "At Pickup" && <ClayButton label="Verify pickup" onPress={() => onOpen("cargo-pickup")} />}
        {["Drop-off", "Arrived"].includes(trip?.trip_status) && <ClayButton label="Verify delivery" onPress={() => onOpen("cargo-delivery")} />}
        <Text style={type.supporting}>Start Trip begins travel to pickup. After loading, departure needs a current source decision when required, Fleet clearance and separate post-load securement.</Text>
        <Text style={type.bodyMd}>{view.canDepart ? "Current server departure clearance verified. Trip movement remains in the existing map workflow." : "Departure blocked. Refresh the server status after Fleet reviews the post-load securement."}</Text>
      </> : <>
        {!atStage && <Text style={type.bodyMd}>This observation is available {stage === "PICKUP" ? "at pickup" : "at delivery"}. Return to the map to follow the trip.</Text>}
        {stale && <Text style={[type.bodyMd, { color: colors.error }]}>The manifest changed. Your earlier count is preserved; begin a new count against this revision.</Text>}
        {pending && <Text style={type.bodyMd}>This saved submission is locked for retry. Quantities and submission identity stay unchanged.</Text>}
        {issueLine ? <CargoIssueSheet line={manifest.lines.find(line => line.line_id === issueLine)} issue={form.issues?.[issueLine]} onChange={onIssueChange} onPhoto={onPhoto} onClose={onCloseIssue} busy={busy} /> : review ? <>
          <CargoReceiptSummary manifest={manifest} lines={execution.lines} counts={form.counts} stage={stage} />
          <ClayButton label="Back to counts" variant="tonal" onPress={() => onReview(false)} disabled={busy} />
        </> : <CargoManifestList manifest={manifest} lines={execution.lines} evidence={execution.evidence} counts={form.counts} issues={form.issues} errors={errors || {}} stage={stage} onChange={onChange} onIssue={onIssue} editable={editable} />}
        {!issueLine && <>
          {!review && <ClayButton label="Review counts" variant="tonal" onPress={() => onReview(true)} disabled={!canObserve || busy} />}
          {review && <>
            {stage === "PICKUP" ? <>
              <ClayButton label="Confirm pickup" onPress={() => onSubmit(false)} disabled={!canObserve || hasIssue || busy} loading={busy && !hasIssue} />
              <ClayButton label="Report pickup issue" variant="secondary" onPress={() => onSubmit(true)} disabled={!canObserve || !hasIssue || busy} loading={busy && hasIssue} />
            </> : <>
              <ClayButton label="Record delivery observation" onPress={() => onSubmit(hasIssue)} disabled={!canObserve || busy} loading={busy} />
              <Text style={type.supporting}>Your observation remains pending review. Expected, picked-up and delivered amounts stay separate.</Text>
            </>}
          </>}
          {stage === "DELIVERY" && <>
            <Text style={type.bodyMd}>{view.summary.receiverLabel}</Text>
            <Text style={type.supporting}>Receiver name and method: unavailable in the current server contract.</Text>
            <ClayButton label={view.canConfirmDelivery ? "Delivery confirmed by server" : "Confirm delivery"} disabled />
          </>}
          {(stale || form.pendingSubmissionId) && <ClayButton label="Begin a new count" variant="tonal" onPress={onRecount} disabled={busy || (pending && !stale)} />}
        </>}
      </>}
    </>}
  </View>;
}
