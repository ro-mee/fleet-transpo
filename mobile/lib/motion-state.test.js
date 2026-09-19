import { describe, it, expect } from "vitest";
import {
  MOVING_THRESHOLD_KMH,
  MOVING_THRESHOLD_MS,
  MOVING_HOLD_MS,
  createMotionState,
  recordFix,
  isDrivingAt,
} from "./motion-state";

const T0 = 1_700_000_000_000; // fixed epoch so nothing depends on wall clock

/** Folds a list of [speedMs, atMs] fixes into a state. */
function fold(fixes, from = createMotionState()) {
  return fixes.reduce(
    (state, [speedMs, atMs]) => recordFix(state, { speedMs, atMs }),
    from
  );
}

describe("Motion threshold units", () => {
  it("converts the 10 km/h policy into the m/s that coords.speed reports", () => {
    // The gate is specified in km/h but measured in m/s. Dropping the /3.6
    // would silently move the lock to 36 km/h.
    expect(MOVING_THRESHOLD_KMH).toBe(10);
    expect(MOVING_THRESHOLD_MS).toBeCloseTo(2.7778, 3);
    expect(MOVING_THRESHOLD_MS).toBeLessThan(3);
  });
});

describe("Motion detection from GPS speed", () => {
  it("treats a 10 km/h fix as moving and anything below as stationary", () => {
    // 2.7 m/s = 9.72 km/h — just under the policy.
    const under = fold([[2.7, T0]]);
    expect(under.lastMovingAt).toBeNull();
    expect(isDrivingAt(under, T0)).toBe(false);

    // 2.8 m/s = 10.08 km/h — just over it.
    const over = fold([[2.8, T0]]);
    expect(over.lastMovingAt).toBe(T0);
    expect(isDrivingAt(over, T0)).toBe(true);
  });

  it("treats exactly the threshold as moving (inclusive bound)", () => {
    const at = fold([[MOVING_THRESHOLD_MS, T0]]);
    expect(isDrivingAt(at, T0)).toBe(true);
  });

  it("never counts a missing or unusable speed as motion", () => {
    // Fail-open: no permission, tracking off, or a cold start with no fix yet
    // must not silently disable the whole in-app guide.
    expect(isDrivingAt(fold([[null, T0]]), T0)).toBe(false);
    expect(isDrivingAt(fold([[undefined, T0]]), T0)).toBe(false);
    expect(isDrivingAt(fold([[NaN, T0]]), T0)).toBe(false);
    expect(isDrivingAt(createMotionState(), T0)).toBe(false);
    expect(isDrivingAt(null, T0)).toBe(false);
  });

  it("records the fix time even when the speed is unusable", () => {
    const state = fold([[null, T0]]);
    expect(state.lastFixAt).toBe(T0);
    expect(state.speedMs).toBeNull();
  });
});

describe("Motion hold window", () => {
  it("stays driving for the whole hold, then releases", () => {
    const state = fold([[20, T0]]); // 72 km/h

    expect(isDrivingAt(state, T0 + MOVING_HOLD_MS - 1)).toBe(true);
    expect(isDrivingAt(state, T0 + MOVING_HOLD_MS)).toBe(false);
    expect(isDrivingAt(state, T0 + MOVING_HOLD_MS + 60_000)).toBe(false);
  });

  it("does NOT release on a later stationary fix — that is the point of the hold", () => {
    // Driving, then stopped at a red light 30 s later. A latest-fix-only check
    // would un-suppress tips mid-route here.
    const state = fold([
      [20, T0],
      [0, T0 + 30_000],
    ]);

    expect(state.lastMovingAt).toBe(T0);
    expect(isDrivingAt(state, T0 + 30_000)).toBe(true);
    expect(isDrivingAt(state, T0 + MOVING_HOLD_MS - 1)).toBe(true);
  });

  it("extends the hold when the vehicle keeps moving", () => {
    const state = fold([
      [20, T0],
      [25, T0 + 90_000],
    ]);

    expect(state.lastMovingAt).toBe(T0 + 90_000);
    // The first fix's hold would have expired here; the second one's has not.
    expect(isDrivingAt(state, T0 + MOVING_HOLD_MS + 1000)).toBe(true);
    expect(isDrivingAt(state, T0 + 90_000 + MOVING_HOLD_MS)).toBe(false);
  });

  it("survives a GPS gap without releasing, because nothing clears it", () => {
    // No fixes at all between T0 and T0+100s (tunnel). The hold is time-based,
    // so it is still running — only MOVING_HOLD_MS of silence ends it.
    const state = fold([[20, T0]]);
    expect(isDrivingAt(state, T0 + 100_000)).toBe(true);
  });

  it("is false for a non-finite clock reading rather than throwing", () => {
    const state = fold([[20, T0]]);
    expect(isDrivingAt(state, NaN)).toBe(false);
    expect(isDrivingAt(state, undefined)).toBe(false);
  });
});

describe("recordFix purity", () => {
  it("returns a new state and never mutates the input", () => {
    const before = createMotionState();
    const after = recordFix(before, { speedMs: 20, atMs: T0 });

    expect(after).not.toBe(before);
    expect(before.lastMovingAt).toBeNull();
    expect(before.lastFixAt).toBeNull();
    expect(after.lastMovingAt).toBe(T0);
  });
});
