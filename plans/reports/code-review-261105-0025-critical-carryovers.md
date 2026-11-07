# Critical carryovers — Code Review

## Score: 6.5/10 — changes required

C1 and C3 materially improved; C2 has concrete reactive-store and prompt-lifecycle defects; C4 remains an acceptance blocker. Passing unit/type/build gates do not establish the missing authenticated browser/physical-PTY guarantees. No exploitable authentication bypass or data-loss vulnerability established in this scoped review.

## Scope

- Risk-based review of the four Cycle 3 carryovers, not certification of the full working tree (89 tracked modified files plus untracked work).
- Read README, PDR, code standards, relevant architecture/API/changelog/roadmap sections, selected plan/P08 requirements, Cycle 3 review, published development/primary workflows and code-review skill.
- Source/tests/plan/task state unchanged. Only this report created, per terminal-review ownership. No validation command rerun; tester owns execution.

## Carryover disposition

| Carryover | Disposition | Evidence |
|---|---|---|
| C1: originating lifetime provenance | Substantially addressed in inspected paths; runtime qualification pending | Create response carries manager epoch; transport decodes headers; launch paths capture/recheck owner and retain epoch; resolver requires generation/epoch/canonical incarnation; panel now uses inventory eligibility. Numeric-only creation remains safely unavailable for unsafe incarnations rather than providing exact-u64 provenance. |
| C2: presentation-independent action state | Partial; blockers below | Shared singleton retains exact target states and reservations across unmount, but all-actions React snapshot never changes identity; Ports mixes unrelated token domains. |
| C3: TS contracts/error taxonomy | Addressed in inspected contracts; tester reports clean production/E2E typechecks | Allowed Ports error categories; Recipe snapshots keyed by owner profile and refreshed on connection status/generation; generic HTTP500 remains unknown unless exact signal-failure code. |
| C4: complete qualification oracles | Incomplete | Recorder overflow detection and UTF-8 accounting improved; physical oracle and termination journey still do not establish their named guarantees; E2E execution/human acceptance absent. |

## Critical issues / release blockers

### B1. Shared action store cannot notify React consumers of changed snapshots
**High; confidence high.** `packages/ui/src/lib/terminal-session-action-coordinator.ts:22,77-83,114-115,144-155,165-167,208-213`; `packages/ui/src/os/terminal-close-context.tsx:85-134`.

`retainedActions` is mutated in place, while `getAllActions()` always returns the same Map. `useSyncExternalStore` compares snapshots by identity; calling listeners does not schedule an update when that identity is unchanged. Monitor/Ports can remain stale after another entry point dispatches or reconciliation settles. More seriously, Close's settlement effect depends on `[actions, currentRequest]`, not observations: authoritative exit changes the same map, so the effect that closes the exact bound window/prompt does not rerun, even when an inventory update renders the provider.

**Correction:** publish one cached immutable snapshot per actual state change (or subscribe to a stable revision with an immutable snapshot). Never allocate a new Map on each `getSnapshot` call. Add mounted-hook and Close integration regressions: dispatch -> exact exit -> prompt/window close, plus cross-entry-point updates and remount persistence. Existing coordinator tests only check imperative state/listener calls (`terminal-session-action-coordinator.test.ts:32-167`), not React snapshot behavior. Shared reservation still blocks duplicate dispatch; this finding does not assert duplicate process signals.

### B2. Ports compares per-target attempt tokens with independent prompt tokens
**High; confidence high.** `packages/ui/src/components/organisms/PortsPanel.tsx:214,266-289,320-346,581-607,623-627,668-683`.

Reproduction from code: open End prompt (prompt token 1), Cancel, reopen (prompt token 2), then dispatch the first target attempt (coordinator token 1). All completion guards compare `attemptToken === promptTokenRef.current`, which is false. Neither outcome feedback nor the `finally` reset runs. `isKilling` remains true; Cancel/End and normal dialog dismissal remain disabled. A prior attempt through another entry point or remount also desynchronizes these counters.

**Correction:** capture `promptTokenAtDispatch` separately; use it solely for presentation-current checks and `attemptToken` solely for coordinator settlement. Test cancel/reopen before first dispatch, remount after a previous refused attempt, and shared-entry-point attempt counts.

