import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ apiFetch: fetchMock }));

import { cargoApi } from "./cargo-api";

beforeEach(() => fetchMock.mockReset());

describe("typed cargo API", () => {
  it("uses the reviewed endpoints and never lets cargo writes enter the generic outbox", async () => {
    fetchMock.mockResolvedValueOnce({ data: { manifest: { manifest_ref: { hash: "h1" } } } })
      .mockResolvedValueOnce({ data: { execution_id: "e1", evidence_upload: { evidence_id: "ev-1" } } })
      .mockResolvedValueOnce({ data: { pickup_state: "AWAITING_DECISION" } });
    const form = new FormData();
    await cargoApi.getExecution("trip/7", "employee-7");
    const upload = await cargoApi.uploadEvidence("7", form, "employee-7");
    await cargoApi.submitReceipt("7", { submission_id: "receipt-id" }, "employee-7");
    expect(upload.data.evidence_upload.evidence_id).toBe("ev-1");
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/trips/trip%2F7/cargo", "/api/trips/7/cargo/evidence", "/api/trips/7/cargo/receipts",
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.cargoActorId).toBe("employee-7");
      expect(options.queueOnFailure).toBe(false);
    }
  });
});
