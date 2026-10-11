import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  cargoReviewReducer,
  CargoVerificationPanelContent,
  initialCargoReviewState,
} from "./cargo-verification-panel";

const pickupId = "11111111-1111-4111-8111-111111111111";
const manifest = {
  manifest_ref: { kind: "REQUEST", id: pickupId, revision: 1, hash: "a".repeat(64) },
  source_ref: { system: "POS", organization_id: "restaurant-1", external_request_id: "source-only" },
  service_code: "RESTAURANT_SUPPLY_PICKUP",
  lines: [{ line_id: "oil", name: "Cooking oil", quantity_basis: "TRANSPORT_PACKAGE", expected_quantity: "10", unit: "box" }],
};

function view(capabilities = {}) {
  return {
    trip_id: 42,
    version: 3,
    manifest,
    pickup_receipt: { receipt_id: pickupId, payload: { lines: [{ line_id: "oil", observed_quantity: "9", evidence_ids: [] }] } },
    delivery_receipt: { payload: { lines: [{ line_id: "oil", observed_quantity: "9" }] } },
    source_decision: null,
    fleet_clearance: null,
    feedback: { state: "ACKNOWLEDGED" },
    capabilities,
    history: { rows: [] },
  };
}

it("renders an honest unavailable state when the server has no cargo configuration", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoVerificationPanelContent, {
    tripId: 42,
    error: { status: 503, code: "CARGO_CONFIGURATION_REQUIRED" },
  }));

  expect(markup).toContain("Cargo review unavailable");
  expect(markup).toContain("source or approval configuration is not enabled");
  expect(markup).not.toContain("Quantity comparison");
  expect(markup).not.toContain("Save source decision");
});

it("does not show decision controls unless the server returned those capabilities", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoVerificationPanelContent, {
    tripId: 42,
    view: view({ read: true, clearance: false, manual_decision: false, feedback_retry: false }),
  }));

  expect(markup).toContain("read-only for the current server-approved capabilities");
  expect(markup).not.toContain("Save source decision");
  expect(markup).not.toContain("Record Fleet clearance");
  expect(markup).toContain("partner received the message");
  expect(markup).not.toContain("Approval recorded");
});

it("keeps reviewer input and error visible, and disables stale resubmission after rejection", () => {
  const draft = {
    ...initialCargoReviewState,
    decisionDraft: {
      ...initialCargoReviewState.decisionDraft,
      reason: "Source accepted nine boxes",
      approver_identity: "Restaurant manager",
    },
  };
  const rejected = cargoReviewReducer(draft, { type: "action-rejected", message: "The pickup changed.", refreshRequired: true });
  const state = cargoReviewReducer(rejected, { type: "refresh-failed", message: "Current state could not be loaded." });
  const markup = renderToStaticMarkup(React.createElement(CargoVerificationPanelContent, {
    tripId: 42,
    view: view({ read: true, manual_decision: true }),
    reviewerState: state,
  }));

  expect(markup).toContain("The pickup changed.");
  expect(markup).toContain("Source accepted nine boxes");
  expect(markup).toContain("Restaurant manager");
  expect(markup).toContain("Current state could not be loaded.");
  expect(markup).toContain("Load the current server record before submitting again");
  expect(markup).toContain("Save source decision</button>");
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Save source decision/);
});

it("locks decision details and offers a same-command retry after an uncertain response", () => {
  const state = {
    ...initialCargoReviewState,
    decisionDraft: {
      ...initialCargoReviewState.decisionDraft,
      reason: "Source accepted nine boxes",
      approver_identity: "Restaurant manager",
      approver_reference: "Call reference 42",
      communicated_at: "2026-10-11T08:30",
      communication_evidence_ids: "evidence-1",
    },
  };
  const markup = renderToStaticMarkup(React.createElement(CargoVerificationPanelContent, {
    tripId: 42,
    view: view({ read: true, manual_decision: true }),
    reviewerState: state,
    decisionRetryPending: true,
  }));

  expect(markup).toContain("The original details are locked until the result is confirmed.");
  expect(markup).toContain("same command ID and payload");
  expect(markup).toContain("Retry same decision");
  expect(markup).toMatch(/<select[^>]*disabled=""/);
  expect(markup).toMatch(/<textarea[^>]*disabled=""/);
  expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Retry same decision/);
});
