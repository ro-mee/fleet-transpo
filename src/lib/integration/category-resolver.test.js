import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { resolveServiceCategory, resolveVehicleCategory } from "./category-resolver";

const CATEGORIES = [
  { category_id: 1, category_name: "Guest Transfer" },
  { category_id: 2, category_name: "VIP Guest Transport" },
  { category_id: 3, category_name: "Hotel Operations & Logistics" },
];

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: CATEGORIES });
});

describe("resolveServiceCategory", () => {
  it("maps passenger codes to passenger classes without keyword inference", async () => {
    const guest = await resolveServiceCategory("GUEST_TRANSPORT");
    expect(guest).toMatchObject({ categoryId: 1, matchedOn: "service_code" });
    const vip = await resolveServiceCategory("VIP_GUEST_TRANSPORT");
    expect(vip).toMatchObject({ categoryId: 2, matchedOn: "service_code" });
  });

  it("maps cargo codes to the operations class, never to a guest shuttle", async () => {
    for (const code of ["RESTAURANT_SUPPLY_PICKUP", "RESTAURANT_FOOD_DELIVERY", "HOTEL_SUPPLY_TRANSFER"]) {
      const r = await resolveServiceCategory(code);
      expect(r).toMatchObject({ categoryId: 3, matchedOn: "service_code" });
    }
  });

  it("returns null for unknown codes and for an unrecognized category table", async () => {
    expect(await resolveServiceCategory("STAFF_SHUTTLE")).toEqual({ categoryId: null, categoryName: null, matchedOn: null });
    expect(await resolveServiceCategory(null)).toEqual({ categoryId: null, categoryName: null, matchedOn: null });
    query.mockResolvedValue({ rows: [{ category_id: 9, category_name: "Executive Lounge Decor" }] });
    expect(await resolveServiceCategory("RESTAURANT_SUPPLY_PICKUP")).toEqual({ categoryId: null, categoryName: null, matchedOn: null });
  });

  it("never throws when the category lookup fails", async () => {
    query.mockRejectedValue(new Error("database unavailable"));
    expect(await resolveServiceCategory("GUEST_TRANSPORT")).toEqual({ categoryId: null, categoryName: null, matchedOn: null });
    // The underlying resolver keeps its own never-throw contract.
    expect(await resolveVehicleCategory("vip arrival")).toEqual({ categoryId: null, categoryName: null, matchedOn: null });
  });
});
