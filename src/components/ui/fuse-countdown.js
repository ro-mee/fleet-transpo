/** Monotonic, pausable countdown for reconsiderable actions. */
export function createFuseCountdown({
  delay,
  onTick = () => {},
  onExpire = () => {},
  now = () => performance.now(),
  scheduleInterval = (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
  clearInterval = (timer) => globalThis.clearInterval(timer),
  scheduleTimeout = (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clearTimeout = (timer) => globalThis.clearTimeout(timer),
  tickMs = 80,
}) {
  let remaining = Math.max(0, delay);
  let deadline = 0;
  let status = "idle";
  let intervalId = null;
  let timeoutId = null;

  const clearScheduled = () => {
    if (intervalId !== null) clearInterval(intervalId);
    if (timeoutId !== null) clearTimeout(timeoutId);
    intervalId = null;
    timeoutId = null;
  };

  const finish = () => {
    if (status !== "running") return false;
    remaining = 0;
    clearScheduled();
    status = "completed";
    onTick(0);
    onExpire();
    return true;
  };

  const update = () => {
    if (status !== "running") return;
    remaining = Math.max(0, deadline - now());
    onTick(remaining);
    if (remaining === 0) finish();
  };

  const schedule = () => {
    status = "running";
    deadline = now() + remaining;
    intervalId = scheduleInterval(update, tickMs);
    timeoutId = scheduleTimeout(finish, remaining);
  };

  return {
    start() {
      if (status !== "idle") return false;
      schedule();
      return true;
    },
    pause() {
      if (status !== "running") return remaining;
      remaining = Math.max(0, deadline - now());
      if (remaining === 0) {
        finish();
        return 0;
      }
      clearScheduled();
      status = "paused";
      onTick(remaining);
      return remaining;
    },
    resume() {
      if (status !== "paused") return false;
      if (remaining === 0) {
        status = "running";
        finish();
        return true;
      }
      schedule();
      return true;
    },
    cancel() {
      if (status === "completed" || status === "cancelled") return false;
      clearScheduled();
      status = "cancelled";
      return true;
    },
    get remaining() {
      return status === "running" ? Math.max(0, deadline - now()) : remaining;
    },
    get status() {
      return status;
    },
  };
}
