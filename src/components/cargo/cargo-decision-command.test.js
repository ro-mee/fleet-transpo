import { expect, it, vi } from "vitest";
import { createCargoDecisionCommandManager } from "./cargo-decision-command";

const eventIds = [
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

it.each([
  ["a lost network response", () => new TypeError("Failed to fetch")],
  ["an HTTP 503 response", () => Object.assign(new Error("Service unavailable"), { status: 503 })],
])("reuses the exact immutable decision command after %s", async (_label, makeUncertainError) => {
  let nextId = 0;
  const createId = vi.fn(() => eventIds[nextId++]);
  const send = vi.fn()
    .mockRejectedValueOnce(makeUncertainError())
    .mockResolvedValueOnce({ saved: true })
    .mockResolvedValueOnce({ saved: true });
  const manager = createCargoDecisionCommandManager({ send, createId });
  const originalPayload = {
    receipt_id: "11111111-1111-4111-8111-111111111111",
    manifest_hash: "a".repeat(64),
    action: "ACCEPT_OBSERVED",
    reason: "Source confirmed nine boxes",
    approver_identity: "Restaurant manager",
    approver_reference: "Call reference 42",
    communicated_at: "2026-10-11T08:30:00.000Z",
    communication_evidence_ids: ["44444444-4444-4444-8444-444444444444"],
  };
  const createFirstPayload = vi.fn((eventId) => ({ event_id: eventId, ...originalPayload }));

  const first = await manager.submit({ tripId: 42, createPayload: createFirstPayload });

  expect(first.status).toBe("uncertain");
  expect(manager.hasPending(42)).toBe(true);
  expect(createId).toHaveBeenCalledTimes(1);

  const createChangedPayload = vi.fn((eventId) => ({
    event_id: eventId,
    ...originalPayload,
    reason: "Changed after the uncertain response",
  }));
  const retried = await manager.submit({ tripId: 42, createPayload: createChangedPayload });

  const expectedPayload = { event_id: eventIds[0], ...originalPayload };
  expect(retried.status).toBe("accepted");
  expect(send).toHaveBeenNthCalledWith(1, 42, expectedPayload);
  expect(send).toHaveBeenNthCalledWith(2, 42, expectedPayload);
  expect(send.mock.calls[1][1]).toBe(send.mock.calls[0][1]);
  expect(Object.isFrozen(send.mock.calls[0][1].communication_evidence_ids)).toBe(true);
  expect(createFirstPayload).toHaveBeenCalledTimes(1);
  expect(createChangedPayload).not.toHaveBeenCalled();
  expect(createId).toHaveBeenCalledTimes(1);
  expect(manager.hasPending(42)).toBe(false);

  const next = await manager.submit({
    tripId: 42,
    createPayload: (eventId) => ({ ...originalPayload, event_id: eventId, reason: "A new review command" }),
  });

  expect(next.status).toBe("accepted");
  expect(send).toHaveBeenNthCalledWith(3, 42, {
    ...originalPayload,
    event_id: eventIds[1],
    reason: "A new review command",
  });
  expect(createId).toHaveBeenCalledTimes(2);
});

it("allows a new command after a definite conflict response", async () => {
  let nextId = 0;
  const send = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error("The pickup changed."), { status: 409 }))
    .mockResolvedValueOnce({ saved: true });
  const manager = createCargoDecisionCommandManager({
    send,
    createId: () => eventIds[nextId++],
  });
  const makePayload = (eventId, reason) => ({ event_id: eventId, receipt_id: "pickup", reason });

  const rejected = await manager.submit({
    tripId: 42,
    createPayload: (eventId) => makePayload(eventId, "First decision"),
  });
  const resubmitted = await manager.submit({
    tripId: 42,
    createPayload: (eventId) => makePayload(eventId, "Updated after refresh"),
  });

  expect(rejected.status).toBe("rejected");
  expect(resubmitted.status).toBe("accepted");
  expect(send).toHaveBeenNthCalledWith(1, 42, { event_id: eventIds[0], receipt_id: "pickup", reason: "First decision" });
  expect(send).toHaveBeenNthCalledWith(2, 42, { event_id: eventIds[1], receipt_id: "pickup", reason: "Updated after refresh" });
  expect(nextId).toBe(2);
});
