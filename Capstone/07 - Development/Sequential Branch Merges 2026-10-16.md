# Sequential branch merges - 2026-10-16

The user authorized merging the reviewed branches into local main one at a time. The main checkout is `C:/Users/lenovo/OneDrive/Desktop/capstone-fuel-pdf`; the starting main commit is `75a5e668`. Branches, worktrees and saved stashes are preserved. No push, deployment, cloud upload or database apply is part of these local merges.

## 1. Mechanic integration

Source: `feat/mechanic-integration` at `6240d32a` (41 prior commits plus the audit note). Main is an ancestor, and the staged merge required no conflict resolution. Includes mechanic/Cargo safeguards, dispatch and registry corrections, UTF-8 protection, shared Off Duty artwork, map performance and root scratch cleanup. Existing individual commits retain their descriptions.

Fresh checks before committing: tracked encoding passed; all 163 migration filenames passed; route authorization passed for all 334 exported methods. Strict lint passed for all 204 changed JavaScript files in small batches. The whitespace check accounts for existing Windows CRLF files; four actual trailing-space/EOF issues were corrected without changing behavior. Application tests are not rerun in this merge task. Earlier test evidence is recorded in the audit/navigation notes and does not certify the combined result. No native/device acceptance or live migration status is claimed.

## 2. Google Maps handoff

Source: `codex/google-maps-handoff` at `bf2b5fe4`. The modern Git merge engine reconciled the Map source automatically; only SYSTEM.md conflicted. Both sets of historical notes were retained. Inspection confirms the combined focus cleanup retains navigation locking and map pause behavior. Includes shared trip-phase authority, ordered tracking preflight, explicit failure choices and server-owned return refresh. Fresh strict lint passed for all 18 changed JavaScript files, tracked encoding passed, and whitespace/conflict checks passed. Device acceptance remains pending.

## 3. Android trip bubble

Source: `codex/android-trip-bubble` at `cdcfb86c`, nine commits beyond the handoff branch. Retained both system-note histories. Resolved the Map focus conflict by keeping `setMapActive(false)` on blur and adding `params?.bubbleReturn` to the focus callback dependencies. Thus returning from the bubble refreshes the canonical assignment while hidden maps still stop animation. The optional native shortcut does not own GPS or authorize a trip; the server assignment remains authoritative. Fresh strict lint passed on all 23 changed JavaScript/TypeScript files; changed JSON and Android XML parsed successfully; tracked encoding, whitespace and conflict checks passed. The first offline Hermes export crashed in the sibling-checkout temporary directory. Retrying the same merged source with TEMP/TMP under the primary workspace succeeded (1,475 modules, 88 assets, 5.74 MB HBC bundle, exit 0). Both compiler binaries have identical SHA-256 and report the same version; the path-sensitive failure was avoided without source changes, but its precise Windows cause is unproven. Expo warned that the isolated checkout lacks services/google-services.json, so this bundle is not native configuration/notification acceptance. Existing release holds remain: native compilation, physical-device behavior and separate cloud-upload consent have not been verified or supplied by this merge.

## 4. Already-squashed fuel history

Source: `origin/feat/fuel-guide-microsim` at `2d82e115`. Verified again that every path in its original 13-file feature slice is byte-identical to squash commit `99ad71c5`, which is an ancestor of main. Used the `ours` merge strategy to record the old 18-commit history as integrated while retaining current main content and all later tutorial/accessibility changes. The staged tree was identical to the first parent before adding this record. No old fuel source was replayed.

## 5. Superseded driver-save documentation history

Source: `fix/driver-edit-save-feedback` at `c9c245a5`. Its remaining commit adds only media/worktree ignore rules, the motion reel note and a system paragraph. All five rules are present in current main; the walkthrough note has since grown from 4,588 to 16,771 characters with newer specifications. Used the `ours` merge strategy to record the historical parent while retaining current content. Confirmed a zero-content merge before adding this completion record; no driver runtime behavior was changed by this step.

## Completion and verification

Separate merge commits: mechanic `44868f61`, Google Maps `bdd72e44`, Android bubble `a698836d`, fuel history `aadba739`, followed by this legacy documentation merge. Existing commits and all branches/worktrees/stashes remain preserved. Final Git checks confirmed all 16 local branch tips and all five audited live remote branch tips are ancestors of local main. All seven registered worktrees were clean, remote main remained at 75a5e668, and local main was 86 commits ahead with zero behind. The four exact temporary export/compiler directories created by this task were checked and removed. The final documentation-only amendment records these observed results; it does not add another merge or replay any source.

Fresh evidence: strict lint on 204 mechanic JavaScript files, 18 handoff JavaScript files and 23 Android JavaScript/TypeScript files; UTF-8 checks; all 163 migration-file validations; all 334 route guards; JSON/Android XML parsing; conflict and whitespace checks; and combined offline Android Hermes export (1,475 modules, 88 assets, 5.74 MB). Windows CRLF files were accounted for during whitespace checking. No application test suite was rerun. Prior test counts are historical, not a fresh combined-suite pass. Native Android compilation/device acceptance, isolated Google services configuration and release/cloud-upload consent remain unresolved. No source/configuration was uploaded, no database was applied, and remote main was not pushed by this task.

See [[Worktree and Merge Audit 2026-10-16]] and [[Google Maps Navigation and Android Bubble Implementation Plan]].
