# P01 — Freeze additive native contracts

## Context links
[Overview](plan.md) | [Binding C1–C10](architecture-contracts.md) | [Ownership/transfers](execution-ownership.md) | [Acceptance matrix](acceptance-matrix.md) | [reports/android-evidence.md](reports/android-evidence.md) | [reports/api-compatibility-evidence.md](reports/api-compatibility-evidence.md)

## Overview
- Priority: P1 (safety-critical cutover); status: pending; effort: 8h.
- Owner: Contract01 (integration owner). Parallelization group: `S-1`.
- Prerequisite task IDs: None (entry prerequisite).
- Authoring only. No product execution approved; no build/lint/tests/formatter while authoring or feature writers are active.

## Key evidence
Current root is Profile Login -> Project List -> focused workspace; dormant Workbench is not the product. Existing FileIdentityDto is nullable and path-derived DocumentId cannot be the new canonical identity. Agent runtime, PTY and workspace epochs are different domains. No server changes are needed.

## Requirements
Functional: settle all types and feature-facing snapshots/actions before any provider migrates. Distinguish profile+endpoint+account, ConnectionRef generation, SocketInstanceRef, PTY epoch UUID, agent epoch u64, workspace epoch u64; no interchangeable Long/string bag. Filesystem target is workspace or project/worktree; ProjectTargetRef stays legitimate for Git and project operations. Native Hub state represents session-derived groups plus explicitly open zero-session project/worktree refs, known/loading/disconnected/unsupported states, hidden/pinned instances and unresolved intents.
Nonfunctional: additive definitions only; current providers keep compiling unchanged. No alternate registry/runtime, scheduler, polling loop, compatibility shim, flags or dependency changes. Existing Kotlin PascalCase convention applies. Do not claim a server capability from app/version strings.

## Architecture and ports
Define FilesystemTargetRef and exact REST query/nested-WS serialization in core/model; reuse and complete FileIdentityDto rather than introduce another wire identity. Add final guarded terminal/create/inventory outcome DTOs in TerminalModels while old provider entry points remain until the atomic P02 replacement. Define raw sparse UI patch/null intent shapes in SettingsModels without changing current consumer nullability yet. AgentHubModels/AgentHubPorts are immutable view snapshot + explicit action contracts, not a service. Existing RetainedRootServices/retained owners will implement them in P07; new presentations accept these contracts, never read registry directly.
Port boundary: snapshot carries qualified selected project/worktree, loaded inventory/capability state, zero-session open refs, terminal/agent rows, pin/hidden/create outcomes. Actions request open/select/dismiss/reopen/create/end, Settings target and notification activation through existing guarded routes. Suspending actions revalidate after consent. Files source can be whole workspace or registered project; Git requires a registered ProjectTargetRef. Define cover/Back events as UI state inputs, not transport commands. P02 producers emit settled shapes before G-A starts.
Document retention/lifetime port contract: existing retained owner owns the canonical holder/map AND native document lifetime; EditorTabsState factories receive that same owner/map, not independent disposal rights. Define explicit alias/session and exact widget+view-lease tokens, identity-bearing EditorLoadResult/DocumentSaveSnapshot, captured owner/revision and all-alias incarnation rotation. Alias/tab/workspace close releases only its own lease/listeners/exact view. Only retained owner may dispose exactly once, after zero aliases, zero active view leases, zero dirty retention and zero in-flight snapshots/saves; retire token first. Final dirty alias close uses existing save/discard/cancel guard and keeps an accessible alias on cancel/failure/busy, never unreachable dirty retention or implicit discard. Retirement synchronously withdraws authority while retaining recoverable in-process dirty/undo; no process-death recovery claim. Canonical reload/discard/tier replacement is one captured-owner/revision transaction: blocked/busy during save, explicit dirty consent, post-consent revalidation, atomic successor publication to every alias with all incarnations rotated, failures/staleness preserve original. Single active native view per document; exact widget+lease detach cannot remove successor receipt, overwrite successor view state, disable its input or dispose its document; old widget cleans only its own resources. Add these port types/invariants additively here, migrate every session/document/factory/surface caller atomically P02; no new registry/runtime.

## Related files and ownership
Absolute source mapping: every project-relative literal below resolves under `G:/ws/sharing/dam-hopper/`; these are full source paths by that mapping. Runtime report paths listed Create are future evidence artifacts, not files authored during planning. No directory ownership or globs.
### Create (new files; not existing source)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/FilesystemTargetRef.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubPorts.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubContractsTest.kt`
- `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalLifetimeContractTest.kt`

