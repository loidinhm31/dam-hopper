# Phase 01 Lifecycle Prototype — Cycle 3 Code Review

## Score and overall assessment

**7/10 — request changes; real lifecycle qualification remains incomplete.**

Scoped production changes are small and reuse existing providers, route boundaries, and resource-claim machinery. `/os` is lazy, URL-only, locally profile/token-gated; legacy dashboard remains default. No new critical exploit, material performance regression, duplicate root service, dependency, or unnecessary abstraction established in these changes. Good KISS/YAGNI/DRY alignment. Local token presence is not server authorization.

Review completed against Phase 01 requirements and Cycle 2 findings. Source and plan/task state intentionally unchanged; coordinator owns disposition. Only this report created.

## Cycle 2 dispositions

| Item | Cycle 3 disposition |
|---|---|
| R1: E2E locator/live terminal tagging | **Partially addressed, lifecycle blocker open.** Actual terminal selector replaces disposable app-wrapper fallback (`os-lifecycle.spec.ts:44-64`); ready-state failure is swallowed and DOM attribute does not prove xterm object/counter continuity. |
| R2: strict connected equality and both matrices | **Addressed for visible component DOM continuity.** Terminal captured node must be connected and contained in its slot (`os-lifecycle.browser.tsx:373-382`); editor additionally compares element identity (`:384-392,468-515`). Both traverse tile/float/maximize/restore/minimize/restore/desktop move. Hidden intervals and live controller/model lifetime remain unproven. |
| R3: desktop sequence and stable frame locator | **Addressed structurally.** Window ID captured once (`os-lifecycle.spec.ts:39-45`); returns to Desktop 1 before moving exact terminal, then verifies it on Desktop 2 (`:122-149`). Actual E2E not executed. |
| Warning 2: authentication branches | Initial missing-profile, missing-token, token-present, and no-auth branches covered (`dam-hopper-app.test.tsx:170-245`). Reactive token/profile removal remains untested. |
| Ctrl+Backquote shortcut isolation | Direct `/os` regression added (`dam-hopper-app.test.tsx:247-273`); production route guard present (`dam-hopper-app.tsx:124-137`). |

## Critical issues / mandatory fixes

**No newly established critical-severity security vulnerability. The following are high-priority acceptance blockers.**

### H1 — E2E still lacks the live lifecycle oracle

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:48-64,67-149`; Phase 01 plan `:35-38,276-284`.
- Actual terminal DOM tagging is an improvement, but terminal readiness rejection is ignored (`.catch(() => {})`); tagging is conditional and no settled baseline is asserted before moving. Attribute continuity proves only the selected DOM marker persists, not the same xterm object or absence of replay/reset on that object.
- No streaming PTY output, outbound `terminal:attach`/replay/reset baselines or per-placement zero deltas. Editor/browser are merely launched (`:110-120`): no dirty Monaco model/undo or running iframe JS state is measured, and neither undergoes the full E2E placement matrix. No separate generation-changing reconnect/changed-incarnation scenario exists.
- **Impact:** Current test cannot qualify Task 4 even if executed successfully; reconnect churn, reset/replay, lost editor history, and preview reload remain undetectable.
- **Correction:** Remove swallowed readiness failure; require settled live resources and capture object identities plus counters before moving. Assert every required placement and inactive-desktop interval against those baselines, dirty Monaco model/undo, and controlled preview JS state. Author owner-revalidated reconnect separately, including changed-incarnation rejection. Obtain authorized source-remediation ownership if real controller integration requires changes outside test-owned paths.
- **Confidence:** High; static inspection. No live failure claimed.

### H2 — Privacy/input journey has no behavioral outcome assertion

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:151-168`; component focus test `packages/ui/browser-tests/os-lifecycle.browser.tsx:518-557`; Phase 01 plan `:38,279`.
- Terminal is left on Desktop 2, then test switches to Desktop 1. It toggles Cognito, checks `inert`, types text without focusing a live app, and checks dismissal. No received PTY bytes, editor content, or preview mutations are observed; paste/pointer are not attempted. Component escape test checks Zustand focus only, not actual DOM focus or terminal output.
- **Impact:** Input leakage can coexist with every current assertion passing. Physical PTY isolation, frame/app precedence, IME/AltGr, remapped escape, and app-split boundaries remain unqualified.
- **Correction:** Establish actual app focus and baseline PTY/editor/preview state, attempt key/paste/pointer input under Cognito, and assert zero writes/mutations. Exercise Ctrl+Alt+Escape from terminal focus with actual focus and zero-byte assertions; cover required input-precedence variants.
- **Confidence:** High; absent behavioral assertions directly observable.

