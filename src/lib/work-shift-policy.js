// Pure defaults, normalization, and validation for FleetOps Operating Hours & Shift Policy.
// No DB imports, no React dependencies.
//
// Stored in `system_settings` under the key 'work_shift_policy'.
// Defines standard organizational work/shift hours, break periods, staggered break rotations,
// and distributed rest days for drivers and fleet operations.

export const DEFAULT_BREAK_SLOTS = [
  { breakStart: "11:30", breakEnd: "12:30", label: "Early Lunch (11:30 AM – 12:30 PM)" },
  { breakStart: "12:00", breakEnd: "13:00", label: "Standard Lunch (12:00 PM – 1:00 PM)" },
  { breakStart: "12:30", breakEnd: "13:30", label: "Mid Lunch (12:30 PM – 1:30 PM)" },
  { breakStart: "13:00", breakEnd: "14:00", label: "Late Lunch (1:00 PM – 2:00 PM)" },
];

export const DEFAULT_WORK_SHIFT_POLICY = {
  shiftStart: "06:00",
  shiftEnd: "22:00",
  breakStart: "12:00",
  breakEnd: "13:00",
  workingDays: [1, 2, 3, 4, 5, 6], // Monday through Saturday (0 = Sunday rest day)
  staggerBreaks: true, // Auto-stagger break times across drivers for continuous noon coverage
  staggerRestDays: true, // Auto-distribute rest days across drivers for 7-day fleet readiness
  breakSlots: DEFAULT_BREAK_SLOTS,
  label: "Standard Fleet Shift",
};

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/**
 * Normalizes a time string to "HH:MM" 24-hour format.
 * Returns `fallback` if invalid.
 */
export function normalizeTime(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const match = value.trim().match(TIME_RE);
  if (!match) return fallback;
  const hour = String(Number(match[1])).padStart(2, "0");
  const minute = String(Number(match[2])).padStart(2, "0");
  return `${hour}:${minute}`;
}

/**
 * Validates a work shift policy candidate object.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export function validateWorkShiftPolicy(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, error: "Policy must be an object." };
  }

  const shiftStart = normalizeTime(candidate.shiftStart);
  const shiftEnd = normalizeTime(candidate.shiftEnd);

  if (!shiftStart) {
    return { ok: false, error: "A valid shift start time (HH:MM) is required." };
  }
  if (!shiftEnd) {
    return { ok: false, error: "A valid shift end time (HH:MM) is required." };
  }
  if (shiftStart >= shiftEnd) {
    return { ok: false, error: "Shift end time must be after shift start time." };
  }

  const hasBreakStart = Boolean(candidate.breakStart);
  const hasBreakEnd = Boolean(candidate.breakEnd);

  if (hasBreakStart !== hasBreakEnd) {
    return { ok: false, error: "Provide both break start and break end times, or neither." };
  }

  if (hasBreakStart && hasBreakEnd) {
    const breakStart = normalizeTime(candidate.breakStart);
    const breakEnd = normalizeTime(candidate.breakEnd);

    if (!breakStart || !breakEnd) {
      return { ok: false, error: "Break times must be valid HH:MM formats." };
    }
    if (breakStart >= breakEnd) {
      return { ok: false, error: "Break end time must be after break start time." };
    }
    if (breakStart < shiftStart || breakEnd > shiftEnd) {
      return { ok: false, error: "Break period must sit within the shift hours." };
    }
  }

  if (candidate.workingDays !== undefined) {
    if (!Array.isArray(candidate.workingDays)) {
      return { ok: false, error: "workingDays must be an array of weekday numbers (0–6)." };
    }
    const cleanDays = candidate.workingDays
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const uniqueDays = [...new Set(cleanDays)];
    if (uniqueDays.length === 0) {
      return { ok: false, error: "Select at least one active working day." };
    }
  }

  return { ok: true };
}

/**
 * Merges a stored policy object over the default values, guaranteeing all fields exist
 * and hold valid sanitized values.
 */
