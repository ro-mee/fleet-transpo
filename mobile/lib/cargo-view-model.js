import { resolveDriverWorkspace } from "./driver-workspace";
// Display facts from CargoExecutionView; never grant source, Fleet or receiver authority.
const SERVICES = { RESTAURANT_SUPPLY_PICKUP: "Restaurant supply pickup", RESTAURANT_FOOD_DELIVERY: "Restaurant food delivery", HOTEL_SUPPLY_TRANSFER: "Hotel supply transfer" };
const SYNC = { NONE: "No observation saved", DEVICE_SAVED: "Saved on this device", FLEET_SAVED: "Saved to Fleet", STALE_REVIEW: "Manifest changed — review your count", TERMINAL_REVIEW: "Saved draft needs Fleet review", REAUTHENTICATION_REQUIRED: "Sign in again to sync" };
const FEEDBACK = { ACKNOWLEDGED: "Partner acknowledged receipt — not approval", PENDING: "Partner receipt pending", LEASED: "Sending partner receipt", RETRY: "Partner receipt will retry", FAILED: "Partner receipt failed", NOT_QUEUED: "Partner receipt not queued" };
const LEGACY_HOLD = "This legacy In Progress cargo trip needs Fleet review. Delivery observations can only be attached at Drop-off or Arrived. Contact Fleet to review the trip status and custody before continuing; this screen cannot change its status.";
export function cargoMapAction(trip, driverType) {
  if (!resolveDriverWorkspace({ driverType, trip }).tripReady || trip?.load_type !== "Cargo") return null;
  if (trip.trip_status === "At Pickup") return "cargo-pickup";
  if (["Passenger Onboard", "In Progress"].includes(trip.trip_status)) return "cargo";
  if (["Drop-off", "Arrived"].includes(trip.trip_status)) return "cargo-delivery";
  return null;
}
export function blankCargoCounts(manifest) { return Object.fromEntries((manifest?.lines || []).map(line => [line.line_id, ""])); }
export function cargoQuantity(value, line) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,15}(?:\.\d{1,3})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (line.quantity_basis === "TRANSPORT_PACKAGE" && /[1-9]/.test(fraction)) return null;
  const cleanWhole = whole.replace(/^0+(?=\d)/, "");
  const cleanFraction = fraction.replace(/0+$/, "");
  return cleanFraction ? `${cleanWhole}.${cleanFraction}` : cleanWhole;
}
export function validateCargoCounts(manifest, counts = {}) {
  const errors = {};
  for (const line of manifest?.lines || []) {
    if (!line.unit?.trim()) errors[line.line_id] = "The manifest unit is missing. Ask Fleet to review.";
    else if (cargoQuantity(counts[line.line_id], line) == null) errors[line.line_id] = line.quantity_basis === "TRANSPORT_PACKAGE" ? `Enter a whole number of ${line.unit}, including zero if none are present.` : `Enter a nonnegative amount in ${line.unit}, with up to three decimal places.`;
  }
  return { valid: Boolean(manifest?.lines?.length) && !Object.keys(errors).length, errors };
}
function validManifest(manifest) {
  return Boolean(manifest?.manifest_ref?.hash && SERVICES[manifest.service_code] && manifest.lines?.length && manifest.lines.every(line => line.line_id && line.name && line.unit && cargoQuantity(line.expected_quantity, line) != null));
}
export function buildCargoViewModel(execution, { offline = false, syncState = {}, fresh = true, trip, driverType } = {}) {
  const workspace = resolveDriverWorkspace({ driverType, trip });
  const tripStatus = trip?.trip_status;
  if (workspace.tripReady !== true || workspace.mode !== "cargo") {
    return { stage: "UNAVAILABLE", primaryAction: "Review assignment", canSubmit: false, canDepart: false, canConfirmDelivery: false, legacyHold: null, summary: { modeLabel: workspaceModeLabel(workspace) }, blockers: [{ code: "VEHICLE_ASSIGNMENT_REQUIRED", message: workspaceBlockReason(workspace) || "This Passenger vehicle uses hotel transportation. Open Trip Details for this trip." }] };
  }
  const view = execution?.data ?? execution;
  if (!validManifest(view?.manifest)) return { stage: "UNAVAILABLE", primaryAction: "Retry", canSubmit: false, canDepart: false, canConfirmDelivery: false, legacyHold: tripStatus === "In Progress" ? LEGACY_HOLD : null, summary: {}, blockers: [{ code: "CARGO_UNAVAILABLE", message: "Cargo verification is unavailable. Retry online or contact Fleet." }] };
  const manifest = view.manifest;
  const state = typeof syncState === "string" ? syncState : syncState.state || "NONE";
  const pending = !["NONE", "FLEET_SAVED"].includes(state);
  const blockers = [...(view.blockers || [])];
  if (offline || !fresh) blockers.unshift({ code: "CARGO_FRESH_VIEW_REQUIRED", message: "Reconnect and refresh the server view before departure or confirmation." });
  if (pending) blockers.unshift({ code: "CARGO_DRAFT_PENDING", message: SYNC[state] || "Saved draft needs review." });
  const canDepart = !offline && fresh && !pending && view.can_depart === true && view.pickup_state === "READY" && view.securement_confirmed === true;
  const canConfirmDelivery = !offline && fresh && !pending && view.can_complete === true && view.receiver_confirmed === true && view.delivery_state === "CONFIRMED";
  const atDelivery = ["Drop-off", "Arrived"].includes(tripStatus);
  let stage = atDelivery ? "DELIVERY" : view.pickup_state || "UNAVAILABLE";
  if (stage === "NOT_RECORDED") stage = "PICKUP";
  if (stage === "READY" && !canDepart) stage = "WAITING";
  if (state === "STALE_REVIEW") stage = "STALE_REVIEW";
  if (view.delivery_state === "CONFIRMED" && canConfirmDelivery) stage = "CONFIRMED";
  if (atDelivery && !canConfirmDelivery && !blockers.some(row => row.code === "CARGO_RECEIVER_CONFIRMATION_REQUIRED")) blockers.push({ code: "CARGO_RECEIVER_CONFIRMATION_REQUIRED", message: "Receiver authority has not been confirmed by the server. Delivery observations remain pending review." });
  const legacyHold = tripStatus === "In Progress" && !canConfirmDelivery ? LEGACY_HOLD : null;
  return { stage, legacyHold, primaryAction: stage === "PICKUP" ? "Record pickup" : stage === "READY" ? "Review departure" : stage === "DELIVERY" ? "Record delivery observation" : "Refresh status", canSubmit: !offline && fresh && !pending && view.capabilities?.observe === true && (tripStatus === "At Pickup" || atDelivery), canDepart, canConfirmDelivery,
    summary: { serviceLabel: SERVICES[manifest.service_code], sourceLabel: `${manifest.source_ref?.system || "Source"} · ${manifest.source_ref?.external_request_id || "Reference unavailable"}`, itemCount: manifest.lines.length, revision: manifest.manifest_ref.revision, syncLabel: SYNC[state] || "Save state unavailable", feedbackLabel: FEEDBACK[view.feedback?.state] || "Partner receipt state unavailable", sourceDecisionLabel: view.source_decision?.action === "ACCEPT_OBSERVED" ? "Source accepted the observed amount" : view.source_decision?.action === "REJECT_PICKUP" ? "Source rejected pickup" : ["WAITING", "AWAITING_DECISION"].includes(view.pickup_state) ? "Awaiting source decision or Fleet clearance" : "No source decision recorded", clearanceLabel: canDepart ? "Fleet departure clearance confirmed" : "Fleet clearance required", securementLabel: view.securement_confirmed === true ? "Server verified post-load securement" : "Post-load securement required", receiverLabel: view.receiver_confirmed === true ? "Receiver confirmation verified by server" : "Receiver authority unavailable", progress: canConfirmDelivery ? "Pickup verified · Delivery confirmed" : view.pickup_receipt ? "Pickup recorded · Delivery pending" : "Pickup pending · Delivery pending" }, blockers };
}
export function buildCargoReceipt(execution, { stage, counts, issues = {}, observedAt = new Date().toISOString(), confirm = false, reportIssue = false }) {
  const view = execution?.data ?? execution;
  const manifest = view?.manifest;
  if (!validManifest(manifest) || !["PICKUP", "DELIVERY"].includes(stage)) throw new Error("A current manifest and receipt stage are required.");
  if (!validateCargoCounts(manifest, counts).valid) throw new Error("Check the actual counts and units before saving.");
  if (confirm && (view.can_complete !== true || view.receiver_confirmed !== true)) throw new Error("Server verified receiver confirmation is required.");
  const receipt = { manifest_ref: { ...manifest.manifest_ref }, stage, observed_at: observedAt, receiver_confirmation_ref: null,
    lines: manifest.lines.map(line => {
      const observed = cargoQuantity(counts[line.line_id], line);
      const expected = stage === "DELIVERY" ? view.lines?.find(item => item.line_id === line.line_id)?.pickup_quantity : line.expected_quantity;
      const issue = issues[line.line_id] || {};
      const difference = expected == null ? null : compareCargoQuantities(observed, expected);
      const issueCode = issue.damaged ? "DAMAGE" : difference < 0 ? "SHORTAGE" : difference > 0 ? "EXCESS" : null;
      if (issueCode && !issue.remarks?.trim()) throw new Error(`Add a reason for ${line.name} before reporting the issue.`);
      return { line_id: line.line_id, observed_quantity: observed, condition: issue.damaged ? "DAMAGED" : "INTACT", issue_code: issueCode, remarks: issue.remarks?.trim() || "", evidence_ids: [], evidence: issue.evidence || [] };
    }) };
  if (reportIssue && !receipt.lines.some(line => line.issue_code)) throw new Error("Report an issue only for a shortage, excess or damage. Equal counts with a remark can use Confirm pickup.");
  return receipt;
}

