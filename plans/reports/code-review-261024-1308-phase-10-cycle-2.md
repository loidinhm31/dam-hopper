# Phase 10 — Cycle 2 Code Review

## Overall assessment

**Score: 6/10. Not ready for Phase 10 qualification sign-off.** Cycle 1 fixes materially improve the journey: credential/debug logging removed from reviewed paths, valid WebSocket close code, genuine two-result Monaco peek, valid unsaved method navigation with disk-unchanged assertion, real newline/non-BMP fixtures, and six checkpoints under one run identity. Remaining issues concern qualification completeness, evidence strength, and an introduced tab-layout regression. No Critical vulnerability demonstrated in the reviewed changes; this is not a whole-subsystem security clearance.

## Critical issues

- None identified in reviewed scope.

## Warnings

1. **High — Required actual-application journeys remain absent.** `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts:15-25,146-393` uses one Admin browser and only one ordinary-user PATCH denial (`167-178`). It never invokes Implementation, navigates as User, exercises User read-only Settings, raw-config/import authorization or demotion, owner/profile/worktree/auth replacement, stale/cancelled navigation, or missing/crash/backoff states. Exact 65,536-byte equality is absent. Phase requirements explicitly require these (`plans/260901-1000-lsp-server-integration/phase-10-linux-web-and-desktop-remote-client-validation.md:30-37,60-67,83-88`). Impact: this passing journey is useful coverage, not complete Phase 10 qualification; lower-layer Phase 09 evidence cannot substitute for required application journeys. Correction: complete missing journeys and captures, or obtain explicit scope reconciliation; do not claim full acceptance from this spec. **Confidence: high.**

2. **High — Zero-child assertions do not cover the complete language-server tree.** `semantic-navigation.spec.ts:121-127,226-228,381-384` matches command lines containing only `typescript-language-server`. Descendant `typescript/lib/tsserver.js` commands need not contain that substring; the observed process tree already documents two such children (`plans/260901-1000-lsp-server-integration/reports/phase-01-process-tree.md:23-27`). Impact: leader disappearance can produce zero matches while semantic descendants/orphans remain. Correction: record PID/start-time and complete descendant/process-group identities while alive, then check all identities and release-engine executables after disable within the existing deadline; corroborate zero overlays/trees. **Confidence: high.** No surviving process was observed by this reviewer; this finding is an assertion blind spot.

3. **High — Source-bound evidence relies on a status-only fingerprint.** Pre-existing dependency `packages/ui/e2e/fixtures/capture-source-fingerprint.ts:27-75` hashes HEAD and `git status` strings, not file contents. Re-editing an already-modified source file leaves its status unchanged; untracked directories are not recursively content-hashed. It feeds image reuse (`image-builder.ts:18-42`) and capture stability (`capture-evidence.ts:229-234`). Impact: stale application images or modified test/source content can retain the same purported source identity. Correction: content-hash relevant tracked/untracked files using robust path enumeration; establish built-asset/image identity against that fingerprint. The host-dist copy in `application-services.ts:208-210` also needs actual asset provenance rather than existence alone. **Confidence: high.** This is a qualification dependency, not a new Cycle 2 regression.

4. **Medium — Reconnect regression guard can accept the pre-close Ready state.** `semantic-navigation.spec.ts:331-362` calls close, immediately waits for Ready, then checks text already present in the local dirty buffer. It does not require a new session/wire URI, post-reconnect definition result, preserved model identity/undo/view state, or observed full replay. Impact: the test can pass before asynchronous close is processed or without proving semantic recovery. Correction: identify the old connection/model, wait for a different ready wire-session identity, navigate to the unsaved definition again, and assert model/text/undo/view continuity. The reported manual disconnect/recovery observation is accepted; this finding concerns automated coverage. **Confidence: high.**

5. **Medium — Two checkpoint images do not establish their advertised states.** `semantic-navigation.spec.ts:386-392` supplies `dockWidth: 320`, but `capture-evidence.ts:151-187` only records that metadata, not a resize. The reviewed `narrow-layout-dock.png` has an approximately 850px editor region and “No file open”; it does not prove narrow editor navigation/focus. In reviewed `default-off.png`, the semantic toggle/status is below the viewport even though `review.md:12-13` describes visible default-OFF controls. Correction: actually set/assert the dock bounding-box width, activate a file and verify focus; scroll default-OFF controls into view before capturing the complete viewport. **Confidence: high.**

