import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/services/reservation-lifecycle.service", () => ({ loadRequest: vi.fn() }));
vi.mock("@/services/dispatch-recommendation-preparation.service", () => ({
  prepareDispatchRecommendation: vi.fn(),
}));
vi.mock("@/services/dispatch-radar.service", () => ({ applyDispatchRadar: vi.fn() }));
vi.mock("@/lib/ai/llm-adapter", () => ({ executeLlmCompletion: vi.fn() }));
vi.mock("@/services/recommendation.service", () => ({ saveRecommendationSnapshot: vi.fn() }));

import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { executeLlmCompletion } from "@/lib/ai/llm-adapter";
import { applyDispatchRadar } from "@/services/dispatch-radar.service";
import { prepareDispatchRecommendation } from "@/services/dispatch-recommendation-preparation.service";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { saveRecommendationSnapshot } from "@/services/recommendation.service";
import { GET } from "./route";

const REQUEST = {
  request_id: 499,
  guest_name: "Fixture guest",
  pickup_location: "Fixture pickup",
  dropoff_location: "Fixture destination",
  pickup_datetime: "2026-10-03T10:00:00.000Z",
};

const RECOMMENDATION = {
  trip: { estimated_distance_km: 4, estimated_travel_minutes: 20 },
  pair: { recommended: null, alternate: null, candidates: [] },
  vehicle: { considered: 0 },
  driver: { considered: 0 },
};

function request() {
  return new Request("http://localhost/api/integration/transport-requests/499/recommendation");
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.__HARNESS_SESSION__ = true;
  auth.mockResolvedValue({ user: { employeeId: 48, role: "dispatcher" } });
  loadRequest.mockResolvedValue(REQUEST);
  prepareDispatchRecommendation.mockResolvedValue({
    request: REQUEST,
    estimate: {},
    drivers: [],
    recommendation: structuredClone(RECOMMENDATION),
  });
  applyDispatchRadar.mockResolvedValue(undefined);
});

afterEach(() => {
  delete globalThis.__HARNESS_SESSION__;
});

describe("GET /api/integration/transport-requests/[id]/recommendation", () => {
  it("returns current advice without persisting or invoking narration", async () => {
    const response = await GET(request(), { params: Promise.resolve({ id: "499" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.narration).toBeNull();
    expect(loadRequest).toHaveBeenCalledWith("499");
    expect(prepareDispatchRecommendation).toHaveBeenCalledOnce();
    expect(applyDispatchRadar).toHaveBeenCalledOnce();
    expect(saveRecommendationSnapshot).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(executeLlmCompletion).not.toHaveBeenCalled();
  });

  it("returns 404 only when the request lookup is empty", async () => {
    loadRequest.mockResolvedValueOnce(null);

    const response = await GET(request(), { params: Promise.resolve({ id: "499" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Transportation request not found" });
    expect(prepareDispatchRecommendation).not.toHaveBeenCalled();
  });
});