### Modify (existing files)
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorResults.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDocument.kt`
- `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionPorts.kt`

### Create (coordinator-only completion receipts after stopped task/wave)
- `plans/261107-0305-android-agent-hub-redesign/reports/freeze-native-contracts-completion.md`
- `plans/261107-0305-android-agent-hub-redesign/reports/freeze-native-contracts-evidence.json`

### Delete
- No whole-file deletions. Remove obsolete replaced methods/callers/navigation assertions inside the modified files; unrelated dormant feature code stays.

### Conflict and transfer rules
The task fences below are exhaustive writable authority. Within this phase, steps execute by their task dependencies. Shared sequential paths transfer `Contract01 -> Api02 -> owning Feature03/04/05/06 -> Integration07 -> Qualification08/docs` only where declared. G-A may read other slices but cannot write their files, common root, shared DTOs or ports. Any missing writable caller blocks the affected task until coordinator deliberately revises that task and reruns structural validation; no compatibility shim or unsanctioned edit. Ownership transfers only after predecessor stopped-wave checks, independent review and evidence-backed completion. Per-task report/evidence grants are coordinator-only after the worker stops. Exact per-path chain: [execution-ownership.md](execution-ownership.md).

## Numbered implementation steps by stable task ID
### freeze-native-contracts
1. Trace C1-C10 into concrete immutable models; preserve exact field casing, decimal u64 range and UUID domain checks. Define route access target separately from canonical document key and tab incarnation.
2. Finish additive filesystem, terminal lifetime and Settings patch schemas; never change terminal write/resize/attach wire. Define admission/outcome persistence schema containing only minimal nonsecret unknown-create identity, not command/output/token.
3. Specify Hub snapshot/actions against existing retained services: zero-session selection, loaded inventory dismissal predicate, explicit hidden view reopen, pin retention, independent Settings A/B/C and click routing.
4. Author contract fixtures for max-u64, mixed identity casing, null versus omitted patch, unsupported owner and process-restored uncertain create. Hand off complete signatures and ownership table; leave activation for P02/P07.
5. Freeze lifetime transition/lease fixtures in AgentHubContractsTest: another alias survives close, final dirty close choices, busy close/reload during save, canonical all-alias replacement and late old-view detach. These contract-level decisions are smokeable without future provider/root wiring; native execution is P02/P06 and retained-root wiring P07.

## Durable task contract
```evcrate-tasks
[
  {
    "id": "freeze-native-contracts",
    "title": "Define additive ownership, filesystem and Hub contracts",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/model/FilesystemTargetRef.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/FileModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubPorts.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/AgentHubContractsTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalLifetimeContractTest.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorResults.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorDocument.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSessionPorts.kt",
      "plans/261107-0305-android-agent-hub-redesign/reports/freeze-native-contracts-completion.md",
      "plans/261107-0305-android-agent-hub-redesign/reports/freeze-native-contracts-evidence.json"
    ],
    "constraints": [
      "Stay within this literal allowlist; escalate additional writes to integration owner before editing.",
      "Implementer authors tests but runs no checks. After every writer in this selected coherent wave stops, coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before evidence-backed completion or successor admission; no sibling-edit checks, no defer-to-P08 completion."
    ],
    "acceptance": [
      "All downstream schemas/ports are complete and additive; no dependent provider waits for an unfinished DTO.",
      "Exact domains/targets, canonical lifetime owner, alias/view leases, disposal/save/replacement fences and dirty-close decisions have runnable contract fixtures; no new runtime owner."
    ],
    "verification": [
      "At this task/wave stop barrier, coordinator runs applicable existing Gradle shared/app compilation and focused owned regression classes from acceptance-matrix command timing; record exact command, exit and assertions. No dependent future root/release work is required for this task's acceptance.",
      "Exercise real compiled additive model/serializer and snapshot/action contracts in an interactive JVM component invocation using the existing compiled classpath (for example jshell --class-path <resolved classpath>); observe exact identity/u64/null round trips and explicit lease/close/replacement decision model round trips (native lifetime behavior is exercised by P02/P06, not claimed from port definitions). This is a separately recorded runnable contract smoke, not another unit-test pass or future provider/root behavior.",
      "Collect terminal implementation and passing independent review after stopped-wave checks; write exact results and reviewer provenance to plans/261107-0305-android-agent-hub-redesign/reports/freeze-native-contracts-completion.md and current helper-schema evidence to plans/261107-0305-android-agent-hub-redesign/reports/freeze-native-contracts-evidence.json. Smoke/review cannot be waived; failed or missing gates block completion. P08 separately repeats full integrated/live/device release suites."
    ]
  }
]
```

- [ ] <!-- evcrate-task:freeze-native-contracts --> Define additive ownership, filesystem and Hub contracts

## Behavior acceptance and qualification
Each task's acceptance/verification arrays are binding at its own stopped coherent-wave completion barrier; the coordinator runs applicable compile, focused regressions, separate meaningful task-local smoke and independent review before helper evidence-backed completion and dependent admission. Implementers run no checks, and no coordinator checks occur while any sibling writer edits. P01–P06 prove component/provider behavior through settled ports, not unimplemented future MainActivity/release wiring; P07 proves its focused active-root/lifetime behavior sequentially. P08 alone repeats full integrated/live/device/human release suites. Tests alone are not smoke. Missing required runtime/device prerequisites block the affected gate; source-only authoring cannot claim runtime success. Record failures/skips/blockers distinctly; no fabricated pass or waiver.

## Risks, privacy, security, failure and rollback
Risk: additive models accidentally become duplicate active authority. Keep existing providers current until P02; remove obsolete replaced definitions there, not aliases. Privacy: intent record excludes credential, command and terminal content. Failure: invalid/unsupported metadata carries unavailable state, never guessed authority. Rollback: remove only this phase's unused additions if cutover has not begun; otherwise reverse dependent client changes first.

## Downstream barrier
P02 starts only after freeze-native-contracts is evidence-backed complete: schema/lease ports and fixture handoff, coordinator applicable compile/focused regressions, separate runnable contract smoke and independent review at W01. No future P08 check is prerequisite evidence; no checks while a writer edits.

## Unresolved questions
None for product design. User confirmed adaptive navigator and all already-connected profiles; no saved-profile auto-connect/keepalive. [Final validation](reports/final-plan-validation.md) preserves C1-C10, task contracts and ownership unchanged. Device/WS/auth/crypto-fixture checks remain explicit implementation gates, not observed passes.
