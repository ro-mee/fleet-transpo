import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ apiFetch: fetchMock }));

import { cargoApi } from "./cargo-api";

beforeEach(() => fetchMock.mockReset());

describe("typed cargo API", () => {
  it("requests private handovers explicitly with the current actor, no cache and cancellation", async () => {
    const view = { trip_id: 7, handovers: { pickup: null, delivery: null } };
    fetchMock.mockResolvedValueOnce({ data: view });
    const controller = new AbortController();
    expect(await cargoApi.getHandovers("7", "employee-7", controller.signal)).toEqual(view);
    expect(fetchMock).toHaveBeenCalledWith("/api/trips/7/cargo?include_handovers=1", {
      method: "GET", cache: "no-store", cargoActorId: "employee-7", queueOnFailure: false, signal: controller.signal,
    });
  });

  it.each([
    { trip_id: 8, handovers: { pickup: null, delivery: null } },
    { trip_id: 7 },
    { trip_id: 7, handovers: { pickup: null } },
  ])("refuses mismatched or incomplete private detail responses", async view => {
    fetchMock.mockResolvedValueOnce({ data: view });
    await expect(cargoApi.getHandovers("7", "employee-7")).rejects.toThrow("Saved signatures could not be verified");
  });

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
