# Name-Based Driver Gmail Accounts Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Replace generic driver login aliases with Gmail addresses that visibly match each driver's first and last name in the live database, while keeping OTP delivery and rollback safe.

**Architecture:** Read the live `employees` row joined to each defense driver as the source of truth for names. D01–D03 use the three exact Gmail addresses supplied by the user; D04–D10 use name-derived Gmail plus aliases routed to the three already controlled inboxes unless the user supplies seven separate controlled inboxes. A guarded plan/apply/verify workflow updates only the ten defense driver employees, audits each change, bumps `auth_version`, and keeps a before-image for rollback.

**Tech Stack:** Node ESM, `pg`, `bcryptjs`, existing `writeAudit`, email OTP policy, Supabase/PostgreSQL, Vitest.

---

## Address contract

The database names are authoritative and must be re-read immediately before apply. The current defense graph expects these names:

| Driver | Current name | Required login address |
|---|---|---|
| D01 | Mateo Reyes | `romarroms123@gmail.com` |
| D02 | Andres Santos | `arvild10.4@gmail.com` |
| D03 | Paolo Dela Cruz | `yy.yujin.han.nn@gmail.com` |
| D04 | Nico Bautista | `romarroms123+nico.bautista@gmail.com` |
| D05 | Rafael Mendoza | `arvild10.4+rafael.mendoza@gmail.com` |
| D06 | Gabriel Navarro | `yy.yujin.han.nn+gabriel.navarro@gmail.com` |
| D07 | Luis Villanueva | `romarroms123+luis.villanueva@gmail.com` |
| D08 | Carlos Garcia | `arvild10.4+carlos.garcia@gmail.com` |
| D09 | Joaquin Ramos | `yy.yujin.han.nn+joaquin.ramos@gmail.com` |
| D10 | Emilio Torres | `romarroms123+emilio.torres@gmail.com` |

The D04–D10 addresses are Gmail plus aliases. They are name-based in the login field and deliver OTP to the three inboxes already provided. Do not claim that standalone Gmail inboxes were created. If the user requires standalone `firstname.lastname@gmail.com` inboxes, stop before apply and collect seven controlled addresses with OTP access.

Name normalization must be deterministic: trim, Unicode NFKD normalize, remove combining marks, lowercase, split on spaces, keep only letters/numbers, join name tokens with dots, and reject an empty result. Thus `Paolo Dela Cruz` becomes `paolo.dela.cruz`; D01–D03 remain explicit overrides.

Passwords remain in the existing gitignored `.env.defense-accounts.json` mapping unless the user separately requests password rotation. Never print passwords, put them in source, or include them in audit values.

## Task 1: Freeze the live mapping and ownership

**Files:**

- Read: `.agents/AGENTS.md`, `Capstone/07 - Development/Defense Demo Data Implementation Plan.md`, `Capstone/02 - Features/Driver Management.md`, `src/lib/auth.js`, `src/lib/auth/otp-policy.js`, `scripts/apply-otp-employee-emails.mjs`.
- Create: `scripts/defense-seed/name-accounts.mjs`.
- Test: `scripts/defense-seed/name-accounts.test.mjs`.

1. Add a read-only `plan` command that loads the existing defense ledger and joins its ten owned driver IDs to `employees.first_name`, `employees.last_name`, role, status, and current email.
2. Refuse if the defense ledger is absent, any owned driver is missing, a driver is deleted/inactive, the role is not `driver`, or a name differs from the expected semantic driver key without an explicit reviewed mapping.
3. Confirm the ten target addresses are case-insensitively distinct and do not belong to another employee. Report the exact holder ID and stop on any collision, including deleted employees because `employees.email` is globally unique.
4. Confirm all ten targets pass the application deliverable-email policy. Do not perform a write.

Expected plan result: ten rows, zero collisions, ten deliverable Gmail addresses, and a digest based on employee IDs, old emails, new emails, and names.

## Task 2: Test the name resolver

1. Write failing tests for `Mateo Reyes → mateo.reyes`, `Paolo Dela Cruz → paolo.dela.cruz`, repeated spaces, uppercase input, accented characters, punctuation, empty names, and explicit D01–D03 overrides.
2. Run `npx vitest run scripts/defense-seed/name-accounts.test.mjs`; confirm the new tests fail before implementation.
3. Implement the smallest pure resolver and mapping function. Keep base inbox assignment in configuration, not inside the normalization function.
4. Re-run the focused tests; expected result is all resolver and collision tests passing.

## Task 3: Add guarded email rotation

**Files:**

