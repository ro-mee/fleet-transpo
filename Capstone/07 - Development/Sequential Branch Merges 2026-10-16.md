# Sequential branch merges - 2026-10-16

The user authorized merging the reviewed branches into local main one at a time. The main checkout is `C:/Users/lenovo/OneDrive/Desktop/capstone-fuel-pdf`; the starting main commit is `75a5e668`. Branches, worktrees and saved stashes are preserved. No push, deployment, cloud upload or database apply is part of these local merges.

## 1. Mechanic integration

Source: `feat/mechanic-integration` at `6240d32a` (41 prior commits plus the audit note). Main is an ancestor, and the staged merge required no conflict resolution. Includes mechanic/Cargo safeguards, dispatch and registry corrections, UTF-8 protection, shared Off Duty artwork, map performance and root scratch cleanup. Existing individual commits retain their descriptions.

Fresh checks before committing: tracked encoding passed; all 163 migration filenames passed; route authorization passed for all 334 exported methods. Strict lint passed for all 204 changed JavaScript files in small batches. The whitespace check accounts for existing Windows CRLF files; four actual trailing-space/EOF issues were corrected without changing behavior. Application tests are not rerun in this merge task. Earlier test evidence is recorded in the audit/navigation notes and does not certify the combined result. No native/device acceptance or live migration status is claimed.

## 2. Google Maps handoff

Source: `codex/google-maps-handoff` at `bf2b5fe4`. The modern Git merge engine reconciled the Map source automatically; only SYSTEM.md conflicted. Both sets of historical notes were retained. Inspection confirms the combined focus cleanup retains navigation locking and map pause behavior. Includes shared trip-phase authority, ordered tracking preflight, explicit failure choices and server-owned return refresh. Fresh strict lint passed for all 18 changed JavaScript files, tracked encoding passed, and whitespace/conflict checks passed. Device acceptance remains pending.

## 3. Android trip bubble

Source: `codex/android-trip-bubble` at `cdcfb86c`, nine commits beyond the handoff branch. Retained both system-note histories. Resolved the Map focus conflict by keeping `setMapActive(false)` on blur and adding `params?.bubbleReturn` to the focus callback dependencies. Thus returning from the bubble refreshes the canonical assignment while hidden maps still stop animation. The optional native shortcut does not own GPS or authorize a trip; the server assignment remains authoritative. Fresh strict lint passed on all 23 changed JavaScript/TypeScript files; changed JSON and Android XML parsed successfully; tracked encoding, whitespace and conflict checks passed. The first offline Hermes export crashed in the sibling-checkout temporary directory. Retrying the same merged source with TEMP/TMP under the primary workspace succeeded (1,475 modules, 88 assets, 5.74 MB HBC bundle, exit 0). Both compiler binaries have identical SHA-256 and report the same version; the path-sensitive failure was avoided without source changes, but its precise Windows cause is unproven. Expo warned that the isolated checkout lacks services/google-services.json, so this bundle is not native configuration/notification acceptance. Existing release holds remain: native compilation, physical-device behavior and separate cloud-upload consent have not been verified or supplied by this merge.

## Remaining sequence

Merge Google Maps handoff, then the Android trip bubble, separately. Preserve map pause/performance fixes while resolving navigation cleanup. Record already-squashed fuel history and superseded documentation history using the current content after verifying that their feature/rules are already included; do not replay obsolete snapshots.

See [[Worktree and Merge Audit 2026-10-16]] and [[Google Maps Navigation and Android Bubble Implementation Plan]].
