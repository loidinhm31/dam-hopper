# Phase 01 Lifecycle Prototype — Cycle 3 Code Review

## 1. Score

**7/10 — request changes for technical lifecycle qualification; scoped route integration improved.**

## 2. Summary

Cycle 2 remediation materially improves component coverage: connectedness/slot containment no longer accept undefined, both terminal and editor traverse the placement matrix, and editor DOM references are compared explicitly. Route tests now cover missing profile, missing token, token-present/no-auth access, default dashboard and Ctrl+Backquote isolation. E2E uses an ID-qualified terminal frame and switches back before moving it. Explicit viewport forwarding and honest pending visual status retained.

No new critical security vulnerability, material performance regression, duplicated root service, or unnecessary abstraction identified in scoped production edits. Lazy authenticated route and existing root providers preserve KISS/YAGNI/DRY. Claim callbacks capture their declared key dependencies; current adapter callers memoize keys.

**Task 4 remains incomplete:** the E2E still does not author the live resource/counter/reconnect/input acceptance oracles. Running its current assertions cannot establish the phase contract. Plan/task state intentionally unchanged; this assignment requests terminal review, no TODO tracking.

### Previous findings disposition

| Cycle 2 finding | Cycle 3 disposition |
|---|---|
| R1/C1: wrapper marker instead of live resource gate | **Open**; fallback still marks disposable wrapper; see M1. |
| R2/C3: detached-node false positives; editor never moves | **Addressed for visible component DOM boundary** (`os-lifecycle.browser.tsx:373-515`): strict connectedness/containment plus both matrices. Hidden intervals and actual resource object lifetime remain unproven. |
| R3: incorrect desktop sequence; positional terminal locator | **Addressed structurally** (`os-lifecycle.spec.ts:39-45,118-145`); live E2E unexecuted. |
| W1: input isolation only structural | **Open**; typing added without an outcome assertion, see M2. |
| W2: missing authentication branches | Missing-token/no-auth tests added; reactive token/profile removal still untested. |
| W3: missing production bundle and live/visual evidence | Production bundle reported successful; live E2E and human visual acceptance still pending. |
| Earlier conditional transitions, viewport, default root, legacy shortcut | Remediations retained; direct `/os` Ctrl+Backquote test now added. |

## 3. Critical issues — MUST FIX

No new critical-severity exploit established. These are **high-priority qualification blockers**, not claims of observed production exploits.

### M1 — E2E resource oracle still permits a disposable wrapper; live lifecycle contract absent

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:48-60,72-145`; phase contract `phase-01-lifecycle-prototype.md:35-38,276-284`.
- `slot.querySelector(".xterm, [data-terminal-container]") ?? slot.firstElementChild` accepts the TerminalsApp wrapper when the terminal has not appeared. No live-terminal readiness assertion precedes tagging. That wrapper legitimately remounts across tile/float/minimize (`DesktopCanvas.tsx:40-52,102-116`; `TerminalsApp.tsx:83-103`). **[INFERENCE, high confidence]** The test can tag the wrong node and fail valid lifecycle behavior; preserving a wrapper would still not prove the same xterm object.
- Journey never establishes streaming PTY output, captures xterm identity or settled attach/replay/reset baselines, creates dirty Monaco/model/undo state, or asserts loaded preview JS/iframe continuity. Editor/browser are launched only (`:106-116`). Separate generation-changing reconnect/changed-incarnation coverage is absent entirely.
- **Correction:** Require an actual ready terminal with no wrapper fallback; capture live resource references and post-attach counters, then assert same identities/zero deltas per placement. Exercise dirty editor and controlled running preview similarly. Author reconnect proof separately. Do not preserve disposable app wrappers to satisfy this test. Existing source-remediation ownership restrictions remain applicable where real controllers are missing.
- **Confidence:** High; static source and explicit acceptance contract. No live E2E failure claimed.

### M2 — Cognito input test has no behavioral oracle and targets no live app

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:147-164`; component focus cycling `packages/ui/browser-tests/os-lifecycle.browser.tsx:518-557`.
- Terminal is left on Desktop 2, then the journey switches to Desktop 1. It toggles privacy, types text, and checks overlay dismissal only. No terminal/editor/preview is focused, no paste/pointer attempted, and no received PTY bytes, editor content or preview mutations measured. The test passes even if the typed input is forwarded. Component cycling dispatches on frame chrome and checks store focus only; no real terminal-origin/zero-byte assertion exists.
- **Impact:** Required privacy/input isolation is not proven; unsafe input forwarding would be invisible to the test.
- **Correction:** Establish live app focus and baseline state before masking; attempt key/paste/pointer operations while masked, then assert zero PTY bytes and unchanged editor/preview state. Assert Ctrl+Alt+Escape changes actual DOM focus without PTY writes; cover required IME/AltGr, remapped escape and app-split boundaries.
- **Confidence:** High; absent outcome assertions directly observable in source.

