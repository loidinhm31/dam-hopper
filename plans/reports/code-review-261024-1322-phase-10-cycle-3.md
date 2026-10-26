# Phase 10 — Cycle 3 Code Review

## Assessment

**Score: 7/10. Improved; not ready for Phase 10 qualification sign-off.** No Critical vulnerability demonstrated in reviewed changes. Remaining blockers concern application-journey coverage, false-positive assertions, source provenance, and mandatory human acceptance—not proof that the underlying semantic implementation is broken.

Confirmed Cycle 2 improvements: EditorTab layout/spacing/transition classes restored with `data-dirty` retained; process scan now matches both TSLS and `tsserver`; Settings OFF/ON controls and portable advisory visible in current images; post-socket-close Definition command added; final capture opens `impl.ts`; all six checkpoints recorded under `e2e-run-1792822881080-39a0b4eb`, each declared 1440×900. Reviewed all six images directly. These improvements do not close every Cycle 2 finding.

## Critical issues

- None identified in reviewed scope. This is not a whole-subsystem security clearance.

## Warnings

### W1 — High: Required actual-application qualification remains incomplete

**Evidence:** `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts:15-25,146-400`; Phase 10 plan `:30-37,60-68,83-88`.

The sole journey uses one Admin browser and one ordinary-user dedicated PATCH rejection. It does not exercise Implementation, ordinary-user navigation/read-only Settings, raw-config/import denial, live admin demotion, empty/outside-target results, exact 65,536-byte equality, cancellation/stale results, owner/profile/worktree/auth replacement, or missing/crash/backoff states. Multi-result coverage opens a peek and closes it without selecting a result. Required User, Implementation, reconnect-recovery and invalidated/error captures are absent from the six current checkpoints. Phase 09 lower-layer tests do not replace these explicitly required actual-app journeys.

**Impact:** Green smoke coverage cannot establish complete Phase 10 acceptance. **Correction:** Complete the named application matrix and required captures, retaining per-journey evidence. **Confidence: high.**

### W2 — High: Source identity still hashes status, not source content

**Evidence:** `packages/ui/e2e/fixtures/capture-source-fingerprint.ts:27-75`, `image-builder.ts:18-42`, `capture-evidence.ts:229-234`, `application-services.ts:208-210`.

The fingerprint hashes HEAD plus porcelain status strings. Re-editing an already-modified file does not change its status; untracked directories do not identify recursive contents. The same identity controls image reuse and capture freshness. Independently copied host `apps/web/dist` is not bound to a recorded build digest.

**Impact:** Changed source, stale application images, or unrelated/stale host builds can retain the purported current source identity. This is an unchanged shared-harness dependency, not a new Cycle 3 regression, but remains material to this phase's source-bound qualification contract.

**Correction:** Content-hash relevant tracked/untracked inputs using robust path enumeration, and record/bind the served web/server/tool artifact identities to that content fingerprint. **Confidence: high.**

### W3 — Medium: Some navigation assertions can pass without navigation

**Evidence:** `semantic-navigation.spec.ts:50-68,240-246,265-276`.

The TSX test sets the source cursor to line 5, then accepts destination lines `[3,4,5]`; its expected `impl.ts` tab is already open. A failed reveal leaving the source at line 5 can satisfy both assertions. Helpers also silently do nothing when Monaco/editor is missing. The multi-result test asserts widget presence/text but not a selected destination.

**Impact:** The four-extension and multiple-selection claims are stronger than their regression guards. **Correction:** Fail immediately when editor lookup fails; assert active model URI/tab and exact destination selection/range, then select a peek result and verify its destination. **Confidence: high.**

### W4 — Medium: OFF teardown is tested after unloading the active workspace

**Evidence:** `semantic-navigation.spec.ts:28-31,373-390`.

`openSettingsPage()` performs `page.goto`, unloading the workspace and its WebSockets before the Admin disables semantics. Subsequent zero-process assertions can therefore prove disconnect cleanup rather than OFF terminating an active semantic session or outstanding request.

**Impact:** Active global hot-disable/admission cutoff remains unqualified by this journey. **Correction:** Keep a ready workspace/client active in a separate page/session while Admin toggles OFF; verify that existing client becomes OFF, outstanding work cannot publish, admission stops, and process/overlay counts reach zero within the qualified deadline. **Confidence: high.**

### W5 — Medium: Reconnect guard still does not establish dirty-model replay

**Evidence:** `semantic-navigation.spec.ts:327-369`; `packages/ui/src/api/semantic-client.ts:630-640,1631-1638`.

The new post-close Definition is useful. However, the immediate Ready assertion can still observe the pre-close state; a fixed one-second wait does not identify the replacement session. The subsequent jump targets a disk-backed interface, not the unsaved-only method. No assertions compare old/new wire session identity or preserve local model identity, undo and view state.

**Impact:** The reported observed disconnect/recovery is not disputed; the automated regression can miss failed dirty-buffer replay or model replacement. **Correction:** Observe a new ready session/wire binding, navigate to `getUnsavedValue` after recovery, and compare local model/text/undo/view continuity. **Confidence: high.**

### W6 — Medium: Narrow capture is still a wide editor with metadata only

