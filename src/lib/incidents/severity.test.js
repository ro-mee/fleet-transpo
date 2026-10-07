import { describe, expect, it } from "vitest";
import {
  recommendIncidentSeverity,
  validateIncidentSeverityAssessment,
} from "../../../shared/incidents/severity.js";

const baseAnswers = {
  immediateDanger: "no",
  vehicleSafety: "safe",
  tripImpact: "none",
  hazardToOthers: "no",
};

function validateGuided({ answers = baseAnswers, severity = "Minor", ...overrides } = {}) {
  return validateIncidentSeverityAssessment({
    severity,
    assessment: {
      version: 1,
      answers,
      override_reason_code: null,
      critical_confirmed: false,
      lower_severity_confirmed: false,
      ...overrides,
    },
  });
}

describe("recommendIncidentSeverity", () => {
  it.each([
    ["no current risk or impact", baseAnswers, "Minor", "no_safety_or_trip_impact"],
    ["a delayed trip", { ...baseAnswers, tripImpact: "delayed" }, "Moderate", "trip_delayed"],
    ["a stopped trip", { ...baseAnswers, tripImpact: "stopped" }, "Moderate", "trip_stopped"],
    ["a vehicle that cannot move safely", { ...baseAnswers, vehicleSafety: "unsafe" }, "Major", "vehicle_cannot_move_safely"],
    ["uncertain vehicle safety", { ...baseAnswers, vehicleSafety: "unsure" }, "Major", "vehicle_safety_uncertain"],
    ["an uncertain danger answer", { ...baseAnswers, immediateDanger: "unsure" }, "Major", "immediate_danger_uncertain"],
    ["a hazard to others", { ...baseAnswers, hazardToOthers: "yes" }, "Major", "road_hazard"],
    ["an unsure hazard answer", { ...baseAnswers, hazardToOthers: "unsure" }, "Major", "road_hazard_uncertain"],
    ["affirmative immediate danger", { ...baseAnswers, immediateDanger: "yes" }, "Critical", "immediate_danger"],
  ])("classifies %s", (_case, answers, severity, reasonCode) => {
    expect(recommendIncidentSeverity(answers)).toEqual({ severity, reasonCode });
  });

  it("requires all four known answer fields", () => {
    expect(recommendIncidentSeverity({ ...baseAnswers, tripImpact: undefined })).toBeNull();
    expect(recommendIncidentSeverity({ ...baseAnswers, injury: "yes" })).toBeNull();
  });

  it("does not classify from category, assistance, or incident description", () => {
    expect(recommendIncidentSeverity(baseAnswers)).toEqual({
      severity: "Minor",
      reasonCode: "no_safety_or_trip_impact",
    });
  });
});

describe("validateIncidentSeverityAssessment", () => {
  it("keeps old severity-only submissions on the compatibility path", () => {
    expect(
      validateIncidentSeverityAssessment({ severity: "Critical" })
    ).toEqual({ ok: true, value: null });
  });

  it("recomputes and stores the recommendation on the server", () => {
    const result = validateGuided({ answers: { ...baseAnswers, tripImpact: "delayed" }, severity: "Moderate" });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({
      recommendedSeverity: "Moderate",
      finalSeverity: "Moderate",
      source: "guided",
      reasonCode: "trip_delayed",
    });
  });

  it("requires a reason for a driver override", () => {
    expect(validateGuided({ severity: "Major" }).ok).toBe(false);
    const result = validateGuided({
      severity: "Major",
      override_reason_code: "driver_judgment",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { source: "override", overrideReasonCode: "driver_judgment" },
    });
  });

  it("requires confirmation before a guided Critical submission", () => {
    const answers = { ...baseAnswers, immediateDanger: "yes" };
    expect(validateGuided({ answers, severity: "Critical" })).toMatchObject({ ok: false });
    expect(
      validateGuided({ answers, severity: "Critical", critical_confirmed: true })
    ).toMatchObject({ ok: true, value: { finalSeverity: "Critical", criticalConfirmed: true } });
  });

  it("rejects Critical confirmation when the selected level is not Critical", () => {
    expect(
      validateGuided({ severity: "Minor", critical_confirmed: true })
    ).toMatchObject({ ok: false });
  });

  it("requires a recheck when overriding a Critical recommendation downward", () => {
    const answers = { ...baseAnswers, immediateDanger: "yes" };
    expect(
      validateGuided({
        answers,
        severity: "Major",
        override_reason_code: "answers_missed_context",
      })
    ).toMatchObject({ ok: false });
    expect(
      validateGuided({
        answers,
        severity: "Major",
        override_reason_code: "answers_missed_context",
        lower_severity_confirmed: true,
      })
    ).toMatchObject({ ok: true, value: { lowerSeverityConfirmed: true } });
  });

  it("keeps SOS direct and Critical without guided answers", () => {
    expect(
      validateIncidentSeverityAssessment({ severity: "Critical", severitySource: "sos" })
    ).toMatchObject({ ok: true, value: { source: "sos", finalSeverity: "Critical" } });
    expect(
      validateIncidentSeverityAssessment({ severity: "Major", severitySource: "sos" })
    ).toMatchObject({ ok: false });
  });
});
