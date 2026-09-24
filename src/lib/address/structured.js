// The cascading address form's pure core.
//
// WHY THIS IS SEPARATE FROM THE COMPONENT
// ---------------------------------------
// "Which level depends on which", "what becomes stale when a level changes" and
// "is this address complete enough to save" are rules, not rendering. Keeping them
// here means they can be tested directly, and that the component cannot quietly
// disagree with the server about what a valid address is — the server imports the
// same completeness rule rather than restating it.
//
// THE HIERARCHY IS NOT UNIFORM, AND THAT IS THE WHOLE DIFFICULTY
// --------------------------------------------------------------
// Region → Province → City/Municipality → Barangay holds for most of the
// Philippines and fails for Metro Manila, which has NO provinces: Manila, Quezon
// City and the rest hang directly off the region. Several highly urbanised cities
// sit outside a province for the same reason.
//
// A cascade that assumes four levels everywhere leaves Province permanently
// unselected and disabled for every NCR address, which makes them unsaveable —
// the failure this module exists to prevent. So `requiresProvince` is passed IN,
// derived from the data (does this region have any provinces at all), never from
// a hardcoded list of region codes. When it is false the province is skipped
// rather than fabricated: "Do not force every Philippine address into an
// incorrect standardized format."
//
// THE ANTI-STALE RULE, AND HOW IT DIFFERS FROM THE FREE-TEXT PATH
// ---------------------------------------------------------------
// `src/lib/address/invalidate.js` clears everything derived when an operator
// edits TEXT. Here the operator cannot type a barangay at all — they pick one —
// so the hazard is different and more specific: pick Region → Province → City →
// Barangay A, drop the pin, then go back and change the CITY, and the coordinates
// still describe a barangay in the old city. The row would then hold a complete,
// plausible, structurally valid address pointing at the wrong place.
//
// `clearBelow` is the defence. Changing a level discards every level under it AND
// the pin, in the same operation that changes the level, so there is no window in
// which the form holds a new city with an old barangay or an old coordinate.
//
// The pin is cleared by ANY change to the address, not only a geographic one.
// That is stricter than it first looks: fixing a typo in the street number
// discards a placed pin. It is deliberate — a pin placed for "8572 Winding Creek"
// is not the pin for "8573 Winding Creek", and requirement is that Address B is
// never submitted with Address A's latitude. It is also why the form orders the
// pin step LAST, so the natural way to fill it out never triggers this.
//
// ONE TYPE RELAXES ONE FIELD
// --------------------------
// Everything above describes rules that hold for every address. There is exactly
// one exception, and it is deliberately narrow: an `operational` address (a hotel
// base, an airport terminal) does not have to carry a house/building number,
// because it does not have one. Every other field keeps every other rule, and no
// other type is affected. See `requiredDetailFields`.

/** The four geographic levels, outermost first. Order is load-bearing. */
export const CASCADE_LEVELS = ["region", "province", "city", "barangay"];

/**
 * What an address is FOR. `home` is the default because most addresses entered
 * against a driver are where that driver lives.
 *
 * `operational` exists because the other three are a PERSON's vocabulary. A hotel
 * base and an airport terminal are neither homes nor offices, and "other" is the
 * statement that no answer was available rather than an answer. Such a place is a
 * point the fleet operates TO and FROM, and until this value existed the two
 * operational surfaces recorded `other` — honest, and silent.
 *
 * It is also the only type that changes what is REQUIRED. See
 * `requiredDetailFields` for that rule and why it is scoped to this one value.
 *
 * The allowed set lives here rather than in the component so the server can
 * validate against the same list — a value the UI cannot produce should not be
 * storable, and restating the list is how those two drift apart.
 */
export const ADDRESS_TYPES = Object.freeze([
  { value: "home", label: "Home", description: "Where someone lives" },
  { value: "office", label: "Office", description: "A place of work" },
  {
    value: "operational",
    label: "Operational",
    description: "A base, terminal or stop the fleet serves",
  },
  { value: "other", label: "Other", description: "Anything else" },
]);

/** The `type` values the server accepts. */
export const ADDRESS_TYPE_VALUES = Object.freeze(ADDRESS_TYPES.map((t) => t.value));

/**
 * Fields that describe the ADDRESS rather than the geography. Changing any of
 * these also invalidates the pin — see the header.
 */
export const DETAIL_FIELDS = [
  "houseBuildingNumber",
  "streetRoad",
  "unitFloorBuilding",
  "subdivisionVillage",
  "landmark",
  "additionalDetails",
  "postalCode",
];

