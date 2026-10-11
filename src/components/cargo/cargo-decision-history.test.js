import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CargoDecisionHistory } from "./cargo-decision-history";

it("keeps source decision, Fleet clearance, and receiver confirmation as separate records", () => {
  const markup = renderToStaticMarkup(React.createElement(CargoDecisionHistory, { view: {
    source_decision: { action: "ACCEPT_OBSERVED" },
    fleet_clearance: { securement_confirmed: true },
    delivery_receipt: { receiver_confirmed: true },
    history: { rows: [{ event_id: "event-1", event_type: "PICKUP_RECORDED", occurred_at: "2026-10-10T00:00:00Z" }] },
  } }));

  expect(markup).toContain("Source decision");
  expect(markup).toContain("Fleet clearance");
  expect(markup).toContain("Receiver confirmation");
  expect(markup).toContain("Activity timeline");
  expect(markup).toContain("Source accepted the observed pickup count");
  expect(markup).toContain("Clearance and load securement confirmed");
  expect(markup).toContain("Confirmed");
});
