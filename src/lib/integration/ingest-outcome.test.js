import { describe, expect, it } from "vitest";
import { describeIngestOutcome } from "@/lib/integration/ingest-outcome";

// The route answers with the request ROW. The injector page used to read
// `res.id` / `res.created`, which the route never sends, so every submission
// toasted "Created transport request #undefined".
describe("describeIngestOutcome", () => {
  it("names a created request by its reservation number", () => {
    const out = describeIngestOutcome({ request_id: 510, reservation_number: "RS-VGFK", fleet_status: "Pending" });
    expect(out.label).toBe("RS-VGFK");
    expect(out.message).toBe("Created transport request RS-VGFK");
    expect(out.message).not.toContain("undefined");
    expect(out.idempotent).toBe(false);
    expect(out.ok).toBe(true);
  });

  it("reports a replay as already on file, not as a second creation", () => {
    const out = describeIngestOutcome({ request_id: 510, reservation_number: "RS-VGFK", idempotent: true });
    expect(out.idempotent).toBe(true);
    expect(out.message).toContain("Already on file");
    expect(out.message).toContain("RS-VGFK");
    expect(out.message).not.toContain("Created");
  });

  it("falls back to the numeric id when the row carries no number", () => {
    const out = describeIngestOutcome({ request_id: 42 });
    expect(out.label).toBe("#42");
    expect(out.message).toBe("Created transport request #42");
  });

  it("never renders undefined for an unidentified success", () => {
    const out = describeIngestOutcome({});
    expect(out.label).toBe("the request");
    expect(out.message).not.toMatch(/undefined|#null|NaN/);
    expect(out.ok).toBe(false);
  });

  it("survives a missing body", () => {
    expect(() => describeIngestOutcome(undefined)).not.toThrow();
    expect(describeIngestOutcome(null).message).not.toContain("undefined");
  });
});
