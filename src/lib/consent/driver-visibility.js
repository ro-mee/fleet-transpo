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
// The license scan columns are whitelisted here; since 2026-08-25 re-upload is
// allowed at any time (the Gemini authenticity/readability gate in
// POST /api/driver/license-scan is the quality control, not a time window).
export const DRIVER_SELF_EDITABLE_FIELDS = ["phone", "face_image_url", "license_image_url", "license_back_image_url"];

// Kept for display parity: the compliance "expiring soon" bucket still mirrors
// the repo's `expiring30` report bucket. No longer an upload restriction.
export const LICENSE_REUPLOAD_WINDOW_DAYS = 30;

/**
 * Whether a driver may upload/replace a license scan for a given side.
 *
 * Policy change 2026-08-25: uploads are allowed at ANY time. The old 30-day
 * pre-expiry window was removed because self-service renewal is now the primary
 * path — a driver who physically renews early should update immediately. The
 * remaining quality control is fail-closed verification in
 * POST /api/driver/license-scan: the photo must genuinely be an LTO card and its
 * key fields must be readable, otherwise nothing is persisted.
 */
export function canUpdateLicenseScan() {
  return true;
}