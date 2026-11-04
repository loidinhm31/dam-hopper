# Critical carryovers — Code Review Cycle 2

## Score: 7/10 — qualification changes required

The two Cycle 1 production defects are corrected in the inspected code: the shared action snapshot now changes identity on publication, and Ports separates presentation tokens from coordinator attempt tokens. C4 is still not technically qualified. Six green automated gates do not execute the affected authenticated browser journeys. No exploitable authentication bypass or data-loss vulnerability established in this scoped review.

## Scope and disposition

- Risk-based review of critical-carryover implementation, consumers and qualification oracles; not certification of the entire 89-file modified working tree.
- Read relevant README/PDR/standards, published development/primary workflows, code-review skill, selected plan/P08/handoff and Cycle 1 report.
- Source, tests, plan and task state unchanged. Only this report created. No TODO tracking or validation commands rerun; execution belongs to main/tester.
- Approximate source/test sections inspected: 2,000+ lines; targeted sections, not every line of the listed large files.

| Carryover | Cycle 2 disposition |
|---|---|
| C1 — originating lifetime provenance | Inspected launch/resolver paths preserve originating owner/generation/epoch and require exact matching inventory before authority adoption. No new blocker found in those paths. Unsafe numeric-only create identity still fails closed. |
| C2 — presentation-independent state | Cycle 1 snapshot/token defects corrected statically. Missing behavioral regressions and retained-feedback/lifetime warnings remain. |
| C3 — production TypeScript alignment | Inspected Ports failure categories and Recipe owner-key normalization align with contracts. Tester reports clean production/E2E typechecks. Profile configuration reactivity warning remains. |
| C4 — real input/lifecycle/termination/Review qualification | Incomplete; blockers below. Actual browser execution, fresh complete capture-state evidence and human review remain unestablished. |

## Critical issues / release-qualification blockers

**Critical security/data-loss findings: none established.** The following are **High acceptance blockers**, not demonstrated production authentication exploits.

### B1. Synthetic exit updates the wrong cache key and does not establish real termination

**High; confidence high.** `packages/ui/e2e/os-session-management/os-session-management.spec.ts:241-264,284-313`; `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts:64-80`; `packages/ui/src/api/query-client.ts:5-11`; `packages/ui/e2e/fixtures/application-fixture.ts:54-65`.

The new exit injection calls `setQueriesData({ queryKey: ["terminal-sessions"] }, ...)`. The authenticated fixture seeds an actual UUID profile; its inventory is stored under `["profile", profileId, generation, "terminal-sessions"]`. TanStack prefix matching does not match that owner-scoped key. This synthetic update cannot drive the intended reconciliation. The endpoint is fulfilled locally with 202 rather than forwarded, so it supplies no real termination either. If the diagnostic global is missing, the injection silently does nothing.

The test still contains only one mocked live-origin 202. Despite its title, it does not exercise successful pending-origin 200, held/lost responses or origin-specific negative reconciliation controls. Production correctly waits for exact exit rather than treating 202 as completion (`terminal-close-context.tsx:88-134,270-318`).

**Correction:** for a narrowly named cache integration regression, update the exact captured owner key, require its existence, and assert the complete unchanged owner/epoch/incarnation plus exited row. For P08 qualification, dispatch against the real endpoint, observe the actual exact exit and retain the live view until it arrives; separately exercise real pending200 and both loss-origin cases. Do not describe cache seeding as authoritative process evidence.

### B2. Repeated sentinels still do not delimit or flush each physical-byte assertion

**High; confidence high for oracle defect; browser behavior unexecuted.** `packages/ui/e2e/os-session-management/os-session-management.spec.ts:108-200`; required matrix: `plans/261104-1529-os-session-management-and-interactions/phase-08-integrated-qualification.md:21`.

`-w1` and initial A/final Z controls are useful corrections. However:

- Only the first opening/closing sentinel is awaited. Later interactions reuse the same `[`/`]` without waiting for fresh output; even another `toContainText("5d")` would match the old sentinel.
- Absence is asserted immediately against cumulative rendered text before a per-interaction closing output barrier. Z is awaited only after all negative checks; leaked bytes arriving after an earlier check are never rechecked.
- After focus moves to nonmodal controls/outside chrome, the test does not prove that each opening marker reached the PTY. Typing into an unfocused terminal can therefore masquerade as isolation.
- No exact byte sequence is parsed between markers. Printable letters alone do not test consumed Escape/modifier bytes. Notification Center, Profiles, Settings, nested Select/context menu and dirty confirmation are absent.
- `[INFERENCE]` Frame text is renderer-dependent, not a reliable terminal-output API: TerminalPanel installs a WebGL-capable renderer and does not enable screen-reader mode (`TerminalPanel.tsx:366-377`; `terminal-renderer.ts:80-129`). A canvas-backed run can fail the positive-control text assertion without proving anything about PTY delivery.

