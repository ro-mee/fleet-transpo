import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
}));

vi.mock("@/lib/db", () => ({
  query: state.query,
  getAdminClient: vi.fn(),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/api/utils", () => ({
  requirePermission: vi.fn(async () => ({ user: { role: "admin" } })),
  ok: (data) => Response.json(data),
  err: (message, status = 400) => Response.json({ message }, { status }),
  errValidation: (errors) => Response.json({ errors }, { status: 400 }),
  handleError: (error) => Response.json({ message: error.message }, { status: 500 }),
  parseBody: vi.fn(),
}));
vi.mock("@/lib/drivers/media", () => ({
  signDriverMedia: vi.fn(async (row) => row),
  signDriverMediaList: vi.fn(async (rows) => rows),
  toStoredMediaRef: vi.fn((value) => value),
}));
vi.mock("@/services/driver-schedule.service", () => ({ loadDriverScheduleContext: vi.fn() }));
vi.mock("@/lib/uvvrp/uvvrp.service", () => ({
  loadDriverTravelContext: vi.fn(),
  driverCanTravel: vi.fn(),
}));

const { GET } = await import("./route");

describe("GET /api/drivers directory filters", () => {
  beforeEach(() => state.query.mockClear());

  async function request(search) {
    return GET(new Request(`https://fleet.test/api/drivers?${search}`));
  }

  it("applies name and contact search to linked and incomplete driver rows", async () => {
    await request("includeUnlinked=1&search=Smith");

    const select = state.query.mock.calls
      .map(([sql, params]) => ({ sql, params }))
      .find(({ sql }) => sql.includes("FALSE AS requires_completion"));

    expect(select.sql).toContain("UNION ALL");
    expect(select.sql.match(/e\.first_name ILIKE/g)).toHaveLength(2);
    expect(select.sql.match(/e\.phone ILIKE/g)).toHaveLength(2);
    expect(select.params.filter((value) => value === "%Smith%")).toHaveLength(2);
  });

  it("does not mix incomplete accounts into status- or license-filtered results", async () => {
    await request("includeUnlinked=1&status=Available&license_class=B");

    const select = state.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("FALSE AS requires_completion"));

    expect(select).not.toContain("UNION ALL");
    expect(select).not.toContain("TRUE AS requires_completion");
  });
});
