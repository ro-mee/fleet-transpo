import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn(), buildQuery: (params) => `?${new URLSearchParams(params).toString()}` }));
import { apiFetch } from "@/lib/api/client";
import {
  cargoSourceHref,
  clearCargoDeparture,
  getCargoEvidence,
  getCargoExecution,
  getCargoHandovers,
  recordManualCargoDecision,
  resolveCargoSourceHref,
  retryCargoFeedback,
} from "./cargo-execution.client";

const evidenceId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => apiFetch.mockReset());

it("requests private handovers explicitly, bypasses cache and forwards cancellation", async () => {
  const handovers = { pickup: null, delivery: null };
  apiFetch.mockResolvedValue({ data: { trip_id: 7, handovers } });
  const signal = new AbortController().signal;
  await expect(getCargoHandovers(7, { signal })).resolves.toEqual(handovers);
  expect(apiFetch).toHaveBeenCalledWith("/api/trips/7/cargo?include_handovers=1", { signal, cache: "no-store" });
});

it("refuses a private projection for another trip or without explicit handovers", async () => {
  apiFetch.mockResolvedValue({ data: { trip_id: 8, handovers: { pickup: null, delivery: null } } });
  await expect(getCargoHandovers(7)).rejects.toThrow("unavailable");
  apiFetch.mockResolvedValue({ data: { trip_id: 7 } });
  await expect(getCargoHandovers(7)).rejects.toThrow("unavailable");
});

it("reads the bounded trip execution without putting private detail URLs in a cached query", async () => {
  apiFetch.mockResolvedValue({ data: { trip_id: 7, version: 3 } });

  await expect(getCargoExecution(7)).resolves.toEqual({ trip_id: 7, version: 3 });
  expect(apiFetch).toHaveBeenCalledWith("/api/trips/7/cargo?history_limit=20&history_offset=0");
});

it("requests a private photo only on explicit detail selection", async () => {
  apiFetch.mockResolvedValue({ data: { evidence: [{ evidence_id: evidenceId, url: "https://private.test/photo", expires_in: 300 }] } });

  await expect(getCargoEvidence(7, evidenceId)).resolves.toMatchObject({ evidence_id: evidenceId, expires_in: 300 });
  expect(apiFetch).toHaveBeenCalledWith(`/api/trips/7/cargo?evidence_id=${evidenceId}`);
});

it("wraps only the approved cargo commands and distinct integration retry", async () => {
  apiFetch.mockResolvedValue({ data: { accepted: true } });
  await clearCargoDeparture(7, { receipt_id: evidenceId, expected_version: 1, reason: "Load secured" });
  await recordManualCargoDecision(7, { event_id: evidenceId });
  await retryCargoFeedback({ tripId: 7, sourceSystem: "POS", organizationId: "restaurant-1", eventId: evidenceId });

  expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/trips/7/cargo/clearance", expect.objectContaining({ method: "POST" }));
  expect(apiFetch).toHaveBeenNthCalledWith(2, "/api/trips/7/cargo/manual-decision", expect.objectContaining({ method: "POST" }));
  expect(apiFetch).toHaveBeenNthCalledWith(3, "/api/integration/cargo/feedback", expect.objectContaining({
    method: "POST",
    body: { trip_id: 7, source_system: "POS", organization_id: "restaurant-1", event_id: evidenceId },
  }));
});

it("builds only local REQUEST and SUPPLY destinations", () => {
  const requestManifest = { manifest_ref: { kind: "REQUEST" }, source_ref: { external_request_id: "ignored-external-id" } };
  const supplyManifest = { manifest_ref: { kind: "SUPPLY" }, source_ref: { external_request_id: "also-ignored" } };

  expect(resolveCargoSourceHref(requestManifest, null, 42)).toBe("/reservations/42");
  expect(resolveCargoSourceHref(supplyManifest, { kind: "SUPPLY", local_id: evidenceId }, 42)).toBe(`/supply-deliveries?shipmentId=${evidenceId}`);
  expect(cargoSourceHref("SUPPLY", "https://unsafe.example/path")).toBeNull();
  expect(resolveCargoSourceHref(supplyManifest, null, 42)).toBeNull();
});
