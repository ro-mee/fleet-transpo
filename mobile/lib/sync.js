import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';

const QUEUE_KEY = '@offline_queue';
let isSyncing = false;

/**
 * Add a failed request to the offline queue
 */
export async function enqueueRequest(method, path, body) {
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
    console.error("[Sync] Failed to enqueue request", error);
  }
}

/**
 * Drain the offline queue and send all pending requests
 */
export async function syncQueue() {
  if (isSyncing) return;
  
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
        await apiFetch(req.path, {
          method: req.method,
          // Only stringify if it exists and is not already a string, though we store body directly in the queue object
          body: req.body ? JSON.stringify(req.body) : undefined,
          // Let's pass a skipAuth or similar if needed, but apiFetch handles token natively.
        });
        console.log(`[Sync] Successfully synced ${req.method} ${req.path}`);
      } catch (err) {
        // If it fails due to network again, keep it in the queue
        if (err.message && err.message.includes("Network request failed")) {
          console.log(`[Sync] Network still down for ${req.path}, keeping in queue.`);
          remainingQueue.push(req);
        } else {
          // If it fails with a 400/500 backend error, it's a permanent failure for this request.
          // We drop it from the queue so we don't get stuck in an infinite loop.
          console.error(`[Sync] Permanent failure syncing ${req.path}:`, err);
        }
      }
    }
    
    // Save any remaining items back to the queue
    if (remainingQueue.length !== queue.length) {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    }
    
  } catch (error) {
    console.error("[Sync] Error during sync processing", error);
  } finally {
    isSyncing = false;
  }
}
