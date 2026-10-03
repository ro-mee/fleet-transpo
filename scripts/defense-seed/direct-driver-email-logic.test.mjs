import { describe, expect, it } from "vitest";
import { directDriverEmail, directEmailDigest, gmailMailboxKey } from "./direct-driver-email-logic.mjs";

describe("direct defense driver addresses", () => {
  it("maps the named D04 account to the requested standalone address", () => {
    expect(directDriverEmail({ driver_key: "D04", first_name: "Nico", last_name: "Bautista" }))
      .toBe("nico.bautista@gmail.com");
  });

  it("keeps D01-D03 outside this second rotation", () => {
    expect(() => directDriverEmail({ driver_key: "D03", first_name: "Paolo", last_name: "Dela Cruz" }))
      .toThrow(/Unexpected direct-email target/);
  });

  it("changes the approval digest when the current email changes", () => {
    const target = { driver_key: "D04", driver_id: 90, employee_id: 126, first_name: "Nico", last_name: "Bautista",
      old_email: "romarroms123+nico.bautista@gmail.com", new_email: "nico.bautista@gmail.com", auth_version: "2" };
    expect(directEmailDigest([target])).not.toBe(directEmailDigest([{ ...target, old_email: "other@gmail.com" }]));
  });

  it("detects Gmail dot and plus variants of the same inbox", () => {
    expect(gmailMailboxKey("nico.bautista@gmail.com")).toBe(gmailMailboxKey("ni.co.bautista+test@googlemail.com"));
    expect(gmailMailboxKey("nico.bautista@example.com")).toBeNull();
  });
});