**Correction:** read only the known synthetic oracle's actual output, decode hex bytes, and await a fresh uniquely identifiable before/after sequence for every interaction. Assert the exact interval excludes printable and consumed control bytes. Prove resumed input/focus for each case; cover the named P08 matrix, then execute it. No production transcript recorder or new global runtime service is needed.

### B3. Capture filenames claim states that the test never establishes

**High; confidence high.** `packages/ui/e2e/os-session-management/os-session-management.spec.ts:315-415`; required states: P08 `:24-34`.

The base checkpoint is labeled “Eligible Review” but follows only terminal launch (`:326-355`); no eligible Review is opened. Notification capture does not require the surface to be visible. Profiles and Settings branches deliberately capture even when their triggers are absent (`:372-408`). The unavailable-Review navigation also captures without asserting the intended unavailable state. A manifest can therefore contain every required filename while depicting the wrong UI.

The separate Review test still uses fixed `profile=default`, generation, terminal and invented Review metadata (`:42-64`), although the fixture provisions a UUID profile. It does not obtain an eligible tuple from the real server and cannot qualify successful real Review authorization/retirement. Cache-shaped fixtures may be useful at an integration layer, not as the required real Review evidence.

**Correction:** derive the connected owner and eligible metadata from the fixture/runtime, assert actual Review availability, and assert every named surface/state at each viewport/zoom before capture. Missing required state must fail or report blocked, not capture a fallback. Preserve the full matrix and separate actual human receipt.

## Warnings

1. **Behavioral regressions for the two production repairs remain missing.** `terminal-session-action-coordinator.test.ts:32-167` checks imperative state/listener counts, not stable-old/new-snapshot identity or mounted-hook rendering. `PortsPanel.test.tsx:37-142` only renders static markup, never cancel/reopen/dispatch. Close tests always mock observations as empty (`terminal-close-context.test.tsx:19-26`); its “200 outcome and response loss reconciliation” test only rejects a held promise and asserts `outcomeUnknown` (`:197-267`), never successful 200 or reconciliation. Add meaningful mounted-hook, exact-exit closure, cross-entry-point/remount and cancel/reopen token-divergence regressions.
2. **Recorder still permits false-positive continuity baselines and mixes owners.** `terminal-session-observation.ts:130-139,196-240,313-367`; `os-lifecycle.spec.ts:65-75`. Missing/malformed diagnostics become empty arrays; a DOM token fallback is sufficient; zero creation/attach/replay and null epoch/incarnation can pass unchanged comparisons. Socket indexes are recorded but frames are filtered by raw terminal ID, and diagnostics admit raw-ID matches across profiles. Require positive initial lifecycle/completed replay, non-null exact backend identity, advancing live output, owner/socket/lifetime scope and diagnostic truncation/reset detection. WebSocket overflow detection alone is not enough.
3. **Global retention remains unbounded; snapshot repair increases its cost.** `terminal-session-action-coordinator.ts:22-29,75-85,123-157,184-188`; `terminal-close-context.tsx:73-81,203-210`. Targets, attempt tokens and close callbacks have no production retirement path. Every notification now copies the entire retained map; reconciliation scans retained actions against observations/rows. Retire safely settled records/callbacks when no longer referenced, without evicting unresolved outcomes or permitting late-token collisions. Do not add a new registry/poller.
4. **Unknown feedback remains inaccessible after remount.** Ports reads retained explanations only when opening the prompt, but the opener is disabled for `outcomeUnknown` (`PortsPanel.tsx:588-608`). Monitor follows the same pattern (`SystemMonitorApp.tsx:429-437,823-838`). Render retained reason/status independently of dispatch eligibility; keep duplicate End disabled.
5. **Recipe profile configuration remains mount-only.** `RecipeEditor.tsx:91-125`. Owner-key normalization and connection status reactivity are corrected, but `getProfiles()` is memoized forever. Added/removed profiles do not refresh the candidate set. Reuse the existing profile-change subscription pattern from `use-aggregated-terminal-sessions.ts:39-45`.

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY

