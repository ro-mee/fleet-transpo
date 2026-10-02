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
