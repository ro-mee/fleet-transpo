import { query } from "@/lib/db";

// ============================================================================
// Vehicle-category resolution at the ingest boundary.
//
// Booking speaks in free text ("Executive SUV", "airport shuttle", "for staff");
// Fleet owns a small closed set of categories in `vehiclecategories`. Migration
// 016 added transportation_requests.requested_category_id for the resolved value
// and the queue already joins and filters on it — this module is the translation
// the plan specified but that was never written. Without it every ingested row
// carried a null category, so the queue had no vehicle class to show and the
// information leaked into `special_requests` as prose ("VIP guest").
//
// Two rules govern the mapping:
//
//   1. The DATABASE owns the ids. Nothing here hardcodes a category_id, so
//      renaming, reordering, or adding a category cannot silently mis-route
//      requests — an unrecognised table just stops matching.
//
//   2. A wrong category is worse than no category. Resolving a VIP arrival to
//      "Hotel Operations & Logistics" books a guest a cargo pickup. Anything the
//      rules do not clearly answer resolves to null and stays free text, which
//      the queue renders honestly as unresolved.
// ============================================================================

/**
 * Distinctive tokens per category, in priority order.
 *
 * `text` matches Booking's wording; `name` matches Fleet's `category_name`. The
 * two are separate lists because the vocabularies genuinely differ — Booking
 * says "limo", the table says "VIP Guest Transport". Matching a rule to a row by
 * regex rather than by id is what keeps rule 1 above true.
 *
 * VIP is first deliberately: "VIP Guest Transport" also contains the word
 * "guest", so a guest-first pass would route every VIP arrival onto the shared
 * airport shuttle. Order is the tie-break, so the most specific rule leads.
 *
 * More generally the rules are ordered by WHO the trip is for (vip, staff, ops)
 * before WHAT the vehicle looks like (van, shuttle, minibus). Those two
 * vocabularies overlap constantly — "Staff Shuttle" contains "shuttle", a
 * housekeeping run is still a van — and the audience is the part that decides
 * the category. Put the shape rule first and "Staff Shuttle" resolves to the
 * guest airport shuttle, which is a real trip booked onto the wrong fleet.
 */
const RULES = [
  {
    text: /\b(vip|executive|luxury|limo|limousine|premium|suite guest)\b/,
    name: /vip|executive|luxury/,
  },
  {
    text: /\b(staff|employee|employees|crew|shift|personnel)\b/,
    name: /staff|employee/,
  },
  {
    text: /\b(cargo|logistic|logistics|supply|supplies|housekeeping|kitchen|laundry|linen|maintenance|ops|operation|operations|utility|truck)\b/,
    name: /operation|logistic|cargo/,
  },
  {
    text: /\b(airport|shuttle|transfer|arrival|departure|guest|passenger|van|minibus|minivan|coaster)\b/,
    name: /shuttle|airport|transfer/,
  },
];

/** Lowercase, strip punctuation to spaces, collapse runs. Keeps \b usable. */
function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve free text to one of Fleet's vehicle categories.
 *
 * Tries, in order: an exact name match (Booking echoing our own vocabulary
 * back), then the keyword rules. Returns a null id rather than guessing.
 *
 * Never throws. Ingest must not fail because a category lookup had a bad day —
 * a request with no category is still a completely usable request, exactly like
 * the reservation-number and geo-estimate steps around it.
 *
 * @param {...(string|null|undefined)} candidates text to inspect, most
 *   authoritative first. Later arguments are only consulted if earlier ones
 *   produce no match.
 * @returns {Promise<{categoryId: number|null, categoryName: string|null, matchedOn: string|null}>}
 */
export async function resolveVehicleCategory(...candidates) {
  const miss = { categoryId: null, categoryName: null, matchedOn: null };

  const texts = candidates.map(normalize).filter(Boolean);
  if (!texts.length) return miss;

  let categories;
  try {
    const { rows } = await query(
      `SELECT category_id, category_name
         FROM vehiclecategories
        WHERE deleted_at IS NULL AND COALESCE(status, 'Active') <> 'Inactive'
        ORDER BY category_id`
    );
    categories = rows || [];
  } catch (e) {
    console.warn("vehicle category lookup failed:", e?.message || e);
    return miss;
  }
  if (!categories.length) return miss;

  const named = categories.map((c) => ({ ...c, normalized: normalize(c.category_name) }));

  for (const text of texts) {
    // Exact name, e.g. Booking configured with Fleet's own category list.
    const exact = named.find((c) => c.normalized === text);
    if (exact) {
      return { categoryId: exact.category_id, categoryName: exact.category_name, matchedOn: "name" };
    }

    // Keyword rules, audience before vehicle shape (see RULES).
    for (const rule of RULES) {
      if (!rule.text.test(text)) continue;
      const hit = named.find((c) => rule.name.test(c.normalized));
      if (hit) {
        return { categoryId: hit.category_id, categoryName: hit.category_name, matchedOn: "keyword" };
      }
    }
  }

  return miss;
}
