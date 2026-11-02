# Phase 08 — Cycle 3 Code Review

**Score: 6/10 — request changes. Root cutover not accepted.**

Scope: Phase 08 root/legacy cutover and web-mobile deletion; emphasis C2/C3 remediation, security, performance, architecture, YAGNI/KISS/DRY. Source review only. Runtime consequences below marked `[INFERENCE]`; no new runtime success claimed. Source, plans and task state unchanged; only this report authored.

## Remediation disposition

- **C2 partial:** `DamHopperAppInner` isolates network-capable hooks; outer component no longer changes hook count. Classifier now handles ordinary root basename, case and trailing slashes. **Reactive route boundary still missing.**
- **C3 partial:** handler registration no longer depends on session windows/desktop; deep-link intent branch no longer pre-creates a second window; unhandled reasons now displayed; raw-search ref prevents previous window-update retry loop. **One handler still closes over initial windows; URL delivery is not reactive.**

## Critical issues / release-blocking findings

No newly identified Critical-severity exploit or data-loss issue. Two **High** findings remain against requested remediation:

### C2 — High: retirement boundary still not reactive

**Evidence:** `packages/ui/src/embed/dam-hopper-app.tsx:332-365,433-505,510-518`.

Outer `DamHopperApp` reads `window.location.pathname` once per its own render; it has no location subscription. BrowserRouter lives inside `DamHopperAppInner`. Router navigation rerenders route consumers, not this ancestor. Inner `/usage` and `/ssh-forwarding` routes therefore display notices while settings/profile hooks, EncryptProvider, AgentStatusBridge and other global hosts remain mounted **[INFERENCE from component ownership]**. Cold retirement notice also mounts no router/listener: browser Back to an active path cannot update this boundary without an unrelated parent render **[INFERENCE]**.

**Impact:** cold-load isolation improved, but required zero-network/zero-mutation retirement boundary is not guaranteed across SPA/Back/Forward navigation.

**Correction:** own one BrowserRouter above a `useLocation()`-subscribed boundary. Render inert notice or service-bearing inner child below it; remove nested router. Add real router/POP navigation coverage with populated profiles/preferences and zero new service/request/mutation assertions. Keep all hooks unconditional.

**Confidence: high; source-established missing subscription, runtime consequence not exercised.**

### C3 — High: stable file handler now retains stale session forever

**Evidence:** `packages/ui/src/os/OsShell.tsx:88-93,261-315,1082-1092`; `packages/ui/src/os/window-store.ts:92-103`.

`file:open` still uses `Object.values(session.windows)` at line 300. Its registration effect now depends only on stable store actions. It captures pre-hydration session/windows and never refreshes them. Store initialization starts with an empty default session; mount hydration replaces it.

**Impact:** opening files misses hydrated/new editor windows and creates extra frames; a captured window later closed may instead be targeted as though still live **[INFERENCE]**. Stable registration fixed churn but introduced permanently stale reuse logic, undermining resource/window uniqueness.

**Correction:** match against `useWindowStore.getState().session.windows` inside this handler, as neighboring handlers already do. Do not restore windows to effect dependencies. Regression: persisted editor, newly opened editor, close/reopen, and repeated file opens; assert live target/reuse and correct frame/resource count.

**Confidence: high; direct stale closure in inspected source.**

## Warnings

1. **Medium — C3 URL delivery remains mount/context-triggered, not navigation-triggered.** `OsShell.tsx:104-181`: effect reads raw `window.location.search`, but dependencies contain neither router location/search nor delivery key. Query-only navigation with unchanged profile/project does not rerun it. `lastProcessedSearchRef` never resets after successful URL clearing, so a later intentional delivery of the same query is skipped. Handler `invalid` results also receive no notice, unlike `unhandled` (`intents.ts:299-314`). **Correction:** subscribe to router location and deduplicate actual deliveries, not one search string for the entire component lifetime; surface both unsuccessful result types. Cover query changes, same-link redelivery, invalid handler result. Consequences `[INFERENCE]`; confidence high.

2. **Medium — mobile deletion incomplete.** `stores/settings.ts:105-108,247-259,299-303,450-453,545-558` still owns, hydrates, clamps and serializes mobile keyboard settings. `TerminalTreeView.tsx:116-122,130-148,379-385` retains compatibility-shaped coarse-pointer helpers/props/branches. **Correction:** remove active web ownership and dead plumbing; preserve server/Android fields via existing raw config round-trip. Phase 08 explicitly requires this, not merely hidden controls.

3. **Medium — density still desktop-wide.** `os/use-os-viewport.ts:13-24`; `WorkflowContextSurface.tsx:46`; `ActiveTerminalRuntimeDisplay.tsx:146`; Traditional navigator imports same viewport hook. Narrow tiled windows on a wide desktop receive noncompact density **[INFERENCE]**. Existing `useContainerQuery` at `use-os-viewport.ts:34-63` supplies intended container measurement; reuse it rather than introduce another hook.

