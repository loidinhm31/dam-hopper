# Phase 01 Lifecycle Prototype — Cycle 2 Code Review

## 1. Score

**6/10 — request changes; technical lifecycle qualification gate remains incomplete.**

## 2. Summary

Route integration improved: lazy `/os`, local profile/token guard, legacy shortcut exclusion, and default dashboard regressions are present. Resource-claim hook dependencies match captured keys; current adapters memoize claim keys. No newly introduced server-authorization, injection, or performance defect identified in scoped production changes. Root services remain shared; no extra abstraction or dependency introduced (KISS/YAGNI/DRY).

Qualification changes do not yet prove the requested lifecycle guarantees. Component assertions can pass when mock resources are detached. E2E marks a disposable app slot rather than the parked resource, and its desktop journey contradicts current shell navigation. Passing typechecks/component tests do not establish the real application gate.

### Cycle 1 dispositions

| Finding | Cycle 2 disposition |
|---|---|
| C1: shell-only E2E, no real lifecycle oracle | **Open**. App-slot markers are not xterm/editor/model/iframe identities; no attach/replay/reset baseline, dirty Monaco undo, live preview JS, or separate reconnect proof. |
| C2: missing `/os` authentication boundary | **Addressed at local UI boundary** (`dam-hopper-app.tsx:142-167,470-478`); token presence/no-auth profile guard added. Server authorization remains independent. |
| C3: component continuity checks only state/registry | **Partial, not closed**. Terminal DOM checks added but optional-chain assertions admit detached nodes; editor never undergoes the transition matrix. |
| W1: conditional E2E transitions | **Addressed structurally** (`os-lifecycle.spec.ts:50-103,117-150`): unconditional assertions/actions. Actual journey remains unexecuted and has sequencing defects below. |
| W2: legacy new-terminal shortcut on `/os` | **Addressed in source** (`dam-hopper-app.tsx:124-137`); no direct shortcut regression test added. |
| W3: unsupported visual review metadata | **Addressed as honest pending status**, not visual acceptance (`review.md:3-13`). No evidence capture/human review yet. |
| W4: viewport not forwarded | **Addressed for this page** via explicit `setViewportSize` (`os-lifecycle.spec.ts:18-19`). |
| W5: missing default-root assertion/unmanaged new route tests | **Addressed** (`dam-hopper-app.test.tsx:65-91,170-213`); new tests use suite-managed root/container and cover dashboard/authenticated/unauthenticated routes. |

Plan/task state intentionally unchanged: review assignment requests terminal findings, no TODO tracking; coordinator owns task disposition.

## 3. Critical issues — MUST FIX

No new critical-severity security vulnerability established. Following **high-priority qualification blockers** must be fixed before accepting Task 4.

### R1 — C1 remains open: E2E tracks a disposable app wrapper, not live resources

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:44-64,74-103,105-115,140-144`; supporting `packages/ui/src/os/DesktopCanvas.tsx:40-52,102-116` and `packages/ui/src/os/apps/TerminalsApp.tsx:83-103`.
- Marker is written to `[data-os-terminals-app]`, the app's mounting slot. Tile/float use different React render branches, and minimization unmounts the frame/app body. Those wrappers may legitimately be replaced while the parked terminal survives. **[INFERENCE, high confidence]** Current marker assertions fail on such a permitted remount, even with a correct resource host.
- No settled live PTY output, actual xterm object identity, outbound `terminal:attach`/replay/reset counters, Monaco editor/model/dirty undo, preview iframe/JS identity, or separate owner-revalidated reconnect scenario is asserted. Thus preserving this marker would still not close C1.
- **Correction:** Establish actual live resources through the isolated application fixture; capture resource-owned identity references and post-attach counter baselines; assert identity and zero deltas after every placement. Keep reconnect evidence separate. Do not change production architecture to preserve disposable app-slot markers.
- **Confidence:** High; static source/contract evidence. Not a claimed observed E2E failure.

### R2 — C3 continuity assertions admit detached resources; editor never moves

- **Evidence:** `packages/ui/browser-tests/os-lifecycle.browser.tsx:338-357,373-397,399-447`.
- `expect(mockTermEl.parentElement?.closest(selector)).not.toBeNull()` passes when `parentElement` is null: optional chaining returns `undefined`, which is not null. Same defect at the only Monaco assertion (`:447`). Therefore the new tests can remain green even if the registered DOM nodes never attach or stop reattaching.
- Monaco is registered with a null editor (`:357`) and opened only after all terminal transitions (`:436-447`); no editor tile/float/maximize/minimize/desktop continuity is exercised. This is DOM-fixture coverage, not live Monaco editor/model/undo evidence.
- **Correction:** Require a connected resource and compare the slot's actual queried node with the captured node using `.toBe(...)`, or require `slot.contains(resourceNode) === true`. Run the placement/inactive-desktop matrix for both resources. Keep real editor/model/undo proof in the full E2E gate; mocks remain legitimate for the focused DOM boundary.
- **Confidence:** High; JavaScript/assertion semantics and inspected test ordering.

### R3 — E2E desktop sequence cannot reach its terminal move; locator is unstable

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:39,105-128`; supporting `packages/ui/src/os/OsShell.tsx:73-86,211-217` and `packages/ui/src/os/DesktopCanvas.tsx:102-116`.
- Add Desktop immediately activates the new empty desktop. The next assertion expects the old terminal's move selector to be visible without switching back. **[INFERENCE, high confidence]** After fixing the earlier resource-marker oracle, this step times out because Desktop 1's frames are no longer rendered.
- `termFrame = locator('[data-os-window-frame]').first()` is positional and re-resolved per action. Opening the tiled editor changes DOM order ahead of the floating terminal; it no longer reliably identifies the terminal even after switching back.
- **Correction:** Capture the terminal frame's stable window ID immediately after launch, construct an ID-qualified locator, assert Desktop 2 activation, switch back to Desktop 1, then move that exact terminal and verify it on Desktop 2.
- **Confidence:** High; static source evidence. Live journey not run.

