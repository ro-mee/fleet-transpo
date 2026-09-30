import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY_PREFIX = "fleetops_audit_license_views:";
const MAX_QUEUE = 100;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function createLicenseViewEventKey() {
  const bytes = new Uint8Array(16);
  try {
    globalThis.crypto?.getRandomValues?.(bytes);
  } catch {}
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function storageKey(employeeId) {
  return employeeId == null ? null : `${KEY_PREFIX}${String(employeeId)}`;
}

async function readQueue(employeeId) {
  const key = storageKey(employeeId);
  if (!key) return [];
  try {
    const raw = await AsyncStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - MAX_AGE_MS;
    return parsed.filter((event) => event && typeof event.event_key === "string" && Number.isSafeInteger(Number(event.driver_id)) && Number(event.driver_id) > 0 && Number.isFinite(Date.parse(event.observed_at)) && Date.parse(event.observed_at) >= cutoff);
  } catch {
    return [];
  }
}

export async function getPendingLicenseViewCount(employeeId) {
  return (await readQueue(employeeId)).length;
}

export async function listLicenseViewEvents(employeeId) {
  return readQueue(employeeId);
}

export async function enqueueLicenseView(employeeId, event) {
  const key = storageKey(employeeId);
  if (!key || !event?.event_key || !Number.isSafeInteger(Number(event.driver_id)) || Number(event.driver_id) <= 0) return { count: 0, dropped: 0 };
  const current = await readQueue(employeeId);
  if (current.some((item) => item.event_key === event.event_key)) return { count: current.length, dropped: 0 };
  const next = [...current, event];
  const dropped = Math.max(0, next.length - MAX_QUEUE);
  const bounded = next.slice(-MAX_QUEUE);
  try { await AsyncStorage.setItem(key, JSON.stringify(bounded)); } catch { return { count: current.length, dropped: 1 }; }
  return { count: bounded.length, dropped };
}

export async function removeLicenseViewEvents(employeeId, eventKeys) {
  const key = storageKey(employeeId);
  if (!key) return 0;
  const removals = new Set(eventKeys || []);
  const next = (await readQueue(employeeId)).filter((event) => !removals.has(event.event_key));
  try {
    if (next.length) await AsyncStorage.setItem(key, JSON.stringify(next));
    else await AsyncStorage.removeItem(key);
    return next.length;
  } catch {
    return (await readQueue(employeeId)).length;
  }
}
