// Shared driver consent & privacy policy. Pure data — no React, no server imports —
// so the same text and version can be read by the web app, the mobile app, and API
// routes without drift. Mirrors how permissions.js keeps the authorization matrix
// in one importable place.

// The current policy version. Bump this whenever the wording changes; a driver who
// accepted an older version is shown the new policy and asked to consent again.
export const CURRENT_PRIVACY_POLICY_VERSION = 1;

/**
 * The data-collection consent a driver must accept (and record) before their
 * personal information — license scan, face photo, GPS, biometric attendance,
 * fuel/vehicle activity — is shown to them or captured on their behalf.
 *
 * The durable, auditable record lives in the `driver_consents` table via
 * POST /api/driver/me/consent (database-normalization migration is the follow-up).
 */
export const PRIVACY_POLICY = {
  version: CURRENT_PRIVACY_POLICY_VERSION,
  title: "Driver Data Privacy & Terms",
  effectiveDate: "2026-08-05",
  sections: [
    {
      heading: "What we collect",
      body: "Name, contact details, driver's license number and its scan image, a reference face photo used for identity verification, live location while on duty, biometric attendance check-in/check-out records, and fuel or vehicle activity associated with your trips.",
    },
    {
      heading: "Why we use it",
      body: "To assign and route trips, verify your identity at check-in, track trip progress and location for dispatch and safety, evaluate your performance, and keep compliance and operational records for the organization.",
    },
    {
      heading: "What we share",
      body: "Your information is used only by the organization's staff (dispatch, fleet, and administration) as needed to operate the fleet. It is not sold to third parties.",
    },
    {
      heading: "How long we keep it",
      body: "We keep records for as long as you remain a driver and as required to meet legal and operational compliance obligations.",
    },
    {
      heading: "Your rights",
      body: "You may review your own information through your profile, correct selected fields, and request that we explain how your data is used.",
    },
  ],
};