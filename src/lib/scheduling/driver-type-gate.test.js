import { describe, expect, it } from "vitest";
import { evaluateRequestConflicts } from "./conflicts";

const passenger = { driver_id: 7, driver_status: "Available", driver_type: "Passenger" };
const cargo = { driver_id: 8, driver_status: "Available", driver_type: "Cargo" };
const request = (service_code) => ({ request_id: 3, service_code });

function mismatch(requestRow, driver) {
  return evaluateRequestConflicts(requestRow, { driver }).filter(
    (finding) => finding.type === "driver_type_mismatch"
  );
}

describe("driver_type service gate (deterministic engine)", () => {
  it("blocks a Passenger driver on a cargo service", () => {
    const findings = mismatch(request("RESTAURANT_FOOD_DELIVERY"), passenger);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "blocking",
      detail: { required_group: "CARGO", service_code: "RESTAURANT_FOOD_DELIVERY" },
    });
  });

  it("blocks a Cargo driver on a passenger service", () => {
    const findings = mismatch(request("GUEST_TRANSPORT"), cargo);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "blocking",
      detail: { required_group: "PASSENGER", service_code: "GUEST_TRANSPORT" },
    });
  });

  it("passes matched pairs", () => {
    expect(mismatch(request("RESTAURANT_FOOD_DELIVERY"), cargo)).toHaveLength(0);
    expect(mismatch(request("VIP_GUEST_TRANSPORT"), passenger)).toHaveLength(0);
  });

  it("skips unknown services instead of blocking legacy rows", () => {
    expect(mismatch(request(null), passenger)).toHaveLength(0);
    expect(mismatch(request("SOME_CUSTOM_SERVICE"), cargo)).toHaveLength(0);
  });

  it("skips drivers with no recorded type instead of bricking the assign", () => {
    const findings = evaluateRequestConflicts(request("HOTEL_SUPPLY_TRANSFER"), {
      driver: { driver_id: 9, driver_status: "Available" },
    }).filter((finding) => finding.type === "driver_type_mismatch");
    expect(findings).toHaveLength(0);
  });
});
