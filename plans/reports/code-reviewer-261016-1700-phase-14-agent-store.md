# Code Review — Phase 14 Agent Store imports + memory (S01, S02)

Branch `feat/android-native-app`. Plan: `plans/261015-1647-android-native-app/phase-14-agent-store-imports-and-memory.md`.

## Score: 5/10

Solid structure (repo/controller/screen split, retire() fencing, request-sequence on loads, snapshot-capturing save, cleanup derived from captured source, 0 FAB/0 WebView, Mermaid deferred). But 2 data-integrity defects in memory editor violate invariant #4, several plan-required actions have no UI, and mutation failure feedback is mostly invisible. Not mergeable as "phase done".

## Scope
- Files: 11 prod files under `features/agents/` (3.4k LOC) + `WorkbenchScreen.kt` diff (+95/-2) + 3 jvmTest + 1 androidApp test + `tests/test-phase-14-agent-store-memory.sh`.
- Cross-checked server: `server/src/api/agent_import.rs`, `agent_store/importer.rs`, `agent_store/distributor.rs` (matrix key shape OK), `api/agent_memory.rs` (`write` default false OK).
- Focus: security, fencing, draft protection, partial failure, YAGNI/KISS/DRY, plan completeness.

## Critical

C1. **Cross-target memory overwrite** — `AgentMemoryController.loadMemory` (l.101-114) sets `selectedProject/selectedAgent=B` immediately but keeps A's `content`/`initialSavedContent`. Save button (`AgentMemoryScreens.kt:113`) is `enabled = !isSaving && selectedProject != null` — not gated on `isLoading`/load error. While B loads (spinner) or after B read fails (`onFailure` only sets `error`, l.134-139; `isDirty=false`, A text shown), tap Save → `saveMemory` PUTs A's content to B's memory file. Also when read succeeds late it overwrites the just-saved buffer in UI (server now differs). Fix: on loadMemory start clear `content`/`initialSavedContent` (or track `loadedTarget`), set `Save enabled = loadedTarget == selectedTarget && !isLoading && error==null`; in `saveMemory` refuse when not loaded for that target. Add test: switch target + save-before-response, switch + read 500 + save.

C2. **Dirty draft silently destroyed on project-list refresh** — `WorkbenchScreen.kt:576` `LaunchedEffect(projects){ setProjects }` → `setProjects` (l.71-87) unconditionally calls `loadMemory` (clobbers `content`, clears preview) with no dirty check. Triggers: workspace switch (`projects=emptyList()` then new list, l.1129-1136), any `projects` reassignment, selected project missing → silent jump to `projects.first()`. Also invoked twice on connect (l.312 explicit + LaunchedEffect) → duplicate templates+memory loads. Violates invariant #4 (draft identity {profileId, project, agent}). Fix: setProjects must only refresh list; if selected target still present keep state; if gone and dirty → `pendingTargetSwitch`; drop the redundant explicit call at l.312 (or the LaunchedEffect). Include workspace/config identity in the draft owner or retire draft on workspace switch with explicit prompt.

## Warnings (High → Medium)

W1. **Import stuck spinner / dead Scan button** — `setSource`/`resetScan` bump `scanRevision` but never reset `isScanning`/`isImporting`. Stale scan result is dropped (`rev != scanRevision` return, l.166/190) → `isScanning` stays true; Scan button (`AgentImportScreens.kt:148`) disabled until profile retire. Reproduce: start scan, toggle source. Fix: set `isScanning=false` in every invalidating transition; only the owner of the current rev clears it.

W2. **Mutation errors invisible** — `mutationError` rendered only in `ShipItemDialog` (`AgentStoreScreens.kt:481`). Matrix-cell ship/unship, delete (`DeleteConfirmDialog` has no error slot, dialog stays open silently), absorb: failures/denials set state nobody displays. Plan: "partial-failure/denial feedback". Add a mutation banner at view level + error in delete dialog.

W3. **Unreviewed mutations from matrix** — `AgentDistributionMatrixView` l.594-600: single tap on a 90dp cell immediately ships/unships (no review/confirm; tap on shipped = unship). Plan: "explicit reviewed mutation intents". Add confirm sheet (item, project, agent, method, symlink vs copy) and expose `force`/absorb deliberately. No in-flight guard in controller for overlapping mutations (first completion resets `isMutating=false` while second runs).