**Evidence:** `semantic-navigation.spec.ts:392-399`; `capture-evidence.ts:151-187`; `semantic-navigation/narrow-layout-dock.png`; `review.md:22-23`.

Opening `impl.ts` fixes the empty-editor problem. But `dockWidth: 320` only enters metadata; the helper does not resize a dock. The current image still shows an approximately 850px-wide editor, and the test never measures a 320px dock or verifies editor focus.

**Impact:** The advertised narrow-layout/focus checkpoint remains unproven. **Correction:** Actually configure/resize the intended dock using the repository convention, assert its bounding-box width and focus, then capture the complete 1440×900 viewport. **Confidence: high.**

## Suggestions — security, performance, architecture, KISS/YAGNI/DRY

- Remove unused `window.__dam_hopper_registry` (`semantic-model-uri.ts:560-562`). Avoid shipping unconditional whole-store/Monaco globals (`editor.ts:1706-1708`, `semantic-navigation.ts:302-305`, `monaco-setup.ts:23-25`) and a production qualification-only `forceSocketLoss()` API (`semantic-client.ts:1627-1638`). Prefer normal UI actions and narrowly scoped, explicitly gated instrumentation where essential. These exports are not themselves an authorization bypass.
- Keep the broadened TSLS/tsserver process scan. Replace fixed teardown sleeps with bounded polling against qualified deadlines and corroborate zero overlays/trees. Captured PID/start-time/process-group identities would strengthen complete-tree/orphan evidence beyond substring matching (`semantic-navigation.spec.ts:121-127,387-390`).
- Deduplicate repeated Monaco shape declarations and assert actual UTF-8 fixture sizes; the fixture/test size comments are approximate and do not establish exact threshold equality (`application-data.ts:165-171`; spec `:309-325`).
- The new `userRoles` option silently ignores ordinary-user roles for SQLite (`application-services.ts:281-293`). Implement that supported branch or reject the incompatible configuration, rather than letting a future authorization test unknowingly keep an Admin identity. Serialize Mongo query values rather than interpolating usernames into JavaScript.
- Registry-status subscription has explicit unsubscription and listens to binding/lifecycle changes, not every keystroke (`EditorTabs.tsx:486-501`; `semantic-model-uri.ts:281-295,371,414,424`). No new hot-path performance defect demonstrated. Existing application/auth/capture fixtures and bundled-engine verification are reused; no native-origin bypass or client-local TSLS introduced in reviewed changes.

## Reviewed files

Changed production files, under `packages/ui/src/`:
- `api/semantic-client.ts`
- `components/molecules/EditorTab.tsx`
- `components/organisms/EditorTabs.tsx`
- `lib/monaco-setup.ts`
- `lib/semantic-model-uri.ts`
- `stores/editor.ts`
- `stores/semantic-navigation.ts`

Changed/new E2E files:
- `packages/ui/e2e/fixtures/application-data.ts`, `application-services.ts`, `application-storage-state.ts`
- `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts` (full 401 lines), `evidence.json`, `review.md`, and all six PNGs.

Supporting selected ranges: `application-fixture.ts`, `capture-evidence.ts`, `capture-source-fingerprint.ts`, `image-builder.ts`, UI `package.json`, `.last-run.json`, Phase 10 plan/parent status, Cycle 2 report, README, PDR, code standards and testing guide. Approximately 1,500 code lines/selected ranges plus documentation/images inspected. No product, test or plan-status edits; only this report created.

## Validation commands and results

- Executed for review scope: `git status --short && git diff --stat`; `git diff -- packages/ui`. Result: ten tracked UI/harness files modified; new semantic qualification case, staged engine and prior report present.
- Inspected `evidence.json`: run `e2e-run-1792822881080-39a0b4eb`; six declared 1440×900 checkpoints; functional and cleanup outcomes recorded `passed`. Recorded command: `pnpm --filter @dam-hopper/ui test:e2e`; exact flags/environment not retained there. PNG dimensions/hashes were not independently recomputed by this reviewer.
- Inspected `packages/ui/test-results/.last-run.json`: `status: passed`, `failedTests: []`. Marker alone does not identify tested source or exact case.
- Directly inspected all six retained PNGs: Settings states/advisory and restored tabs visible; genuine two-result peek and dirty method visible; final editor remains wide.
- Assignment reports **3,205 Vitest tests passing; ESLint zero errors**. Reported, not independently verified or rerun. No compile/typecheck/build/lint/test/browser command executed by this reviewer; Main owns execution. No coverage percentage available.
- After corrections, Main should run package build/typecheck, E2E typecheck, affected Vitest tests, lint and the source-bound application qualification journey with capture enabled; obtain actual human review afterward.

## Unresolved questions / acceptance gates

- `semantic-navigation/review.md:3-9,25-26` remains **PENDING_HUMAN_REVIEW**. A real human decision bound to the final run/source/image identity is mandatory; this engineering review cannot supply it.
- Where is source-bound actual-app evidence for the missing Phase 10 journeys? None supplied or found in the reviewed case. Until provided, matrix/provenance/narrow/reconnect/hot-disable gaps remain open.
- Native including Linux Tauri, Windows and Android remains deferred/unqualified/non-blocking. No additional platform support claim established.