## 4. Warnings — SHOULD FIX

1. **Input-isolation evidence remains structural.** `os-lifecycle.spec.ts:152-161` toggles Cognito and checks overlay/inert attributes but sends no input/paste/pointer to live terminal/editor/preview and observes no PTY bytes or editor/preview mutations. Component focus cycling (`os-lifecycle.browser.tsx:450-489`) dispatches on frame chrome and checks store focus only, not actual DOM focus, terminal-origin handling, or zero PTY bytes. Add behavioral assertions required by phase contract lines 35-38 and 276-284; current checks cannot establish AC11.
2. **Authentication branch regression gap.** Route tests cover missing profile and a profile with token, but not an existing authenticated-type profile with no token, permitted `authType: 'none'`, or token/profile removal while `/os` is mounted (`dam-hopper-app.test.tsx:170-213`). These are security-relevant UI gate branches; no backend authorization bypass is alleged.
3. **Qualification evidence still pending.** No live application E2E execution, production web bundle result, or human visual inspection is supplied by Cycle 2 evidence. `@dam-hopper/ui build` is TypeScript compilation only (`packages/ui/package.json:7`), not `@dam-hopper/web`'s Vite production bundle. Pending visual ledger is correct, but not an acceptance receipt.

## 5. Suggestions — NICE TO HAVE

- Add a direct Ctrl+Backquote regression proving `/os` stays on `/os`, while legacy routes still open a workspace terminal; also cover already-prevented events.
- Share a small placement assertion helper between component cases only after both real transition matrices exist; avoid a new general-purpose lifecycle testing framework.

## 6. Reviewed files

All six requested files inspected in full (approximately 1,534 lines):
- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/embed/dam-hopper-app.test.tsx`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx`
- `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts`
- `packages/ui/e2e/os-lifecycle/review.md`
- `packages/ui/src/os/resource-registry.ts`

Supporting evidence: Phase 01 plan/acceptance; README; relevant PDR/code standards/testing sections; `OsShell.tsx`, `DesktopCanvas.tsx`, `WindowFrame.tsx`, `OsResourceHost.tsx`, `MonacoKeepAliveHost.tsx`, three app adapters, profile hook; application/capture fixtures; UI/browser/Playwright/web build configuration; Cycle 2 tester report. Supporting files reviewed only as needed for scoped contracts.

## 7. Validation commands and results

No duplicate builds/tests/linters run by reviewer; existing tester owns execution. Results below are **reported evidence**, not independently executed results: `plans/reports/tester-261102-1048-phase-01-cycle-2-validation.md:25-35`.

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/embed/dam-hopper-app.test.tsx` | Exit 0; 5/5 tests |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-lifecycle.browser.tsx` | Exit 0; 9/9 tests; oracle limitations R2 |
| `pnpm --filter @dam-hopper/ui test src/os/` | Exit 0; 26/26 tests |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; no TypeScript errors; no journey execution |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; UI TypeScript compilation |
| Targeted tile-tree/docking/terminal/browser/Monaco keep-alive unit regressions (exact command in tester report :34) | Exit 0; 41/41 tests across 5 files |

Actual application journey **not run**: `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle`. Main should execute after fixes, collect per-placement/reconnect/input evidence, then obtain human review. Production bundling (`pnpm --filter @dam-hopper/web build`) and lint not reported; type/test coverage percentages not measured.

## 8. Unresolved questions

No product decision needed. Unresolved evidence: successful corrected live E2E, genuine xterm/Monaco/preview/counter/input/reconnect proofs, production bundling, captured artifacts and human visual review. Existing component/typecheck success does not resolve these gates.
