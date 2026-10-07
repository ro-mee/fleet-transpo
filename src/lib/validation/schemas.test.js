import { describe, expect, it } from "vitest";
import { createUserSchema, driverSchema, vehicleSchema } from "./schemas";

const base = {
  email: "new.user@fleetops.com",
  first_name: "New",
  last_name: "User",
  role_id: "2",
};

describe("createUserSchema invite flow", () => {
  it("accepts the invite payload without a password", () => {
    const result = createUserSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("ignores a legacy password key (zod strips unknown keys)", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abcdef1!" });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("password");
  });

  it("rejects an invalid email", () => {
    const result = createUserSchema.safeParse({ ...base, email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("still requires names and role", () => {
    expect(createUserSchema.safeParse({ ...base, first_name: "" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, last_name: "" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, role_id: "" }).success).toBe(false);
  });

  it("rejects names with digits or special characters", () => {
    expect(createUserSchema.safeParse({ ...base, first_name: "New2" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, last_name: "User!" }).success).toBe(false);
  });
});

describe("driver license form validation", () => {
  const driver = {
    first_name: "Juan",
    last_name: "Dela Cruz",
    license_number: "N04-19-013583",
    license_expiry: "2030-01-31",
    license_type: "Professional",
    license_class: "B",
  };

  it("rejects Student Permits with the eligibility reason", () => {
    const result = driverSchema.safeParse({ ...driver, license_type: "Student Permit" });
    expect(result.success).toBe(false);
    expect(result.error.issues.some((issue) => issue.message.includes("Student Permit is not eligible"))).toBe(true);
  });

  it("requires number, exact expiry date, type, and a supported class", () => {
    expect(driverSchema.safeParse({ ...driver, license_number: "" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, license_expiry: "2030-02-31" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, license_type: "Non-Professional" }).success).toBe(false);
    expect(driverSchema.safeParse({ ...driver, license_class: "C" }).success).toBe(false);
  });
});

describe("vehicle driver-class form validation", () => {
  const vehicle = { plate_number: "ABC-1234", vehicle_name: "Van", required_license_class: "B1" };
  it('accepts a pending plate only with an asset code',()=>{
    expect(vehicleSchema.safeParse({...vehicle,plate_number:'',fleet_asset_code:'FLT-007'}).success).toBe(true);
    expect(vehicleSchema.safeParse({...vehicle,plate_number:''}).success).toBe(false);
  });
  it("requires a currently supported required driver class", () => {
    expect(vehicleSchema.safeParse(vehicle).success).toBe(true);
    expect(vehicleSchema.safeParse({ ...vehicle, required_license_class: "C" }).success).toBe(false);
    expect(vehicleSchema.safeParse({ ...vehicle, required_license_class: "" }).success).toBe(false);
  });
});
