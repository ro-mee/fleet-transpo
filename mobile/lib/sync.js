import AsyncStorage from '@react-native-async-storage/async-storage';

// api.js injects itself here after it initialises to break the circular
// dependency (api → sync → api). Never import api.js directly from this file.
let _apiFetch = null;
export function setApiFetch(fn) { _apiFetch = fn; }

const QUEUE_KEY = '@offline_queue';
let isSyncing = false;

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
          // Permanent backend error — drop from queue to avoid infinite loop
          console.error(`[Sync] Permanent failure syncing ${req.path}:`, err);
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
