// Driver-facing notification microcopy — the single source of wording for
// every notification a driver receives. Pure functions: data in,
// { title, message, pushBody } out. Producers under src/app/api and
// src/services must not hand-roll driver strings; they call these so tone
// stays consistent and the invariants below hold everywhere at once.
//
// Two documented exceptions live outside this module because their wording
// is composed inside plpgsql triggers (migration 110): Dispatch Assigned
// (notify_dispatch_created / enqueue_dispatch_push) and Leave Reviewed
// (notify_leave_reviewed). Keep their wording in sync with these rules when
// editing that migration.
//
// Tone rules:
//   - title: a stable event name — never IDs, names, dates, or any varying
//     data. Dedupe in sla.js/maintenance.js keys on title, so a drifting
//     title silently breaks notification dedupe.
//   - message: 1-2 sentences — what happened, who, and what happens next.
//     Never promise a response time.
//   - pushBody: one short sentence (OS push truncates around two lines).
//   - Sentence case, no exclamation marks, human names over role labels.
//   - No incident numbers in driver copy — a driver never sees "report #47";
//     the notification's reference_id deep-links to the incident instead.
//   - Dates read as words ("January 1, 2026"), never ISO ("2026-01-01").
//   - No staff jargon in driver copy ("reinstated", "reassign", "their
//     profile") and no raw snake_case incident types: call sites pass the
//     human label from incidentTypeLabel() in src/lib/incidents/resolution.js.
//
// Staff variants (driverAutoSuspendedStaff / driverReinstatedStaff) keep the
// pre-existing staff wording, moved here verbatim so both audiences of the
// compliance events come from one place.

/** "@param {string} label" — " — about 8 minutes out", or "" when unknown. */
function minutesOut(etaMinutes) {
  return etaMinutes != null && Number.isFinite(+etaMinutes)
    ? ` — about ${Math.round(+etaMinutes)} minutes out`
    : "";
}

/** " — about 8 min" (short form for push bodies), or "" when unknown. */
function minutesShort(etaMinutes) {
  return etaMinutes != null && Number.isFinite(+etaMinutes)
    ? ` — about ${Math.round(+etaMinutes)} min`
    : "";
}