export function compareCargoQuantities(left, right) {
  const scaled = value => { const [whole, fraction = ""] = String(value).split("."); return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")); };
  const a = scaled(left), b = scaled(right);
  return a === b ? 0 : a < b ? -1 : 1;
}
export function cargoFormHasIssue(execution, { counts = {}, issues = {} } = {}, stage = "PICKUP") {
  return !!execution?.manifest?.lines?.some(line => {
    if (issues[line.line_id]?.damaged) return true;
    const actual = cargoQuantity(counts[line.line_id], line);
    const expected = stage === "DELIVERY" ? execution.lines?.find(item => item.line_id === line.line_id)?.pickup_quantity : line.expected_quantity;
    return actual != null && expected != null && compareCargoQuantities(actual, expected) !== 0;
  });
}
export function workspaceModeLabel(workspace) {
  return workspace.mode === "cargo" ? "Cargo driver" : workspace.mode === "passenger" ? "Passenger driver" : "Driver type needs setup";
}
export function workspaceBlockReason(workspace) {
  if (["missing_driver_type", "unsupported_driver_type"].includes(workspace.reason)) return "Driver type needs setup. Ask Dispatch to save Passenger or Cargo before continuing.";
  if (workspace.reason === "driver_vehicle_mismatch") return "The vehicle does not match your saved driver type. Ask Dispatch to correct the driver, vehicle, or trip type before continuing.";
  if (workspace.reason === "trip_type_mismatch") return "The saved trip type does not match your driver type and vehicle. Ask Dispatch to correct the driver, vehicle, or trip type before continuing.";
  if (workspace.reason === "missing_trip_type") return "This cargo vehicle's trip type is missing. Ask Fleet or Dispatch to confirm the cargo assignment.";
  if (workspace.reason === "missing_operational_use") return "The vehicle work type is missing. Ask Fleet or Dispatch to confirm Cargo or Passenger use.";
  if (workspace.reason === "no_vehicle" || workspace.tripReady !== true) return "No verified vehicle is assigned to this trip. Ask Fleet or Dispatch to review the assignment.";
  return null;
}
// Reads only. Existing map controls remain the sole trip-transition writer.
export async function resolveCargoMapGate(trip, { driverType, offline = false, readExecution, readSyncState } = {}) {
  const workspace = resolveDriverWorkspace({ driverType, trip });
  if (workspace.tripReady !== true) return { allowed: false, route: null, reason: workspaceBlockReason(workspace) };
  if (trip?.load_type !== "Cargo" || !["At Pickup", "Passenger Onboard", "Drop-off", "Arrived", "In Progress"].includes(trip.trip_status)) return { allowed: true };
  const route = cargoMapAction(trip, driverType);
  const legacyHold = trip.trip_status === "In Progress" ? LEGACY_HOLD : null;
  if (offline) return { allowed: false, route, reason: legacyHold ? `Offline. ${legacyHold}` : "Reconnect to check the current cargo decision before continuing." };
  try {
    const [execution, syncState] = await Promise.all([readExecution(), readSyncState ? readSyncState() : Promise.resolve({})]);
    const view = buildCargoViewModel(execution, { driverType, trip, fresh: true, syncState });
    const delivery = ["Drop-off", "Arrived", "In Progress"].includes(trip.trip_status);
    return (delivery ? view.canConfirmDelivery : view.canDepart) ? { allowed: true } : { allowed: false, route, reason: legacyHold || (delivery ? "Verify the delivery observation and wait for server-confirmed receiver authority before completing the trip." : "Verify pickup and wait for current source acceptance, Fleet clearance and separate post-load securement before departure.") };
  } catch { return { allowed: false, route, reason: legacyHold ? `Cargo verification is unavailable. ${legacyHold}` : "Cargo verification is unavailable. Retry online or contact Fleet. Your trip movement was not confirmed." }; }
}

// Keep trip identity/status even when the independently read cargo provider is unavailable.
export async function readCargoScreenSources(tripId, { driverType, readExecution, readTrips }) {
  const [execution, trips] = await Promise.allSettled([readExecution(), readTrips()]);
  const rows = trips.status === "fulfilled" && Array.isArray(trips.value) ? trips.value : [];
  const trip = rows.find(row => String(row.trip_id) === String(tripId)) || null;
  const workspace = resolveDriverWorkspace({ driverType, trip });
  const cargoAllowed = workspace.tripReady === true && workspace.mode === "cargo" && trip?.load_type === "Cargo";
  return { execution: cargoAllowed && execution.status === "fulfilled" ? execution.value : null, executionError: execution.status === "rejected" ? execution.reason : null, trip, workspace, cargoAllowed };
}
