# Phase 08 — Cycle 2 Code Review

**Score: 5/10 — request changes. Root cutover not accepted.**

Review: security, performance, ownership/architecture, YAGNI/KISS/DRY and Cycle 1 remediation. Source review only; predicted runtime consequences explicitly marked below. Source/plans/task state unchanged; this report is the only authored artifact.

## Cycle 1 disposition

| Finding | Cycle 2 disposition |
|---|---|
| C1 — unreachable onboarding/auth/profile management | Source-level remediation present: unauthenticated entry opens retained profile/settings dialogs; authenticated TopBar exposes profile management. Existing dialog supports login/MFA through its edit fallback. Interactive fresh-profile/expired-token/MFA qualification not established. |
| C2 — removed routes not inert | **Still open.** New classifier mishandles root basename; conditional hooks and SPA navigation add boundary defects. |
| C3 — cold-link delivery before consumers | **Still open.** Readiness boolean does not survive cleanup/re-registration ordering; unsuccessful links can repeatedly create windows. |
| C4 — terminal identity mismatch | Primary source defect addressed: shell stores sessionId/terminalId consistently, resource host accepts terminalId, focus handler no longer requires a pre-existing local registry entry. Cold existing/missing session behavior not runtime-qualified. |
| W1 — container density | Open: retained components still use desktop-wide viewport. |
| W2 — compatibility remnants | Partially addressed: generic policy alias removed; constant-false pointer plumbing remains. |
| W3 — web mobile preferences | Open: active store ownership/hydration/clamping/persistence remains. |
| W4 — acceptance/test depth | Open: parser/DOM-presence tests unchanged; prior full browser run failed. |

## Critical issues — MUST FIX

### C2 — High: removed-route boundary still permits services/network

**Evidence:** `packages/ui/src/lib/router-basename.ts:1-16`; `packages/ui/src/embed/dam-hopper-app.tsx:133-139,304-359,369-425,427-495`.

- Normal deployment basename is `/`. Classifier strips it from `/usage`, producing `usage`, then compares against `/usage`; result false. Same defect for `/ssh-forwarding` and trailing-slash variants. Thus the supposedly inert path continues into settings hydration, profile migration and global service hosts.
- Old bootstrap guard still checks exact suffixes only. `/usage/` bypasses that guard too, allowing ordinary profile bootstrap/no-auth login POST **[INFERENCE from source]**.
- Early return precedes `useBrowserShortcutGuard`, store subscriptions and other hooks. On a matching non-root basename, navigating between active/removed paths and subsequently rerendering the parent changes its hook count **[INFERENCE: React hook-order failure]**.
- `DamHopperApp` reads raw `window.location` outside BrowserRouter, not a reactive route subscription. Client navigation reaches inner notice routes while global service hosts remain mounted **[INFERENCE from component ownership]**. Router's default case-insensitive matching also differs from this case-sensitive classifier.

**Impact:** promised zero-network/zero-mutation removed routes not delivered; possible navigation crash after the classifier starts matching.

**Correction:** normalize root/non-root basename consistently; put route classification in a reactive outer route boundary and place network-capable hooks/services in a separate child component. Avoid conditional hooks. Cover populated preferences/profiles, existing connections, root and non-root basenames, slash/case variants and client navigation with zero-request/mutation assertions.

**Confidence: high.**

### C3 — High: handler cleanup invalidates readiness; cold links can loop

**Evidence:** `packages/ui/src/os/OsShell.tsx:87-92,103-195,250-274,1094-1107`; `packages/ui/src/os/intents.ts:284-305`; `packages/ui/src/os/app-registry.ts:171-248`.

The new `handlersReady` boolean is insufficient:

1. Initial load replaces the session; handler registration sets readiness true.
2. On the following commit, changed `session.windows`/desktop dependencies clean up the handler effect before passive effect setup runs.
3. The earlier deep-link effect sees render-time readiness true and dispatches while the handlers are absent; registration runs only afterward.
4. Unhandled results neither clear the URL nor surface their reason. The effect has already opened a window and depends on `session.windows`; it runs again after its own update.
5. Multi-instance apps (`terminals`, `editor`, `browser`) have no reusable match in `findExistingWindowForApp`. Repeated consumption can create more windows and resource hosts **[INFERENCE from React passive cleanup/setup ordering and inspected code]**.

Even outside that race, link processing pre-creates a window while `terminal:open` and `browser:open` handlers independently create another one. One URL has two window-creation authorities.

**Impact:** cold legacy/file/session links can remain undelivered, churn windows/resources, and fail the no-duplicate-host acceptance criterion.

**Correction:** register consumers with stable lifetime and read current session through store access; make session initialization explicit. Process each URL delivery once, use one window-opening authority, await the handler result and surface unhandled/invalid results. Consume URL only after acknowledged delivery. Add real cold-mounted shell tests for persisted/empty sessions, one resulting window/resource, and unsuccessful delivery.

**Confidence: high. No runtime reproduction claimed.**

## Warnings — SHOULD FIX / preserve explicit gates

