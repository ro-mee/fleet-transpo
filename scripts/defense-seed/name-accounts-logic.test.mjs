import { describe, expect, it } from "vitest";
import { desiredEmail, slugName } from "./name-accounts-logic.mjs";

describe("name-based driver account mapping", () => {
  it("normalizes a regular name to dot-separated lowercase tokens", () => {
    expect(slugName("Nico", "Bautista")).toBe("nico.bautista");
  });

  it("keeps all name tokens for Dela Cruz", () => {
    expect(slugName("Paolo", "Dela Cruz")).toBe("paolo.dela.cruz");
  });

  it("removes accents and punctuation safely", () => {
    expect(slugName("José", "O'Neill-Santos")).toBe("jose.o.neill.santos");
  });

  it("uses the user-supplied direct addresses for D01-D03", () => {
    expect(desiredEmail({ driver_key: "D01", first_name: "Mateo", last_name: "Reyes" }))
      .toBe("romarroms123@gmail.com");
    expect(desiredEmail({ driver_key: "D02", first_name: "Andres", last_name: "Santos" }))
      .toBe("arvild10.4@gmail.com");
    expect(desiredEmail({ driver_key: "D03", first_name: "Paolo", last_name: "Dela Cruz" }))
      .toBe("yy.yujin.han.nn@gmail.com");
  });

  it("routes D04-D10 through controlled inboxes with visible name aliases", () => {
    expect(desiredEmail({ driver_key: "D04", first_name: "Nico", last_name: "Bautista" }))
      .toBe("romarroms123+nico.bautista@gmail.com");
    expect(desiredEmail({ driver_key: "D10", first_name: "Emilio", last_name: "Torres" }))
      .toBe("romarroms123+emilio.torres@gmail.com");
  });

  it("rejects names without two usable tokens", () => {
    expect(() => slugName("", "")).toThrow();
  });
});
