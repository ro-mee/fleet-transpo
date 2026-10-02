import { describe, expect, it } from "vitest";
import { numberCodingBlockReason } from "./availability-reason";

const policy = {
  enabled: true,
  weekdayRestrictions: { Friday: [9, 0] },
};
const friday = new Date("2026-10-02T04:00:00.000Z");

describe("numberCodingBlockReason", () => {
  it("explains the actual restricted plate digit and date", () => {
    expect(numberCodingBlockReason(
      { vehicle_id: 7, plate_number: "ABC-1239" },
      { policy, exemptVehicleIds: new Set() },
      friday
    )).toBe("Number-coding restriction: plate ending in 9 is restricted on Friday (restricted digits: 9, 0).");
  });

  it("returns no coding explanation for unrestricted plates, exemptions, or disabled policy", () => {
    expect(numberCodingBlockReason({ vehicle_id: 7, plate_number: "ABC-1234" }, { policy }, friday)).toBeNull();
    expect(numberCodingBlockReason({ vehicle_id: 7, plate_number: "ABC-1239" }, { policy, exemptVehicleIds: new Set([7]) }, friday)).toBeNull();
    expect(numberCodingBlockReason({ vehicle_id: 7, plate_number: "ABC-1239" }, { policy: { ...policy, enabled: false } }, friday)).toBeNull();
  });
});
