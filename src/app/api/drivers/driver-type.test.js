import { describe, it, expect } from "vitest";
import { driverSchema } from "@/lib/validation/schemas";

describe("driverSchema with driver_type", () => {
  it("defaults driver_type to Passenger and driver_status to Available", () => {
    const validData = {
      first_name: "Juan",
      last_name: "Dela Cruz",
      license_number: "N01-12-345678",
      license_expiry: "2028-12-31",
      license_type: "Professional",
      license_class: "B",
      birthdate: "1990-01-01",
    };
    const parsed = driverSchema.parse(validData);
    expect(parsed.driver_type).toBe("Passenger");
    expect(parsed.driver_status).toBe("Available");
  });

  it("accepts Cargo as driver_type", () => {
    const validData = {
      first_name: "Pedro",
      last_name: "Santos",
      license_number: "N01-12-345679",
      license_expiry: "2028-12-31",
      license_type: "Professional",
      license_class: "B",
      birthdate: "1990-01-01",
      driver_type: "Cargo",
    };
    const parsed = driverSchema.parse(validData);
    expect(parsed.driver_type).toBe("Cargo");
  });

  it("rejects invalid driver_type", () => {
    const invalidData = {
      first_name: "Pedro",
      last_name: "Santos",
      license_number: "N01-12-345679",
      license_expiry: "2028-12-31",
      license_type: "Professional",
      license_class: "B",
      birthdate: "1990-01-01",
      driver_type: "Motorcycle",
    };
    expect(() => driverSchema.parse(invalidData)).toThrow();
  });
});
