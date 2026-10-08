import { describe, expect, it } from "vitest";
import { bagSummary, queuePresentation } from "./queue-presentation";

const BUCKET_PRESENTATIONS = [
  ["Ready for confirmation", { label: "Ready", status: "Ready", entity: "copilot" }],
  ["Review required", { label: "Review required", status: "Review required", entity: "copilot" }],
  ["Needs verification", { label: "Needs verification", status: "Needs verification", entity: "copilot" }],
  ["Blocked", { label: "Blocked", status: "Blocked", entity: "copilot" }],
  ["Waiting for preceding request", { label: "Waiting", status: "Waiting", entity: "copilot" }],
  ["Not evaluated", { label: "Not evaluated", status: "Not evaluated", entity: "copilot" }],
];

describe("queuePresentation", () => {
  it.each(BUCKET_PRESENTATIONS)("maps the %s bucket to its canonical badge", (bucket, expected) => {
    expect(queuePresentation({ fleet_status: "Scheduled" }, bucket)).toEqual(expected);
  });

  it("keeps Pending Reassignment ahead of a proposal bucket", () => {
    expect(
      queuePresentation(
        { fleet_status: "Scheduled", dispatch_status: "Pending Reassignment" },
        "Ready for confirmation"
      )
    ).toEqual({
      label: "Needs reassignment",
      status: "Pending Reassignment",
      entity: "dispatch",
    });
  });

  it.each(["Assigned", "In Progress", "Completed", "Cancelled"])("keeps %s ahead of stale proposal data", (fleetStatus) => {
    expect(
      queuePresentation({ fleet_status: fleetStatus }, "Ready for confirmation")
    ).toEqual({ label: fleetStatus, status: fleetStatus, entity: "reservation" });
  });

  it.each(["Pending", "Scheduled", "Assigned", "In Progress", "Completed", "Cancelled"])(
    "uses the reservation lifecycle map for %s when no proposal bucket applies",
    (fleetStatus) => {
      expect(queuePresentation({ fleet_status: fleetStatus }, null)).toEqual({
        label: fleetStatus,
        status: fleetStatus,
        entity: "reservation",
      });
    }
  );
});

describe("bagSummary", () => {
  it("does not infer luggage from passenger count when it is missing", () => {
    expect(bagSummary({ passenger_count: 3, luggage_count: null })).toBe("Bags not recorded");
  });

  it("preserves recorded zero luggage", () => {
    expect(bagSummary({ luggage_count: 0 })).toBe("0 bags");
  });

  it("uses singular and plural labels for recorded luggage", () => {
    expect(bagSummary({ luggage_count: 1 })).toBe("1 bag");
    expect(bagSummary({ luggage_count: 2 })).toBe("2 bags");
  });
});