## 4. Warnings — SHOULD FIX

1. **Hidden intervals not checked.** `os-lifecycle.browser.tsx:416-449,451-455,494-515` checks frame removal while minimized and reattachment after restoring/moving, but not resource connectedness/parking or current registry identity while minimized/on an inactive desktop. Detach-then-reattach can pass. Assert captured resources stay connected in their parking hosts throughout those intervals; compare current terminal/editor registry resources with captured references. Focus cycling should additionally assert `document.activeElement`.
2. **Reactive auth guard lacks regression.** `dam-hopper-app.test.tsx:170-245` mocks `useServerProfile`; it does not exercise real token/profile-change notifications while `/os` is mounted. Production subscription exists (`use-server-profile.ts:10-16`, `server-config.ts:352-359`); no runtime defect alleged. Add one revoke/removal regression to ensure shell unmount and notice appear.
3. **Live and visual evidence pending.** `review.md:3-13` is appropriately pending, not acceptance. Require corrected live E2E execution and captured source-pinned artifacts, then separate human inspection before calling the prototype gate qualified.

## 5. Suggestions — NICE TO HAVE

- Type route-profile doubles using the real profile fields and use `authType: "basic"`, not the nonexistent `"token"` enum (`dam-hopper-app.test.tsx:23,185,214`; `server-config.ts:39-43`). Current broad string mock hides contract drift, although the guard's non-none branch is exercised.
- Add a positive legacy-route Ctrl+Backquote case and an already-prevented-event case. The new isolation test alone also passes if the shortcut handler is removed entirely.
- Keep focused DOM fixtures, but label them DOM/slot continuity rather than live xterm/editor qualification; casts and an initially null Monaco editor do not prove transport/model lifetime.

## 6. Reviewed files

Requested scope, approximately 1,665 lines total; changed/relevant sections inspected:
- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/embed/dam-hopper-app.test.tsx`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx`
- `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts`
- `packages/ui/e2e/os-lifecycle/review.md`
- `packages/ui/src/os/resource-registry.ts`

Supporting contracts inspected: Phase 01 plan; Cycle 2 review; README; relevant PDR/code standards/testing guidance; `OsShell`, `DesktopCanvas`, `WindowFrame`, `OsResourceHost`, `MonacoKeepAliveHost`, three app adapters, `TerminalKeepAliveHost`, profile hook/token notifications, application fixture/data, package/browser build configuration. No source or plan edits performed.

## 7. Validation commands and results

Reviewer ran no duplicate builds/tests/linters; tester owns execution. **Reported evidence**, not independently executed results: refreshed `plans/reports/tester-261102-1102-phase-01-cycle-3-validation.md:26-36` (11:09 update explicitly covers newly added missing-token test and editor matrix).

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/embed/dam-hopper-app.test.tsx` | Exit 0; 8/8 passed |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-lifecycle.browser.tsx` | Exit 0; 9/9 passed |
| `pnpm --filter @dam-hopper/ui test src/os/` | Exit 0; 26/26 passed |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; no TypeScript errors; not journey execution |
| `pnpm --filter @dam-hopper/web build` | Exit 0; production Vite bundle, 6,118 modules |
| `pnpm --filter @dam-hopper/ui test src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/TerminalKeepAliveHost.test.tsx src/components/organisms/BrowserDebugKeepAliveHost.test.tsx src/components/organisms/MonacoHost.test.tsx` | Exit 0; 41/41 passed |

`E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle` **not run**. Main should execute only after the missing oracles are authored and source writers join. Lint and coverage percentages not reported/measured; no clean/full-suite claim.

## 8. Unresolved questions

No product question requiring user decision. Unresolved evidence: corrected live xterm/Monaco/preview identity and counter/input/reconnect proofs; captured artifact provenance and human visual acceptance. Component/typecheck/build success does not resolve these gates.
