import { isRestricted, plateLastDigit, restrictedDigitsFor, weekdayFor } from "./policy";

/** Return a coding explanation only when the shared date-and-plate rule blocks. */
export function numberCodingBlockReason(vehicle, ctx, date) {
  if (!ctx?.policy?.enabled || !vehicle?.plate_number) return null;
  if (ctx.exemptVehicleIds?.has?.(vehicle.vehicle_id)) return null;
  if (!isRestricted(vehicle.plate_number, ctx.policy, date)) return null;

  const digit = plateLastDigit(vehicle.plate_number);
  const weekday = weekdayFor(date);
  const restrictedDigits = restrictedDigitsFor(ctx.policy, date);
  return `Number-coding restriction: plate ending in ${digit} is restricted on ${weekday} (restricted digits: ${restrictedDigits.join(", ")}).`;
}
