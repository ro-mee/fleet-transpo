import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  requireDriver: vi.fn(async () => ({ user: { employeeId: 8, driverId: 4 } })),
  writeAudit: vi.fn(async () => ({ log_id: 1 })),
  signFuelReceipt: vi.fn(async (row) => row),
  getFuelPolicy: vi.fn(async () => ({ maxPricePerLiter: 120, strictFuelTypeMatching: false })),
  fuelTypeMismatch: vi.fn(() => false),
  computeFuelFlags: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => ({ query: mocks.query, withTransaction: mocks.withTransaction }));
vi.mock("@/lib/api/utils", async () => {
  const actual = await vi.importActual("@/lib/api/utils");
  return { ...actual, requireDriver: mocks.requireDriver };
});
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/services/fuel-settings.service", () => ({ getFuelPolicy: mocks.getFuelPolicy }));
vi.mock("@/lib/fuel/receipt-storage", () => ({
  isOwnedFuelReceiptUrl: vi.fn(() => true),
  toStoredReceiptRef: vi.fn(() => "4/receipt.jpg"),
  signFuelReceipt: mocks.signFuelReceipt,
}));
vi.mock("@/lib/fuel/request-policy", () => ({
  ACTIVE_FUEL_TRIP_STATUSES: ["In Progress"],
  fuelFulfillmentError: vi.fn(() => null),
  fuelTankCapacityError: vi.fn(() => null),
  fuelTypeMismatch: mocks.fuelTypeMismatch,
}));
vi.mock("@/lib/fuel/transaction-integrity", () => ({
  computeFuelFlags: mocks.computeFuelFlags,
  detectDuplicateReceipt: vi.fn(async () => ({ exact: false, possible: false })),
}));

import { POST } from "./route";

let tx;
let duplicateRecord;

function request() {
  return new Request("https://fleet.test/api/mobile/fuel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fuel_request_id: 7,
      trip_id: 90,
      client_submission_id: "client-submission-90-001",
      fuel_date: "2026-10-01",
      receipt_url: "https://fleet.test/receipt.jpg",
      liters: 30,
      amount: 3000,
      station_name: "Test Fuel",
      payment_method: "Cash",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFuelPolicy.mockResolvedValue({ maxPricePerLiter: 120, strictFuelTypeMatching: false });
  mocks.fuelTypeMismatch.mockReturnValue(false);
  duplicateRecord = null;
  mocks.query.mockResolvedValue({ rows: [{ trip_id: 90, vehicle_id: 33, fuel_type: "Diesel", mileage: 1200, tank_capacity_l: 80, fuel_level: 20 }] });
  tx = {
    query: vi.fn(async (sql) => {
      if (sql.includes("FROM fuelrequests")) return { rows: [{ fuel_request_id: 7, allocation_month: "2026-10-01", status: "Approved" }] };
      if (sql.includes("FROM fuelrecords") && sql.includes("client_submission_id")) return { rows: duplicateRecord ? [duplicateRecord] : [] };
      if (sql.includes("INSERT INTO fuelrecords")) return { rows: [{ fuel_record_id: 18, status: "Pending" }] };
      if (sql.includes("UPDATE fuelrequests")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
  mocks.withTransaction.mockImplementation((callback) => callback(tx));
});

describe("POST /api/mobile/fuel audit idempotency", () => {
  it("audits a new report once and does not audit an idempotent retry", async () => {
    const req = request();
    const response = await POST(req);

    expect(response.status).toBe(201);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
    expect(mocks.writeAudit).toHaveBeenCalledWith(req, expect.anything(), expect.objectContaining({
      action: "fuel_submitted",
      resource: "fuelrecords",
      resourceId: 18,
      newValues: { status: "Pending", source: "mobile" },
    }));

    duplicateRecord = { fuel_record_id: 18, status: "Pending" };
    const retry = await POST(request());
    expect(retry.status).toBe(201);
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });

  it("uses the configured price ceiling and rejects a strict fuel type mismatch", async () => {
    mocks.getFuelPolicy.mockResolvedValue({ maxPricePerLiter: 95, strictFuelTypeMatching: false });
    expect((await POST(request())).status).toBe(201);
    expect(mocks.computeFuelFlags).toHaveBeenCalledWith(expect.objectContaining({ maxPricePerLiter: 95 }));

    mocks.getFuelPolicy.mockResolvedValue({ maxPricePerLiter: 95, strictFuelTypeMatching: true });
    mocks.fuelTypeMismatch.mockReturnValue(true);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
  });
});
