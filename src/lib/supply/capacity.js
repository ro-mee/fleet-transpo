import { vehicleOperationallyAvailable } from "@/lib/ai/pair-scoring";

const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const numericValue = (value) => value === null || value === undefined || value === "" ? Number.NaN : Number(value);

function fitsBox(packageDimensions, containerDimensions, canRotate) {
  const packageSides = [packageDimensions.length, packageDimensions.width, packageDimensions.height];
  const containerSides = [containerDimensions.length, containerDimensions.width, containerDimensions.height];
  const permutations = canRotate
    ? [
        [0, 1, 2], [0, 2, 1], [1, 0, 2],
        [1, 2, 0], [2, 0, 1], [2, 1, 0],
      ]
    : [[0, 1, 2]];
  return permutations.some((order) => order.every((index, axis) => packageSides[index] <= containerSides[axis]));
}

function check(id, status, reason, values = {}) {
  return { id, status, reason, ...values };
}

/**
 * Deterministic single-vehicle feasibility checks. A PASS here only covers the
 * measurements represented by this profile; loading arrangement, axle balance,
 * securement and roadworthiness still require their own operational checks.
 */
export function evaluateSupplyLoad(manifest, profile, now = new Date()) {
  const lines = Array.isArray(manifest?.lines) ? manifest.lines : [];
  const checks = [];
  let totalWeightKg = 0;
  let totalVolumeM3 = 0;
  let measurementsValid = lines.length > 0;

  if (lines.length === 0) {
    measurementsValid = false;
    checks.push(check("manifest", "BLOCK", "The manifest must contain at least one transport line."));
  } else {
    const invalidLine = lines.find((line) =>
      !Number.isInteger(Number(line.transport_package_count)) || Number(line.transport_package_count) <= 0 ||
      !finitePositive(line.gross_weight_kg_per_package) ||
      !finitePositive(line.dimensions_m?.length) || !finitePositive(line.dimensions_m?.width) || !finitePositive(line.dimensions_m?.height)
    );
    if (invalidLine) {
      measurementsValid = false;
      checks.push(check("manifest_measurements", "BLOCK", "Every line needs a positive package count, package weight and three package dimensions."));
    } else {
      for (const line of lines) {
        const packages = Number(line.transport_package_count);
        totalWeightKg += packages * Number(line.gross_weight_kg_per_package);
        totalVolumeM3 += packages * Number(line.dimensions_m.length) * Number(line.dimensions_m.width) * Number(line.dimensions_m.height);
      }
      checks.push(check("manifest_measurements", "PASS", "Package quantities and physical measurements are complete."));
    }
  }

  checks.push(check(
    "pickup_readiness",
    manifest?.pickup?.ready === true ? "PASS" : "BLOCK",
    manifest?.pickup?.ready === true ? "Warehouse has marked the shipment ready for pickup." : "Warehouse readiness has not been confirmed."
  ));

  if (!profile?.vehicle_status) {
    checks.push(check("vehicle_operational_status", "UNKNOWN", "Current vehicle condition status is unavailable."));
  } else if (!vehicleOperationallyAvailable(profile)) {
    checks.push(check("vehicle_operational_status", "BLOCK", `Vehicle status is ${profile.vehicle_status} and does not permit dispatch.`));
  } else {
    checks.push(check("vehicle_operational_status", "PASS", "Vehicle condition status does not block dispatch. Time-specific availability is not checked here."));
  }

  if (!profile || profile.supports_supply_delivery !== true) {
    checks.push(check("service_eligibility", "BLOCK", "This vehicle is not explicitly enabled for supply delivery."));
  } else if (!profile.verified_at || !profile.verification_reference) {
    checks.push(check("profile_verification", "BLOCK", "Cargo measurements do not have a recorded verification reference."));
  } else if (profile.verification_valid_until && new Date(profile.verification_valid_until).getTime() <= now.getTime()) {
    checks.push(check("profile_verification", "BLOCK", "Cargo measurements have passed their verification date."));
  } else {
    checks.push(check("service_eligibility", "PASS", "The vehicle has explicit supply-delivery approval."));
    checks.push(check("profile_verification", "PASS", "Cargo measurements are recorded as verified."));
  }

  const ratedPayload = numericValue(profile?.rated_payload_kg);
  const grossWeightLimit = numericValue(profile?.gross_vehicle_weight_limit_kg);
  const operatingMass = numericValue(profile?.operating_mass_kg);
  const reserve = numericValue(profile?.operational_reserve_kg);
  if (![ratedPayload, grossWeightLimit, operatingMass, reserve].every(Number.isFinite)) {
    checks.push(check("payload", "UNKNOWN", "Verified payload, gross vehicle limit, operating mass and operating reserve are all required."));
  } else {
    const payload = Math.min(ratedPayload, grossWeightLimit - operatingMass) - reserve;
    if (!finitePositive(payload)) {
      checks.push(check("payload", "BLOCK", "No safe payload remains after the verified operating-mass reserve."));
    } else if (measurementsValid && Number.isFinite(totalWeightKg)) {
      checks.push(check(
        "payload",
        totalWeightKg <= payload ? "PASS" : "BLOCK",
        totalWeightKg <= payload ? "Load is within the derived safe available payload." : "Load exceeds safe available payload; split or use another vehicle.",
        { load_kg: totalWeightKg, capacity_kg: payload, utilization_pct: (totalWeightKg / payload) * 100 }
      ));
    }
  }

  const volume = numericValue(profile?.usable_volume_m3);
  if (!finitePositive(volume)) {
    checks.push(check("volume", "UNKNOWN", "A verified usable cargo volume is required before this vehicle can be evaluated."));
  } else if (measurementsValid && Number.isFinite(totalVolumeM3)) {
    checks.push(check(
      "volume",
      totalVolumeM3 <= volume ? "PASS" : "BLOCK",
      totalVolumeM3 <= volume ? "Load is within usable cargo volume." : "Load exceeds usable cargo volume; split or use another vehicle.",
      { load_m3: totalVolumeM3, capacity_m3: volume, utilization_pct: (totalVolumeM3 / volume) * 100 }
    ));
  }

  const compartment = {
    length: numericValue(profile?.compartment_length_m),
    width: numericValue(profile?.compartment_width_m),
    height: numericValue(profile?.compartment_height_m),
  };
  const opening = {
    length: numericValue(profile?.opening_length_m),
    width: numericValue(profile?.opening_width_m),
    height: numericValue(profile?.opening_height_m),
  };
  if (![...Object.values(compartment), ...Object.values(opening)].every(Number.isFinite)) {
    checks.push(check("package_fit", "UNKNOWN", "Verified compartment and loading-opening dimensions are required."));
  } else if (measurementsValid) {
    const unfit = lines.find((line) => {
      const dims = line.dimensions_m;
      return !fitsBox(dims, compartment, line.package_can_rotate !== false) ||
        !fitsBox(dims, opening, line.package_can_rotate !== false);
    });
    checks.push(check(
      "package_fit",
      unfit ? "BLOCK" : "PASS",
      unfit ? `Package ${unfit.external_line_id} does not fit the compartment and loading opening in an allowed orientation.` : "Every package fits the verified compartment and loading opening."
    ));
  }

  const supportedHandling = new Set(profile?.handling_capabilities ?? []);
  const requiredHandling = [...new Set(lines.flatMap((line) => line.handling ?? []))];
  const missingHandling = requiredHandling.filter((need) => !supportedHandling.has(need));
  checks.push(check(
    "handling",
    missingHandling.length ? "BLOCK" : "PASS",
    missingHandling.length ? `Vehicle does not have verified handling capability: ${missingHandling.join(", ")}.` : "All declared handling needs have a matching vehicle capability."
  ));

  const temperatureNeeds = lines.map((line) => line.temperature_c).filter(Boolean);
  if (temperatureNeeds.length) {
    const minimum = numericValue(profile?.temperature_min_c);
    const maximum = numericValue(profile?.temperature_max_c);
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
      checks.push(check("temperature", "UNKNOWN", "The manifest needs temperature control, but the vehicle range is not verified."));
    } else {
      const requiredMin = Math.min(...temperatureNeeds.map((range) => Number(range.min_c)));
      const requiredMax = Math.max(...temperatureNeeds.map((range) => Number(range.max_c)));
      const passes = minimum <= requiredMin && maximum >= requiredMax;
      checks.push(check(
        "temperature",
        passes ? "PASS" : "BLOCK",
        passes ? "Verified vehicle temperature range covers the manifest." : "Vehicle temperature range does not cover the manifest requirement.",
        { required_min_c: requiredMin, required_max_c: requiredMax, vehicle_min_c: minimum, vehicle_max_c: maximum }
      ));
    }
  } else {
    checks.push(check("temperature", "PASS", "The manifest does not require temperature control."));
  }

  return {
    load_checks_pass: checks.every((item) => item.status === "PASS"),
    totals: {
      gross_weight_kg: measurementsValid ? totalWeightKg : null,
      nominal_volume_m3: measurementsValid ? totalVolumeM3 : null,
    },
    checks,
    limitations: ["This evaluation does not prove trip-specific occupant or equipment mass, packing arrangement, axle distribution, load securement, vehicle roadworthiness, driver eligibility, documents or schedule availability."],
  };
}
