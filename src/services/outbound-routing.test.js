import { beforeEach, expect, it, vi } from "vitest";
const query = vi.fn();
const pmsAck = vi.fn();
const posAck = vi.fn();
vi.mock("@/lib/db", () => ({ query: (...args) => query(...args) }));
vi.mock("@/lib/integration/booking-gateway", () => ({
  getBookingGateway: (source = "PMS") => {
    if (source === "PMS") return { name: "http", sourceIdentity: "PMS", acknowledgeStatus: pmsAck };
    if (source === "POS") return { name: "http", sourceIdentity: "POS", acknowledgeStatus: posAck };
    throw new Error("Unsupported outbound source");
  },
}));
import { emitTransportStatus, reconcileFailedDeliveries } from "./outbound.service";

const request = { request_id: 3, source_system: "POS", external_request_id: "123", external_booking_id: "123", fleet_status: "Scheduled" };
const event = { event_id: "fixed-event", source_system: "POS", external_request_id: "123", external_booking_id: "123", status: "SCHEDULED", occurred_at: "2026-10-07T00:00:00Z" };
beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue({ rows: [{ log_id: 17 }] });
  pmsAck.mockResolvedValue({ delivered: true });
  posAck.mockResolvedValue({ delivered: true });
});

it("sends a POS transition only to its POS adapter", async () => {
  const result = await emitTransportStatus(request);
  expect(result.delivered).toBe(true);
  expect(posAck).toHaveBeenCalledWith(expect.objectContaining({ source_system: "POS" }));
  expect(pmsAck).not.toHaveBeenCalled();
});

it.each([{ delivered: false }, {}, undefined])("keeps an unacknowledged emission retryable (%j)", async (ack) => {
  posAck.mockResolvedValue(ack);
  pmsAck.mockResolvedValue(ack);
  const result = await emitTransportStatus(request);
  expect(result.delivered).toBe(false);
  expect(query.mock.calls.some(([sql]) => sql.includes("status = 'processed'"))).toBe(false);
  expect(query.mock.calls.some(([sql]) => sql.includes("status = 'failed'"))).toBe(true);
});

it("does not send an event when its durable log insert fails", async () => {
  query.mockRejectedValueOnce(new Error("database unavailable"));
  expect((await emitTransportStatus(request)).delivered).toBe(false);
  expect(posAck).not.toHaveBeenCalled();
  expect(pmsAck).not.toHaveBeenCalled();
});

it("records unsupported source delivery as failed without falling back", async () => {
  const result = await emitTransportStatus({ ...request, source_system: "legacy-provider" });
  expect(result.delivered).toBe(false);
  expect(pmsAck).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => sql.includes("status = 'failed'"))).toBe(true);
});

it("retries the original event through the row's source adapter", async () => {
  query.mockResolvedValueOnce({ rows: [{ log_id: 17, source_system: "POS", payload: event }] });
  const result = await reconcileFailedDeliveries();
  expect(result.delivered).toBe(1);
  expect(posAck).toHaveBeenCalledWith(event);
  expect(pmsAck).not.toHaveBeenCalled();
});

it("does not process a retry without a positive ACK", async () => {
  query.mockResolvedValueOnce({ rows: [{ log_id: 17, source_system: "POS", payload: event }] });
  posAck.mockResolvedValue({ delivered: false });
  pmsAck.mockResolvedValue({ delivered: false });
  const result = await reconcileFailedDeliveries();
  expect(result.stillFailed).toBe(1);
  expect(query.mock.calls.some(([sql]) => sql.includes("status = 'processed'"))).toBe(false);
});

it("refuses a retry whose payload source differs from the durable log source", async () => {
  query.mockResolvedValueOnce({ rows: [{ log_id: 17, source_system: "POS", payload: { ...event, source_system: "PMS" } }] });
  expect((await reconcileFailedDeliveries()).stillFailed).toBe(1);
  expect(pmsAck).not.toHaveBeenCalled();
  expect(posAck).not.toHaveBeenCalled();
});

