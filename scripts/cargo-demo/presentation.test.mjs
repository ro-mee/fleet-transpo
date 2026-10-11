import { describe, expect, it } from "vitest";
import * as demo from "./fixtures.mjs";

describe("cargo demo presentation", () => {
  it("shows a shortage waiting on the source, then a clean recount under the same manifest", () => {
    const waiting = demo.getCargoDemoPresentation?.("wait-and-recount", 0);
    const recounted = demo.getCargoDemoPresentation?.("wait-and-recount", 1);

    expect(waiting).toMatchObject({
      scenarioId: "wait-and-recount",
      workflow: "cargo",
      serviceLabel: "Hotel · supply transfer",
      statusLabel: "Waiting for source decision",
      quantities: { expected: "10", pickedUp: "9", delivered: null, orderShortage: "1", unit: "box" },
      summary: "The driver records the 1-box shortage and waits. This sample is not cleared for departure.",
      simulated: true,
      readOnly: true,
    });
    expect(recounted).toMatchObject({
      statusLabel: "Clean recount recorded",
      quantities: { expected: "10", pickedUp: "10", delivered: null, orderShortage: "0", unit: "box" },
      summary: "The recount finds all 10 boxes. It uses a new receipt for the same trip and manifest.",
      simulated: true,
      readOnly: true,
    });
    expect(recounted.identity.manifestRef).toEqual(waiting.identity.manifestRef);
    expect(recounted.identity.executionId).toBe(waiting.identity.executionId);
    expect(recounted.identity.receiptId).not.toBe(waiting.identity.receiptId);
  });

  it("keeps restaurant and hotel cases on one cargo workflow and separates Guest/VIP transport", () => {
    const scenarios = demo.listCargoDemoScenarios?.();

    expect(scenarios?.filter(item => item.workflow === "cargo").map(item => item.workflowKey)).toEqual([
      "shared-cargo",
      "shared-cargo",
      "shared-cargo",
      "shared-cargo",
      "shared-cargo",
      "shared-cargo",
    ]);
    expect(scenarios?.find(item => item.id === "guest-transport")).toMatchObject({
      workflow: "passenger",
      workflowKey: "passenger",
      simulated: true,
    });
  });

  it("shows order shortage separately from delivery shortage after an accepted count", () => {
    const accepted = demo.getCargoDemoPresentation?.("accepted-shortage");

    expect(accepted).toMatchObject({
      statusLabel: "1-box order shortage",
      quantities: { expected: "10", pickedUp: "9", delivered: "9", orderShortage: "1", deliveryShortage: "0", unit: "box" },
      simulated: true,
      readOnly: true,
    });
  });

  it("returns no presentation for an unknown sample case", () => {
    expect(demo.getCargoDemoPresentation?.("live-trip-123")).toBeNull();
  });
});
