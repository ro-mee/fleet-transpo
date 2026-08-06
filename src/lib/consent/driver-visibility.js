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
export const DRIVER_SELF_EDITABLE_FIELDS = ["phone", "face_image_url"];