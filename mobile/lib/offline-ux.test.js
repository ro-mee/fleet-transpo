/**
 * Offline view-state logic tests (offline-ux.js) — the regression surface for
 * the 4-state offline UX. The resolveDriverId bug shipped because the logic
 * only ever lived in screens fed imagined shapes; these tests pin the actual
 * decision table, including the honesty rules:
 * - confirmed-empty keys off syncedAt (stamped even for []), not item count
 * - empty-unconfirmed is ONLINE (copy: "couldn't be confirmed", not
 *   "Connect once" — the device is connected)
 * - a screen is only confirmed empty when EVERY source was answered
 */
import { describe, it, expect } from "vitest";
import { offlineViewState, combineOfflineSources } from "./offline-ux";

describe("offlineViewState (single source)", () => {
  it("data: any items, note only when offline", () => {
    expect(offlineViewState({ offline: false, syncedAt: 1, itemCount: 3 })).toEqual({
      state: "data", confirmed: true, showSyncNote: false,
    });
    expect(offlineViewState({ offline: true, syncedAt: 1, itemCount: 3 })).toEqual({
      state: "data", confirmed: true, showSyncNote: true,
    });
    // Data present even without a stamped syncedAt (corrupt entry) is still data.
    expect(offlineViewState({ offline: true, syncedAt: null, itemCount: 1 }).state).toBe("data");
  });

  it("empty-confirmed: syncedAt non-null means the server answered, even for []", () => {
    expect(offlineViewState({ offline: false, syncedAt: 123, itemCount: 0 })).toEqual({
      state: "empty-confirmed", confirmed: true, showSyncNote: false,
    });
    expect(offlineViewState({ offline: true, syncedAt: 123, itemCount: 0 })).toEqual({
      state: "empty-confirmed", confirmed: true, showSyncNote: true,
    });
  });

  it("never-synced: offline with no server confirmation", () => {
    expect(offlineViewState({ offline: true, syncedAt: null, itemCount: 0 })).toEqual({
      state: "never-synced", confirmed: false, showSyncNote: false,
    });
    expect(offlineViewState({ offline: true, itemCount: 0 }).state).toBe("never-synced");
  });

  it("empty-unconfirmed: ONLINE and never answered — not 'never-synced'", () => {
    expect(offlineViewState({ offline: false, syncedAt: null, itemCount: 0 })).toEqual({
      state: "empty-unconfirmed", confirmed: false, showSyncNote: false,
    });
  });
});

describe("combineOfflineSources (multi-source)", () => {
  it("data when any source has items", () => {
    expect(combineOfflineSources(true, [
      { syncedAt: 1, itemCount: 0 },
      { syncedAt: null, itemCount: 2 },
    ])).toMatchObject({ state: "data", showSyncNote: true });
    expect(combineOfflineSources(false, [{ syncedAt: null, itemCount: 2 }]).showSyncNote).toBe(false);
  });

  it("empty-confirmed only when EVERY source was answered", () => {
    expect(combineOfflineSources(true, [
      { syncedAt: 1, itemCount: 0 },
      { syncedAt: 2, itemCount: 0 },
    ])).toMatchObject({ state: "empty-confirmed", confirmedCount: 2, showSyncNote: true });
  });

  it("partial: one source answered, one not — not a confirmed-empty claim", () => {
    const r = combineOfflineSources(true, [
      { syncedAt: 1, itemCount: 0 }, // submissions: server said []
      { syncedAt: null, itemCount: 0 }, // inspections: never answered
    ]);
    expect(r.state).toBe("partial");
    expect(r.confirmedCount).toBe(1);
    expect(r.showSyncNote).toBe(true);
  });

  it("never-synced offline / empty-unconfirmed online when no source is answered", () => {
    const none = [{ syncedAt: null, itemCount: 0 }, { syncedAt: null, itemCount: 0 }];
    expect(combineOfflineSources(true, none).state).toBe("never-synced");
    expect(combineOfflineSources(false, none).state).toBe("empty-unconfirmed");
  });

  it("handles edge inputs without throwing", () => {
    expect(combineOfflineSources(true).state).toBe("never-synced");
    expect(combineOfflineSources(true, []).state).toBe("never-synced");
    expect(combineOfflineSources(false, null).state).toBe("empty-unconfirmed");
    expect(combineOfflineSources(true, [null, undefined]).state).toBe("never-synced");
  });
});
