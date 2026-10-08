import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Structural pin: the heartbeat is role-agnostic session infrastructure (it
 * only reads/slides the caller's own session row), so every role with a web
 * workspace must be admitted. `mechanic` and `driver` were missing, which
 * 403'd their heartbeats — console spam plus a `last_seen_at` that never
 * slides, idle-logging-out active workshop/driver sessions.
 */
describe("heartbeat role admission", () => {
  it("admits mechanic and driver alongside the staff roles", () => {
    const source = readFileSync(new URL("./route.js", import.meta.url), "utf8");
    for (const role of [
      "super_admin",
      "admin",
      "fleet_manager",
      "dispatcher",
      "management",
      "driver",
      "mechanic",
    ]) {
      expect(source).toContain(`"${role}"`);
    }
  });
});
