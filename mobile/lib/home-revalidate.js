const HOME_STALE_MS = 30_000;
export function shouldRevalidateHome(lastSyncedAtMs, nowMs = Date.now()) {
  if (lastSyncedAtMs == null) return true;
  return nowMs - lastSyncedAtMs >= HOME_STALE_MS;
}