- Preserve exact immutable target tuples, owner fences, single-flight reservations and conservative unknown outcomes. No new retry layer or network polling is warranted.
- Remove or narrowly gate the writable production test hook `window.__DAM_HOPPER_QUERY_CLIENT__` (`apps/web/src/main.tsx:71-73`). It exists in production bootstrap solely for these cache injections. This is avoidable mutable diagnostic exposure, not evidence of an authentication boundary bypass.
- Drop obsolete `unknown` migration props (`PortsPanel.tsx:196-197`) and unused Close in-flight set bookkeeping (`terminal-close-context.tsx:81,319-320`). Avoid competing local/shared presentation state where the coordinator can be the direct read source.
- Iterate the retained map directly rather than allocating `Array.from(...entries())` during reconciliation (`terminal-session-action-coordinator.ts:129`); avoid duplicate full-map reconciliation in Ports/Monitor when the persistent root already observes inventory. Keep notification snapshots cached between mutations.
- Document the new create-response epoch/capability headers: source adds them to `create_session` (`server/src/api/terminal.rs:221-231`) and transport decodes them (`ws-transport.ts:3302-3308`), while API/changelog describe inventory GET headers only (`docs/api-reference.md:125-143`; `docs/CHANGELOG.md:5`).

## Positive observations

- Snapshot publication is centralized in `notify()` and `getAllActions()` returns the cached snapshot (`terminal-session-action-coordinator.ts:28-30,167-168`), avoiding both stale identity and allocate-on-read loops.
- Ports uses coordinator attempt tokens only for shared settlement and presentation tokens for local completion/reset (`PortsPanel.tsx:273-289,315-346`). The cancel/reopen counter-domain mismatch is removed in these paths.
- Exact target matching and settled-state preservation remain intact; a late result does not overwrite `ended`/`restartCancelled` in the shared coordinator.
- Create epoch originates from the actual PTY manager and carries `no-store`; resolver checks originating generation/profile/epoch/incarnation before adopting destructive authority.
- Recorder stores content-free WebSocket metadata, uses UTF-8 byte lengths and rejects frame-buffer overflow rather than silently certifying truncated history.

## Reviewed files

Targeted source/test sections:
- `packages/ui/src/lib/{terminal-session-action-coordinator.ts,terminal-session-action-coordinator.test.ts,terminal-session-actions.ts,terminal-renderer.ts}`
- `packages/ui/src/components/organisms/{PortsPanel.tsx,PortsPanel.test.tsx,TerminalPanel.tsx}`
- `packages/ui/src/os/{terminal-close-context.tsx,terminal-close-context.test.tsx,OsShell.tsx}`
- `packages/ui/src/os/apps/{SystemMonitorApp.tsx,TerminalsApp.tsx}`
- `packages/ui/src/os/recipes/RecipeEditor.tsx`
- `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts`
- `packages/ui/src/api/{terminal-session-contract.ts,queries.ts,query-client.ts,ws-transport.ts}`
- `packages/ui/e2e/os-session-management/os-session-management.spec.ts`
- `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts`
- `packages/ui/e2e/fixtures/{terminal-session-observation.ts,application-fixture.ts,application-storage-state.ts}`
- `apps/web/src/main.tsx`; `server/src/api/terminal.rs`
- Supporting sections: README, PDR/code standards, API/changelog, selected plan/P08/handoff, prior Cycle 1 review and current tester report. Targeted searches also inspected related consumer/transport references; no full-repository audit implied.

## Validation commands / results

**Attributed tester evidence, not reviewer-executed:** `plans/reports/tester-261105-0036-cycle-2-verification.md:13-22,85-89`.

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test` | Exit 0; 334 files, 3,200 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --lib` | Exit 0; 1,418 passed, 0 failed, 1 ignored |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; production TypeScript, 0 errors |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; E2E TypeScript, 0 errors |
| `pnpm lint` | Exit 0; 0 errors, 325 warnings |
| `pnpm build` | Exit 0; web production build completed; one static/dynamic import notice |

Reported total: **4,618 passed, 0 failed, 1 ignored**. Browser E2E was **typechecked only, not executed**. Type/test coverage percentages unavailable. Reviewer performed static source/report inspection only; no build/test/lint reruns and no claimed runtime reproduction.

After repairs, main/tester should run the focused mounted-consumer regressions, authenticated session-management/lifecycle journeys and the full named P08 matrix using the existing fixture/config, followed by the required main-owned regression gates. Human review remains separate.

## Unresolved questions / evidence

- No unresolved product/design decision identified.
- Still missing: real authenticated execution of corrected physical-byte, live202/exact-exit, pending200 and both loss-origin journeys; owner-scoped positive continuity controls; actual eligible Review/retirement evidence; state-correct fresh capture matrix; actual human acceptance.
- Selected plan remains administratively completed with technical qualification explicitly open. This review does not change that status or grant release approval.
