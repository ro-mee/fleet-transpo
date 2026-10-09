import { afterEach, describe, expect, it, vi } from "vitest";
import { createFuseCountdown } from "./fuse-countdown";

function createTimer(delay = 5000) {
  let now = 0;
  const onTick = vi.fn();
  const onExpire = vi.fn();
  const timer = createFuseCountdown({ delay, now: () => now, onTick, onExpire });

  return {
    timer,
    onTick,
    onExpire,
    advance(milliseconds) {
      now += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    },
  };
}

describe("createFuseCountdown", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for the full reconsideration window and expires only once", () => {
    vi.useFakeTimers();
    const { timer, onExpire, advance } = createTimer();

    expect(timer.start()).toBe(true);
    expect(timer.start()).toBe(false);
    advance(4999);
    expect(onExpire).not.toHaveBeenCalled();
    expect(timer.remaining).toBe(1);

    advance(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(timer.status).toBe("completed");
    expect(timer.cancel()).toBe(false);
  });

  it("retains only the remaining time across pause and resume", () => {
    vi.useFakeTimers();
    const { timer, onExpire, advance } = createTimer();

    timer.start();
    advance(1500);
    expect(timer.pause()).toBe(3500);
    advance(10000);
    expect(onExpire).not.toHaveBeenCalled();
    expect(timer.remaining).toBe(3500);

    expect(timer.resume()).toBe(true);
    advance(3499);
    expect(onExpire).not.toHaveBeenCalled();
    advance(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("cancels locally without firing after Undo", () => {
    vi.useFakeTimers();
    const { timer, onExpire, advance } = createTimer();

    timer.start();
    advance(2000);
    expect(timer.cancel()).toBe(true);
    expect(timer.status).toBe("cancelled");
    expect(timer.cancel()).toBe(false);
    advance(5000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("refuses Undo after the expiration boundary has committed", () => {
    vi.useFakeTimers();
    const { timer, onExpire, advance } = createTimer();

    timer.start();
    advance(5000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(timer.cancel()).toBe(false);
    expect(timer.status).toBe("completed");
  });
});
