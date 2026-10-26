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

## Stash removal - 2026-10-26

Both preserved stashes were removed with the owner authorization against HEAD `841e4711`, after a fresh per-hunk redundancy check that extends the blob statistics above.

- `stash@{0}` `0c215b4f99d12e87ff6b159bb1347a64dd71a4f2` (Copilot singular/plural driver wording): all three modified files already match HEAD; the `drivers?` classifier regime and both "singular and plural driver terms" documentation sentences are present verbatim.
- `stash@{1}` `2d8351aecf23eac624c26a5298d3df95f0b67ce0` (driver-info/edit pre-review snapshot): of the 67 tracked paths, 10 blobs are identical in HEAD and 57 are behind later evolution. A line-by-line check of every stash-added line against current HEAD content found no file reverted to its base and no stash-only hunk lost; the only misses are two refreshed `last_verified:` date stamps and lines reworded or rebuilt by the 13 commits between this snapshot and its branch tip `bf9e54be`, which is an ancestor of main (`git merge-base --is-ancestor feature/driver-info-edit-sync HEAD`).
- The old caution that "restoring either blindly could replace newer fixes" is resolved by that evidence: there is nothing left to restore that is not already present in a current form.
- Of the 16 saved untracked paths, 13 are tracked in main (four implementation plans including the 2026-09-29 inspection plan, the `mobile/lib` empty-state/odometer/escaping modules with their tests, the Capstone inspection UI/UX plan and the motion reel note) and 3 remain intentionally gitignored local working files still on disk (IMPLEMENTATION_NOTES.md, SCENE_NOTES.md, STORYBOARD.md), matching the local-only policy from `5bdc9a02`.
- Backup taken before the drop: full patch exports of both stashes (untracked content included) plus their SHAs and restore instructions at gitignored `scratch/stash-retirement-2026-10-26/` (README.txt and two `.patch` files). The dropped commits also remain reachable by SHA in the object store until pruning.

This removal changed no application code. Line membership does not by itself prove semantic equivalence; the branch covered the work with its own commits and pinned tests. Related: [[Worktree and Merge Audit 2026-10-08]], [[2026-10-01]], [[Sequential Branch Merges 2026-10-16]].
