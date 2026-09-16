import AsyncStorage from "@react-native-async-storage/async-storage";
import { ALL_COACH_MARK_KEYS, getMilestoneConfig } from "./coach-marks";

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
