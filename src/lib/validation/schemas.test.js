import { describe, expect, it } from "vitest";
import { createUserSchema } from "./schemas";

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
