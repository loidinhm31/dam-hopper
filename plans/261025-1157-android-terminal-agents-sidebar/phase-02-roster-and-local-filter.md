# Phase 02 — Roster projection and local filter

Priority P2 · status Complete (administrative; review caveats retained) · owner: pure/store implementer · execution: G2 branch A (internal serial tasks). No time estimate.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "implement-roster-membership",
    "title": "Implement qualified membership join and effective status projection",
    "blocked_by": [
      "freeze-terminal-agents-contracts"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsMembership.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsPresentation.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsMembershipTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsProjectionTest.kt"
    ],
    "constraints": [
      "Pure deterministic code and behavior tests only; no root/VM/screen/reducer/Settings/network edits.",
      "Consume Phase01 interfaces without changing their files. No process-name inference or raw-ID fallback.",
      "Same logical-owner cached observations may render only Unavailable until current runtime baselines requalify."
    ],
    "acceptance": [
      "Canonical project/worktree metadata, current-owner inventory and visible selectable membership join exactly; duplicate/conflicting metadata fail closed.",
      "Equal IDs/profiles/incarnations remain isolated, including equal ConnectionRef/sock-1 values on different attachmentIncarnation; registration/tab order stable and no unobserved PTY becomes an agent row.",
      "Availability precedence covers disconnected cached READY, baseline loading/invalidation, typed 404 Unsupported and identity purge.",
      "Status/reason/Done/source/coverage behavior matches contracts without notification mutations."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :shared:jvmTest --tests \"*TerminalAgentsMembershipTest\" --tests \"*TerminalAgentsProjectionTest\" after coherent branch completion.",
      "Use table-driven inputs/outputs including equal-value socket replacement with distinct attachment token, cached logical identity versus current authority, conflicts and epoch/baseline stamps; no source-wording assertions."
    ]
  },
  {
    "id": "implement-roster-grouping-filter",
    "title": "Complete pure status filtering, counts, stable grouping and exact-target cycling",
    "blocked_by": [
      "implement-roster-membership"
    ],
    "allowed_files": [
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/DefaultTerminalAgentsProjector.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsGrouping.kt",
      "native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/DefaultTerminalAgentsFilterCodec.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsGroupingTest.kt",
      "native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalAgentsFilterTest.kt"
    ],
    "constraints": [
      "Compose the complete projector from membership/presentation helpers only after their task terminal; no placeholder interface methods.",
      "No storage/network access from pure projection/filter/grouping and no notification AgentFilter changes.",
      "Counts use eligible unfiltered terminal rows; groups use filtered rows, not group counts."
    ],
    "acceptance": [
      "Stable first-project/status/reason/harness/member order and unanimous-only Done aggregation match web semantics.",
      "All/multi-select normalizes empty and all-seven to All; defensive scalar/JSON decode retains only valid statuses and canonical order.",
      "Qualified cycling next/wrap/active-elsewhere/defensive-empty returns exact captured target, never another profile by bare ID.",
      "Every status bucket exists even at zero; empty versus filtered-empty and duplicate/reason grouping have behavior tests."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :shared:jvmTest --tests \"*TerminalAgentsGroupingTest\" --tests \"*TerminalAgentsFilterTest\" after branch terminal.",
      "Exercise all seven statuses, mixed sources/reasons/hints, permutation-stable project/tab order and canonical encoding without code-text scans."
    ]
  },
  {
    "id": "implement-roster-local-store",
    "title": "Add one device-local SharedPreferences filter adapter and storage tests",
    "blocked_by": [
      "implement-roster-grouping-filter"
    ],
    "allowed_files": [
      "native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidTerminalAgentsFilterStore.kt",
      "native/android-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidTerminalAgentsFilterStoreTest.kt"
    ],
    "constraints": [
      "Application Context only; dedicated terminal_agents_sidebar/status_filter preference, no WorkbenchPreferences or remote Settings envelope.",
      "No invented native legacy-key migration, web-storage migration, mount write or profile-dependent filter persistence.",
      "Only explicit user change calls save; load is defensive and never writes or deletes."
    ],
    "acceptance": [
      "Adapter implements Phase01 store using Phase02 codec; missing/corrupt/scalar/array storage behaves exactly as frozen.",
      "Fake/injected preference access records zero writes on load and canonical writes on explicit save; storage denial is safe.",
      "Persisted bytes contain only filter labels, never terminal/profile/project/account/command/status observations."
    ],
    "verification": [
      "Run node scripts/run-gradle.mjs :androidApp:testDebugUnitTest --tests \"*AndroidTerminalAgentsFilterStoreTest\" after coherent integration.",
      "Tests exercise codec plus adapter calls/bytes with existing Android test constraints; do not rely on default-return Android stubs as proof of real persistence."
    ]
  }
]
```

- [x] <!-- evcrate-task:implement-roster-membership --> Implement membership and presentation
- [x] <!-- evcrate-task:implement-roster-grouping-filter --> Implement grouping, filter and cycling
- [x] <!-- evcrate-task:implement-roster-local-store --> Implement local filter adapter

## Context / architecture / requirements
Priority P2; all tasks Complete per user direction. [Contracts](contracts.md#2-qualified-ownership-membership-and-inventory), [web/native evidence](design-evidence.md). G2 pure/store branch was implemented alongside Phase03. Cycle 3 records an open successor-inventory/membership-freshness warning; see [review](../reports/code-review-261025-1647-terminal-agents-sidebar-cycle3.md). This phase owns immutable data-to-data transformations and one narrow Android local store; existing notification filtering/admission is unchanged.

## Related files / ownership and transfers
CREATE only listed allowed_files; all paths are new, no writable overlap between tasks. MODIFY none; DELETE none. Read-only sources: web `traditional-terminal-agents.ts`, `traditional-terminal-agent-groups.ts`, `traditional-terminal-agent-filter.ts`; native terminal/owner types and existing `AndroidPreferencesStore.kt` for adapter conventions. Never edit the latter or Settings/WorkbenchPreferences. New tests live in existing JVM/Android unit source sets; no dependency edits authorized. If an unlisted helper path is genuinely required, stop for explicit ownership revision rather than widening to a directory.

## implement-roster-membership — ordered steps
1. Implement exact metadata canonicalization/join in `TerminalAgentsMembership.kt` using existing worktree/endpoint normalizers. Confirm explicit registration and accepted visible membership; authoritative inventory order wins, not controller map/active project. Represent conflict as fail-closed health/diagnostic input rather than selecting an arbitrary duplicate.
2. Implement complete internal row-building helpers: exact qualified live Traditional membership/status join uses runtime attachmentIncarnation and carries captured statusAuthorityRevision into target. Same logical-owner cache across attachment replacement remains display-only Unavailable with old captured target; identity loss purges. No partial interface, reducer or notification mutation.
3. Implement `TerminalAgentsPresentation.kt` to derive status from effective availability, not cached READY; preserve Needs attention reasons, secondary Done definition, source and hook caveat. Helpers are complete in this task; the next task creates the complete projector implementation.
4. Test two profiles same ID, restarted PTY incarnation, same generation/equal sock-1 **different attachment token**, normalized nullable worktrees, account/endpoint/generation/socket mismatch, absent/mismatched status, stale inventory ticket, conflicting duplicates, destroying/targetUnavailable/dead/nontraditional and typed availability precedence. Pure tests distinguish old display cache from current runtime/target fence; real callback/admission rejection is Phase04.

## implement-roster-grouping-filter — ordered steps
1. Create complete `DefaultTerminalAgentsProjector` using the finished membership/presentation helpers. Implement all interface methods; `project` uses one unfiltered eligible row sequence, all/zero status counts, normalized presentation filtering and stable grouping. No unfinished methods at task completion.
2. Implement `TerminalAgentsGrouping.kt` pure helpers: canonical owner/status/reason groups; preserve member tab order; unique source hints; fixed OMP/Codex/Claude order; unanimous-only Done. Cycle with qualified instance keys; defensive empty returns null.
3. Implement `DefaultTerminalAgentsFilterCodec` with canonical English labels from web semantics. Decode invalid/missing data to All; scalar/JSON-array defensive support; normalize empty/all-seven; encode scalar or canonical array. No storage access or migration.
4. Test count-before-filter/group, multi toggles/all sentinel, invalid members, duplicate labels/reasons, first-project encounter, mixed/unanimous Done and exact next/wrap behavior. Validate outputs against stated contract, not the presence of names in production files.

## implement-roster-local-store — ordered steps
1. Create adapter backed by dedicated application-context SharedPreferences. Reuse platform storage idioms, not preferences envelope or sync service. For testability keep preference-byte access narrow using existing Android interfaces/test doubles, no new dependency.
2. `load` reads once and decodes without writeback; `save` only serializes chosen filter, handles local storage exceptions safely. One filter across profile switches; process-local selected value remains usable on failed save.
3. Add adapter unit tests with observable read/write records. Test corrupt/missing/scalar/array input, denied read/write, repeated load without save, canonical multi selection. Actual durable on-device restart is qualified later; stubbed Android methods do not prove it.
4. Return branch terminal with exact new paths and symbols, test commands for coordinator, any real checks if explicitly authorized. Do not mount store or add a root service here.

## Acceptance / checks / parallelization
The pure/store branch tasks are marked complete. User-reported aggregate qualification in Phase05 covers 1,048 passing unit/JVM tests and successful `assembleDebug`; task-specific commands/results are not itemized here. Connected-device instrumentation and complete live acceptance remain open.

## Risks / security / failure / rollback
- Ambiguous metadata: exclude instance and expose refresh, never first-match fallback. Exact roster worktree correction does not rewrite existing broad terminal selector.
- Cached/typed state may be missing: empty observed-agent list plus diagnostic, never invent a harness or status.
- Allocation: reuse All-path eligible list where safe, count/group in linear passes; snapshot copy once at publication, not per property access.
- Persistence failure is optional local UI preference failure, not remote sync; no identity/commands in bytes/logs. No native legacy bytes verified, so no migration path.
- Rollback removes these exclusive new implementations/tests and dedicated preference only with all consumers reverted; do not touch existing preferences/remote config.

## Next dependencies / unresolved questions
`implement-roster-local-store` and Phase03 UI work preceded Phase04. Existing runtime/root/VM/reducer/Settings/terminal screen ownership stayed with Phase04. No product questions; MainActivity/device acceptance remains open in Phase05.
