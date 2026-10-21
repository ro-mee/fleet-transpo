import AsyncStorage from "@react-native-async-storage/async-storage";
import { ALL_COACH_MARK_KEYS, getMilestoneConfig } from "./coach-marks";
import { listDriverGuides } from './driver-guides';
import { guideProgressKey, isGuideSuppressed } from './driver-guide-progress';

/**
 * Builds a versioned, driver-scoped storage key for a coach mark milestone.
 * Format: fleetops.guide.<milestoneKey>.v<version>_<driverId>
 *
 * @param {string} milestoneKey
 * @param {number} version
 * @param {string|number|null} driverId
 * @returns {string}
 */
export function getCoachMarkStorageKey(milestoneKey, version = 1, driverId = null) {
  const cleanKey = String(milestoneKey || "").trim().toLowerCase();
  const base = `fleetops.guide.${cleanKey}.v${version}`;
  return driverId != null ? `${base}_${driverId}` : base;
}

/**
 * Checks if a specific coach mark milestone has already been completed by this driver.
 *
 * @param {string} milestoneKey
 * @param {number} version
 * @param {string|number|null} driverId
 * @returns {Promise<boolean>}
 */
export async function isCoachMarkCompleted(milestoneKey, version = 1, driverId = null) {
  try {
    const key = getCoachMarkStorageKey(milestoneKey, version, driverId);
    const value = await AsyncStorage.getItem(key);
    return value === "true" || value === "completed";
  } catch {
    return false;
  }
}

/**
 * Marks a coach mark milestone as completed for this driver.
 *
 * @param {string} milestoneKey
 * @param {number} version
 * @param {string|number|null} driverId
 * @returns {Promise<boolean>}
 */
export async function setCoachMarkCompleted(milestoneKey, version = 1, driverId = null) {
  try {
    const key = getCoachMarkStorageKey(milestoneKey, version, driverId);
    await AsyncStorage.setItem(key, "completed");
    return true;
  } catch {
    return false;
  }
}

/**
 * Resets a single coach mark milestone for this driver.
 *
 * @param {string} milestoneKey
 * @param {number} version
 * @param {string|number|null} driverId
 * @returns {Promise<boolean>}
 */
export async function resetCoachMark(milestoneKey, version = 1, driverId = null) {
  try {
    const key = getCoachMarkStorageKey(milestoneKey, version, driverId);
    await AsyncStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resets all known contextual coach marks for this driver.
 * Used by "Reset In-App Tips" in Help & Support.
 *
 * @param {string|number|null} driverId
 * @returns {Promise<boolean>}
 */
export async function resetAllCoachMarks(driverId = null) {
  try {
    const keysToRemove = ALL_COACH_MARK_KEYS.map((k) => {
      const config = getMilestoneConfig(k);
      return getCoachMarkStorageKey(k, config?.version || 1, driverId);
    });
    await AsyncStorage.multiRemove(keysToRemove);
    return true;
  } catch {
    return false;
  }
}

const guideWrites = new Map();
const currentScope = scope => !scope.isCurrent || scope.isCurrent();
function validGuideRecord(record) {
  return record && Object.keys(record).every(key => ['status', 'updatedAt', 'source'].includes(key)) &&
    ['seen', 'dismissed', 'completed'].includes(record.status) &&
    Number.isFinite(record.updatedAt) && record.updatedAt >= 0 &&
    ['guide', 'legacy_unknown_outcome'].includes(record.source);
}

function serializeGuideWrite(key, action) {
  const next = (guideWrites.get(key) || Promise.resolve()).then(action).catch(() => false);
  guideWrites.set(key, next);
  void next.then(() => { if (guideWrites.get(key) === next) guideWrites.delete(key); });
  return next;
}

export async function readGuideProgress(scope) {
  try {
    const key = guideProgressKey(scope);
    await guideWrites.get(key);
    if (!currentScope(scope)) return { available: false, record: null };
    const raw = await AsyncStorage.getItem(key);
    if (!currentScope(scope)) return { available: false, record: null };
    const record = raw === null ? null : JSON.parse(raw);
    if (record !== null && !validGuideRecord(record)) throw new Error('Invalid stored guide progress');
    return { available: true, record };
  } catch {
    return { available: false, record: null };
  }
}

export async function writeGuideProgress(scope, record) {
  try {
    const key = guideProgressKey(scope);
    if (!validGuideRecord(record)) return false;
    return await serializeGuideWrite(key, async () => {
      if (!currentScope(scope)) return false;
      const raw = await AsyncStorage.getItem(key);
      if (!currentScope(scope)) return false;
      const previous = raw === null ? null : JSON.parse(raw);
      if (record.status === 'seen' && isGuideSuppressed(previous)) return true;
      await AsyncStorage.setItem(key, JSON.stringify(record));
      return currentScope(scope);
    });
  } catch { return false; }
}

export async function resetGuideProgress(scope) {
  try {
    const key = guideProgressKey(scope);
    return await serializeGuideWrite(key, async () => {
      if (!currentScope(scope)) return false;
      await AsyncStorage.removeItem(key);
      return currentScope(scope);
    });
  } catch { return false; }
}

export async function resetDriverGuideProgress(actorId) {
  const guides = [...listDriverGuides('passenger'), ...listDriverGuides('cargo')];
  const scopes = new Map(guides.map(guide => {
    const scope = { actorId, guideId: guide.id, variant: guide.variant, version: guide.version };
    return [guideProgressKey(scope), scope];
  }));
  const results = await Promise.all([...scopes.values()].map(resetGuideProgress));
  return results.every(Boolean);
}
