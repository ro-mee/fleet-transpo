import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn(async () => ({})) }));

import { apiFetch } from "@/lib/api/client";
import { createMaintenanceRecord, getVehicleHistory, updateMaintenanceRecord, getOpenFuelDiagnostics } from "./maintenance.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("maintenance.service body encoding", () => {
  it("reads open fuel diagnostics for visible vehicle ids", async () => {
    apiFetch.mockResolvedValueOnce([{ maintenance_id: 44, vehicle_id: 12 }]);
    expect(await getOpenFuelDiagnostics([12, 13])).toEqual([{ maintenance_id: 44, vehicle_id: 12 }]);
    expect(apiFetch).toHaveBeenCalledWith("/api/vehicle-maintenance/fuel-diagnostics?vehicle_ids=12%2C13");
    expect(await getOpenFuelDiagnostics([12])).toEqual([]);
  });
  it("passes objects to apiFetch — pre-stringifying double-encodes on the wire", async () => {
    // apiFetch stringifies once. A pre-stringified body arrives at the route
    // as a JSON string instead of an object: POST 400s on its required
    // fields and PUT reports "no writable fields".
    await createMaintenanceRecord({ vehicle_id: 1, maintenance_type: "Routine" });
    expect(apiFetch).toHaveBeenCalledWith("/api/vehicle-maintenance", {
      method: "POST",
      body: { vehicle_id: 1, maintenance_type: "Routine" },
    });
    expect(typeof apiFetch.mock.calls[0][1].body).not.toBe("string");

    await updateMaintenanceRecord(7, { status: "In Progress" });
    expect(apiFetch).toHaveBeenCalledWith("/api/vehicle-maintenance/7", {
      method: "PUT",
      body: { status: "In Progress" },
    });
    expect(typeof apiFetch.mock.calls[1][1].body).not.toBe("string");
  });

  it("keeps the assignment normalization on writes", async () => {
    await createMaintenanceRecord({ vehicle_id: 1, assigned_mechanic_id: "" });
    expect(apiFetch.mock.calls[0][1].body).not.toHaveProperty("assigned_mechanic_id");
  });

  it("reads vehicle history through the mechanic gate route", async () => {
    await getVehicleHistory(12);
    expect(apiFetch).toHaveBeenCalledWith("/api/mechanic/vehicle-history?vehicle_id=12");
  });
});