export function mergeWorkShiftPolicy(stored) {
  const s = stored || {};

  const shiftStart = normalizeTime(s.shiftStart, DEFAULT_WORK_SHIFT_POLICY.shiftStart);
  const shiftEnd = normalizeTime(s.shiftEnd, DEFAULT_WORK_SHIFT_POLICY.shiftEnd);

  let breakStart = s.breakStart === undefined
    ? DEFAULT_WORK_SHIFT_POLICY.breakStart
    : s.breakStart ? normalizeTime(s.breakStart, DEFAULT_WORK_SHIFT_POLICY.breakStart) : null;

  let breakEnd = s.breakEnd === undefined
    ? DEFAULT_WORK_SHIFT_POLICY.breakEnd
    : s.breakEnd ? normalizeTime(s.breakEnd, DEFAULT_WORK_SHIFT_POLICY.breakEnd) : null;

  // If one is missing or invalid order, fallback safely
  if (breakStart && breakEnd) {
    if (breakStart >= breakEnd || breakStart < shiftStart || breakEnd > shiftEnd) {
      breakStart = DEFAULT_WORK_SHIFT_POLICY.breakStart >= shiftStart && DEFAULT_WORK_SHIFT_POLICY.breakEnd <= shiftEnd
        ? DEFAULT_WORK_SHIFT_POLICY.breakStart : null;
      breakEnd = breakStart ? DEFAULT_WORK_SHIFT_POLICY.breakEnd : null;
    }
  } else if (breakStart || breakEnd) {
    breakStart = null;
    breakEnd = null;
  }

  let workingDays = DEFAULT_WORK_SHIFT_POLICY.workingDays;
  if (Array.isArray(s.workingDays)) {
    const valid = s.workingDays
      .map(Number)
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (valid.length > 0) {
      workingDays = [...new Set(valid)].sort((a, b) => a - b);
    }
  }

  let breakSlots = DEFAULT_BREAK_SLOTS;
  if (Array.isArray(s.breakSlots) && s.breakSlots.length > 0) {
    const validSlots = s.breakSlots
      .map((slot) => {
        const start = normalizeTime(slot.breakStart);
        const end = normalizeTime(slot.breakEnd);
        if (start && end && start < end) {
          return {
            breakStart: start,
            breakEnd: end,
            label: slot.label || `${start} – ${end}`,
          };
        }
        return null;
      })
      .filter(Boolean);
    if (validSlots.length > 0) {
      breakSlots = validSlots;
    }
  }

  return {
    shiftStart: shiftStart < shiftEnd ? shiftStart : DEFAULT_WORK_SHIFT_POLICY.shiftStart,
    shiftEnd: shiftStart < shiftEnd ? shiftEnd : DEFAULT_WORK_SHIFT_POLICY.shiftEnd,
    breakStart,
    breakEnd,
    workingDays,
    staggerBreaks: s.staggerBreaks !== undefined ? Boolean(s.staggerBreaks) : DEFAULT_WORK_SHIFT_POLICY.staggerBreaks,
    staggerRestDays: s.staggerRestDays !== undefined ? Boolean(s.staggerRestDays) : DEFAULT_WORK_SHIFT_POLICY.staggerRestDays,
    breakSlots,
    label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : DEFAULT_WORK_SHIFT_POLICY.label,
  };
}

/**
 * Computes a driver's 7-day schedule (days 0 to 6) based on policy, driver rotation index,
 * and staggering preferences.
 *
 * @param {object} policy
 * @param {number} driverIndex integer 0..N
 * @param {object} [opts]
 * @param {boolean} [opts.staggerBreaks] rotate lunch break slots across drivers
 * @param {boolean} [opts.staggerRestDays] distribute rest days across drivers (e.g. driver 0 on Sun, 1 on Mon, etc.)
 */
export function buildDriverWeeklySchedule(policy, driverIndex = 0, {
  staggerBreaks = policy.staggerBreaks ?? true,
  staggerRestDays = policy.staggerRestDays ?? true,
} = {}) {
  const merged = mergeWorkShiftPolicy(policy);
  const slots = merged.breakSlots.filter((slot) => slot.breakStart >= merged.shiftStart && slot.breakEnd <= merged.shiftEnd);

  // Staggered break rotation (round-robin)
  const chosenSlot = staggerBreaks && slots.length
    ? slots[driverIndex % slots.length]
    : { breakStart: merged.breakStart, breakEnd: merged.breakEnd };

  // Staggered rest day rotation across 7 days: driver 0 rests day 0 (Sun), driver 1 rests day 1 (Mon), etc.
  const restDayForDriver = driverIndex % 7;

  const shiftStart = merged.shiftStart.length === 5 ? `${merged.shiftStart}:00` : merged.shiftStart;
  const shiftEnd = merged.shiftEnd.length === 5 ? `${merged.shiftEnd}:00` : merged.shiftEnd;
  const breakStart = chosenSlot.breakStart
    ? (chosenSlot.breakStart.length === 5 ? `${chosenSlot.breakStart}:00` : chosenSlot.breakStart)
    : null;
  const breakEnd = chosenSlot.breakEnd
    ? (chosenSlot.breakEnd.length === 5 ? `${chosenSlot.breakEnd}:00` : chosenSlot.breakEnd)
    : null;

  return Array.from({ length: 7 }, (_, dow) => {
    let isRest;
    if (staggerRestDays) {
      isRest = dow === restDayForDriver;
    } else {
      isRest = !merged.workingDays.includes(dow);
    }

    return {
      day_of_week: dow,
      is_rest_day: isRest,
      shift_start: isRest ? "00:00:00" : shiftStart,
      shift_end: isRest ? "00:00:00" : shiftEnd,
      break_start: isRest ? null : breakStart,
      break_end: isRest ? null : breakEnd,
    };
  });
}
