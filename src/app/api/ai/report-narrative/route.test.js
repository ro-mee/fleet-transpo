import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  executeLlmCompletion: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: state.query }));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({ user: { role: "fleet_manager" } })),
  parseBody: (request) => request.json(),
  ok: (data) => Response.json(data),
  handleError: (error) => Response.json({ message: error.message }, { status: 500 }),
}));
vi.mock("@/lib/ai/llm-adapter", () => ({ executeLlmCompletion: state.executeLlmCompletion }));
vi.mock("@/lib/ai/prompt-loader", () => ({
  getReportInstructions: vi.fn(async () => "Report instructions"),
  getSystemInstructions: vi.fn(async () => "System instructions"),
}));

const { POST } = await import("./route");

describe("POST /api/ai/report-narrative empty fleet window", () => {
  beforeEach(() => {
    state.query.mockReset();
    state.executeLlmCompletion.mockReset();
  });

  it("bypasses an old cached narrative and the LLM when the report has zero trips", async () => {
    state.query.mockResolvedValue({ rows: [{ narrative: "A fleet outage is likely." }] });
    state.executeLlmCompletion.mockResolvedValue({ success: true, content: "unsupported" });
    const request = new Request("https://fleet.test/api/ai/report-narrative", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        report: "fleet",
        range: { from: "2026-09-25", to: "2026-10-02" },
        data: { utilization: 0, totalTrips: 0, totalDistance: 0, byVehicle: [] },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(body.mode).toBe("deterministic");
    expect(body.narrative).toContain("No trip records appear in the selected report window");
    expect(body.narrative).not.toContain("outage");
    expect(state.query).not.toHaveBeenCalled();
    expect(state.executeLlmCompletion).not.toHaveBeenCalled();
  });
});

describe("financial narrative scope version", () => {
  const request = (force = false) => new Request("https://fleet.test/api/ai/report-narrative", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ report: "financial", force, data: { totalCost: 250, fuelCost: 150, maintCost: 60, expenseCost: 40, totalDistance: 100, costPerKm: 2.5 } }),
  });
  beforeEach(() => {
    state.query.mockReset();
    state.executeLlmCompletion.mockReset();
    state.executeLlmCompletion.mockResolvedValue({ success: false });
  });
  it("replaces a fresh legacy narrative while keeping the existing budget row", async () => {
    state.query.mockImplementation(async (sql, params) => {
      if (sql.startsWith("SELECT")) return { rows: [{ mode: "deterministic", narrative: "Old trip costs", generated_at: new Date(), force_count: 2, force_day: new Date() }] };
      expect(params[0]).toBe("financial");
      expect(params[3]).toBe("deterministic-v2");
      return { rows: [{ force_count: 2 }] };
    });
    const body = await (await POST(request())).json();
    expect(body.cached).not.toBe(true);
    expect(body.mode).toBe("deterministic");
    expect(body.narrative).toContain("approved driver expenses PHP 40");
    expect(body.force_remaining_today).toBe(1);
  });
  it("serves a current scope cache without another model call", async () => {
    state.query.mockResolvedValue({ rows: [{ mode: "generative-v2", narrative: "Current approved expenses", generated_at: new Date() }] });
    const body = await (await POST(request())).json();
    expect(body.cached).toBe(true);
    expect(body.mode).toBe("generative");
    expect(state.executeLlmCompletion).not.toHaveBeenCalled();
  });
  it("does not return an obsolete narrative when the regeneration budget is spent", async () => {
    state.query.mockResolvedValue({ rows: [{ mode: "deterministic", narrative: "Old trip costs", generated_at: new Date(), force_count: 3, force_day: new Date() }] });
    const body = await (await POST(request(true))).json();
    expect(body.mode).toBe("rate-limited");
    expect(body.narrative).toContain("approved driver expenses PHP 40");
    expect(body.narrative).not.toContain("Old trip costs");
  });
});

it.each([false, true])("does not reuse an old analytics cost scope when force=%s", async force => {
  state.query.mockReset();
  state.query.mockResolvedValue({ rows: [{ mode: "deterministic", narrative: "Old analytics total", generated_at: new Date(), force_count: 3, force_day: new Date() }] });
  state.executeLlmCompletion.mockResolvedValue({ success: false });
  const req = new Request("https://fleet.test/api/ai/report-narrative", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ report: "analytics", force, data: { totalCost: 250, totalTrips: 1, expenseCost: 40, totalDistance: 80, costDistance: 100, costPerKm: 2.5 } }) });
  const body = await (await POST(req)).json();
  expect(body.narrative).toContain("PHP 250");
  expect(body.narrative).not.toContain("Old analytics total");
});
