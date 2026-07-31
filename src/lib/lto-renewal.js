/**
 * Philippine LTO Vehicle Registration Renewal Calculator
 *
 * LTO Renewal Rules:
 * Monthly Schedule (Last Numeric Digit of Plate Number):
 * 1 -> January
 * 2 -> February
 * 3 -> March
 * 4 -> April
 * 5 -> May
 * 6 -> June
 * 7 -> July
 * 8 -> August
 * 9 -> September
 * 0 -> October
 *
 * Weekly Schedule (Second-to-Last Numeric Digit of Plate Number):
 * 1, 2, 3 -> 1st to 7th day (Week 1)
 * 4, 5, 6 -> 8th to 14th day (Week 2)
 * 7, 8    -> 15th to 21st day (Week 3)
 * 9, 0    -> 22nd to Last Day (Week 4)
 */

export const LTO_MONTHS = {
  1: { name: "January", monthIndex: 0 },
  2: { name: "February", monthIndex: 1 },
  3: { name: "March", monthIndex: 2 },
  4: { name: "April", monthIndex: 3 },
  5: { name: "May", monthIndex: 4 },
  6: { name: "June", monthIndex: 5 },
  7: { name: "July", monthIndex: 6 },
  8: { name: "August", monthIndex: 7 },
  9: { name: "September", monthIndex: 8 },
  0: { name: "October", monthIndex: 9 },
};

export function calculateLtoRenewalSchedule(plateNumber, referenceDate = new Date()) {
  if (!plateNumber || typeof plateNumber !== "string") {
    return {
      success: false,
      error: "Unable to determine renewal schedule from the provided plate number.",
    };
  }

  // Extract all numeric digits from plate number
  const digits = plateNumber.replace(/\D/g, "");

  if (!digits || digits.length < 1) {
    return {
      success: false,
      error: "Unable to determine renewal schedule from the provided plate number.",
    };
  }

  // Last numeric digit -> Month
  const lastDigit = parseInt(digits[digits.length - 1], 10);
  const monthInfo = LTO_MONTHS[lastDigit];

  if (!monthInfo) {
    return {
      success: false,
      error: "Unable to determine renewal schedule from the provided plate number.",
    };
  }

  // Second-to-last numeric digit -> Weekly Window
  let secondLastDigit = 1;
  if (digits.length >= 2) {
    secondLastDigit = parseInt(digits[digits.length - 2], 10);
  }

  let weekLabel = "";
  let startDay = 1;
  let endDay = 7;

  if ([1, 2, 3].includes(secondLastDigit)) {
    weekLabel = "1st–7th day (Week 1)";
    startDay = 1;
    endDay = 7;
  } else if ([4, 5, 6].includes(secondLastDigit)) {
    weekLabel = "8th–14th day (Week 2)";
    startDay = 8;
    endDay = 14;
  } else if ([7, 8].includes(secondLastDigit)) {
    weekLabel = "15th–21st day (Week 3)";
    startDay = 15;
    endDay = 21;
  } else {
    // 9, 0
    weekLabel = "22nd–Last day (Week 4)";
    startDay = 22;
    const refYear = referenceDate.getFullYear();
    const lastDayOfMonth = new Date(refYear, monthInfo.monthIndex + 1, 0).getDate();
    endDay = lastDayOfMonth;
  }

  // Determine current / next renewal dates
  const currentYear = referenceDate.getFullYear();
  let renewalYear = currentYear;

  const windowEndThisYear = new Date(currentYear, monthInfo.monthIndex, endDay, 23, 59, 59);
  if (referenceDate > windowEndThisYear) {
    renewalYear = currentYear + 1;
  }

  const startDate = new Date(renewalYear, monthInfo.monthIndex, startDay);
  const endDate = new Date(renewalYear, monthInfo.monthIndex, endDay, 23, 59, 59);

  // Status calculation
  const nowMs = referenceDate.getTime();
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const diffDaysToStart = Math.ceil((startMs - nowMs) / (1000 * 60 * 60 * 24));
  const diffDaysToEnd = Math.ceil((endMs - nowMs) / (1000 * 60 * 60 * 24));

  let status = "Current";
  let statusBadgeVariant = "success";

  if (nowMs > endMs) {
    status = "Overdue";
    statusBadgeVariant = "danger";
  } else if (nowMs >= startMs && nowMs <= endMs) {
    status = "Due This Week";
    statusBadgeVariant = "warning";
  } else if (diffDaysToStart <= 7) {
    status = "Due in 7 Days";
    statusBadgeVariant = "warning";
  } else if (diffDaysToStart <= 14) {
    status = "Due in 14 Days";
    statusBadgeVariant = "info";
  } else if (diffDaysToStart <= 30) {
    status = "Upcoming";
    statusBadgeVariant = "info";
  }

  const windowText = `${monthInfo.name} ${startDay}–${endDay}, ${renewalYear}`;

  return {
    success: true,
    plate_number: plateNumber,
    month: monthInfo.name,
    month_index: monthInfo.monthIndex,
    window_days: `${startDay}–${endDay}`,
    window_label: weekLabel,
    formatted_window: windowText,
    renewal_start_date: startDate.toISOString().split("T")[0],
    renewal_end_date: endDate.toISOString().split("T")[0],
    renewal_year: renewalYear,
    days_until_start: diffDaysToStart,
    days_until_end: diffDaysToEnd,
    status,
    status_badge_variant: statusBadgeVariant,
    source: "Calculated from Plate Number (LTO Rules)",
  };
}
