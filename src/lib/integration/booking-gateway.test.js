import { afterEach, expect, it, vi } from "vitest";
import { getBookingGateway, _resetBookingGateway } from "./booking-gateway";

afterEach(() => { vi.unstubAllEnvs(); _resetBookingGateway(); });

it("keeps a POS mock separate from a configured PMS HTTP adapter", () => {
  vi.stubEnv("BOOKING_GATEWAY", "http");
  vi.stubEnv("POS_GATEWAY", "mock");
  const pms = getBookingGateway("PMS");
  const pos = getBookingGateway("POS");
  expect(pms.sourceIdentity).toBe("PMS");
  expect(pos.sourceIdentity).toBe("POS");
  expect(pos.name).toBe("mock");
  expect(pos).not.toBe(pms);
});

it("refuses to route an unknown source to the PMS adapter", () => {
  expect(() => getBookingGateway("legacy-provider")).toThrow(/source/i);
});

it("rejects cross-source events even in a source-bound mock", async () => {
  vi.stubEnv("POS_GATEWAY", "mock");
  await expect(getBookingGateway("POS").acknowledgeStatus({
    source_system: "PMS", external_booking_id: "123", status: "SCHEDULED",
    occurred_at: "2026-10-07T00:00:00Z",
  })).rejects.toThrow(/source/i);
});

it("fails closed for an unsupported configured gateway mode", () => {
  vi.stubEnv("POS_GATEWAY", "htpt");
  expect(() => getBookingGateway("POS")).toThrow(/mode/i);
});

it("keeps HTTP source configuration separate without making a connection", () => {
  vi.stubEnv("BOOKING_GATEWAY", "http");
  vi.stubEnv("POS_GATEWAY", "http");
  vi.stubEnv("BOOKING_API_URL", "https://pms.example.invalid");
  vi.stubEnv("POS_API_URL", "https://pos.example.invalid");
  vi.stubEnv("BOOKING_API_KEY", "pms-fixture-token");
  vi.stubEnv("POS_API_KEY", "pos-fixture-token");
  expect(getBookingGateway("PMS")).toMatchObject({ baseUrl: "https://pms.example.invalid", apiKey: "pms-fixture-token" });
  expect(getBookingGateway("POS")).toMatchObject({ baseUrl: "https://pos.example.invalid", apiKey: "pos-fixture-token" });
});
