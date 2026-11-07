# Phase 01 Lifecycle Prototype — Cycle 4 Code Review

## Score / overall assessment

**7/10 — request changes for technical acceptance.** No new critical-severity exploit or material performance regression established in scoped production edits. Mandatory attachment now fails rather than silently continuing, and route/DOM regressions improve. The required live lifecycle and behavioral privacy oracles remain absent; passing current suites cannot close the prototype gate.

Review used the published `code-review` skill, development rules, README, PDR and code standards. Source, tests and plan/task status intentionally unchanged; no TODO tracking or administrative status changes. This report is the only authored file.

## Cycle 3 dispositions

| Finding | Cycle 4 disposition |
|---|---|
| Critical 1: mandatory terminal attachment / live DOM tagging | **Narrow remediation addressed.** `os-lifecycle.spec.ts:48-57` awaits a terminal surface with a 15-second timeout, no swallowed rejection, no wrapper fallback; tag targets the selected terminal DOM. **Full lifecycle oracle remains open** (H1). |
| Critical 2: Desktop 2 / focused privacy behavior | **Desktop placement addressed; behavioral oracle not addressed.** Journey stays on Desktop 2 and clicks its terminal frame (`:151-153`), then clicks the overlay and types. No app-focus assertion or PTY/editor/preview outcome comparison (H2). |
| Warning: minimized / inactive-desktop intervals | **Partially addressed.** Intermediate registry-element comparisons now exist for both resources (`os-lifecycle.browser.tsx:422-424,449-452,508-509,522-524`). No connected parking-host assertion; registry retention alone allows detached DOM (W1). |
| Warning: reactive token revocation | **Partially addressed.** Shell unmount/notice tested after token mutation and explicit `root.render` (`dam-hopper-app.test.tsx:276-302`), not after a real notification (W2). |
| Suggestion: `authType: "basic"` | **Addressed.** Correct enum used at `dam-hopper-app.test.tsx:185,214,277`. Mock profile remains broadly typed (`:23`). |
| Positive legacy Ctrl+Backquote regression | **Addressed.** `/` navigation case added (`dam-hopper-app.test.tsx:304-327`), alongside `/os` isolation. |

## Critical issues / mandatory acceptance blockers

**No newly established critical-severity security vulnerability.** These are high-priority acceptance blockers, not observed production exploit claims.