4. **High qualification warning — relevant regression oracles absent; retained browser migration still open.** `embed/dam-hopper-app.test.tsx:244-267,333-363` checks presence, not resource identity or zero requests; manually rerendered `pushState` does not prove router navigation. `browser-tests/os-shell.browser.tsx:54-147` tests chrome/basic launch/resize, not C2/C3. Direct deleted-module imports remain in `browser-tests/app-zoom.browser.tsx:7`, `project-worktree-target.browser.tsx:5`, `search-panel-focus.browser.tsx:8-11`, `host-resource-monitoring.browser.tsx:323`, `host-resource-sse-cutover.browser.tsx:8`. Cycle 2 report records a broader browser run with 16 failed files/29 failed tests. Not rerun here; Phase 09 owns migration/qualification, not permission to claim a passing full gate or remove retained feature assertions.

5. **Release prerequisite evidence unresolved.** Phase plan `phase-08-cutover-and-legacy-deletion.md:6,14-18` requires independent P0 publication receipt and prior parity before root cutover. Overview `plan.md:38-42` still records blocked Phase 07 technical acceptance and receipt gating. Administrative DONE is not safety acceptance. Receipt/technical disposition not found in inspected evidence; no new recipe audit claimed.

## Suggestions

- Remove duplicated, weaker retirement checks inside bootstrap and duplicate inner notice route composition once the single reactive boundary owns retirement. One authority; no new routing abstraction needed.
- `ConflictResolverPanel.tsx:10-11,60` calls local literal `30` an OS z-index authority. Derive from actual frame ownership or retire obsolete floating-wrapper defaults when no real consumers remain.
- Refresh stale shell documentation: `docs/code-standards.md:105-107` still mandates WorkspacePage/legacy shell stacking despite their deletion. Preserve generic privacy/crypto/editor behavior coverage during browser migration.

## Positive observations

- Hook-order fix is clean component isolation rather than conditional-hook suppression.
- Most intent handlers now read current store state; removing window/desktop effect dependencies removes registration churn.
- Deep-link intent branch delegates window creation instead of pre-creating a duplicate frame; unhandled errors now visible.
- `terminal-input-policy.ts:22-41` retains real stdin/textarea suppression without an Android compatibility API.
- Existing auth/profile dialogs reused; substantial obsolete shell/mobile composition removed without adding server APIs or another state framework.

## Reviewed files

Targeted source/test sections and diffs, approximately 2,500 lines; not all deleted test bodies:

- `packages/ui/src/embed/dam-hopper-app{,.test}.tsx`.
- `packages/ui/src/os/{OsShell.tsx,intents.ts,intents.test.ts,deep-links.ts,deep-links.test.ts,window-store.ts,use-os-viewport.ts}`.
- `packages/ui/src/components/organisms/{TerminalPanel.tsx,TerminalKeepAliveHost.tsx,TerminalRuntimeOutput.tsx,PaneContainer.tsx,MonacoHost.tsx,PassphraseDialog.tsx,SettingsAppearanceSection.tsx,TerminalTreeView.tsx,WorkflowContextSurface.tsx,ActiveTerminalRuntimeDisplay.tsx,TraditionalTerminalProjectsDisplay.tsx,ConflictResolverPanel.tsx}` — full relevant sections or scoped diffs/searches.
- `packages/ui/src/{stores/settings.ts,lib/terminal-input-policy.ts}`.
- `packages/ui/browser-tests/os-shell.browser.tsx`; deleted-module reference search across browser tests/source, including warning paths above.
- README, PDR, code standards, Phase 08 plan/overview, Cycle 2 review, active development rules/workflow and manually loaded code-review skill.
- Updated plans: none; assignment prohibits task-state tracking.

## Validation commands / results

**Executed by this reviewer:**

- `git diff --stat` — 119 tracked files, +882 / -17,512 at inspection.
- Scoped `git diff -- ...` for cutover entry/shell/deep-links and retained terminal/editor/privacy/settings changes — inspected source changes; no compile/runtime result implied.
- Targeted read/search tools — established stale closure, missing reactive boundaries, remaining mobile ownership and deleted browser imports.
- `date +%y%m%d` — report date `261103`.

**Build/tests/lint not executed:** Phase 08 ownership reserves integrated checks to main/tester. Current type coverage, test coverage, lint counts and post-remediation runtime acceptance unestablished.

**Inherited evidence only, from Cycle 2 report lines 93-103:** UI unit run reported 324 files/2,997 tests passed; UI/web builds passed with ConfigEditor chunk warning; correctly filtered two browser files reported seven tests passed; broader browser selection failed with 16 failed files/29 failed tests. These results predate this remediation and are not current validation.

**Recommended main-owned checks after fixes:** meaningful C2/C3 regressions, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build && pnpm build`, correctly filtered `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-input-isolation.browser.tsx browser-tests/os-shell.browser.tsx`, plus Phase 09 retained-browser migration/full qualification. Focused passes cannot replace the full migration gate.

## Unresolved questions / evidence

- Where is the source-pinned independent P0 publication receipt and technical disposition of pre-cutover parity/safety gates?
- No post-remediation router/POP retirement isolation, repeated file delivery, cold-link/resource uniqueness or interactive onboarding/MFA results supplied in inspected evidence.
- No product clarification needed for findings; remaining uncertainty is validation/release evidence.
