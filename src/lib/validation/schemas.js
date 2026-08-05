import { z } from "zod";
import {
  PATTERNS,
  LIMITS,
  isPhonePH,
  isVIN,
  isYear,
  isPlateNumberPH,
  isIsoDate,
  isDateInPast,
  isPassword,
} from "./index";

const requiredString = (label, opts = {}) =>
  z
    .string({ error: `${label} is required.` })
    .min(1, `${label} is required.`)
    .max(opts.max ?? LIMITS.TEXT_MAX, `${label} must be at most ${opts.max ?? LIMITS.TEXT_MAX} characters.`);

const optionalString = (opts = {}) =>
  z
    .string()
    .trim()
    .max(opts.max ?? LIMITS.TEXT_MAX, `Must be at most ${opts.max ?? LIMITS.TEXT_MAX} characters.`)
    .optional()
    .or(z.literal(""));

const dateString = (label, opts = {}) =>
  z
    .string()
    .refine((v) => !v || isIsoDate(v), `${label} must be a valid date.`)
    .refine((v) => !v || !opts.noPast || !isDateInPast(v), `${label} must not be in the past.`)
    .optional()
    .or(z.literal(""));

const coerceId = (label) =>
  z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : Number(v)), z.number().int().positive(`${label} is invalid.`).optional());

export const vehicleSchema = z.object({
  plate_number: z
    .string()
    .trim()
    .min(1, "Plate number is required.")
    .refine(isPlateNumberPH, "Please enter a valid Philippine plate number (e.g. ABC-1234).")
    .transform((v) => v.toUpperCase()),
  vehicle_name: requiredString("Vehicle type/name").refine(
    (v) => PATTERNS.NAME.test(v.trim()),
    "Vehicle type/name must contain only letters."
  ),
  model: optionalString(),
  manufacturer: optionalString(),
  year: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z
      .number()
      .refine(isYear, `Year must be between ${LIMITS.YEAR_MIN} and ${new Date().getFullYear() + 1}.`)
      .optional()
  ),
  color: optionalString(),
  fuel_type: z.string().default("Gasoline"),
  seating_capacity: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(LIMITS.SEAT_MIN).max(LIMITS.SEAT_MAX).optional()
  ),
  category_id: coerceId("Vehicle category"),
  vehicle_status: z.string().default("Available"),
  purchase_price: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().min(0, "Purchase price must be a positive number.").optional()
  ),
  purchase_date: dateString("Purchase date"),
  insurance_expiry: dateString("Insurance expiry"),
  next_service_date: dateString("Next service date"),
  next_service_mileage: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().min(0, "Mileage must be a positive number.").optional()
  ),
});

export const driverSchema = z.object({
  first_name: requiredString("First name", { max: 100 }).refine(
    (v) => PATTERNS.NAME.test(v.trim()),
    "First name must contain only letters (no numbers or special characters)."
  ),
  last_name: requiredString("Last name", { max: 100 }).refine(
    (v) => PATTERNS.NAME.test(v.trim()),
    "Last name must contain only letters (no numbers or special characters)."
  ),
  email: z
    .string()
    .email("Please enter a valid email address.")
    .or(z.literal(""))
    .optional(),
  phone: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isPhonePH(v), "Please enter a valid Philippine phone number (e.g. 09171234567)."),
  password: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isPassword(v), "Password must be 8+ characters with upper, lower, number, and a special character."),
  position: z.string().default("Driver"),
  license_number: z
    .string()
    .trim()
    .min(1, "License number is required.")
    .max(30, "License number must be at most 30 characters.")
    .transform((v) => v.toUpperCase()),
  license_expiry: dateString("License expiry", { noPast: true }),
  license_type: z.string().optional(),
  license_class: z.string().optional(),
  years_of_experience: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(0, "Years of experience must be a positive number.").max(70).optional()
  ),
  driver_status: z.string().default("Available"),
  license_image_url: z.string().optional(),
});

export const driverEditSchema = driverSchema.extend({
  license_expiry: dateString("License expiry"),
});

export const reservationSchema = z.object({
  guest_name: optionalString(),
  guest_phone: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isPhonePH(v), "Please enter a valid Philippine phone number (e.g. 09171234567)."),
  guest_email: z.string().email("Please enter a valid email address.").or(z.literal("")).optional(),
  pickup_location: requiredString("Pickup location"),
  dropoff_location: optionalString(),
  reservation_date: z
    .string()
    .min(1, "Date is required.")
    .refine((v) => isIsoDate(v), "Date must be a valid date.")
    .refine((v) => !isDateInPast(v), "Reservation date must not be in the past."),
  pickup_time: z.string().min(1, "Pickup time is required."),
  estimated_return_time: optionalString(),
  purpose: optionalString(),
  passenger_count: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(LIMITS.SEAT_MIN).max(LIMITS.SEAT_MAX).default(1)
  ),
  notes: optionalString(),
  vehicle_id: coerceId("Vehicle"),
  driver_id: coerceId("Driver"),
  service_type_id: coerceId("Service type"),
  booking_channel_id: coerceId("Booking channel"),
  external_booking_id: optionalString(),
  integration_source: optionalString(),
  room_number: optionalString(),
  bill_to_room: z.boolean().optional(),
  guest_id: z.string().optional(),
});

// Admin account creation. Mirrors the rules in
// src/app/api/auth/register/route.js (validateBody with the same labels and
// maxLengths), so a client-side error means the server would reject it too —
// the two layers can't disagree about what is a valid account.
export const createUserSchema = z.object({
  email: z
    .string({ error: "Email is required." })
    .min(1, "Email is required.")
    .email("Please enter a valid email address."),
  password: z
    .string({ error: "Password is required." })
    .min(1, "Password is required.")
    .min(LIMITS.PASSWORD_MIN, `Password must be at least ${LIMITS.PASSWORD_MIN} characters.`)
    .refine((v) => /[a-z]/.test(v), "Password must contain at least one lowercase letter.")
    .refine((v) => /[A-Z]/.test(v), "Password must contain at least one uppercase letter.")
    .refine((v) => /\d/.test(v), "Password must contain at least one number.")
    .refine((v) => /[^A-Za-z0-9]/.test(v), "Password must contain at least one special character."),
  first_name: z
    .string({ error: "First name is required." })
    .min(1, "First name is required.")
    .min(LIMITS.NAME_MIN, `First name must be at least ${LIMITS.NAME_MIN} characters.`)
    .max(100, "First name must be at most 100 characters.")
    .refine(
      (v) => PATTERNS.NAME.test(v.trim()),
      "First name must contain only letters (no numbers or special characters)."
    ),
  last_name: z
    .string({ error: "Last name is required." })
    .min(1, "Last name is required.")
    .min(LIMITS.NAME_MIN, `Last name must be at least ${LIMITS.NAME_MIN} characters.`)
    .max(100, "Last name must be at most 100 characters.")
    .refine(
      (v) => PATTERNS.NAME.test(v.trim()),
      "Last name must contain only letters (no numbers or special characters)."
    ),
  role_id: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().positive("Please select a role.")
  ),
});

export { isVIN, isYear };
