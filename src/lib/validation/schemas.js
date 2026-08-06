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
  service_interval_km: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z
      .number()
      .int("Service interval (km) must be a whole number.")
      .min(1, "Service interval (km) must be at least 1. Leave it blank to skip mileage-based prediction.")
      .optional()
  ),
  service_interval_days: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z
      .number()
      .int("Service interval (days) must be a whole number.")
      .min(1, "Service interval (days) must be at least 1. Leave it blank to skip time-based prediction.")
      .optional()
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
  license_back_image_url: z.string().optional(),
  address: z.string().max(255, "Address must be at most 255 characters.").optional().or(z.literal("")),
  sex: z.string().max(20, "Sex must be at most 20 characters.").optional().or(z.literal("")),
  birthdate: dateString("Birthdate"),
  nationality: z.string().max(100, "Nationality must be at most 100 characters.").optional().or(z.literal("")),
  emergency_contact_name: optionalString({ max: 150 }),
  emergency_contact_address: optionalString({ max: 255 }),
  emergency_contact_phone: z
    .string()
    .optional()
    .or(z.literal(""))
    .refine((v) => !v || isPhonePH(v), "Please enter a valid Philippine phone number (e.g. 09171234567)."),
});

export const driverEditSchema = driverSchema;

export const createUserSchema = z.object({
  email: z.string().trim().min(1, "Email address is required.").email("Please enter a valid email address."),
  password: z.string().min(6, "Password must be at least 6 characters."),
  first_name: requiredString("First name", { max: 100 }).refine(
    (v) => PATTERNS.NAME.test(v.trim()),
    "First name must contain only letters."
  ),
  last_name: requiredString("Last name", { max: 100 }).refine(
    (v) => PATTERNS.NAME.test(v.trim()),
    "Last name must contain only letters."
  ),
  role_id: z.string().min(1, "System role is required."),
});