W4. **Plan-required surface missing/dead** — No UI/controller path for: absorb (controller fn `absorbItem` never called), project scan (`scanProjects`/`ProjectAgentScanResult`), item detail (`getItem`), per-project memory list (`listProjectMemory`), unship `force`. Repo methods + DTOs dead (YAGNI) yet plan scope lists them. Either wire them or record a documented descope in the acceptance ledger (needs user approval per plan).

W5. **Plan step 7 / success criteria unmet by evidence** — plan file still "pending / 0%"; no ledger/docs update; no real temp-server run (symlink outcomes, partial failure, import races). Phase test script is 99 `grep -F` presence assertions (cannot catch C1/C2/W1). Plan states compilation/tests alone do not satisfy native-surface acceptance.

W6. **Uncertain-result handling** — on transport failure after request dispatch (ship/unship/absorb/bulk/delete/import confirm) controllers only show `err.message`; no reconcile (`loadStore`) and no "outcome uncertain" marker. Partial import success: `onSuccess`→`storeController.loadStore` fires only when all succeed (`AgentImportController.kt:250`), so partially imported items don't appear in catalog until manual refresh. Plan step 6 not met.

W7. **Import correctness** — (a) `itemKey = category:name` omits `relativePath`; duplicate names in one scan collapse selection, both items sent on confirm, and `allSelected`/`toggleSelectAll` (size compare) mis-evaluate. (b) After REPO confirm server `cleanup_import` deletes tmpDir regardless of per-item results, but `capturedScan` stays and Import button stays enabled → retry hits "Source directory does not exist". Clear/lock `capturedScan` after a REPO confirm. (c) No in-controller guard against double `confirmImport`/confirm-during-scan (UI-only `enabled`). (d) New scan during in-flight import lets old results land under new scan state. (e) `startScan` while a REPO scan discarded by revision leaves server tmp clone orphaned (no cancel endpoint) — note.

W8. **Memory template flow** — (a) `applyTemplatePreview` silently replaces an edited preview; (b) `adoptPreviewIntoEditor` and `savePreviewAsMemory` overwrite a dirty editor draft without confirm; (c) preview is read-only `MarkdownPreviewView`, so `updatePreviewContent`, `isPreviewEdited`, `showDiscardPreviewConfirm`, preview-edit target-switch guard are unreachable dead code (or plan "edit" is unmet); (d) `isApplyingTemplate` stays true when response target mismatches (l.210-216 returns `current`) → permanent spinner; failure branch ignores target; `loadMemory` doesn't bump `templateOpRevision` (A→B→A stale match); (e) `saveMemory` success keeps old `initialSavedContent` if user typed during save; reverting typing to the old baseline shows "clean" though server holds captured text — set `initialSavedContent=capturedContent` always and compare content to it; (f) `savePreviewAsMemory` clears preview even if edited during save; (g) Save As Memory button not disabled while saving.

W9. **Silent staleness** — `loadMatrixAndHealth` ignores failures; `shipCounts`/matrix keep old data (or empty → "Shipped to 0" and "○ Ship" for already-shipped cells → tap ships over existing). `selectItem` content failure → `""` → "No content available" (masks error/denial). Plan: explicit stale/unavailable state.

W10. **Perf** — `AgentStoreController` `init` + memory `setProjects` + templates fire on every connect regardless of panel visibility; every mutation → `loadStore()` = list + matrix + health (server walks all projects/agents) even for one matrix tap; matrix and health fetched sequentially; category filter applied server-side AND client-side (`filteredItems`) → refetch of full matrix/health on each chip tap; `filteredItems` getter recomputed 3+ times per recomposition. Prefer lazy-on-open, matrix-only refresh after mutation, parallel fetch, `remember`/derived state.

W11. **Fencing/owner** — `profileId`/`generation` ctor params are stored but never read (owner enforced only by instance+`retire()`); controllers replaced in `WorkbenchScreen.kt:302-304` without retiring the previous instance (profile A→B direct re-run); `isRetired` and op counters are plain non-volatile `var`s (tests use `Dispatchers.Default`; prod scope not guaranteed single-threaded). Mutation ops (ship/unship/absorb/delete/bulk/import confirm) have only `isRetired` fence, no monotonic revision — contrary to stated invariant #3. `resetScan` lacks `isRetired` guard.

