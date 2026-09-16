import { describe, expect, it } from "vitest";
import { createUserSchema } from "./schemas";

const base = {
  email: "new.user@fleetops.com",
  first_name: "New",
  last_name: "User",
  role_id: "2",
};

describe("createUserSchema password parity", () => {
  it("rejects the old 6-character floor", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abc123" });
    expect(result.success).toBe(false);
  });

  it("rejects passwords without a special character", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abcdef12" });
    expect(result.success).toBe(false);
  });

  it("accepts a policy-compliant password", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abcdef1!" });
    expect(result.success).toBe(true);
  });

  it("still requires all other fields", () => {
    const result = createUserSchema.safeParse({ ...base, password: "Abcdef1!", email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});