- Modify: `scripts/defense-seed/name-accounts.mjs`.
- Reuse: `scripts/load-env.mjs`, `scripts/defense-seed/ledger.mjs`, `src/lib/audit.js`, `src/lib/auth/sessions.js`.
- Modify: `package.json` scripts.

1. Add `plan`, `apply`, `verify`, and `rollback` modes. `plan` must run inside `BEGIN READ ONLY`; `apply` must require the current digest as `--apply=<digest>`.
2. Before updating, snapshot each exact employee ID, old email, new email, role, status, and `auth_version`. Store the snapshot in a gitignored local export and in an account-rotation ledger key such as `seed:defense-accounts-2026-10` without passwords.
3. In one transaction, lock the ten exact employee rows, re-check names/roles/collisions, update only `employees.email`, increment `auth_version`, and write one audit row per account with old/new email and reason `defense_name_based_account_mapping`.
4. Revoke only those ten employees' active web sessions, mobile refresh-token families, trusted devices, and unused password-reset tokens through the existing session helper/transaction contract. Do not purge any security table globally.
5. Leave `password_hash` unchanged. If a password rotation is later requested, make it a separate guarded operation with a separate digest.

## Task 4: Verify OTP and driver identity behavior

1. Add read-only checks that each active defense employee has the expected name-derived email, driver role, active status, unique email, and unchanged password-hash presence.
2. Verify old `+fleetops-dXX` aliases no longer belong to any employee and that no non-defense employee was changed.
3. Send an OTP to each controlled inbox one at a time through the real login flow. Confirm D01–D03 direct addresses and D04–D10 plus aliases arrive in the intended base inboxes. Do not seed OTP challenges, sessions, trusted devices, or recovery codes.
4. Log in as D01 and one name-based account, verify the correct driver profile and trips load, then log out. Keep OTP codes and session tokens out of logs and screenshots.

Expected result: ten distinct name-based login addresses, OTP delivery confirmed for every controlled inbox route, and no account maps to another driver's profile.

## Task 5: Rollback and failure handling

1. Make `rollback` read-only preview the before-images and refuse if any target employee email changed after apply, a target address is now held by another row, or an unrelated foreign reference requires review.
2. On approved rollback, restore only the ten exact old emails, increment `auth_version` again, revoke only those ten employees' sessions/devices, and write audit entries for the reversal.
3. Test apply twice (second run refuses), collision refusal, mid-transaction rollback, changed-row refusal, and exact rollback restoration in a disposable database or transaction harness.

## Task 6: Documentation and handoff

**Update:** `Capstone/07 - Development/Defense Demo Data Implementation Plan.md`, `Capstone/02 - Features/Driver Management.md`, and `SYSTEM.md`.

Record that D01–D03 use the supplied direct Gmail addresses, D04–D10 use name-based plus aliases routed to controlled inboxes, passwords remain local-only, OTP was verified per inbox, and no standalone Gmail inbox was created unless separately provisioned. Include the plan digest, verification output, rollback command, and the remaining requirement for genuine license review and driver consent.

## Approval boundary

This plan does not change the database, employee emails, passwords, sessions, or Gmail accounts. Applying it requires review of the live `seed:defense:accounts:plan` output and explicit approval of the final name-to-address mapping. If standalone Gmail inboxes are required for D04–D10, provide those controlled inboxes before implementation; otherwise the plus-alias mapping above is ready for approval.

## Applied result (2026-10-03)

The user approved the mapping. The guarded plan returned digest `30ba8fdd6a3e1e60`; apply changed only employee IDs 123–132, preserved all password hashes, bumped `auth_version`, revoked only those accounts' sessions/devices, and saved `scratch/defense-name-accounts-backup.json` (gitignored). `seed:defense:accounts:name:verify` reports `state=applied`, matching digest, zero pending targets, and no errors. The live defense status and contamination checks pass with exactly 10 active driver accounts and zero active old driver or unassigned accounts. The original approval-boundary text above describes the pre-apply state; this section is the post-apply record.

## Direct-address follow-up (2026-10-03, planned)

The user subsequently requested removing the plus-alias prefixes for D04–D10, with `nico.bautista@gmail.com` for D04. The read-only `seed:defense:accounts:direct:plan` resolves all seven live names to standalone Gmail addresses and reports no database collision (digest `f47056ee98204aaf`). A separate guarded workflow was prepared in `scripts/defense-seed/direct-driver-emails.mjs`. It is not applied: none of the seven proposed inboxes is recorded in local `OTP_FIX_*` ownership configuration, and direct addresses can receive login OTPs independently of the three supplied inboxes. The existing aliases remain the current live logins until all seven inboxes are confirmed as controlled.
