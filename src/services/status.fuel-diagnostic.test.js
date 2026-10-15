import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ maintenance: [], status: "Available", incidents: [], trips: [] }));
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  getAdminClient: () => ({ from: (table) => {
    const result = { select() { return this; }, eq() { return this; }, in() { return this; }, is() { return this; }, limit() { return this; },
      update(values) { fixture.status = values.vehicle_status; return this; },
      maybeSingle: async () => ({ data: { vehicle_status: fixture.status, registration_expiry: "2030-01-01" } }),
      then(resolve) { return Promise.resolve({ data: table === "vehiclemaintenance" ? fixture.maintenance : table === "driverincidents" ? fixture.incidents : table === "trips" ? fixture.trips : [] }).then(resolve); },
    };
    return result;
  } }),
}));
import { buildFuelDiagnosticPayload } from "@/lib/fuel/diagnostic";
import { syncVehicleStatus } from "./status.service";
const input = { vehicleId: 12, plate: "ABC 1234", estimatedKmpl: 6.4, baselineKmpl: 8.5, variancePercent: -24.7, from: "2026-12-01", to: "2026-12-31", trips: 18, km: 1240, liters: 193 };
beforeEach(() => { vi.useFakeTimers(); fixture.status = "Available"; fixture.maintenance = []; fixture.incidents = []; fixture.trips = []; });
afterEach(() => vi.useRealTimers());

describe("fuel diagnostics and real vehicle-status synchronization", () => {
  it("stays available on filing day and becomes due at Manila midnight", async () => {
    vi.setSystemTime(new Date("2026-12-31T15:59:59Z"));
    const diagnostic = buildFuelDiagnosticPayload(input);
    expect(diagnostic.maintenance_date).toBe("2027-01-01");
    fixture.maintenance = [{ ...diagnostic, maintenance_id: 44 }];
    await syncVehicleStatus(12);
    expect(fixture.status).toBe("Available");
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    await syncVehicleStatus(12);
    expect(fixture.status).toBe("Under Maintenance");
  });
  it("does not ground tomorrow's diagnostic filed just after Manila midnight", async () => {
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    fixture.maintenance = [{ ...buildFuelDiagnosticPayload(input), maintenance_id: 44 }];
    expect(fixture.maintenance[0].maintenance_date).toBe("2027-01-02");
    await syncVehicleStatus(12);
    expect(fixture.status).toBe("Available");
  });
  it("preserves grounding from an unresolved major incident despite tomorrow's diagnostic", async () => {
    vi.setSystemTime(new Date("2026-12-31T15:59:59Z"));
    fixture.maintenance = [buildFuelDiagnosticPayload(input)];
    fixture.incidents = [{ incident_id: 99 }];
    await syncVehicleStatus(12);
    expect(fixture.status).toBe("Under Maintenance");
  });
});
