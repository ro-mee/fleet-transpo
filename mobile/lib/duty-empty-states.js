/**
 * FleetOps Driver Companion — Duty-Aware Empty States
 * Central dictionary and resolver for non-operational states across Map, Trips, and Home tabs.
 */

export const DUTY_EMPTY_STATES = {
  off_duty: {
    key: "off_duty",
    statusPill: "OFF DUTY",
    mapTitle: "You’re Off Duty",
    mapDescription: "Live trip tracking becomes available when you start your shift.",
    tripsTitle: "You’re Off Duty",
    tripsDescription: "Trip queue will activate once your shift begins.",
    homeTitle: "You’re Off Duty",
    homeDescription: "Start your shift via Pre-Shift inspection when ready.",
    iconType: "off_duty",
  },
  rest_day: {
    key: "rest_day",
    statusPill: "REST DAY",
    mapTitle: "Today is Your Rest Day",
    mapDescription: "No operational map or trip tracking is needed today.",
    tripsTitle: "Today is Your Rest Day",
    tripsDescription: "No operational trips are scheduled for you today.",
    homeTitle: "Today is Your Rest Day",
    homeDescription: "No shifts scheduled today. Enjoy your day off!",
    iconType: "rest_day",
  },
  on_leave: {
    key: "on_leave",
    statusPill: "ON LEAVE",
    mapTitle: "You’re Currently on Leave",
    mapDescription: "Live trip tracking will be available when you return to active duty.",
    tripsTitle: "You’re Currently on Leave",
    tripsDescription: "Trip assignments will resume when you return to active duty.",
    homeTitle: "You’re Currently on Leave",
    homeDescription: "Dispatch is paused during your approved leave.",
    iconType: "on_leave",
  },
};

// Aliases for Map-specific dictionary compatibility
export const MAP_EMPTY_STATES = {
  off_duty: {
    key: "off_duty",
    statusPill: DUTY_EMPTY_STATES.off_duty.statusPill,
    title: DUTY_EMPTY_STATES.off_duty.mapTitle,
    description: DUTY_EMPTY_STATES.off_duty.mapDescription,
    iconType: "off_duty",
  },
  rest_day: {
    key: "rest_day",
    statusPill: DUTY_EMPTY_STATES.rest_day.statusPill,
    title: DUTY_EMPTY_STATES.rest_day.mapTitle,
    description: DUTY_EMPTY_STATES.rest_day.mapDescription,
    iconType: "rest_day",
  },
  on_leave: {
    key: "on_leave",
    statusPill: DUTY_EMPTY_STATES.on_leave.statusPill,
    title: DUTY_EMPTY_STATES.on_leave.mapTitle,
    description: DUTY_EMPTY_STATES.on_leave.mapDescription,
    iconType: "on_leave",
  },
};

/**
 * Resolves whether the driver is in a non-operational state (On Leave, Rest Day, or Off Duty)
 * or active on duty (returns null).
 */
export function resolveDutyEmptyState({ duty, profile, user, paramStatus, activeTrip } = {}) {
  // Direct override via route query parameters for tests & previews
  if (paramStatus) {
    const clean = String(paramStatus).toLowerCase().trim().replace(/[-_\s]+/g, "");
    if (clean === "offduty") return "off_duty";
    if (clean === "restday") return "rest_day";
    if (clean === "onleave" || clean === "leave") return "on_leave";
  }

  // Active in-progress trip always displays operational map / active queue
  if (activeTrip != null) return null;

  // 1. Evaluate "Currently on Leave"
  const isLeave =
    profile?.driverStatus === "On Leave" ||
    user?.driver_status === "On Leave" ||
    user?.status === "On Leave" ||
    (duty?.loaded && duty?.today?.blocked && duty?.today?.reason?.toLowerCase().includes("leave"));
  if (isLeave) return "on_leave";

  // 2. Evaluate "Rest Day"
  const isRestDay =
    profile?.driverStatus === "Rest Day" ||
    (duty?.loaded && duty?.today?.blocked && duty?.today?.reason?.toLowerCase().includes("rest day"));
  if (isRestDay) return "rest_day";

  // 3. Evaluate "Off Duty"
  const isOffDuty =
    profile?.driverStatus === "Off Duty" ||
    user?.driver_status === "Off Duty" ||
    user?.status === "Off Duty" ||
    (duty?.loaded && !duty.checkedIn);
  if (isOffDuty) return "off_duty";

  // Active operational state (on duty)
  return null;
}

export const resolveMapEmptyState = resolveDutyEmptyState;