it.each([null, undefined, ""])('refuses a retry with no durable source identity (%j)', async (source) => {
  query.mockResolvedValueOnce({ rows: [{ log_id: 17, source_system: source, payload: event }] });
  expect((await reconcileFailedDeliveries()).stillFailed).toBe(1);
  expect(pmsAck).not.toHaveBeenCalled();
  expect(posAck).not.toHaveBeenCalled();
});

it("routes historical fleet/PMS log rows as PMS without changing their event", async () => {
  const historical = { ...event, source_system: "PMS" };
  query.mockResolvedValueOnce({ rows: [{ log_id: 17, source_system: "fleet", payload: historical }] });
  expect((await reconcileFailedDeliveries()).delivered).toBe(1);
  expect(pmsAck).toHaveBeenCalledWith(historical);
  expect(posAck).not.toHaveBeenCalled();
});

it("preserves pre-source-contract PMS v1 payload correlation on retry", async () => {
  const historical = { external_booking_id: "old-id", status: "COMPLETED", occurred_at: "2026-08-10T00:00:00Z" };
  query.mockResolvedValueOnce({ rows: [{ log_id: 17, source_system: "PMS", payload: historical }] });
  expect((await reconcileFailedDeliveries()).delivered).toBe(1);
  expect(pmsAck).toHaveBeenCalledWith({ ...historical, source_system: "PMS" });
});

it("does not send when insert returns no durable log ID", async () => {
  query.mockResolvedValueOnce({ rows: [] });
  expect((await emitTransportStatus(request)).reason).toBe("delivery-log-unavailable");
  expect(posAck).not.toHaveBeenCalled();
  expect(pmsAck).not.toHaveBeenCalled();
});

it("refuses a legacy retry with neither row nor payload source", async () => {
  const { source_system: _source, ...historical } = event;
  query.mockResolvedValueOnce({ rows: [{ log_id: 17, payload: historical }] });
  expect((await reconcileFailedDeliveries()).stillFailed).toBe(1);
  expect(pmsAck).not.toHaveBeenCalled();
  expect(posAck).not.toHaveBeenCalled();
});

it("logs before sending and preserves the generated event across a failed emission and retry", async () => {
  let persisted;
  query.mockImplementation(async (sql, params) => {
    if (sql.startsWith("INSERT")) {
      persisted = JSON.parse(params[4]);
      return { rows: [{ log_id: 17 }] };
    }
    if (sql.startsWith("SELECT")) return { rows: [{ log_id: 17, source_system: "POS", payload: persisted }] };
    return { rows: [] };
  });
  posAck.mockImplementationOnce(async (sent) => {
    expect(persisted).toEqual(sent);
    throw new Error("temporary outage");
  }).mockResolvedValueOnce({ delivered: true });
  expect((await emitTransportStatus(request, { occurredAt: "2026-10-07T00:00:00Z" })).delivered).toBe(false);
  const original = posAck.mock.calls[0][0];
  expect(original).toMatchObject({ status: "SCHEDULED", occurred_at: "2026-10-07T00:00:00Z", event_id: expect.any(String) });
  expect((await reconcileFailedDeliveries()).delivered).toBe(1);
  expect(posAck.mock.calls[1][0]).toEqual(original);
  expect(pmsAck).not.toHaveBeenCalled();
});

it("reconciles a mixed-source batch without crossing adapters", async () => {
  const pms = { ...event, event_id: "pms-event", source_system: "PMS" };
  query.mockResolvedValueOnce({ rows: [
    { log_id: 17, source_system: "POS", payload: event },
    { log_id: 18, source_system: "PMS", payload: pms },
  ] });
  expect((await reconcileFailedDeliveries()).delivered).toBe(2);
  expect(posAck.mock.calls).toEqual([[event]]);
  expect(pmsAck.mock.calls).toEqual([[pms]]);
});

it("stores the resolved PMS source when a legacy request lacks source_system", async () => {
  await emitTransportStatus({ request_id: 4, external_booking_id: "old-1", fleet_status: "Completed" });
  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain("INSERT INTO integration_log");
  expect(params[0]).toBe("PMS");
  expect(JSON.parse(params[4]).source_system).toBe("PMS");
});