### B3. Physical-byte oracle is buffered and absence assertions are not byte proofs
**High acceptance blocker; confidence high from static code; not browser-executed.** `packages/ui/e2e/os-session-management/os-session-management.spec.ts:108-181`; selected `phase-08-integrated-qualification.md:21`.

The spec starts `od -An -v -tx1` without the required per-byte width, then sends only five `HELLO` bytes and waits for their hex. [INFERENCE] Default multi-byte input blocks can prevent any positive-control output before more bytes/EOF; no readiness proof is collected. Simply adding `-w1` also requires changing assertions, since one-byte-per-line output will not equal the current space-separated substring.

Negative checks immediately search rendered text for contiguous sequences. They do not delimit and flush each blocked interaction between allowed controls, and line wrapping/formatting or partial leakage can evade those substrings. Only one initial/final positive control surrounds all surfaces; required additional surfaces/modifier/Escape cases remain absent.

**Correction:** use the planned known synthetic raw byte process, verify readiness, parse its output as bytes, bracket every blocked interaction with observed unique allowed sentinels, and assert the exact intervening byte sequence. Cover the named P08 surface matrix. Preserve a real authenticated browser run and separate human receipt.

### B4. Termination E2E still expects live completion from a fake 202
**High acceptance blocker; confidence high.** `packages/ui/e2e/os-session-management/os-session-management.spec.ts:184-266`; `packages/ui/src/os/terminal-close-context.tsx:107-130,293-318`.

Dynamic echo fixes the previous identity mismatch, but `route.fulfill(202)` never forwards the request to terminate the PTY and supplies no exact exited observation. The test nevertheless expects the Close dialog to disappear (`:255`). Production correctly requires exact exit for live-origin completion; only restartPending/200 cancellation completes immediately. The test title claims 200, origin loss and retry safety, but its body exercises none of those paths.

**Correction:** exercise real live202 -> exact exit and pending200 -> restartCancelled, plus origin-specific held/lost responses. Keep an echoed-response transport test separately if useful; do not treat a mocked acknowledgement as PTY completion. Awaiting202 should retain the live view/prompt until authoritative completion.

## Warnings

1. **Recorder still mixes owners and permits vacuous baselines.** `packages/ui/e2e/fixtures/terminal-session-observation.ts:224-242,271-296,313-367`; `packages/ui/e2e/os-lifecycle/os-lifecycle.spec.ts:65-75`. Frames retain `socketIndex` but snapshot filters only raw terminal ID; diagnostics also match raw ID without owner. Equal IDs on two profiles can contaminate evidence. Zero create/attach/replay counts and null epoch/incarnation still pass unchanged comparisons; only token presence is required. Require exact owner/socket/lifetime scope, completed initial lifecycle, advancing live output and diagnostic truncation detection. WebSocket overflow rejection alone does not establish those controls.
2. **Unbounded global retention.** `packages/ui/src/lib/terminal-session-action-coordinator.ts:22-25,73-82,160-186`; `packages/ui/src/os/terminal-close-context.tsx:73-81,204-210`. Every target and attempt-token entry survives for the full JS runtime; only test reset clears them. Root Close also retains bound callbacks. Add lifecycle-aware retirement of safely settled records/callbacks without silently evicting unresolved actions or allowing late attempts to collide with recycled tokens. Avoid adding another registry/poller.
3. **Unknown state survives, but its explanation can become unreachable.** `PortsPanel.tsx:216-224,588-608`; `SystemMonitorApp.tsx:429-437,823-838`. After remount, unresolved rows disable the only action that opens retained feedback, displaying disabled control/spinner rather than the unknown-outcome reason. Render retained status/reason independently of dispatch eligibility.
4. **Recipe configured-profile list is still mount-only.** `packages/ui/src/os/recipes/RecipeEditor.tsx:91-125`. Connection changes for the captured profile set are reactive, but added/removed configured profiles never refresh `profiles` or its connection-version calculation. Reuse existing profile-change subscription for dynamic configuration; do not claim full profile reactivity from `subscribeConnections` alone.

## Suggestions — security, architecture, performance, KISS/DRY

