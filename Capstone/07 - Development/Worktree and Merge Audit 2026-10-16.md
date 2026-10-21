# Worktree and merge audit - 2026-10-16

Read-only Git audit requested by the user. Baseline: local `main` and live remote `main` both point to `75a5e66851abbd814ebfa6aec7146470d892020b`. Live remote branch heads were checked with `git ls-remote --heads origin`; all five matched the existing remote-tracking references. No fetch, application change, commit, merge, push, database operation or build was performed. This note is the only file added by this audit.

## All seven registered worktrees

All seven had zero tracked or untracked changes before this note was saved. Ignored build outputs and local configuration are outside this cleanliness claim.

| Checkout | Branch | Commits absent from main | Assessment |
| --- | --- | ---: | --- |
| Main repository | feat/mechanic-integration | 41 | Unmerged; tip f336ca35 matches origin |
| .codex/worktrees/cargo-core-sandbox/capstone | codex/cargo-core-sandbox | 0 | Fully included in main; 17 commits behind |
| .codex/worktrees/cargo-mobile-ui/capstone | codex/cargo-mobile-ui | 0 | Fully included in main; 43 commits behind |
| .codex/worktrees/google-maps-handoff/capstone | codex/android-trip-bubble | 35 | Unmerged; local branch only |
| .worktrees/dispatch-copilot-ui-audit | fix/dispatch-copilot-ui-audit | 0 | Fully included in main; 167 commits behind |
| .worktrees/feat-passenger-cargo | feat/passenger-cargo | 0 | Fully included in main; 89 commits behind |
| ../capstone-fuel-pdf | main | 0 | Matches local and remote main |

The three `.codex` checkout paths above are under `C:/Users/lenovo`; the other relative paths are anchored at the main repository. After saving this note, the main repository has this one new documentation file.

## Remaining local branches and remote-only feature

All 16 local branches and all five live remote branch heads were checked, including ancestry and patch equivalence against main.

| Branch | Ahead / behind main | Assessment |
| --- | --- | --- |
| codex/google-maps-handoff | 26 / 0 | Unmerged, but entirely contained in codex/android-trip-bubble, which adds nine commits |
| fix/driver-edit-save-feedback | 1 / 324 | Historical documentation/ignore commit c9c245a5; corresponding ignore rules and walkthrough note already exist in main in newer form |
| origin/feat/fuel-guide-microsim | 18 / 491 | Original history unmerged; entire original 13-file feature slice is already in main through squash commit 99ad71c5 |
| feat/dev-otp-bypass | 0 / 81 | Fully included |
| feat/driver-punctuality | 0 / 312 | Fully included |
| feat/otp-attempts-warning | 0 / 334 | Fully included |
| feat/otp-redesign | 0 / 415 | Fully included |
| feat/security-hardening-batch-1 | 0 / 547 | Fully included |
| feature/driver-info-edit-sync | 0 / 294 | Fully included |
| perf/quick-actions | 0 / 565 | Fully included, including remote counterpart |

`git cherry` alone marked the 18 fuel commits as distinct because a multi-commit squash does not preserve each individual patch identity. Stronger content evidence: all 13 paths changed by the old fuel branch exactly match that branch at `99ad71c5`, and that squash is an ancestor of main. Seven of those paths still match current main byte-for-byte; the other six have subsequent changes. This supersedes the October 8 audit's description of the fuel branch as a missing feature. Do not merge its old history merely to eliminate the ahead count.

## Integration risks and suggested order

1. Review `feat/mechanic-integration` as the primary pending integration. It is 41 commits above main, spanning 282 files, including migrations 162/163. It includes broader mechanic, Cargo, dispatch, encoding, map, artwork and cleanup work; the branch name understates its scope. Main is its ancestor, so integration requires no textual reconciliation against today's main. That is not runtime or database acceptance. The previous closeout recorded 275 affected tests passing, but full-suite/lint attempts exhausted memory; those checks were not rerun here. Live migration status was not queried.
2. Review navigation and Android overlay separately. Main is also an ancestor of `codex/android-trip-bubble`, whose total diff spans 260 files. Its 35 commits include 15 shared with the mechanic branch; the two branches have 26 mechanic-only and 20 Android-only commits. Integrating both requires resolving three textual conflict hunks across `SYSTEM.md` and `mobile/app/(app)/(tabs)/map.js`, as reported by a read-only three-way merge preview. Seven paths changed on both sides. Preserve both navigation lifecycle handling and current map pause/performance behavior during reconciliation. Native Android compilation, physical-device acceptance and the documented cloud-upload consent hold remain pending. The Google Maps handoff branch is already contained in Android, so it is not a separate additional feature stream.
3. Keep the old fuel branch and driver-save documentation branch out of an automatic merge queue. A merge preview of the fuel branch against current main shows ten conflict hunks in four files: fuel-report.js, CoachMarkOverlay.jsx, CoachMarkProvider.jsx and CoachMarkSimulationPanel.jsx. The driver-save documentation commit produces five conflict hunks across .gitignore, the motion reel note and SYSTEM.md. Their old history is not evidence of missing runtime features.