/** "January 1, 2026" — a date in words; falls back to the raw value. */
function dateWords(value) {
  if (value == null || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

// ---- Incident report lifecycle (reporter loop-closure) ----------------------

export function incidentUnderReview({ incidentTypeLabel }) {
  const type = incidentTypeLabel || "Incident";
  return {
    title: "Incident Report Under Review",
    message: `We received your ${type} report. You'll receive an update when the fleet team acknowledges your report.`,
    pushBody: `Your ${type} report was received. The fleet team is on it.`,
  };
}

export function incidentAcknowledged({ note }) {
  const noteText = note ? ` Note: ${note}` : "";
  return {
    title: "Incident Report Acknowledged",
    message: `The fleet team has acknowledged your report.${noteText} You'll receive an update when help is arranged.`,
    pushBody: `Your report was acknowledged.`,
  };
}

export function incidentResolvedByStaff({ actions }) {
  const actionsText = actions ? ` Actions taken: ${actions}.` : "";
  return {
    title: "Incident Report Resolved",
    message: `The fleet team resolved your report.${actionsText} Tap to review, then confirm or dispute.`,
    pushBody: `Your report was resolved. Confirm or dispute.`,
  };
}

export function incidentResolvedByResponder({ responderName, note }) {
  const name = responderName || "The responder";
  const noteText = note ? ` Note: ${note}` : "";
  return {
    title: "Incident Report Resolved",
    message: `${name} marked your report as resolved.${noteText} Please confirm you're safe — or dispute it if you still need help.`,
    pushBody: `${name} resolved your report. Confirm or dispute.`,
  };
}

export function vehicleRepaired({ plate }) {
  const from = plate ? `Vehicle ${plate} from` : "The vehicle from";
  return {
    title: "Vehicle Repair Completed",
    message: `${from} your report has been repaired and is back in service.`,
    pushBody: `${plate || "Your vehicle"} is repaired and back in service.`,
  };
}

// ---- Help on the way (manual response + responder auto-tracking) -----------

/**
 * Manual response updates from POST /api/incidents/[id]/response —
 * `responseLabel` is what the fleet team dispatched ("Tow Truck", "Fleet
 * Vehicle"); `status` is the response_status ("Dispatched" | "En Route" |
 * "Arrived").
 */
export function helpResponding({ responseLabel, status, etaMinutes }) {
  const label = responseLabel || "Help";
  if (status === "Arrived") {
    return {
      title: "Help Update",
      message: `${label} has arrived. Your report stays open until it is resolved.`,
      pushBody: `${label} has arrived.`,
    };
  }
  return {
    title: "Help Update",
    message: `${label} is on the way to your location${minutesOut(etaMinutes)}. Keep your phone nearby.`,
    pushBody: `${label} is en route${minutesShort(etaMinutes)}.`,
  };
}

export function helpEnRoute({ responderName, etaMinutes }) {
  const name = responderName || "Help";
  return {
    title: "Help Update",
    message: `${name} is on the way to your location${minutesOut(etaMinutes)}. Keep your phone nearby.`,
    pushBody: `${name} is en route${minutesShort(etaMinutes)}.`,
  };
}

export function helpArrived({ responderName }) {
  const name = responderName || "Help";
  return {
    title: "Help Update",
    message: `${name} has arrived. Your report stays open until it is resolved.`,
    pushBody: `${name} has arrived.`,
  };
}

export function helpNewEta({ responderName, etaMinutes }) {
  const name = responderName || "Help";
  const minutes = minutesOut(etaMinutes) ? ` about ${Math.round(+etaMinutes)} minutes` : " a little longer than first estimated";
  return {
    title: "Help Update — New ETA",
    message: `${name} is now${minutes} away. Keep your phone nearby.`,
    pushBody: `New ETA:${minutesShort(etaMinutes) || " updated"}.`,
  };
}

// ---- Responder assignment (both audiences are drivers) ----------------------

export function responderAssignedResponder({ driverName, location, etaMinutes }) {
  const name = driverName || "the driver";
  const where = location ? ` at ${location}` : "";
  return {
    title: "You Are the Responder",
    message: `You're responding to ${name}'s incident${where}${minutesOut(etaMinutes)}. Open the incident for their live location and navigation.`,
    pushBody: `You're the responder for ${name}'s incident. Open for location.`,
  };
}

export function responderAssignedReporter({ responderName, etaMinutes }) {
  const name = responderName || "A fleet responder";
  return {
    title: "Help Update",
    message: `${name} has been dispatched to your location${minutesOut(etaMinutes)}. Status and ETA update automatically as they drive.`,
    pushBody: `${name} is dispatched to you${minutesShort(etaMinutes)}.`,
  };
}

// ---- Compliance (license expiry suspension / reinstatement) -----------------
// Two audiences, two copies: the owner gets driver-appropriate wording; ops
// staff keep the operational copy (moved here verbatim, previously inline).

export function driverAutoSuspendedDriver({ expiry }) {
  return {
    title: "Driver Account Suspended",
    message: `Your license expired on ${dateWords(expiry) || "an unknown date"}, so your driver account is suspended. Renew your license and contact the fleet team to restore your access.`,
    pushBody: `Your driver account is suspended — license expired.`,
  };
}

export function driverAutoSuspendedStaff({ name, expiry }) {
  return {
    title: "Driver Auto-Suspended",
    message: `${name || "A driver"} was automatically suspended — license expired on ${dateWords(expiry) || "an unknown date"}. Reinstate from their profile after renewal.`,
    pushBody: `${name || "Driver"} suspended — license expired ${dateWords(expiry) || "unknown date"}.`,
  };
}

export function driverReinstatedDriver() {
  return {
    title: "Driver Account Active Again",
    message: `Your license renewal was processed. Your driver account is active again.`,
    pushBody: `Your driver account is active again.`,
  };
}

export function driverReinstatedStaff({ name }) {
  const who = name || "The driver";
  return {
    title: "Driver Reinstated",
    message: `${who}'s license was renewed — compliance suspension lifted and driver is Available again.`,
    pushBody: `${who === "The driver" ? "Driver" : name}'s license renewal lifted the suspension — driver is Available.`,
  };
}
