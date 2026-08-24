import { describe, it, expect } from "vitest";
import { suspensionAction, licenseExpired } from "@/lib/drivers/compliance";
import { DRIVER_STATUS } from "@/lib/constants";

const TODAY = new Date("2026-08-23T12:00:00");
const YESTERDAY = "2026-08-22";
const TOMORROW = "2026-08-24";

describe("licenseExpired", () => {
  it("is expired when expiry is before today", () => {
    expect(licenseExpired(YESTERDAY, TODAY)).toBe(true);
  });

  it("is NOT expired on the expiry day itself (expires end of day)", () => {
    expect(licenseExpired(TOMORROW, TODAY)).toBe(false);
    expect(licenseExpired("2026-08-23", TODAY)).toBe(false);
  });

  it("treats missing or malformed expiry as not expired — no data never suspends", () => {
    expect(licenseExpired(null, TODAY)).toBe(false);
    expect(licenseExpired(undefined, TODAY)).toBe(false);
    expect(licenseExpired("not-a-date", TODAY)).toBe(false);
  });

  it("accepts Date instances exactly as pg returns them (regression)", () => {
    // pg hands back DATE columns as Date objects; slicing their toString()
    // used to misparse "Sun Aug 22 2027…" into a year-2001 date.
    const futureDate = new Date(`${TOMORROW}T00:00:00`);
    const pastDate = new Date(`${YESTERDAY}T00:00:00`);
    expect(licenseExpired(futureDate, TODAY)).toBe(false);
    expect(licenseExpired(pastDate, TODAY)).toBe(true);
  });
});

describe("suspensionAction", () => {
  it("suspends an available driver whose license just expired", () => {
    expect(
      suspensionAction({ driverStatus: "Available", licenseExpiry: YESTERDAY }, TODAY)
    ).toEqual({ action: "suspend", reason: "license_expired" });
  });

  it("suspends regardless of other statuses except On Leave", () => {
    expect(
      suspensionAction({ driverStatus: DRIVER_STATUS.OFF_DUTY, licenseExpiry: YESTERDAY }, TODAY).action
    ).toBe("suspend");
  });

  it("On Leave always wins over compliance suspension", () => {
    expect(
      suspensionAction(
        { driverStatus: DRIVER_STATUS.ON_LEAVE, licenseExpiry: YESTERDAY },
        TODAY
      ).action
    ).toBe("none");
  });

  it("re-suspending an already-suspended driver is a no-op (idempotent)", () => {
    expect(
      suspensionAction(
        { driverStatus: "Suspended", suspensionReason: null, licenseExpiry: YESTERDAY },
        TODAY
      ).action
    ).toBe("none");
  });

  it("restores ONLY a license_expired suspension after a valid renewal", () => {
    expect(
      suspensionAction(
        { driverStatus: "Suspended", suspensionReason: "license_expired", licenseExpiry: TOMORROW },
        TODAY
      )
    ).toEqual({ action: "restore" });
  });

  it("never restores manual suspensions — even with a fresh license", () => {
    expect(
      suspensionAction(
        { driverStatus: "Suspended", suspensionReason: "manual", licenseExpiry: TOMORROW },
        TODAY
      ).action
    ).toBe("none");
  });

  it("never restores legacy/NULL-reason suspensions", () => {
    expect(
      suspensionAction({ driverStatus: "Suspended", suspensionReason: null, licenseExpiry: TOMORROW }, TODAY).action
    ).toBe("none");
    expect(
      suspensionAction({ driverStatus: "Suspended", licenseExpiry: TOMORROW }, TODAY).action
    ).toBe("none");
  });

  it("a still-expired license blocks restore regardless of reason", () => {
    expect(
      suspensionAction(
        { driverStatus: "Suspended", suspensionReason: "license_expired", licenseExpiry: YESTERDAY },
        TODAY
      ).action
    ).toBe("none");
  });

  it("healthy available driver is untouched", () => {
    expect(
      suspensionAction({ driverStatus: "Available", licenseExpiry: TOMORROW }, TODAY).action
    ).toBe("none");
  });
});