1. **Medium — density remains viewport-based.** `src/os/use-os-viewport.ts:13-24`, `src/components/organisms/ActiveTerminalRuntimeDisplay.tsx:146`, `WorkflowContextSurface.tsx:46`; Traditional navigator likewise imports this hook. A narrow app on a wide desktop receives desktop-wide density. Reuse existing `useContainerQuery` for component-container decisions.
2. **Medium — mobile deletion remains incomplete.** `src/stores/settings.ts:105-108,247-259,300-303,354-357,450-453,545-558` still owns mobile keyboard preferences. `TerminalTreeView.tsx:116-122,148,797` retains false coarse-pointer state and compatibility-shaped helper parameters/branches. Remove web preference ownership and dead pointer plumbing; preserve server/Android fields through raw config round-tripping, not active web controls/state. Generic input-policy alias itself is now removed.
3. **High qualification warning — missing regression oracles and known browser failures.** `src/embed/dam-hopper-app.test.tsx:244-267,333-363` still checks shell/notice presence, not identity continuity or zero requests; direct pushState is not router navigation. `browser-tests/os-shell.browser.tsx:54-147` covers chrome/window creation, not cold links or onboarding. Retained browser files still import deleted modules, e.g. `app-zoom.browser.tsx:7`, `project-worktree-target.browser.tsx:5`, `search-panel-focus.browser.tsx:8-11`, `host-resource-monitoring.browser.tsx:323`. Prior tester run reported 16 failed browser files and 29 failed tests. Phase 09 owns migration; do not characterize this as a passing full regression gate or delete retained feature coverage to hide it.
4. **Release gate unresolved.** Phase 08 spec requires independent P0 publication receipt plus lifecycle/full catalog/Hub/recipe parity before root switch (`phase-08-cutover-and-legacy-deletion.md:6,14-18`). Overview still records Phase 07 technical acceptance blocked with three Critical recipe findings (`plan.md:38`). Administrative closure is not evidence those safety prerequisites passed. No new audit of recipe implementation performed here.

## Suggestions

- Use one canonical terminal identity helper, shared by routing, window state, visible attachment and resource mounting; remove duplicate sessionId/terminalId interpretation when a coordinated cutover is authorized.
- `ConflictResolverPanel.tsx:10-11` still labels local hard-coded `30` as OS authority. Derive stacking from actual frame ownership, or remove obsolete floating-wrapper defaults where no production consumer remains.
- Keep follow-up tests behavioral: onboarding/MFA, basename redirects, cold file/session opens, root-to-/os continuity, and compact tiled-window density. Include failed/disconnected target cases.

## Positive observations

- Reuses existing auth/profile dialogs rather than introducing another login stack.
- Generic `terminal-input-policy` now exports only its real API; null/missing-textarea and lock/restore assertions retained.
- Terminal resource-host and visible-slot identity fallback order now agrees for explicit terminal links.
- Significant obsolete shell/mobile presentation removed; retained monitor row migrated rather than dropped. No new server/API/storage abstraction introduced for this cutover.

## Reviewed files

Changed inventory: 119 tracked paths and two untracked generic policy files at inspection. Targeted source sections/diffs, not every deleted test line:

- `packages/ui/src/embed/dam-hopper-app{,.test}.tsx`.
- `packages/ui/src/os/{OsShell.tsx,OsResourceHost.tsx,TopBar.tsx,deep-links.ts,deep-links.test.ts,use-os-viewport.ts,app-registry.ts,intents.ts,WindowFrame.tsx}`.
- `packages/ui/src/os/apps/{TerminalsApp.tsx,SystemMonitorApp.tsx}`.
- `packages/ui/src/components/organisms/{ServerProfilesDialog.tsx,TerminalKeepAliveHost.tsx,TerminalPanel.tsx,TerminalRuntimeOutput.tsx,PaneContainer.tsx,MonacoHost.tsx,PassphraseDialog.tsx,ConflictResolverPanel.tsx,TerminalTreeView.tsx,ActiveTerminalRuntimeDisplay.tsx,WorkflowContextSurface.tsx}`; relevant Traditional navigator and ServerSettingsDialog references.
- `packages/ui/src/lib/{router-basename.ts,terminal-input-policy.ts,terminal-input-policy.test.ts}`; `src/hooks/use-server-profile.ts`; `src/stores/{settings.ts,editor.ts}`.
- `packages/ui/browser-tests/os-shell.browser.tsx`; retained browser imports listed above and broader deleted-module reference search.
- README, PDR, code standards, Phase 08 plan/overview, Cycle 1 reviewer and tester terminal reports; active development rules and code-review skill.

## Validation commands/results

**This reviewer:** `git diff --stat && git status --short`; targeted `git diff`; source reads/searches. No build/test/lint/formatter execution: phase ownership reserves integrated checks to main/tester. No post-remediation runtime success asserted.

**Prior evidence from `agent://Phase08TestRunner`, NOT rerun and NOT current-remediation validation:**

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 324 files / 2,997 tests passed |
| `pnpm --filter @dam-hopper/ui build && pnpm build` | Exit 0; ConfigEditor static/dynamic import chunking warning |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; static E2E typecheck only |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx` | Exit 0; 2 files / 7 tests passed |
| `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx` | Exit 1; broader suite selected: 45 passed / 16 failed / 1 skipped files; 251 passed / 29 failed / 3 skipped tests |

Current lint status, type/test coverage percentages, live PTY continuity and post-remediation browser acceptance: not established. Recommended main-owned validation: updated cold-link/removed-route/auth regression tests, UI typecheck/build, correctly filtered browser tests, then Phase 09 full migration/qualification gates.

## Unresolved questions / evidence

- Where is the source-pinned independent P0 publication receipt and disposition of pre-cutover safety gates? Not present in inspected evidence.
- No post-remediation interactive onboarding/MFA, cold deep-link delivery, missing-terminal guidance or zero-network removed-route results supplied during this review.
- No product clarification needed to correct C2/C3; remaining uncertainty is runtime/release evidence, not requested behavior.