W12. **Server-side destructive cleanup (pre-existing, outside diff)** — `import_confirm_handler` calls `cleanup_import(source_dir)` = `remove_dir_all` on a client-supplied path with no check it is a scan-produced tmp dir. Android derives `cleanup` correctly (REPO only), and `ImportConfirmRequest.cleanup` default is **`true`** (`AgentStoreModels.kt:306`) — unsafe default; flip to `false`/required. Raise server hardening separately (needs backend design review per plan).

## Suggestions
- S1. Split `AgentStoreScreens.kt` (847 LOC): matrix, ship dialog, delete dialog, results dialog → own files (project rule: small kebab/self-documenting modules).
- S2. `WorkbenchScreen` agents block duplicates ~45 lines of install/uninstall lambdas for the legacy `AgentsPanelScreen` fallback; extract once or remove fallback (controllers are always created with the client). Replace `!!` with local vals.
- S3. Use `AgentStoreHelpers.projectAgentKey` in matrix view (inline `"$proj:${ag.wireName}"` duplicates it).
- S4. Memory editor uses raw `BasicTextField`; plan says use shared editor components (Phase 09 undo/large-file tiering). Add size guard for huge memory files.
- S5. Consolidate the 6 near-identical mutation fold blocks in `AgentStoreController` into one `runMutation(label){}` helper (DRY) — also the natural place for in-flight guard + uncertain-outcome reconcile.
- S6. Controller tests poll with `Thread.sleep`/wall-clock `waitUntil`; use `runTest` + injected dispatcher for determinism. Add tests for C1, C2, W1, W7, W8(d,e).
- S7. Server error text may echo `repoUrl` containing credentials into `scanError`; scrub userinfo before display, and warn in UI not to embed tokens (plan: no import URLs with secrets in diagnostics). No logging found in the diff (good).
- S8. Call `retire()` on previous controllers before replacing; expose draft-loss prompt on profile switch if dirty memory exists.

## Positive
- Clean wire models; kebab-case wire names; `ApiClient.encodePathSegment` used for all path params; query via map.
- Matrix key shape matches `distributor.rs` (`item_key → "<proj>:<agent>"`).
- Template preview calls `write=false`; `write=true` never sent.
- `cleanup` derived from captured source, not UI state; source/reset/new-scan all bump revision and null captured scan + selection.
- Save captures snapshot and keeps newer edits dirty; target switch prompts on dirty draft.
- 0 FloatingActionButton, 0 WebView in `features/agents` (verified by grep); Markdown view only shows deferred notice for Mermaid, no HTML engine.
- Bulk results dialog shows per-item/target outcomes; partial failure sets `mutationError` and withholds `onSuccess`.
- No server/web changes.

## Validation
| Command | Result |
|---|---|
| `./tests/test-phase-14-agent-store-memory.sh` (run by reviewer) | 99 passed / 0 failed (grep-presence assertions only) |
| `./gradlew :shared:jvmTest` | 248 passed — reported by Main, NOT re-run by reviewer |
| `:androidApp:testDebugUnitTest :androidApp:testReleaseUnitTest` | 51 passed — reported by Main, NOT re-run |
| `:androidApp:assembleDebug` | BUILD SUCCESSFUL — reported by Main, NOT re-run |
| 13 regression suites (953 static assertions) | reported by Main, NOT re-run |
| Real-server runtime exercise (plan step 7) | NOT performed |

Defects C1/C2/W1 found by code trace, not executed; no existing test covers them.

## Metrics
- Test: 6 controller + 8 repository + serialization + 1 android test; no coverage tool run. Lint: not run.

## Recommended order
1. Fix C1, C2, W1 (+ regression tests).
2. W2/W3 (mutation banner + matrix confirm), W6, W7, W8(d,e).
3. W4 wire absorb/scan/detail or get descope approval; W5 real-server run, update ledger/docs.
4. W10-W12, S1-S8.

## Unresolved questions
1. Is absorb/project-scan/detail/force-unship UI descoped? Plan scope says all must ship; no approval seen.
2. Should memory drafts be keyed by workspace config too (project name collisions across `switchWorkspace`)?
3. Does the server echo `repoUrl` userinfo in git-clone errors? (not verified)
4. Server `cleanup_import` unvalidated `remove_dir_all`: in-scope for a backend fix ticket?
5. Is the production `coroutineScope` single-threaded (Main)? Determines severity of non-volatile `isRetired`/counters.