/** A blank structured-address value. Every surface starts from this. */
export const EMPTY_STRUCTURED_ADDRESS = Object.freeze({
  type: "home",

  // Geographic levels. The `*Code` fields are PSGC codes and are what the server
  // validates against; the `*Name` fields are the display copy.
  regionCode: null,
  regionName: null,
  provinceCode: null,
  provinceName: null,
  cityCode: null,
  cityName: null,
  barangayCode: null,
  barangayName: null,

  // True when the selected city has no province (Metro Manila and the
  // province-independent cities). Data-derived, never guessed.
  cityHasNoProvince: false,

  houseBuildingNumber: "",
  streetRoad: "",
  unitFloorBuilding: "",
  subdivisionVillage: "",
  landmark: "",
  additionalDetails: "",
  postalCode: "",

  // The pin. Both or neither — the database CHECK enforces the same pairing.
  latitude: null,
  longitude: null,
});

/**
 * The geographic fields to discard when `level` changes, plus the pin.
 *
 * Returns the level's own descendants and NOT the level itself: the caller is
 * replacing that one with a new selection.
 *
 * @param {"region"|"province"|"city"|"barangay"} level
 * @returns {string[]} keys to reset
 */
export function clearBelow(level) {
  const index = CASCADE_LEVELS.indexOf(level);
  // An unknown level clears nothing rather than everything: silently wiping the
  // whole form on a typo'd argument would be the worse failure.
  if (index === -1) return [];

  const descendants = CASCADE_LEVELS.slice(index + 1).flatMap((name) => [
    `${name}Code`,
    `${name}Name`,
  ]);

  const reset = [...descendants, "latitude", "longitude"];

  // `cityHasNoProvince` describes the CITY, so it goes stale when the city or
  // anything above it changes — but NOT when the barangay changes, because that
  // leaves the city alone. Clearing it there would make the form start demanding
  // a province the selected city does not have, which is the Metro Manila failure
  // this whole module is arranged around.
  if (index <= CASCADE_LEVELS.indexOf("city")) reset.push("cityHasNoProvince");

  return reset;
}

/**
 * The keys to reset when a non-geographic detail changes. Everything the pin
 * contributed, because the pin describes the address that was written before this
 * edit. See the header for why this is stricter than it looks.
 *
 * @returns {string[]}
 */
export function clearDerivedFromDetails() {
  return ["latitude", "longitude"];
}

/**
 * Apply a change to one geographic level, discarding everything beneath it.
 *
 * @param {object} previous  the current value
 * @param {string} level     which level changed
 * @param {object} selection the new values for that level, e.g. `{ regionCode, regionName }`
 * @returns {object} a new value
 */
export function selectLevel(previous, level, selection) {
  const next = { ...previous };
  // Reset FIRST, then apply the selection. The other order silently loses any key
  // that is both in `clearBelow(level)` and in `selection` — which is exactly
  // `cityHasNoProvince` when a city is chosen, so the flag would always come out
  // false and every Metro Manila address would start demanding a province.
  for (const key of clearBelow(level)) next[key] = EMPTY_STRUCTURED_ADDRESS[key];
  return { ...next, ...selection };
}

/**
 * Apply a change to a detail field, discarding the pin.
 *
 * @param {object} previous
 * @param {string} field
 * @param {string} value
 * @returns {object}
 */
export function editDetail(previous, field, value) {
  const next = { ...previous, [field]: value };
  for (const key of clearDerivedFromDetails()) next[key] = null;
  return next;
}

/**
 * The geographic levels that are still empty, given what has been chosen.
 *
 * `requiresProvince` is data-derived: false for a region with no provinces, which
 * is why this is a parameter and not a constant.
 *
 * @param {object} value
 * @param {{ requiresProvince: boolean }} options
 * @returns {string[]} level names, outermost first
 */
export function missingLevels(value, { requiresProvince }) {
  const missing = [];
  if (!value.regionCode) missing.push("region");
  if (requiresProvince && !value.provinceCode) missing.push("province");
  if (!value.cityCode) missing.push("city");
  if (!value.barangayCode) missing.push("barangay");
  return missing;
}

/**
 * Field → the message to show when it is empty. Only REQUIRED fields appear.
 *
 * Province is conditional and is added by the caller's `requiresProvince`.
 *
 * @returns {Record<string, string>}
 */
export const REQUIRED_MESSAGES = Object.freeze({
  region: "Select a region.",
  province: "Select a province.",
  city: "Select a city or municipality.",
  barangay: "Select a barangay.",
  houseBuildingNumber: "House / building number is required.",
  streetRoad: "Street / road is required.",
  postalCode: "ZIP code is required.",
});

