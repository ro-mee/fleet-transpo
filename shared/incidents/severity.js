export const INCIDENT_SEVERITY_RULE_VERSION = 1;

export const INCIDENT_SEVERITIES = ["Minor", "Moderate", "Major", "Critical"];

export const INCIDENT_SEVERITY_ANSWERS = {
  immediateDanger: ["yes", "no", "unsure"],
  vehicleSafety: ["safe", "unsafe", "unsure", "not_applicable"],
  tripImpact: ["none", "delayed", "stopped"],
  hazardToOthers: ["yes", "no", "unsure", "not_applicable"],
};

export const INCIDENT_OVERRIDE_REASONS = [
  "situation_changed",
  "answers_missed_context",
  "driver_judgment",
];

export const INCIDENT_SEVERITY_REASON_LABELS = {
  immediate_danger: "You reported someone is in immediate danger.",
  immediate_danger_uncertain: "Immediate danger is unclear, so this is treated as urgent.",
  vehicle_cannot_move_safely: "The vehicle cannot safely continue.",
  vehicle_safety_uncertain: "Vehicle safety is unclear, so stop and request urgent review.",
  road_hazard: "You reported a hazard to people or traffic.",
  road_hazard_uncertain: "A hazard to people or traffic is unclear.",
  trip_stopped: "The incident has stopped the trip.",
  trip_delayed: "The incident is delaying the trip.",
  no_safety_or_trip_impact: "Your answers report no current danger or trip disruption.",
  direct_sos: "You sent a direct SOS emergency report.",
};

const isOneOf = (value, options) => options.includes(value);
const hasExactAnswerKeys = (answers) =>
  answers &&
  typeof answers === "object" &&
  !Array.isArray(answers) &&
  Object.keys(INCIDENT_SEVERITY_ANSWERS).every((key) =>
    Object.prototype.hasOwnProperty.call(answers, key)
  ) &&
  Object.keys(answers).every((key) =>
    Object.prototype.hasOwnProperty.call(INCIDENT_SEVERITY_ANSWERS, key)
  );

export function isValidIncidentSeverityAnswers(answers) {
  return (
    hasExactAnswerKeys(answers) &&
    Object.entries(INCIDENT_SEVERITY_ANSWERS).every(([key, values]) =>
      isOneOf(answers[key], values)
    )
  );
}

/**
 * Classifies only explicit, coded answers. Category, assistance, and narrative
 * text are deliberately excluded so keywords cannot create a false alarm.
 */
export function recommendIncidentSeverity(answers) {
  if (!isValidIncidentSeverityAnswers(answers)) return null;

  if (answers.immediateDanger === "yes") {
    return { severity: "Critical", reasonCode: "immediate_danger" };
  }

  if (answers.immediateDanger === "unsure") {
    return { severity: "Major", reasonCode: "immediate_danger_uncertain" };
  }

  if (answers.vehicleSafety === "unsafe") {
    return { severity: "Major", reasonCode: "vehicle_cannot_move_safely" };
  }

  if (answers.vehicleSafety === "unsure") {
    return { severity: "Major", reasonCode: "vehicle_safety_uncertain" };
  }

  if (answers.hazardToOthers === "yes") {
    return { severity: "Major", reasonCode: "road_hazard" };
  }

  if (answers.hazardToOthers === "unsure") {
    return { severity: "Major", reasonCode: "road_hazard_uncertain" };
  }

  if (answers.tripImpact === "stopped") {
    return { severity: "Moderate", reasonCode: "trip_stopped" };
  }

  if (answers.tripImpact === "delayed") {
    return { severity: "Moderate", reasonCode: "trip_delayed" };
  }

  return { severity: "Minor", reasonCode: "no_safety_or_trip_impact" };
}

/**
 * Validates a guided report on the server and builds the persisted audit
 * record. Reports from old app versions remain valid when no assessment is
 * supplied. SOS is explicitly tagged by its existing direct action.
 */
export function validateIncidentSeverityAssessment({
  severity,
  assessment,
  severitySource,
}) {
  if (!INCIDENT_SEVERITIES.includes(severity)) {
    return { ok: false, error: "Choose a valid severity level" };
  }

  if (severitySource === "sos") {
    if (assessment != null || severity !== "Critical") {
      return { ok: false, error: "SOS reports must be direct Critical reports" };
    }
    return {
      ok: true,
      value: {
        version: INCIDENT_SEVERITY_RULE_VERSION,
        answers: null,
        recommendedSeverity: "Critical",
        finalSeverity: "Critical",
        source: "sos",
        reasonCode: "direct_sos",
        overrideReasonCode: null,
        criticalConfirmed: true,
        lowerSeverityConfirmed: false,
      },
    };
  }

  if (severitySource != null) {
    return { ok: false, error: "Severity source is invalid" };
  }

  if (assessment == null) return { ok: true, value: null };

  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) {
    return { ok: false, error: "Severity assessment is invalid" };
  }

  const allowedKeys = new Set([
    "version",
    "answers",
    "override_reason_code",
    "critical_confirmed",
    "lower_severity_confirmed",
  ]);
  if (Object.keys(assessment).some((key) => !allowedKeys.has(key))) {
    return { ok: false, error: "Severity assessment contains unknown fields" };
  }
  if (
    assessment.version !== INCIDENT_SEVERITY_RULE_VERSION ||
    !isValidIncidentSeverityAnswers(assessment.answers) ||
    typeof assessment.critical_confirmed !== "boolean" ||
    typeof assessment.lower_severity_confirmed !== "boolean"
  ) {
    return { ok: false, error: "Answer all severity questions before submitting" };
  }

  const recommendation = recommendIncidentSeverity(assessment.answers);
  const isOverride = severity !== recommendation.severity;
  const overrideReasonCode = assessment.override_reason_code ?? null;
  if (
    (isOverride && !isOneOf(overrideReasonCode, INCIDENT_OVERRIDE_REASONS)) ||
    (!isOverride && overrideReasonCode !== null)
  ) {
    return { ok: false, error: "Choose why the recommended severity was changed" };
  }
  if (severity === "Critical" && !assessment.critical_confirmed) {
    return { ok: false, error: "Confirm the Critical report before submitting" };
  }
  if (severity !== "Critical" && assessment.critical_confirmed) {
    return { ok: false, error: "Critical confirmation does not match the selected severity" };
  }
  const lowerSeverityConfirmed =
    recommendation.severity === "Critical" && severity !== "Critical";
  if (assessment.lower_severity_confirmed !== lowerSeverityConfirmed) {
    return {
      ok: false,
      error: lowerSeverityConfirmed
        ? "Confirm that you rechecked the immediate danger answer"
        : "Severity confirmation does not match your answers",
    };
  }

  return {
    ok: true,
    value: {
      version: INCIDENT_SEVERITY_RULE_VERSION,
      answers: assessment.answers,
      recommendedSeverity: recommendation.severity,
      finalSeverity: severity,
      source: isOverride ? "override" : "guided",
      reasonCode: recommendation.reasonCode,
      overrideReasonCode,
      criticalConfirmed: assessment.critical_confirmed,
      lowerSeverityConfirmed,
    },
  };
}
