# Phase 01 — Shared contract freeze

Priority P2 · status Complete (administrative; review caveats retained) · owner: contract implementer · execution: serial G1. No time estimate.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "freeze-terminal-agents-contracts",
    "title": "Establish immutable native-only roster, projection, store and sidebar ports",
    "blocked_by": [],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsModels.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjection.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsPorts.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsSidebarModels.kt"
    ],
    "constraints": [
      "Create only four narrow contract files; no root/VM/reducer/UI implementation or dependency changes.",
      "Implement contracts.md verbatim in native Kotlin types; existing transport and workspace identities stay authoritative.",
      "Both branch owners receive the same accepted signature artifact before concurrent work; contract drift stops both."
    ],
    "acceptance": [
      "All named immutable models, projector/filter/store/service interfaces and UI callbacks in contracts.md exist with exact signatures.",
      "Membership runtime keys carry monotonic retained-host attachmentIncarnation and captured statusAuthorityRevision in addition to owner/socket/ticket fences; Committed/Deferred/Refused remain explicit.",
      "No pure projection, storage adapter, network requester, roster coordinator or component implementation is smuggled into contract files.",
      "Coordinator records exact signature freeze, including synchronous producer ports, popup visibility callback, Phase04 typed try-admission/defaulted Settings seams and branch-consumer acceptance; source text alone is not compilation proof."
    ],
    "verification": [
      "At coherent group boundary, coordinator runs node scripts/run-gradle.mjs :shared:compileKotlinJvm and records actual result.",
      "Review compiled port declarations against contracts.md and confirm both branch implementations use these imports; no builds during plan authoring."
    ]
  }
]
```

- [x] <!-- evcrate-task:freeze-terminal-agents-contracts --> Establish shared contracts

## Context and architecture
Priority P2; status Complete per user direction; sequential G1. [Overview](plan.md), [contracts](contracts.md), [evidence](design-evidence.md). Verified terminal identity/status models and retained-workspace/runtime evidence are reused; these are presentation ports, not a second notification authority. Current root/session inventory is not retained membership, so typed publication and owner receipts are prerequisites to both branches.

## Related files / exact ownership
Contract owner CREATE only the four files in this phase's allowed_files. Paths are project-root-relative (root `G:/ws/sharing/dam-hopper`); no directory/glob permission. MODIFY none; DELETE none. Existing `TerminalModels.kt`, `AgentStatusReducer.kt`, `WorkspaceFileOwner.kt`, connection refs and StateFlow are read-only imports. New files remain focused (split as enumerated, not huge root expansion). No runtime binding, data transformation, normalization algorithm, JSON codec, persistence or Compose body here.

## freeze-terminal-agents-contracts — ordered steps
1. Materialize `TerminalAgentsModels.kt`: runtime keys include attachmentIncarnation, snapshot/target carry statusAuthorityRevision and all inventory/callback captures retain runtime key. Preserve logical display-cache identity independent of attachment; same-generation equal sock-1 replacement is distinct authority. Reuse actual ULong PTY incarnation and nullable worktree semantics.
2. Materialize `TerminalAgentsProjection.kt`: `TerminalAgentsProjector` and `TerminalAgentsFilterCodec` interfaces, no Default implementations. Type/member shapes from contracts, including unfiltered counts and exact-target cycling.
3. Materialize `TerminalAgentsPorts.kt`: local filter store and retained service/activation contracts. Keep register/close/publish/filter synchronous; Phase04 uses short synchronous producer sections with try-only registry admission, not deferred/throw-on-busy producers. Receipt lifecycle distinguishes Deferred, actual Committed linearization and cancellation.
4. Materialize `TerminalAgentsSidebarModels.kt`: controlled UI state/mode/callbacks, including `onPopupVisibilityChanged`, group-key click and independent Settings callback. No Activity/VM/repository reference; owner-qualified root cover reporting occurs in Phase04.
5. Record freeze acceptance at coordinator handoff: enumerate four declarations files, exact symbols/signatures/defaults, collection snapshot boundaries and branch consumers. Resolve any type/import mismatch here, propagate accepted contract revisions to this plan before branching. Coordinator accepts freeze; unresolved mismatch blocks G2. This is not independent plan review/validation and does not hydrate state.

## Acceptance and checks
Contract signatures cover canonical ownership/attachment incarnation, effective cache, pure projection/filter/group, local store, popup reporting, qualified retained StateFlows and async activation. Phase04 alone implements exact typed socket/reducer try-admission, mutation-only route/session hooks and ProfileRouteAdmission chain from contracts, with registry->try-roster->try-socket->try-reducer exclusion, not Main-only proof. SettingsScreens defaults USAGE/no-op preserve compiled WorkbenchScreen caller intentionally. Future compile and exact branch signature acceptance required; no port duplicates, notification-filter reuse or task-state hydration.

## Risks / security / failure / rollback
- Freeze omits a required identity dimension => unsafe branch assumptions. Block and revise both affected branches before work; do not add runtime fallbacks.
- Mutable collection alias => stale/live authority crossing snapshots. Immutable public collections with boundary copies; no avoidable repeated copies in hot projections.
- Existing ownership/serialization enums must not expand for client Unsupported. No serialization annotation on new presentation types.
- Revert these exclusive new files only before consumer work, or together with all consumers after integration. No product/dependency/task-state changes are authorized by this planning result.

## Next dependencies / conflicts
Phase01 contracts are marked Complete; Phase02/03 consumers and Phase04 integration proceeded from the frozen ports. G2 writable sets were disjoint from these four files and each other.

## Unresolved questions
No unresolved product questions. Phase-level compiler results are not itemized separately in this update; aggregate automated qualification is recorded in Phase05.