### H1 — DOM readiness/tagging still does not qualify live resource lifetime

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:48-65,76-108,110-149`; phase contract `phase-01-lifecycle-prototype.md:35-38,282-290`.
- Attachment now mandatory, but `toBeAttached` does not establish a ready streaming PTY. Marker retention measures a DOM attribute, not the same xterm object or zero outbound attach/replay/reset deltas. No stream/counter baseline is captured. Editor/browser are launched but not exercised with dirty model/undo or controlled preview JS state. Separate generation-changing reconnect and changed-incarnation rejection are absent.
- **Impact:** Same DOM can survive replay/reset, changed xterm state, lost editor history or preview navigation while assertions pass. Merely running this journey cannot qualify Task 4.
- **Correction:** Establish real settled resources; retain xterm/editor/model/iframe identities and attach/replay/reset counters; assert full placement and inactive intervals against those baselines. Add dirty text plus undo and running preview JS assertions. Author reconnect/incarnation independently; obtain source-remediation ownership where required.
- **Confidence:** High, static evidence. No runtime failure alleged.

### H2 — Privacy journey still has no behavioral outcome oracle

- **Evidence:** `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:151-178`; frame pointer behavior `packages/ui/src/os/WindowFrame.tsx:49-51`; phase contract `:38,285`.
- `desktop2TermFrame.click()` does not prove xterm input/textarea focus. Clicking the overlay proves it is clickable, not that a pointer at the underlying app target is intercepted. After typing `blocked-cognito-input`, the test checks only overlay/inert removal; it never checks received PTY bytes, editor text, preview events, or preserved resource identity/focus. No paste attempt. Switching away immediately also prevents a positive restored-input assertion.
- **Impact:** Input leakage or permanently disabled input after dismissal is invisible to this test.
- **Correction:** Focus and assert the real input surface; establish a positive input baseline, record received bytes/editor/preview state, attempt physical key/paste/pointer operations while masked, assert zero mutations, then verify restored input and same resources. Exercise frame escape with real DOM focus/zero PTY bytes, IME/AltGr/remapped escape and app-split boundaries.
- **Confidence:** High; missing assertions directly inspectable.

## Warnings

1. **W1 — Hidden retention only checks registry references.** `os-lifecycle.browser.tsx:422-424,449-452,508-509,522-524`: a detached element may remain registered, so these assertions do not prove connected parking or editor/controller survival. Assert `isConnected`, containment in the actual parking host, stable registry/controller objects and unchanged siblings before restore/activation. Cast terminal and `editor: null` fixtures (`:338-357`) remain useful DOM tests, not live xterm/Monaco qualification.
2. **W2 — Revocation test bypasses the reactive boundary.** `dam-hopper-app.test.tsx:35-39,290-298` mocks subscriptions/hook and manually renders. It would pass if the production token-change subscription broke. Exercise real `useServerProfile` with stored profile/token and `clearAuthToken`, or drive an observable notification mock without explicit rendering. Existing production mechanism is present (`use-server-profile.ts:10-16`; `server-config.ts:352-359`); no production reactivity bug established.
3. **W3 — Qualification/visual evidence still pending.** `e2e/os-lifecycle/review.md:3-13` honestly remains pending. Live Playwright journey and human inspection were not executed. Administrative DONE is explicitly distinguished from technical incompleteness (`phase-01-lifecycle-prototype.md:43-66`); this review does not reopen administrative status, but H1/H2 are missing authored assertions, not just missing execution receipts. Earlier C1/C2 and W1–W4 source-remediation findings remain carried, not resolved by this narrow patch.
4. **Validation harness warnings:** Current tester reports React act-environment/unwrapped-update warnings (`tester-cycle4-261102-1120-lifecycle-prototype.md:74-78`). Tests passed; timing reliability not established by warning-free evidence.

## Suggestions / positive observations

- Keep current simple lazy route, shared providers and immutable owner-qualified key conventions. `/os` has no added navigation/build flag; legacy root remains default. Client token presence is a UI gate, not server authorization.
- Resource-claim dependency additions match captured values (`resource-registry.ts:130-157`); all three inspected adapters memoize claim keys. No current release/reclaim churn demonstrated. Avoid a new generalized registry abstraction for this review.
- Type profile doubles with `ServerProfile` or a checked `Pick` instead of optional string `authType`; this prevents future enum drift.
- Rename synthetic lifecycle/preview tests to match their actual oracle. Preview test (`os-lifecycle.browser.tsx:224-303`) compares iframe DOM, not JavaScript state despite its title.
- Retain the cleanup returned by `registerParkedMonaco` (`:357`) and invoke it during test teardown; the synthetic registration otherwise remains in the module registry after its container is removed.

## Reviewed files

All six requested files inspected, approximately **1,769 lines**:
- `packages/ui/src/embed/dam-hopper-app.tsx`
- `packages/ui/src/embed/dam-hopper-app.test.tsx`
- `packages/ui/src/os/resource-registry.ts`
- `packages/ui/browser-tests/os-lifecycle.browser.tsx`
- `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts`
- `packages/ui/e2e/os-lifecycle/review.md`

Supporting sections: Phase 01 requirements/ownership/task acceptance; both latest Cycle 3 reports; README; PDR; code standards/testing guide; profile hook/config; `OsShell`, `WindowFrame`, `OsResourceHost`, `MonacoKeepAliveHost`, terminal keep-alive, terminal/editor/browser adapters; E2E fixture/data; package scripts; current tester report. Not a repository-wide or renewed audit of unchanged carried security findings.

## Validation commands / results

Reviewer executed `git status --short && git diff --stat`, scoped `git diff`, and `date +%y%m%d` for inspection/report naming. No duplicate tests/builds/linters: execution owned by TesterCycle4.

**Current tester-reported evidence**, read from `plans/reports/tester-cycle4-261102-1120-lifecycle-prototype.md:13-21`; not independently rerun:

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/embed/dam-hopper-app.test.tsx` | Exit 0; 10/10 |
| `pnpm --filter @dam-hopper/ui test src/os/` | Exit 0; 26/26 |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-lifecycle.browser.tsx` | Exit 0; 9/9, Chromium component runner |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; no diagnostics; not journey execution |
| `pnpm --filter @dam-hopper/ui test src/lib/tile-tree.test.ts src/lib/terminal-layout-docking.test.ts src/components/organisms/TerminalKeepAliveHost.test.tsx src/components/organisms/BrowserDebugKeepAliveHost.test.tsx src/components/organisms/MonacoHost.test.tsx` | Exit 0; 41/41 |

**86/86 tests across 11 files**, selected scope only. No current-cycle production build or lint run. Type/test coverage percentages not measured. Prior-cycle production-build receipt is not a fresh Cycle 4 result.

After oracle/source remediation, integration owner should execute `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-lifecycle` on a coherent artifact and obtain separate human visual acceptance. Current journey success alone would not close H1/H2.

## Unresolved questions

No product clarification required. Outstanding evidence: live xterm/counter, dirty Monaco model/undo, preview JS, reconnect/incarnation, physical input isolation and clean restored input, source-pinned captures and human review. Technical prototype gate remains incomplete.
