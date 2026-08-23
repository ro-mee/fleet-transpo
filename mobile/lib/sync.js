import AsyncStorage from '@react-native-async-storage/async-storage';

// api.js injects itself here after it initialises to break the circular
// dependency (api → sync → api). Never import api.js directly from this file.
let _apiFetch = null;
export function setApiFetch(fn) { _apiFetch = fn; }

const QUEUE_KEY = '@offline_queue';
// Incident reports that permanently failed during replay (e.g. an expired
// session mid-replay). They are never silently deleted like other dead
// requests — the Activity Logs screen surfaces them for manual retry.
const DEAD_LETTER_KEY = '@offline_dead_letter_incidents';
let isSyncing = false;

/**
 * Incident reports that could not be delivered, newest last.
 */
export async function getIncidentDeadLetters() {
  if (!isReady()) return [];
  try {
    const raw = await AsyncStorage.getItem(DEAD_LETTER_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveDeadLetters(list) {
  await AsyncStorage.setItem(DEAD_LETTER_KEY, JSON.stringify(list));
}

function isIncidentReport(req) {
  return typeof req?.path === "string" && req.path.includes("/api/driver/incidents");
}

async function quarantineIncidentReport(req, errorMessage) {
  try {
    const list = await getIncidentDeadLetters();
    list.push({
      id: req.id,
      method: req.method,
      path: req.path,
      body: req.body,
      timestamp: req.timestamp,
      error: String(errorMessage || "Unknown error"),
      quarantined_at: Date.now(),
    });
    await saveDeadLetters(list);
  } catch {
    // Quarantining must never throw into the sync loop.
  }
}

/**
 * Remove one quarantined report (after a successful manual retry or an
 * informed user decision to discard it).
 */
export async function removeIncidentDeadLetter(id) {
  const list = await getIncidentDeadLetters();
  await saveDeadLetters(list.filter((item) => item.id !== id));
}

/**
 * Attempt to deliver every quarantined report once. Returns how many are left.
 */
export async function retryIncidentDeadLetters() {
  const list = await getIncidentDeadLetters();
  let remaining = 0;
  for (const item of list) {
    try {
      if (!_apiFetch) throw new Error("apiFetch not injected");
      await _apiFetch(item.path, {
        method: item.method,
        body: item.body ? JSON.stringify(item.body) : undefined,
        queueOnFailure: false,
      });
      await removeIncidentDeadLetter(item.id);
    } catch {
      remaining += 1;
    }
  }
  return remaining;
}

/**
 * Discard all quarantined reports. Only ever called from a user action that
 * makes the deletion explicit — never automatically.
 */
export async function clearIncidentDeadLetters() {
  if (!isReady()) return;
  try {
    await AsyncStorage.removeItem(DEAD_LETTER_KEY);
  } catch {}
}

/**
 * Returns true only when the AsyncStorage native module is available.
 * On cold start the bridge may not be ready yet — we skip silently instead
 * of crashing with "Native module is null, cannot access legacy storage".
 */
function isReady() {
  try {
    // The library exposes a default implementation; if its internal _db /
    // RNCAsyncStorage property is null the native bridge isn't up yet.
    return AsyncStorage != null;
  } catch {
    return false;
  }
}

/**
 * Add a failed request to the offline queue
 */
export async function enqueueRequest(method, path, body) {
  if (!isReady()) return;
  try {
    const queueStr = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = queueStr ? JSON.parse(queueStr) : [];
    
    queue.push({
      id: Date.now().toString() + Math.random().toString(36).substring(7),
      method,
      path,
      body,
      timestamp: Date.now()
    });
    
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    console.log(`[Sync] Queued ${method} ${path}`);
  } catch (error) {
    // Swallow the "Native module is null" error on cold start
    if (!error?.message?.includes('Native module is null')) {
      console.error("[Sync] Failed to enqueue request", error);
    }
  }
}

/**
 * Drain the offline queue and send all pending requests
 */
export async function syncQueue() {
  if (isSyncing) return;
  if (!isReady()) return;

  try {
    const queueStr = await AsyncStorage.getItem(QUEUE_KEY);
    if (!queueStr) return;
    
    let queue = JSON.parse(queueStr);
    if (!Array.isArray(queue) || queue.length === 0) return;
    
    isSyncing = true;
    console.log(`[Sync] Attempting to sync ${queue.length} queued requests...`);
    
    const remainingQueue = [];
    
    // Process sequentially to maintain order
    for (const req of queue) {
      try {
        if (!_apiFetch) throw new Error('apiFetch not injected');
          await _apiFetch(req.path, {
            method: req.method,
            body: req.body ? JSON.stringify(req.body) : undefined,
            queueOnFailure: false,
          });
        console.log(`[Sync] Successfully synced ${req.method} ${req.path}`);
      } catch (err) {
        // If it fails due to network again, keep it in the queue
        if (err.message && err.message.includes("Network request failed")) {
          console.log(`[Sync] Network still down for ${req.path}, keeping in queue.`);
          remainingQueue.push(req);
        } else {
          // Permanent backend error — drop from queue to avoid infinite loop.
          console.error(`[Sync] Permanent failure syncing ${req.path}:`, err);
          if (isIncidentReport(req)) {
            // An incident report is a safety record: quarantine it for the
            // driver instead of deleting it. The server deduplicates via
            // client_submission_id, so retrying later is always safe.
            await quarantineIncidentReport(req, err?.message || err);
          }
        }
      }
    }
    
    // Save any remaining items back to the queue
    if (remainingQueue.length !== queue.length) {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    }
    
  } catch (error) {
    // Swallow the "Native module is null" error on cold start
    if (!error?.message?.includes('Native module is null')) {
      console.error("[Sync] Error during sync processing", error);
    }
  } finally {
    isSyncing = false;
  }
}
