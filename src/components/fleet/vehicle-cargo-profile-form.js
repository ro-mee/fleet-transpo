export const HANDLING_CAPABILITIES = [
  ["FRAGILE", "Fragile"],
  ["NO_STACK", "No stacking"],
  ["FOOD_SEPARATION", "Food separation"],
  ["SECURE_LOAD", "Secured load"],
  ["SPILL_CONTAINMENT", "Spill containment"],
];

export const PROFILE_FIELDS = [
  ["rated_payload_kg", "Rated payload", "kg"],
  ["gross_vehicle_weight_limit_kg", "Gross vehicle weight limit", "kg"],
  ["operating_mass_kg", "Operating mass", "kg"],
  ["operational_reserve_kg", "Operating reserve", "kg"],
  ["usable_volume_m3", "Usable cargo volume", "m³"],
  ["compartment_length_m", "Compartment length", "m"],
  ["compartment_width_m", "Compartment width", "m"],
  ["compartment_height_m", "Compartment height", "m"],
  ["opening_length_m", "Opening length", "m"],
  ["opening_width_m", "Opening width", "m"],
  ["opening_height_m", "Opening height", "m"],
];

export const PROFILE_FIELD_LIMITS = {
  rated_payload_kg: 1000000,
  gross_vehicle_weight_limit_kg: 1000000,
  operating_mass_kg: 1000000,
  operational_reserve_kg: 1000000,
  usable_volume_m3: 10000,
  compartment_length_m: 100,
  compartment_width_m: 100,
  compartment_height_m: 100,
  opening_length_m: 100,
  opening_width_m: 100,
  opening_height_m: 100,
};
export const PROFILE_ERROR_KEYS = [
  ...PROFILE_FIELDS.map(([key]) => key),
  "temperature_min_c",
  "temperature_max_c",
  "verification_reference",
  "verification_valid_until",
];

export const blankProfile = {
  supports_supply_delivery: false,
  rated_payload_kg: "",
  gross_vehicle_weight_limit_kg: "",
  operating_mass_kg: "",
  operational_reserve_kg: "",
  usable_volume_m3: "",
  compartment_length_m: "",
  compartment_width_m: "",
  compartment_height_m: "",
  opening_length_m: "",
  opening_width_m: "",
  opening_height_m: "",
  temperature_min_c: "",
  temperature_max_c: "",
  handling_capabilities: [],
  verification_reference: "",
  verification_valid_until: "",
};

export function nextUtcDate() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateProfile(form) {
  const errors = {};
  for (const [key, label] of PROFILE_FIELDS) {
    const raw = form[key].trim();
    const max = PROFILE_FIELD_LIMITS[key];
    if (!raw) {
      errors[key] = `${label} is required when enabling supply delivery.`;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors[key] = `${label} must be a valid number.`;
    } else if (key === "operational_reserve_kg" ? value < 0 : value <= 0) {
      errors[key] = key === "operational_reserve_kg" ? "Must be zero or greater." : "Must be greater than zero.";
    } else if (value > max) {
      errors[key] = `Must be ${max.toLocaleString("en-PH")} or less.`;
    }
  }

  const grossWeight = Number(form.gross_vehicle_weight_limit_kg);
  const operatingMass = Number(form.operating_mass_kg);
  if (
    form.gross_vehicle_weight_limit_kg !== "" && form.operating_mass_kg !== "" &&
    Number.isFinite(grossWeight) && Number.isFinite(operatingMass) && grossWeight <= operatingMass &&
    !errors.gross_vehicle_weight_limit_kg
  ) {
    errors.gross_vehicle_weight_limit_kg = "Gross vehicle weight must exceed operating mass.";
  }

  for (const [key, label] of [["temperature_min_c", "Minimum temperature"], ["temperature_max_c", "Maximum temperature"]]) {
    const raw = form[key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < -80 || value > 80) {
      errors[key] = `${label} must be between -80 and 80 °C.`;
    }
  }
  const minTemperature = Number(form.temperature_min_c);
  const maxTemperature = Number(form.temperature_max_c);
  if (
    form.temperature_min_c !== "" && form.temperature_max_c !== "" &&
    Number.isFinite(minTemperature) && Number.isFinite(maxTemperature) && minTemperature > maxTemperature &&
    !errors.temperature_max_c
  ) {
    errors.temperature_max_c = "Maximum temperature must not be below minimum temperature.";
  }

  const reference = form.verification_reference.trim();
  if (reference.length < 3) errors.verification_reference = "Use at least 3 non-space characters.";
  else if (reference.length > 255) errors.verification_reference = "Use no more than 255 characters.";

  const validUntil = form.verification_valid_until;
  if (!validUntil) errors.verification_valid_until = "Verification expiry is required when enabling supply delivery.";
  else if (!isCalendarDate(validUntil)) errors.verification_valid_until = "Enter a real calendar date.";
  else if (validUntil <= new Date().toISOString().slice(0, 10)) {
    errors.verification_valid_until = "Verification must remain valid beyond today (UTC).";
  }

  return errors;
}

export function profileToForm(profile) {
  if (!profile) return { ...blankProfile };
  return Object.fromEntries(Object.keys(blankProfile).map((key) => {
    const value = profile[key];
    if (key === "supports_supply_delivery") return [key, value === true];
    if (key === "handling_capabilities") return [key, Array.isArray(value) ? value : []];
    return [key, value == null ? "" : String(value).slice(0, key === "verification_valid_until" ? 10 : undefined)];
  }));
}

export function profilePayload(form, vehicleId) {
  if (!form.supports_supply_delivery) return { vehicle_id: vehicleId, supports_supply_delivery: false };
  const body = { ...form, vehicle_id: vehicleId, verification_reference: form.verification_reference.trim() };
  for (const key of PROFILE_FIELDS.map(([name]) => name).concat(['temperature_min_c', 'temperature_max_c'])) {
    body[key] = form[key] === '' ? null : Number(form[key]);
  }
  return body;
}
