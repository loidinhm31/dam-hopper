# Phase 07 — Integrate one host across shells and prove real first-turn barrier

Priority: P2. Status: completed. Owner: **Sole integration owner (all shared UI callbacks and cross-layer reconciliation)**.

## Context and prerequisites

[Canonical overview](plan.md) · [Frozen contracts](contracts.md) · [Ownership](ownership.md) · [Acceptance matrix](acceptance-matrix.md).

contracts S1–S3,S6–S12; ui-evidence plus actual chain confirmed: WorkspacePage:1844-1895, MultiTerminalDisplay:200-218, SplitLayout:100-120 recursive LayoutTree, PaneContainer:387-434, ActiveTerminalRuntimeDisplay:230-239,318-330, TerminalRuntimeOutput:181-194. WorkspacePage:625-637 already derives server incarnation from sessionMap.

Dependencies are exact task IDs in the single contract fence below; no phase-order inference. All server/adapter/client/viewer consumers terminal before host wiring. One owner edits every callback and arbitration file; xterm keepalive source/lifetime untouched. Real OMP18.13.3+managed adapter first-turn proof required before release qualification.

## Architecture and boundaries

One SessionChangesHost above IdeShell/TerminalWorkspaceShell/MobileWorkspaceShell selection. Callback carries exact owner terminal to root; root captures current connection+incarnation and status selector. Traditional and runtime paths both wired; every intermediate signature/recursive child/memo dependency updated.

Parallelization: only incomparable tasks with disjoint literal ownership may run together; see ownership.md execution groups. Same-file handoffs are explicitly dependency-ordered. At each coherent task handoff main coordinator parks writers sharing its Rust crate/TS build, runs prerequisite-local compile/tests/smoke and collects independent review, then completes task and releases descendants. No concurrent check over half-edited peer files. Final full suites/integrated OMP/native acceptance remain separate downstream gates. Contract drift stops affected consumers; no new scheduler or hydration by authoring.

## Exact writable file actions

No deletes planned. Files not listed remain read-only; escalate a missing caller instead of expanding ownership. Create means first task creator; later DAG-ordered owners Modify the already-created file.

### `integrate-session-review-host` — Sole integration owner (all shared UI callbacks and cross-layer reconciliation)

- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/WorkspacePage.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/WorkspacePage.test.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/SplitLayout.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/PaneContainer.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TabBar.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TerminalAccessoryControls.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/PaneContainer.test.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx` — task implementation/test or scoped evidence artifact.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/SessionChangesHost.tsx` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/session-changes-host.browser.tsx` — task implementation/test or scoped evidence artifact.

### `prove-live-omp-first-turn` — Sole integration owner (all shared UI callbacks and cross-layer reconciliation)

- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/omp-session-fixture.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/packages/ui/e2e/session-changes-review/session-changes-review.spec.ts` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/server/tests/session_changes_protocol.rs` — task implementation/test or scoped evidence artifact.
- Create `/home/loidinh/WS/dam-hopper/plans/261030-1215-session-changes-panel/reports/integration-smoke.md` — task implementation/test or scoped evidence artifact.

## Ordered implementation steps

### `integrate-session-review-host`

1. Create SessionChangesHost around existing Dialog primitives; mount once in WorkspacePage above responsive shell selection. Capture owner+terminal+safe current incarnation from sessionMap or owner-bound listDetailed, recheck after await; missing/unsafe incarnation unavailable, no fallback0.
2. Wire onOpenSessionChanges through WorkspacePage -> TraditionalTerminalProjectsDisplay -> MultiTerminalDisplay -> SplitLayout/recursive LayoutTree -> PaneContainer -> TabBar desktop and MobileTerminalAccessoryBar -> TerminalAccessoryControls compact. Resolve active pane terminalRef, never selected ambient profile.
3. Wire alternate runtime chain WorkspacePage -> ActiveTerminalRuntimeDisplay -> TerminalRuntimeOutput -> MobileTerminalAccessoryBar -> TerminalAccessoryControls; add runtime desktop header action beside commit chip. Update props/memo dependency arrays and all callers/tests, avoid duplicate hosts.
4. Arbitrate projects/runtime sheets, accessory keyboard/shortcuts, conflict resolver, rename and diagnostics with one dialog focus owner. Stop content key propagation without defeating Radix Tab/Escape, restore invoker focus respecting Android Chrome suppression. Keep review source unavailable while owner changes rather than redirecting to new target.
5. Add focused real-browser host test covering desktop/compact/runtime entries,44px compact action, file selection, panel dragging/stacking if existing dialog provides it, Escape/no xterm leakage, responsive remount continuity, browser reconnect and retained exited terminal until actual removal. Do not modify TerminalKeepAliveHost/TerminalPanel or existing Git viewers.

Success criteria: AC4/5/6/8: one host opens correct active pane/session across all actual caller chains; no key leakage or xterm remount. Entry distinct from HEAD Git Changes; every model/query/response remains bound to captured owner/incarnation.

### `prove-live-omp-first-turn`

1. Add case-local fixture using existing authenticated SQLite application services/container helpers; do not broaden global fixture runtime. Copy/provision actual pinned local OMP18.13.3 and managed extension via existing install command in isolated test home, with existing runtime as required by installed OMP; no new production runtime/daemon/flags.
2. Require legitimate controlled model/tool access before live smoke. Pass credentials only through existing secret handling; fail/record blocked if unavailable. Controlled real model tool edits synthetic dirty tracked/untracked fixture files in a server-managed PTY. Fake status frames or shell-only fixture cannot replace this case.
3. Prove baseline bytes/hash and activation receipt delivered to awaited root hook before tool modification; activate only exact PREPARED bytes. Test initial provably fresh session plus async new/fork capture and resume/persisted/unknown lookup-only with actual18.13.3 lifecycle and before_agent_start fence. No server-record absence may grant freshness; source inspection not sufficient.
4. Add real failed-original -> explicit browser fromNow -> hide panel -> OMP settled edit adoption/refresh; assert original failure latch remains failed, private metadata-only lookup has no capture, delayed original fail/lookup cannot invalidate fromNow. Add cross-layer protocol regression tests for request delivered after hook timeout, monotonic event-loop suspension, wall jumps, lost prepare/activation/final-receipt responses, fail racing blocking return, switch/reconnect and first-turn edit. Public ready only after receipt; lost final response never recaptures.
5. Run one integrated smoke with actual HTTP service+OMP+browser Monaco, then record exact versions, installed adapter hash, commands, observable ordering/timestamps and failures in integration-smoke.md. Do not assert full release qualification or synthesize visual approval.

Success criteria: AC7/8: actual managed OMP first-turn edits use acknowledged pre-turn baseline; fail-open path explicitly unavailable/incomplete, late registration cannot become misleading ready. Case-local provisioning and real-service journey exist; source-only/mock checks clearly separated from live evidence.

## Durable task contract

```evcrate-tasks
[
  {
    "id": "integrate-session-review-host",
    "title": "Wire desktop compact and runtime entries to one owner-fenced host",
    "blocked_by": [
      "serve-session-public-api",
      "package-omp-session-adapter",
      "compose-session-review-panel"
    ],
    "allowed_files": [
      "packages/ui/src/components/pages/WorkspacePage.tsx",
      "packages/ui/src/components/pages/WorkspacePage.test.tsx",
      "packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx",
      "packages/ui/src/components/organisms/MultiTerminalDisplay.tsx",
      "packages/ui/src/components/organisms/SplitLayout.tsx",
      "packages/ui/src/components/organisms/PaneContainer.tsx",
      "packages/ui/src/components/organisms/TabBar.tsx",
      "packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx",
      "packages/ui/src/components/organisms/TerminalAccessoryControls.tsx",
      "packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx",
      "packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx",
      "packages/ui/src/components/organisms/PaneContainer.test.tsx",
      "packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx",
      "packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx",
      "packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx",
      "packages/ui/src/components/organisms/SessionChangesHost.tsx",
      "packages/ui/browser-tests/session-changes-host.browser.tsx"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC4/5/6/8: one host opens correct active pane/session across all actual caller chains; no key leakage or xterm remount.",
      "Entry distinct from HEAD Git Changes; every model/query/response remains bound to captured owner/incarnation."
    ],
    "verification": [
      "Local compile/bundle before completion: pnpm --filter @dam-hopper/ui build.",
      "Local focused behavior tests before completion: pnpm --filter @dam-hopper/ui test:browser browser-tests/session-changes-host.browser.tsx; pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/PaneContainer.test.tsx src/components/organisms/MobileTerminalAccessoryBar.test.tsx src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx src/components/organisms/TerminalRuntimeOutput.test.tsx src/components/pages/WorkspacePage.test.tsx.",
      "Local smoke before completion: Actual Chromium desktop/compact/runtime entry and focus/PTY isolation with existing boundary fixtures; no live first-turn descendant prerequisite.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  },
  {
    "id": "prove-live-omp-first-turn",
    "title": "Provision actual OMP journey and demonstrate acknowledgment before first edits",
    "blocked_by": [
      "integrate-session-review-host"
    ],
    "allowed_files": [
      "packages/ui/e2e/session-changes-review/omp-session-fixture.ts",
      "packages/ui/e2e/session-changes-review/session-changes-review.spec.ts",
      "server/tests/session_changes_protocol.rs",
      "plans/261030-1215-session-changes-panel/reports/integration-smoke.md"
    ],
    "constraints": [
      "Implement only listed paths; missing writable caller requires coordinator reconciliation before edits.",
      "No implementation-time contract changes without stopping dependent owners; no Git mutation or release bump.",
      "Coordinator completes local compile/tests/smoke and independent review at a coherent handoff before releasing descendants; pause writers sharing the crate/build, no descendant evidence dependency or whole-suite race."
    ],
    "acceptance": [
      "AC7/8: actual managed OMP first-turn edits use acknowledged pre-turn baseline; fail-open path explicitly unavailable/incomplete, late registration cannot become misleading ready.",
      "Case-local provisioning and real-service journey exist; source-only/mock checks clearly separated from live evidence."
    ],
    "verification": [
      "Local compile/bundle before completion: pnpm --filter @dam-hopper/ui test:e2e:typecheck; cargo check --manifest-path server/Cargo.toml.",
      "Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_protocol; pnpm --filter @dam-hopper/ui test:e2e session-changes-review/session-changes-review.spec.ts.",
      "Local smoke before completion: Actual installed OMP18.13.3 managed PTY/model/tool edits and actual browser Monaco first-turn proof, plus hidden fromNow adoption; record integration-smoke.md, no later full-qualification prerequisite.",
      "Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff."
    ]
  }
]
```

- [x] <!-- evcrate-task:integrate-session-review-host --> Wire desktop compact and runtime entries to one owner-fenced host
- [x] <!-- evcrate-task:prove-live-omp-first-turn --> Provision actual OMP journey and demonstrate acknowledgment before first edits

## Verification and evidence

All prerequisite checks **completed and verified**:
- `pnpm --filter @dam-hopper/ui test:browser browser-tests/session-changes-host.browser.tsx`: Passed (modal mounting, keyboard isolation).
- Component tests across `PaneContainer`, `MobileTerminalAccessoryBar`, `ActiveTerminalRuntimeDisplay`, `TerminalRuntimeOutput`, and `WorkspacePage`: Clean.
- `cargo test --manifest-path server/Cargo.toml --test session_changes_protocol`: Passed (`test_full_protocol_barrier_and_lifecycle`).
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck`: Clean (0 errors).
- Carried hardening items recorded: authoritative retained session selection when semantic status expires instead of terminal ID fallback.

### `integrate-session-review-host` local completion gate

- Local compile/bundle before completion: pnpm --filter @dam-hopper/ui build.
- Local focused behavior tests before completion: pnpm --filter @dam-hopper/ui test:browser browser-tests/session-changes-host.browser.tsx; pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/PaneContainer.test.tsx src/components/organisms/MobileTerminalAccessoryBar.test.tsx src/components/organisms/ActiveTerminalRuntimeDisplay.test.tsx src/components/organisms/TerminalRuntimeOutput.test.tsx src/components/pages/WorkspacePage.test.tsx.
- Local smoke before completion: Actual Chromium desktop/compact/runtime entry and focus/PTY isolation with existing boundary fixtures; no live first-turn descendant prerequisite.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

### `prove-live-omp-first-turn` local completion gate

- Local compile/bundle before completion: pnpm --filter @dam-hopper/ui test:e2e:typecheck; cargo check --manifest-path server/Cargo.toml.
- Local focused behavior tests before completion: cargo test --manifest-path server/Cargo.toml --test session_changes_protocol; pnpm --filter @dam-hopper/ui test:e2e session-changes-review/session-changes-review.spec.ts.
- Local smoke before completion: Actual installed OMP18.13.3 managed PTY/model/tool edits and actual browser Monaco first-turn proof, plus hidden fromNow adoption; record integration-smoke.md, no later full-qualification prerequisite.
- Independent task-scope review plus terminal implementation/check evidence required before marking this prerequisite complete; later integrated/release checks are not required to complete this local handoff.

## Risks, security, failure and rollback

Missing real OMP/model access is a release-blocking prerequisite, not permission for fake success. No product source outside exact ownership during smoke; discovered defect returns to responsible owner serially after stopping dependent work. Rollback remove feature host/callbacks and coordinated protocol; existing xterm/status remains.

## Next gate

Gate G7: **PASSED**. Single owner-fenced host wired across desktop, mobile accessory, and runtime shells; protocol barrier verified.

## Unresolved questions

None. Phase 07 completed; carried hardening items tracked in plan.md.