- Keep the exact target tuple and owner fences; no additional runtime service or retry layer needed. Consolidate presentation reads on the existing coordinator rather than maintaining competing local retained-state copies.
- Remove dead migration seams: `PortsPanel.tsx:196-197` unused `unknown` props and Close's unused in-flight set bookkeeping (`terminal-close-context.tsx:81,319-320`).
- After correctness fixes, iterate the retained map directly instead of `Array.from(...entries())` in every reconciliation (`terminal-session-action-coordinator.ts:127`), where iteration does not add/delete keys. Avoid unnecessary full-map reconciliation in every presentation when the persistent root already observes it.
- Document new **create-response** capability/epoch headers in API/changelog sections: current descriptions mention inventory GET endpoints only (`docs/api-reference.md:125-143`; `docs/CHANGELOG.md:5`). Keep technical qualification explicitly open.
- Scope new regressions to meaningful transitions: real hook updates, exact exit settlement, cancel/reopen token divergence, unmount/remount, one target through multiple entry points. More imperative notification-count assertions will not catch B1/B2.

## Positive observations

- Manager-lifetime headers are generated from the actual manager and responses use `no-store` (`server/src/api/terminal.rs:221-231`). No new user-controlled authority source added.
- Owner snapshots are immutable; launch flows recheck captured profile/generation after create before publishing provenance (`connections.ts:170-181`; `OsShell.tsx:337-389`; `CommandPalette.tsx:157-198`; `TerminalsApp.tsx:79-126`).
- Missing/mismatched ordinary provenance now fails closed; safe numeric disagreement is rejected, and unsafe numeric-only creation cannot silently manufacture exact authority (`terminal-session-contract.ts:604-667`).
- Generic HTTP500 no longer fabricates a proven signal-dispatch failure (`terminal-session-actions.ts:171-193`).
- Shared reservations and exact target keys materially improve cross-presentation dispatch suppression without a new network poller.
- Observer stores content-free frame metadata, counts UTF-8 bytes and rejects WebSocket overflow instead of silently certifying truncated history.

## Reviewed files

Primary source and test sections:
- `server/src/api/terminal.rs`
- `packages/ui/src/api/{terminal-session-contract.ts,terminal-session-contract.test.ts,ws-transport.ts,connections.ts}`
- `packages/ui/src/lib/{terminal-session-action-coordinator.ts,terminal-session-action-coordinator.test.ts,terminal-session-actions.ts}`
- `packages/ui/src/os/{OsShell.tsx,CommandPalette.tsx,terminal-close-context.tsx,terminal-close-context.test.tsx,TerminalCloseDialog.tsx}`
- `packages/ui/src/os/apps/{TerminalsApp.tsx,SystemMonitorApp.tsx}`
- `packages/ui/src/os/recipes/RecipeEditor.tsx`
- `packages/ui/src/components/organisms/{PortsPanel.tsx,TerminalPanel.tsx}`
- `packages/ui/src/hooks/use-ports.ts`
- `packages/ui/e2e/fixtures/terminal-session-observation.ts`
- `packages/ui/e2e/{os-session-management/os-session-management.spec.ts,os-lifecycle/os-lifecycle.spec.ts}`
- Supporting targeted searches: `PortsPanel.test.tsx`, `browser-tests/os-system-monitor.browser.tsx`; selected plan/P08, prior review, tester report and documentation listed above. Not all lines of these large files reviewed.

## Validation commands / results

**Attributed tester evidence, not reviewer-executed:** `plans/reports/tester-261105-0020-critical-carryovers-verification.md:13-22,85-89`.

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test` | 334 files; 3,200 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --lib` | 1,418 passed, 0 failed, 1 ignored |
| `pnpm --filter @dam-hopper/ui build` | `tsc -p tsconfig.json`; exit0, 0 errors |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | `tsc -p tsconfig.e2e.json`; exit0, 0 errors |
| `pnpm lint` | exit0; 0 errors, 325 warnings |
| `pnpm build` | exit0; web build completed; one static/dynamic import notice |

Total reported executed tests: **4,618 passed, 0 failed, 1 ignored**. Browser E2E was **typechecked only, not executed**. Reviewer ran static inspection commands only. Coverage percentages unavailable. Main/tester should execute focused consumer regressions, browser suites and the selected P08 authenticated E2E matrix after repairs; existing green gates do not waive B1–B4.

## Unresolved questions / evidence

- No unresolved product decision identified.
- Still missing: actual browser execution of corrected physical-byte/live202/pending200/loss oracles, owner-scoped positive lifecycle controls, complete fresh capture matrix and actual human acceptance.
- Selected plan/P08/task state intentionally unchanged by this review. Administrative completion is not technical qualification.