/** Fields required on every address, geographic levels excluded. */
const REQUIRED_DETAILS = ["houseBuildingNumber", "streetRoad", "postalCode"];

/**
 * The same list for an OPERATIONAL address, which is shorter by one field.
 *
 * An airport curb and a hotel entrance are places the fleet stops at, not
 * doorsteps. They have a road and a ZIP; they have no house number, because
 * nothing at a terminal bay was ever numbered. Demanding one leaves the operator
 * two ways to proceed and both are wrong — type a number that does not exist, or
 * leave the operational address unrecorded — and the first is the fabrication
 * this whole module refuses to make anywhere else.
 *
 * WHAT IS *NOT* RELAXED, AND WHY THAT IS THE POINT
 * ------------------------------------------------
 * The house number only. A street/road is what makes the point addressable at
 * all, and the ZIP is what a driver's navigation actually consumes; an
 * "operational address" missing either is not a sparser address, it is a worse
 * one. Nor is anything relaxed for `home`, `office` or `other` — a person's
 * doorstep keeps every rule it had.
 *
 * THE TRADE, STATED PLAINLY
 * -------------------------
 * `type` is a claim the caller makes, so a client that wants to skip the house
 * number can declare itself operational. That is accepted because the alternative
 * — a general "optional" flag, or inferring the relaxation from a coordinate —
 * would be indistinguishable from a bug and would relax the rule for surfaces
 * that never asked. This is one named exception, on one field, gated on a value
 * the server validates against a closed list.
 */
const OPERATIONAL_REQUIRED_DETAILS = ["streetRoad", "postalCode"];

/**
 * Whether this value is an operational address.
 *
 * `?? `-safe by construction: an absent or unknown `type` is NOT operational, so
 * a caller that forgets the field gets the strict rule rather than the loose one.
 *
 * @param {object} value
 * @returns {boolean}
 */
export function isOperational(value) {
  return value?.type === "operational";
}

/**
 * The non-geographic fields this particular address must carry.
 *
 * Exported because the FORM needs the same answer to decide which field shows a
 * "required" mark. Leaving the component to restate the rule is how a field ends
 * up flagged required while the validator is willing to save it empty — or, worse,
 * flagged optional while the server refuses it.
 *
 * @param {object} value
 * @returns {string[]}
 */
export function requiredDetailFields(value) {
  return isOperational(value) ? OPERATIONAL_REQUIRED_DETAILS : REQUIRED_DETAILS;
}

/**
 * The required NON-geographic fields that are still empty.
 *
 * Split out because the server validates in two stages: the street-level detail
 * can be checked before it looks anything up, while "is a province required"
 * cannot be answered until the barangay code resolves. Sharing this with
 * `structuredErrors` keeps the two stages from disagreeing about which fields
 * are mandatory.
 *
 * @param {object} value
 * @returns {Record<string, string>}
 */
export function detailErrors(value) {
  const errors = {};

  // Read through `requiredDetailFields` rather than the constant, so the
  // operational exception applies here and everywhere else at once.
  for (const field of requiredDetailFields(value)) {
    if (!isFilled(value[field])) errors[field] = REQUIRED_MESSAGES[field];
  }

  // Format only — whether the code matches the city is not knowable here and is
  // not claimed. Same contract as src/lib/address/postal.js.
  if (isFilled(value.postalCode) && !/^\d{4}$/.test(String(value.postalCode).trim())) {
    errors.postalCode = "ZIP code must be 4 digits (e.g. 1421).";
  }

  return errors;
}

/**
 * Every required field that is still empty, with its message.
 *
 * This is the single definition of "complete enough to save" — the Save button,
 * the inline errors and the server all read it, so they cannot drift.
 *
 * @param {object} value
 * @param {{ requiresProvince: boolean }} options
 * @returns {Record<string, string>} field → message; empty when valid
 */
export function structuredErrors(value, { requiresProvince = true } = {}) {
  const errors = detailErrors(value);

  for (const level of missingLevels(value, { requiresProvince })) {
    errors[level] = REQUIRED_MESSAGES[level];
  }

  return errors;
}

