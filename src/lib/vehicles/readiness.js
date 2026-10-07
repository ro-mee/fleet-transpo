/**
 * Road-readiness contract (pure evaluator, Release B Task 4 bounded slice).
 *
 * This module has NO runtime effect on its own: it does not read the database,
 * write migrations, touch vehicle APIs/forms, or gate dispatch. It defines the
 * fail-closed semantics a later server-owned adapter and migration must enforce
 * inside commit/start gates. Inputs are normalized DTO fields, not a claim
 * about the current `vehicles` / `vehicledocuments` schema — in particular the
 * legacy `status`, `vehicles.registration_expiry` and `vehicles.insurance_expiry`
 * columns are deliberately ignored; only verified document records supply
 * expiry evidence.
 */

/**
 * Stable machine-readable blocker codes in deterministic emission order.
 */
export const READINESS_BLOCKER_ORDER = [
  "PLATE_MISSING",
  "COMMISSIONING_NOT_READY",
  "MAINTENANCE_NOT_CLEARED",
  "SAFETY_NOT_CLEARED",
  "OR_CR_NOT_VERIFIED",
  "OR_CR_VERIFICATION_AUDIT_MISSING",
  "OR_CR_EVIDENCE_AMBIGUOUS",
  "REGISTRATION_EXPIRY_MISSING",
  "REGISTRATION_EXPIRY_INVALID",
  "REGISTRATION_EXPIRED",
  "INSURANCE_NOT_VERIFIED",
  "INSURANCE_VERIFICATION_AUDIT_MISSING",
  "INSURANCE_EVIDENCE_AMBIGUOUS",
  "INSURANCE_EXPIRY_MISSING",
  "INSURANCE_EXPIRY_INVALID",
  "INSURANCE_EXPIRED",
  "REFERENCE_TIME_INVALID",
];

const ORDER_INDEX = new Map(READINESS_BLOCKER_ORDER.map((code, i) => [code, i]));

function manilaDateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function classifyExpiry(raw) {
  if (raw === null || raw === undefined) return { kind: "missing" };
  let s;
  if (typeof raw === "string") {
    s = raw.trim();
    if (!s) return { kind: "missing" };
  } else if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { kind: "invalid" };
    s = raw.toISOString().slice(0, 10);
  } else {
    return { kind: "invalid" };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return { kind: "invalid" };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { kind: "invalid" };
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { kind: "invalid" };
  }
  return { kind: "valid", value: s };
}

function auditOk(doc, now) {
  const by = doc.verified_by;
  if (by === null || by === undefined) return false;
  if (typeof by === "string" && by.trim() === "") return false;
  const at = doc.verified_at;
  if (at === null || at === undefined || at === "") return false;
  const t = at instanceof Date ? at : new Date(at);
  if (!(t instanceof Date) || Number.isNaN(t.getTime())) return false;
  // The attestation cannot come from the future.
  if (t.getTime() > now.getTime()) return false;
  return true;
}

function assessDocumentType(liveDocs, documentType, codes, manilaToday, now) {
  const rows = liveDocs.filter((d) => d.document_type === documentType);
  const verified = rows.filter((d) => d.verification_status === "Verified");
  if (verified.length === 0) return [codes.notVerified];
  // Never silently choose between competing verified records.
  if (verified.length > 1) return [codes.ambiguous];
  const out = [];
  const doc = verified[0];
  if (!auditOk(doc, now)) out.push(codes.audit);
  const expiry = classifyExpiry(doc.expiry_date);
  if (expiry.kind === "missing") out.push(codes.missing);
  else if (expiry.kind === "invalid") out.push(codes.invalid);
  // An expiry date stays valid through that day in Asia/Manila.
  else if (expiry.value < manilaToday) out.push(codes.expired);
  return out;
}

/**
 * Evaluate whether a vehicle is road-ready.
 *
 * @param {object} vehicle - `{ plate_number, commissioning_status, maintenance_clear, safety_clear }`.
 * @param {Array<object>} documents - `{ document_type, verification_status, verified_by, verified_at, expiry_date, deleted_at }`.
 * @param {Date} now - reference instant; an invalid instant fails closed.
 * @returns {{ ready: boolean, blockers: string[] }} codes only, no prose.
 */
export function evaluateRoadReadiness(vehicle = {}, documents = [], now) {
  // Fail closed when the caller forgets the instant: unlike `undefined`
  // triggering a wall-clock default, an absent `now` must block rather than
  // silently evaluate against whatever time the server happens to have.
  if (now === null || now === undefined) {
    return { ready: false, blockers: ["REFERENCE_TIME_INVALID"] };
  }
  const ref = now instanceof Date ? now : new Date(now);
  if (!(ref instanceof Date) || Number.isNaN(ref.getTime())) {
    return { ready: false, blockers: ["REFERENCE_TIME_INVALID"] };
  }

  const v = vehicle && typeof vehicle === "object" ? vehicle : {};
  const blockers = [];

  const plate = typeof v.plate_number === "string" ? v.plate_number.trim() : "";
  if (!plate) blockers.push("PLATE_MISSING");

  if (v.commissioning_status !== "Ready") blockers.push("COMMISSIONING_NOT_READY");

  // Server-normalized inputs: only an explicit `true` clears. Missing, false,
  // or malformed evidence blocks. These are NOT client-writable API fields.
  if (v.maintenance_clear !== true) blockers.push("MAINTENANCE_NOT_CLEARED");
  if (v.safety_clear !== true) blockers.push("SAFETY_NOT_CLEARED");

  const docs = Array.isArray(documents) ? documents : [];
  // Soft-deleted rows are not evidence. `== null` covers NULL and undefined.
  const live = docs.filter((d) => d && typeof d === "object" && d.deleted_at == null);

  const manilaToday = manilaDateString(ref);

  blockers.push(
    ...assessDocumentType(
      live,
      "OR_CR",
      {
        notVerified: "OR_CR_NOT_VERIFIED",
        audit: "OR_CR_VERIFICATION_AUDIT_MISSING",
        ambiguous: "OR_CR_EVIDENCE_AMBIGUOUS",
        missing: "REGISTRATION_EXPIRY_MISSING",
        invalid: "REGISTRATION_EXPIRY_INVALID",
        expired: "REGISTRATION_EXPIRED",
      },
      manilaToday,
      ref
    )
  );

  blockers.push(
    ...assessDocumentType(
      live,
      "Insurance",
      {
        notVerified: "INSURANCE_NOT_VERIFIED",
        audit: "INSURANCE_VERIFICATION_AUDIT_MISSING",
        ambiguous: "INSURANCE_EVIDENCE_AMBIGUOUS",
        missing: "INSURANCE_EXPIRY_MISSING",
        invalid: "INSURANCE_EXPIRY_INVALID",
        expired: "INSURANCE_EXPIRED",
      },
      manilaToday,
      ref
    )
  );

  blockers.sort((a, b) => ORDER_INDEX.get(a) - ORDER_INDEX.get(b));

  return { ready: blockers.length === 0, blockers };
}
