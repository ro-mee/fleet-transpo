import { expect, it, vi } from "vitest";
const query = vi.fn(async () => ({ rows: [{ log_id: 17 }] }));
const acknowledgeStatus = vi.fn(async () => ({ delivered: true }));
vi.mock("@/lib/db", () => ({ query: (...args) => query(...args) }));
vi.mock("@/lib/integration/booking-gateway", () => ({ getBookingGateway: () => ({ name: "mock", acknowledgeStatus }) }));
import { emitTransportStatus } from "./outbound.service";
import { TransportStatusEventSchema } from "@/lib/integration/contracts";

it("correlates outbound status with the original source and request ID", async () => {
  await emitTransportStatus({ request_id: 3, source_system: "POS", external_request_id: "123", external_booking_id: "123", fleet_status: "Scheduled" });
  expect(acknowledgeStatus).toHaveBeenCalledWith(expect.objectContaining({ source_system: "POS", external_request_id: "123", external_booking_id: "123", event_id: expect.any(String) }));
});

it("does not reject archived outbound source identifiers", async () => {
  await emitTransportStatus({ request_id: 4, source_system: "legacy-provider", external_booking_id: "old-1", fleet_status: "Scheduled" });
  expect(() => TransportStatusEventSchema.parse(acknowledgeStatus.mock.lastCall[0])).not.toThrow();
});
