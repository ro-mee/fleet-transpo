import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { profilePayload, profileToForm, validateProfile } from "./vehicle-cargo-profile-form";

const state = vi.hoisted(() => ({ query: {}, options: null }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: options => { state.options = options; return state.query; },
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock("@/lib/api/client", () => ({ apiFetch: vi.fn() }));
vi.mock("@/components/ui/toast", () => ({ toast: { success: vi.fn() } }));
vi.stubGlobal("React", React);
const { default: Editor } = await import("./vehicle-cargo-profile-editor");
const { apiFetch } = await import("@/lib/api/client");

const PROFILE = {
  vehicle_id: 37, supports_supply_delivery: true,
  rated_payload_kg: 1000, gross_vehicle_weight_limit_kg: 2500, operating_mass_kg: 1900, operational_reserve_kg: 100,
  usable_volume_m3: 5, compartment_length_m: 2, compartment_width_m: 2, compartment_height_m: 2,
  opening_length_m: 1.5, opening_width_m: 1.5, opening_height_m: 1.5,
  temperature_min_c: null, temperature_max_c: null, handling_capabilities: ["SECURE_LOAD"],
  verification_reference: "MEASURE-37", verification_valid_until: "2099-01-01", verified_by: 23, verified_at: "2026-10-13T01:00:00Z",
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.query = { data: { profiles: [PROFILE] }, isLoading: false, isError: false, refetch: vi.fn() };
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

describe("Fleet cargo profile editor", () => {
  it("queries only the saved vehicle and shows the derived basis separately from conflicting legacy kg", async () => {
    const html = renderToStaticMarkup(React.createElement(Editor, { vehicleId: 37, legacyCapacityKg: 1000 }));
    await state.options.queryFn();
    expect(apiFetch).toHaveBeenCalledWith("/api/supply/vehicles/cargo-profile?vehicle_id=37");
    expect(html).toContain("500 kg");
    expect(html).toContain("1,000 kg");
    expect(html).toContain("saved profile and legacy capacity disagree");
    expect(html).toContain("employee ID 23");
    expect(html).toContain("not a separate compliance approval");
    expect(html).toContain("saves separately from vehicle details");
  });

  it("does not show a capacity discrepancy when the measured and legacy values agree", () => {
    const html = renderToStaticMarkup(React.createElement(Editor, { vehicleId: 37, legacyCapacityKg: 500 }));
    expect(html).not.toContain("legacy capacity disagree");
  });

  it("requires saving a Cargo vehicle before enabling profile input", () => {
    const html = renderToStaticMarkup(React.createElement(Editor, { vehicleId: null }));
    expect(state.options.enabled).toBe(false);
    expect(html).toContain("Save the vehicle with Cargo operational use first");
    expect(html).not.toContain("Save cargo profile");
  });

  it("refuses to replace a failed initial read with editable blank measurements", () => {
    state.query = { isError: true, isLoading: false, refetch: vi.fn() };
    const html = renderToStaticMarkup(React.createElement(Editor, { vehicleId: 37 }));
    expect(html).toContain("Retry before editing");
    expect(html).not.toContain("Save cargo profile");
  });

  it("keeps the form visible after a background refresh failure and identifies expiry", () => {
    state.query = { ...state.query, isError: true, data: { profiles: [{ ...PROFILE, verification_valid_until: "2000-01-01" }] } };
    const html = renderToStaticMarkup(React.createElement(Editor, { vehicleId: 37 }));
    expect(html).toContain("Your draft is preserved");
    expect(html).toContain("expired");
    expect(html).toContain("Save cargo profile");
  });
});

describe("reused cargo profile form validation", () => {
  it("keeps zero reserve, canonical nullable temperatures and trimmed recording reference", () => {
    const form = { ...profileToForm(PROFILE), operational_reserve_kg: "0", verification_reference: "  MEASURE-37  " };
    expect(validateProfile(form)).toEqual({});
    expect(profilePayload(form, 37)).toMatchObject({ vehicle_id: 37, operational_reserve_kg: 0, temperature_min_c: null, temperature_max_c: null, verification_reference: "MEASURE-37" });
    expect(profilePayload(form, 37)).not.toHaveProperty("cargo_capacity_kg");
  });

  it("preserves required measurements, realistic GVW, temperature ordering and expiry checks", () => {
    const form = { ...profileToForm(PROFILE), rated_payload_kg: "", gross_vehicle_weight_limit_kg: "1000", temperature_min_c: "10", temperature_max_c: "0", verification_valid_until: "2000-01-01" };
    expect(validateProfile(form)).toMatchObject({
      rated_payload_kg: expect.any(String), gross_vehicle_weight_limit_kg: expect.any(String), temperature_max_c: expect.any(String), verification_valid_until: expect.any(String),
    });
  });

  it("disables a profile without copying or deleting the recorded physical facts", () => {
    expect(profilePayload({ ...profileToForm(PROFILE), supports_supply_delivery: false }, 37)).toEqual({ vehicle_id: 37, supports_supply_delivery: false });
  });
});
