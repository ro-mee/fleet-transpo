import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ defaultTx: null }));
vi.mock("@/lib/db", () => ({ query: vi.fn(() => { throw new Error("Unexpected global query"); }), getAdminClient: vi.fn(() => { throw new Error("Unexpected Supabase client"); }), withTransaction: vi.fn(async (run) => run(h.defaultTx)) }));
import { syncVehicleStatus } from "./status.service";
import { withTransaction } from "@/lib/db";
function executor({ status = "Available", expiry = "2030-01-01", incident = false, maintenance = false, trip = false, fail = false } = {}) {
 return { query: vi.fn(async (sql) => {
  if (sql.includes("FROM vehicles")) return { rows: [{ vehicle_status: status, registration_expiry: expiry }] };
  if (sql.includes("FROM driverincidents")) return { rows: incident ? [{ incident_id: 1 }] : [] };
  if (sql.includes("FROM vehiclemaintenance")) return { rows: maintenance ? [{ maintenance_id: 1 }] : [] };
  if (sql.includes("FROM trips")) return { rows: trip ? [{ trip_id: 1 }] : [] };
  if (sql.includes("UPDATE vehicles")) { if (fail) throw new Error("status rejected"); return { rows: [] }; }
  throw new Error(sql);
 }) };
}
beforeEach(() => { vi.clearAllMocks(); h.defaultTx = executor(); });
describe("transaction-aware vehicle status", () => {
 it.each([
  [{ incident: true, maintenance: true, trip: true, expiry: "2000-01-01" }, "Under Maintenance"],
  [{ maintenance: true, trip: true }, "Under Maintenance"],
  [{ trip: true, expiry: "2000-01-01" }, "In Use"],
  [{ expiry: "2000-01-01" }, "Registration Expired"],
  [{}, "Available"],
 ])("preserves status precedence for %j", async (input, expected) => {
  const tx = executor(input); await syncVehicleStatus(7, tx);
  expect(tx.query.mock.calls.find(([sql]) => sql.includes("UPDATE vehicles"))[1]).toEqual([expected, 7]);
  expect(tx.query.mock.calls[0][0]).toContain("FOR UPDATE");
  expect(withTransaction).not.toHaveBeenCalled();
 });
 it("preserves decommissioned vehicles", async () => {
  const tx = executor({ status: "Decommissioned" }); await syncVehicleStatus(7, tx);
  expect(tx.query).toHaveBeenCalledTimes(1);
 });
 it("throws write failures instead of silently treating the vehicle as synchronized", async () => {
  await expect(syncVehicleStatus(7, executor({ fail: true }))).rejects.toThrow("status rejected");
 });
 it("opens a transaction for existing callers without an executor", async () => {
  await syncVehicleStatus(7); expect(withTransaction).toHaveBeenCalledTimes(1);
  expect(h.defaultTx.query.mock.calls.at(-1)[1]).toEqual(["Available", 7]);
 });
});
