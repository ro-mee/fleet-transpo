import { beforeEach, describe, expect, it, vi } from "vitest";
import { rolesFor } from "@/lib/auth/permissions";
import { GET, POST, PATCH } from "./route";

const fake = vi.hoisted(() => ({ role: "fleet_manager", rows: [], writes: 0, region: null }));
vi.mock("@/lib/api/utils", () => {
  class AuthError extends Error { constructor(message, status) { super(message); this.status = status; } }
  return { AuthError, requirePermission: async (_req, resource, action) => { if (!rolesFor(resource, action).includes(fake.role)) throw new AuthError("Forbidden", 403); return { user: { employeeId: 3 } }; }, parseBody: (req) => req.json(), ok: (data, status = 200) => Response.json(data, { status }), err: (error, status) => Response.json({ error }, { status }), handleError: (e) => Response.json({ error: e.message }, { status: e.status || 500 }) };
});
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/db", () => {
  const query = async (sql, values) => {
    if (sql.includes("INSERT INTO system_settings")) { fake.region = JSON.parse(values[0]); return { rows: [] }; }
    if (sql.includes("FROM system_settings")) return { rows: fake.region ? [{ setting_value: fake.region }] : [] };
    if (sql.includes("INSERT INTO fuel_price_snapshots")) {
      fake.writes++; const row = { snapshot_id: 1, fuel_product: values[0], region: values[1], reference_price: values[2], source_url: values[7], effective_at: values[5], lifecycle: values[9], verified_by: values[11], verification_method: values[8] }; fake.rows.push(row); return { rows: [row] };
    }
    if (sql.includes("SELECT") && sql.includes("FROM fuel_price_snapshots")) return { rows: fake.rows };
    return { rows: [] };
  };
  return { query, withTransaction: (fn) => fn({ query }) };
});
const input = { fuel_product: "Diesel", region: "NCR", reference_price: 62.7, effective_at: "2030-10-01T00:00:00+08:00", source_url: "https://official.example/dated-prices", verified_by: 999, verification_method: "Automatic", lifecycle: "Active" };
const request = (method, body) => new Request("https://local/api/fuel/reference-prices", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => { fake.role = "fleet_manager"; fake.rows = []; fake.writes = 0; fake.region = null; });
describe("manual reference-price API through the real repository", () => {
  it("denies drivers and read-only managers before writes", async () => {
    for (const role of ["driver", "management", "dispatcher"]) { fake.role = role; expect((await POST(request("POST", input))).status).toBe(403); }
    expect(fake.writes).toBe(0);
  });
  it("records the signed-in verifier and future effectivity, ignoring client trust fields", async () => {
    const response = await POST(request("POST", input));
    expect(response.status).toBe(201);
    expect((await response.json()).snapshot).toMatchObject({ verified_by: 3, verification_method: "Manual", lifecycle: "Pending" });
  });
  it("shows history and allows authorized selection of the estimate region", async () => {
    expect((await PATCH(request("PATCH", { region: "NCR" }))).status).toBe(200);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200); expect((await response.json()).region).toBe("NCR");
  });
});
