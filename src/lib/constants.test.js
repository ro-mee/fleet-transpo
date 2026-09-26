import { describe, expect, it } from "vitest";
import { NOTIFICATION_EVENTS, NOTIFICATION_CHANNELS } from "@/lib/constants";

// The preferences surface is generated from this object, not written beside it:
// `GET /api/notifications/preferences` iterates `Object.entries(NOTIFICATION_EVENTS)`
// to build the list, `/notifications/preferences` renders one row per key, and
// `channelEnabled()` reads `defaults[channel]` for an absent preference row. A
// key missing either field therefore does not fail loudly at its call site — it
// renders a row with no label or throws on a channel read. Asserted here because
// this file did not exist when Task 15's plan assumed it did (recorded in the
// SDD ledger as a plan defect).
describe("NOTIFICATION_EVENTS", () => {
  const entries = Object.entries(NOTIFICATION_EVENTS);

  it("is not empty", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("gives every event a human label", () => {
    for (const [key, config] of entries) {
      expect(typeof config.label, key).toBe("string");
      expect(config.label.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("gives every event a defaults object covering every declared channel", () => {
    for (const [key, config] of entries) {
      expect(config.defaults, key).toBeTypeOf("object");
      for (const channel of Object.values(NOTIFICATION_CHANNELS)) {
        expect(typeof config.defaults[channel], `${key}.${channel}`).toBe("boolean");
      }
    }
  });

  it("uses snake_case keys, which is what the preference row's event_key stores", () => {
    for (const [key] of entries) {
      expect(key, key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