The three-way preview uses Git's read-only legacy `merge-tree` mode; it does not apply changes or certify semantic correctness. Conflict counts include only added conflict delimiters emitted by the preview, not marker-like strings inside existing test code.

## Preserved saved work and leftover directories

Two stashes remain: `0c215b4f` (Copilot singular/plural driver wording) and `2d8351ae` (historical driver-info/edit snapshot). The October 8 audit describes their relationship to merged work. They were listed, not applied, deleted or independently certified redundant today.

`.worktrees/feat-driver-punctuality` remains an unregistered leftover copy with no `.git` marker. Its former branch is fully merged; today's audit did not repeat the October 8 file-by-file comparison of that copy. `.codex/worktrees/cargo-verification` contains only `.codex-worktree-name` and has no checkout or Git marker. Neither is an additional active worktree. No directory was removed.

## Evidence and limits

Evidence: registered worktree inventory; status in every checkout; all local and remote branch heads; live remote verification; main ancestry and ahead/behind counts; patch-equivalence checks; affected-file blob comparisons; squash ancestry; read-only merge previews; stash inventory; and leftover-directory inspection. No application tests were required or run for this history/content audit. Clean working trees and conflict-free ancestry do not establish release safety.

Related notes: [[Worktree and Merge Audit 2026-10-08]], [[Google Maps Navigation and Android Bubble Implementation Plan]], [[Fuel]].

## Follow-up: user-authorized sequential merges

The user subsequently authorized one-at-a-time integration into local main. Mechanic, Google Maps handoff and Android trip-bubble source were merged separately. Old fuel and driver-save documentation histories were reconciled with the current content retained: the fuel feature was already squashed into main and the media protection/note had newer replacements. This supersedes the unmerged-branch snapshot above; the snapshot remains as pre-merge evidence. See [[Sequential Branch Merges 2026-10-16]] for commit descriptions, conflict resolutions and fresh verification limits. Native/device acceptance and publication remain separate.

## Repeat audit after remote synchronization - 2026-10-16

A fresh read of live remote heads now confirms remote main and local main both point to `5e9d73f2e1aeb002a4a28c6203c7a56542ffac47` (zero ahead/behind). This supersedes the earlier publication-pending snapshot: the remote has moved since the merge task, without a push by this audit. All five live remote branch hashes match their local remote-tracking references, including mechanic at `6240d32a`.

Rechecked all 16 local branches and all five live remote branches: every tip is an ancestor of main, with zero commits missing from main. The old branch names and older checkout files remain present because no branch or worktree was deleted or advanced during integration.

| Registered checkout branch | Commits missing from main | Status before saving this repeat-audit record |
| --- | ---: | --- |
| feat/mechanic-integration | 0 | Clean |
| codex/cargo-core-sandbox | 0 | Clean |
| codex/cargo-mobile-ui | 0 | Clean |
| codex/android-trip-bubble | 0 | Clean |
| fix/dispatch-copilot-ui-audit | 0 | Clean |
| feat/passenger-cargo | 0 | Clean |
| main (capstone-fuel-pdf) | 0 | Clean |

All statuses included tracked and all untracked files; ignored build outputs/configuration were not counted. The primary mobile folder has no nested .git marker and uses the parent repository. The two previously documented unregistered leftover folders remain outside the seven active checkouts; this repeat audit inspected their markers, not their complete file histories.

Two historical stashes are still preserved. The small stash's actual singular/plural driver-scope change (`drivers?`) is present in main's newer classifier. For the larger stash, all 67 edited tracked paths exist in main: 10 blobs match exactly and 57 differ from later/current content. Of 16 saved untracked paths, 10 match main exactly and three have later/different main versions. The remaining three (IMPLEMENTATION_NOTES.md, SCENE_NOTES.md, STORYBOARD.md) are local-only motion-production notes, present in the primary checkout. The stash base and final driver-info/edit branch are ancestors of main. These comparisons do not prove every old hunk redundant; the large stash remains a preserved historical snapshot, not an unmerged branch. Neither stash was restored or deleted.

This repeat audit changed no application code, branch, worktree registration, stash or database and ran no application tests. Saving this mandatory vault record leaves one documentation-only edit in the main checkout; all other worktrees remain clean. No commit, merge or push was performed during this repeat audit.