6. **Medium — Tab layout styling was accidentally removed.** `packages/ui/src/components/molecules/EditorTab.tsx:55-62` adds useful `data-dirty`, but removes `flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer select-none shrink-0` from the existing class list. The screenshots show stacked icon/name/close elements and cramped tab labels. Impact: unrelated production UI regression, not needed for qualification instrumentation. Correction: restore the existing layout/interaction classes while retaining `data-dirty`. **Confidence: high.**

## Suggestions — architecture, performance, KISS/YAGNI/DRY

- Remove unused `window.__dam_hopper_registry` (`semantic-model-uri.ts:560-562`). Avoid unconditional production exports of whole editor/semantic stores and Monaco (`editor.ts:1706-1708`, `semantic-navigation.ts:302-305`, `monaco-setup.ts:23-25`) plus a production test-only `forceSocketLoss` API (`semantic-client.ts:1627-1639`). Prefer normal UI commands and narrowly scoped, explicitly gated instrumentation where essential. These exports are not themselves an authorization bypass.
- Deduplicate the repeated local Monaco shape declarations in spec helpers; fail immediately if the expected editor is missing instead of silently doing nothing (`semantic-navigation.spec.ts:50-118`).
- Replace the fixed two-second teardown sleep with bounded polling against complete process identities. Check actual adaptive fixture byte lengths; inspected-string calculation is 60,967 → 66,067 → 60,967 bytes, correctly crossing 65,536, but not exercising equality or directly observing sync mode.
- Registry subscription cleanup is explicit and notifications are lifecycle/binding events, not per-keystroke events (`EditorTabs.tsx:487-501`; `semantic-model-uri.ts:282-294,371,414,424,444,457`). No demonstrated new hot-path performance problem in this change. Bundled engine verification and existing application/capture fixtures are reused rather than replaced with synthetic UI.

## Reviewed files

Changed production files: `packages/ui/src/api/semantic-client.ts`; `components/molecules/EditorTab.tsx`; `components/organisms/EditorTabs.tsx`; `lib/monaco-setup.ts`; `lib/semantic-model-uri.ts`; `stores/editor.ts`; `stores/semantic-navigation.ts` (all under `packages/ui/src/`).

Changed/new E2E: `packages/ui/e2e/fixtures/application-data.ts`, `application-services.ts`, `application-storage-state.ts`; `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts`, `evidence.json`, `review.md`, and all six PNG checkpoints.

Supporting evidence: application fixture/capture/fingerprint/image-builder/types helpers; Phase 10 plan and parent status; Phase 01 process-tree report; relevant README, PDR, code standards and testing guidance. Approximately 1,700 code lines/selected ranges plus plans/docs/images inspected. No product, test, or plan status edits; only this requested report created.

## Validation commands and results

- Executed for scope: `git status --short && git diff --stat`; `git diff -- packages/ui`. Result: ten tracked UI/harness files modified, new semantic qualification case and engine artifacts.
- Inspected retained `evidence.json`: run `e2e-run-1792822055160-22649d22`, six 1440×900 checkpoints sharing one fingerprint, functional/cleanup outcomes both recorded `passed`; command recorded as `pnpm --filter @dam-hopper/ui test:e2e` (not exact invocation/environment).
- Inspected `packages/ui/test-results/.last-run.json`: `status: passed`, no failed test IDs. This alone does not identify the exercised test/source.
- Inspected all six PNGs directly; image review above is engineering review, not human visual acceptance.
- Assignment reports 3,205 Vitest tests passing and ESLint zero errors; accepted as supplied validation, not independently rerun. No compile/typecheck/build/lint/test/browser execution performed by this reviewer; execution remains with Main. No coverage percentage available.

## Unresolved questions / acceptance gates

- `review.md:3-9,25-26` correctly remains `PENDING_HUMAN_REVIEW`; human ACCEPTED/REJECTED decision is still required and cannot be supplied by this review.
- Missing required application journeys and complete-tree/source-provenance evidence remain unresolved. No separate current source-bound artifact covering them was supplied or found in the reviewed case.
- Native/Windows/Android remain deferred; no new support claim or native-origin exception reviewed.