/** True when a value carries something a person would recognise as content. */
function isFilled(value) {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

/** Convenience predicate over `structuredErrors`. */
export function isStructuredComplete(value, options) {
  return Object.keys(structuredErrors(value, options)).length === 0;
}

/**
 * The address as display lines, in the order a Philippine address is written.
 *
 * Optional lines that are empty are OMITTED, not left as blank entries — a
 * preview reading "8572 Winding Creek Boulevard, , , Santa Rosa City" is worse
 * than one that simply skips what is not there.
 *
 * @param {object} value
 * @returns {string[]}
 */
export function composeStructuredLines(value) {
  const lines = [];

  const street = joinParts(value.houseBuildingNumber, value.streetRoad);
  if (street) lines.push(street);

  pushIfFilled(lines, value.unitFloorBuilding);
  pushIfFilled(lines, value.subdivisionVillage);

  // "Barangay Balibago" rather than "Balibago" — in a Philippine address the
  // level is normally written with its prefix, and without it a barangay name
  // reads like a street or a subdivision.
  //
  // The prefix is added ONLY when the name does not already carry it. PSGC names
  // the numbered barangays "Barangay 197" outright — every barangay of Manila
  // and Pasay is named that way — so an unconditional prefix renders a large,
  // real set of addresses as "Barangay Barangay 197". See `withBarangayPrefix`.
  if (isFilled(value.barangayName)) {
    lines.push(withBarangayPrefix(value.barangayName));
  }

  pushIfFilled(lines, value.cityName);

  // Skipped entirely when the city has none, rather than emitted blank.
  if (!value.cityHasNoProvince) pushIfFilled(lines, value.provinceName);

  pushIfFilled(lines, value.regionName);

  // `landmark` and `additionalDetails` are deliberately NOT included. They are
  // delivery instructions — "Near the main gate", "2nd floor, blue gate" — not
  // postal address lines, and this output is what gets stored as
  // `formatted_address`. Putting "blue gate" in the authoritative rendering would
  // make every consumer of that column treat an instruction as part of the
  // address. The form shows them underneath the preview, labelled as notes.

  // "4026, Philippines" — the ZIP and the country share the final line, joined
  // with a comma (not the space `joinParts` uses, because these are two separate
  // facts rather than one multi-word value). Neither is invented: a missing ZIP
  // yields "Philippines" alone, never a made-up code.
  lines.push(
    [value.postalCode, "Philippines"]
      .filter(isFilled)
      .map((part) => String(part).trim())
      .join(", ")
  );

  return lines;
}

/** The preview as one string, for `addresses.formatted_address`. */
export function formatStructuredAddress(value) {
  return composeStructuredLines(value).join(", ");
}

function pushIfFilled(lines, value) {
  if (isFilled(value)) lines.push(typeof value === "string" ? value.trim() : value);
}

/**
 * A barangay name carrying its level prefix exactly once.
 *
 * The prefix exists because a bare barangay name reads like a street or a
 * subdivision — "Balibago" alone could be either. But some barangays are NAMED
 * with the prefix already: PSGC writes every one of Manila's and Pasay's
 * numbered barangays as "Barangay 197", not "197". Prepending unconditionally
 * therefore renders those as "Barangay Barangay 197".
 *
 * The test is for the word, not the string prefix, so "Barangay" must stand
 * alone: `\b` after it means "Barangay 197" and "Barangay" itself match, while a
 * hypothetical "Barangay197" does not, and neither does a name that merely
 * mentions the word later ("Santo Niño, Barangay 5").
 *
 * Matching is case-insensitive and the supplied spelling is preserved — a name
 * the data spells "barangay 197" is stored and rendered as "barangay 197", not
 * rewritten to a capital B. This is presentation only: `barangayName` and the
 * PSGC row behind it are never altered.
 *
 * @param {string} name
 * @returns {string}
 */
function withBarangayPrefix(name) {
  const trimmed = String(name).trim();
  return /^barangay\b/i.test(trimmed) ? trimmed : `Barangay ${trimmed}`;
}

function joinParts(...parts) {
  return parts
    .filter((p) => isFilled(p))
    .map((p) => String(p).trim())
    .join(" ");
}

/**
 * Whether the region selected has any provinces at all, from the province list
 * the caller already loaded. A region with none skips the province level.
 *
 * Deliberately takes the loaded list rather than a region code: the answer comes
 * from the same data the dropdown is showing, so the form cannot decide the
 * province is optional while the dropdown is displaying one.
 *
 * @param {object[]} provincesForRegion
 * @param {boolean} loaded  whether the province request has completed
 * @returns {boolean}
 */
export function regionRequiresProvince(provincesForRegion, loaded) {
  // Until the list arrives we do not know, and guessing "no province" would let
  // an incomplete address read as complete — so assume required and let the
  // loading state resolve it.
  if (!loaded) return true;
  return Array.isArray(provincesForRegion) && provincesForRegion.length > 0;
}