## Warnings

1. **Hidden resource lifetime not checked.** `os-lifecycle.browser.tsx:416-455,494-515` checks minimized frame absence and later reattachment, but not connected parking/registry identity while minimized or inactive. Desktop move plus desktop activation occur in one `act`, leaving no assertion between them. Add separate hidden-state checks and assert sibling resources remain unchanged.
2. **Reactive authentication revocation untested.** `dam-hopper-app.test.tsx:25-40,170-245` mocks both subscription and profile hook. Add a token-clear/profile-removal case while `/os` is mounted, asserting shell unmount and notice. Real production notification path exists (`use-server-profile.ts:10-16`; `server-config.ts:352-359`); no source failure alleged.
3. **Pending evidence is not acceptance.** `e2e/os-lifecycle/review.md:3-13` honestly records pending capture/human inspection. No live application E2E or visual acceptance receipt exists. Plan's prior editor/owner-security findings (`phase-01-lifecycle-prototype.md:55-60`) are not closed by this scoped test/route remediation.

## Suggestions

- Type profile doubles using real `ServerProfile` fields and `authType: "basic"`, not nonexistent `"token"` (`dam-hopper-app.test.tsx:23,185,214`; `server-config.ts:39-46`). Broad string typing currently hides contract drift.
- Add positive legacy-route Ctrl+Backquote and already-prevented-event cases; negative isolation alone also passes if handler is removed entirely.
- Label cast terminal/null-editor fixtures as DOM/slot tests, not live resource qualification (`os-lifecycle.browser.tsx:338-357`). Preserve the useful focused tests; avoid a generalized testing framework.

## Reviewed files

All six requested files inspected, approximately 1,670 lines total:
- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/embed/dam-hopper-app.test.tsx`
- `packages/ui/src/os/resource-registry.ts`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx`
- `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts`
- `packages/ui/e2e/os-lifecycle/review.md`

Supporting evidence: Phase 01 plan including literal ownership and acceptance; Cycle 2/previous Cycle 3 reports; README; PDR; code standards; testing guide; shell/desktop/resource hosts; terminal/editor/browser adapters; Monaco parking and terminal keep-alive; profile hook/auth configuration; application fixture and seed data. Relevant sections inspected, not a repository-wide audit. Resource-claim dependency additions match captured keys; current adapter keys are memoized.

## Validation commands/results

Reviewer ran only `git diff --stat && git status --short` and scoped `git diff` for inspection. No duplicate builds/tests/linters; tester owns execution. Following are **tester-reported results, not independently rerun**: `plans/reports/tester-261102-1111-phase-01-lifecycle-prototype.md:29-44`.

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/embed/dam-hopper-app.test.tsx` | Exit 0; 8/8 |
| `pnpm --filter @dam-hopper/ui test src/os/` | Exit 0; 26/26 |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-lifecycle.browser.tsx` | Exit 0; 9/9 |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; no type errors; not journey execution |
| `pnpm --filter @dam-hopper/ui test src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/TerminalKeepAliveHost.test.tsx src/components/organisms/BrowserDebugKeepAliveHost.test.tsx src/components/organisms/MonacoHost.test.tsx` | Exit 0; 41/41 |
| `pnpm --filter @dam-hopper/web build` | Exit 0; 6,118 modules transformed |

Reported total: **84/84 tests across 11 files**. Lint/type-coverage/test-coverage percentages not measured here. No full-suite claim.

`E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle` **not executed**. Main should run after required live oracles and authorized source remediation land on a coherent artifact; capture source-pinned evidence and obtain separate human inspection. Running the current journey alone does not close H1/H2.

## Unresolved questions

No product clarification needed. Unresolved evidence: live xterm/object/counter, dirty Monaco/model/undo, preview JS continuity, reconnect/incarnation and behavioral input-isolation proofs; source-pinned captures and human visual acceptance. Task 4 remains technically incomplete.
