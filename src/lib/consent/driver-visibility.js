// Shared "what a driver sees" configuration for the driver-facing surfaces (web
// driver home + mobile app). Both surfaces read this single list so the sections
// a driver can view are identical no matter which device they use.
//
// Each section is shown on a surface only if it has real, driver-owned data and
// the permission is granted. Sections without schema backing yet (documents
// beyond the license scan, emergency contact, shift schedule) are deliberately
// not listed; they appear here once their data model exists.
export const DRIVER_VISIBLE_SECTIONS = [
  {
    key: "profile",
    label: "Profile",
    description: "Personal information (name, email, phone).",
  },
  {
    key: "license",
    label: "License & Credentials",
    description: "License number, type, class, expiry, and scan image.",
  },
  {
    key: "performance",
    label: "Performance",
    description: "Trips, distance, hours, and rating from completed trips.",
  },
  {
    key: "trip_history",
    label: "Trip History",
    description: "The driver's own assigned trips.",
  },
  {
    key: "attendance",
    label: "Attendance",
    description: "The driver's own check-in/check-out records.",
  },
];

// Sections a driver can update on their own. Kept minimal: only fields the driver
// owns and has no staff workflow dependency on. Everything else is read-only.
//
// The license scan columns are whitelisted here but the PATCH handler gates each
// side individually via canUpdateLicenseScan — a side is only writable when it
// has no scan on file yet or the license is inside the re-upload window.
export const DRIVER_SELF_EDITABLE_FIELDS = ["phone", "face_image_url", "license_image_url", "license_back_image_url", "license_expiry"];

// How many days before a license expiry a driver may re-upload their scan.
// Mirrors the repo's `expiring30` bucket used by the documents expiry report.
export const LICENSE_REUPLOAD_WINDOW_DAYS = 30;

// Days from today until the license expiry (>= 0, using calendar days), or
// Infinity when the expiry is unparseable or missing.
function daysUntilLicenseExpiry(licenseExpiry) {
  const expiry = String(licenseExpiry || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return Infinity;
  const [y, m, d] = expiry.split("-").map(Number);
  const exp = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

/**
 * Whether a driver may upload/replace a license scan for a given side.
 *
 * A side is open when it has no scan on file yet, or when the license is within
 * (or past) the re-upload window. Once a scan is on file and the license is
 * outside that window, the scan is view-only.
 *
 * The "AI failed to read the photo" case is handled session-only at upload time:
 * an unclear scan is never saved, so a driver simply retakes it until the OCR
 * pass succeeds — the DB never stores an unreadable scan, which is why no status
 * column is needed here.
 */
export function canUpdateLicenseScan({ frontImageUrl, backImageUrl, side, licenseExpiry }) {
  const imageUrl = side === "back" ? backImageUrl : frontImageUrl;
  if (!imageUrl) return true;
  return daysUntilLicenseExpiry(licenseExpiry) <= LICENSE_REUPLOAD_WINDOW_DAYS;
}