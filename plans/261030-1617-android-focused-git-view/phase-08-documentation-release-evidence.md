# Phase 08 — Documentation and release evidence closeout

## Context / overview
Priority P2. Status in-progress (documentation updates underway by evc-docs-manager; passing documentation review pending). Effort unestimated. Owner: **single documentation owner**. Execution group: **G4 sequential docs**.
Predecessors: qualify-git-failure-boundaries terminal evidence; blocking failures retained. Successors: parent release decision only.
Authority: [contracts](contracts.md), [acceptance matrix](acceptance-matrix.md), [coordinator evidence](reports/coordinator-evidence.md), [Git evidence](reports/git-contract-evidence.md), [workspace evidence](reports/workspace-safety-evidence.md). Read relevant current source before coding; source facts are not runtime results.

## Key insights
- Existing native docs describe dormant Git and historical H1–H5; intended focused-Git architecture is explicitly not implemented until code lands.
- Broader native Phase18/19 and related device gates are not silently completed by this feature.

## Functional / nonfunctional requirements
- Update existing native README/architecture/acceptance/changelog only from actual source and exercised evidence.
- All ten ACs remain visible, historical limits qualified, release blockers honest. No release/version/Git operation. AC01–AC10 evidence closeout.

## Architecture and data flow
Land01–06 -> independent current-server/device qualification07 -> one docs owner reconciles actual code vs intended architecture and evidence ledger -> parent decides implementation/release readiness. Documentation cannot turn blocked physical/API29 gates into passes.

## Exact writable actions
Paths below are literal normalized repository-relative paths; this table and task arrays have identical writable union. No wildcard ownership. Create only named necessary files; modify existing patterns, no parallel replacement system.
| Action | File | Purpose |
|---|---|---|
| Modify | `native/android-app/README.md` | Source/evidence-backed native documentation and release disposition |
| Modify | `docs/architecture/android-native-client.md` | Source/evidence-backed native documentation and release disposition |
| Modify | `docs/android-native-acceptance.md` | Source/evidence-backed native documentation and release disposition |
| Modify | `docs/CHANGELOG.md` | Source/evidence-backed native documentation and release disposition |
| Create | `plans/261030-1617-android-focused-git-view/reports/release-readiness.md` | Source/evidence-backed native documentation and release disposition |

Delete files: none; delete obsolete members/calls inside owned modified files as specified. No compatibility aliases/shims.

Read-only related paths:
- `plans/reports/brainstorm-261030-1451-android-focused-git-view.md`
- `plans/261030-1617-android-focused-git-view/contracts.md`
- `plans/261030-1617-android-focused-git-view/acceptance-matrix.md`
- `plans/261030-1617-android-focused-git-view/reports/git-qualification.md`
- `plans/261030-1617-android-focused-git-view/reports/device-qualification.md`
- `plans/261030-1617-android-focused-git-view/reports/request-contract-audit.md`
- `docs/code-standards.md`

## Ordered implementation steps by task ID
### document-focused-git-release-evidence
1. Read actual landed source and07 report artifacts. Reconcile implemented boundaries against intended Git architecture; when code differs from accepted contract, return product drift to coordinator, do not retroactively bless it with prose.
2. Native README documents active focused Git tab/three sections/details/diff, four identities, worktree switch/retention, read-only conflict handoff and secondary-root fetch/pull limitation. Existing shortcut limitations remain unless changed within explicit scope; Git tab reachability does not authorize broader Settings/12-panel changes.
3. Native architecture promotes intended increment to implemented description only for landed behavior; retain historical source/docs discrepancy and evidence dates, no claim all H1–H5 fresh defects or all baseline Phase12 done. Keep owner/rebind/terminal grid/draft preservation and unknown-outcome semantics explicit.
4. Acceptance ledger maps all ACs to actual report/command/device outcomes and H1–H5 re-evaluation; retain open broader Phase18/19 obligations. Docs CHANGELOG records feature/hardening without release/version bump or implied server deployment.
5. Create release-readiness.md with per-AC implementation/evidence status, emulator/ARM64/API29/form-factor/security gates, exact outstanding blockers and safe rollback to prior installed client artifact. No Git reset/server mutation as rollback. Parent owns final reviewer/validation/release action. Do not mark plan/task execution complete from documentation alone.

## Durable tasks
```evcrate-tasks
[
  {
    "id": "document-focused-git-release-evidence",
    "title": "Document implemented focused Git and honest qualification disposition",
    "blocked_by": [
      "qualify-git-failure-boundaries"
    ],
    "allowed_files": [
      "native/android-app/README.md",
      "docs/architecture/android-native-client.md",
      "docs/android-native-acceptance.md",
      "docs/CHANGELOG.md",
      "plans/261030-1617-android-focused-git-view/reports/release-readiness.md"
    ],
    "constraints": [
      "One docs writer; wait for07 and any required product repairs/requalification to terminate before editing shared documentation.",
      "Keep docs factual and under repository800-line guidance; no unrelated roadmap/other plan changes or invented evidence.",
      "Docs-only compile is not applicable with a recorded reason; no product-test waiver. Validate changed docs links/status/source claims using actual evidence and obtain passing docs review before completion."
    ],
    "acceptance": [
      "Existing docs accurately distinguish implemented/reachable vs exercised/blocked release evidence, all ten ACs and H1\u2013H5 dispositions traceable; no preclaimed qualification.",
      "Native architecture intended section promoted only for actually landed behavior; settings/shortcuts/historical broader Phase18/19 limits preserved, changelog reflects scoped change.",
      "No release/version/signing/commit/push/deploy or destructive Git rollback implicitly authorized."
    ],
    "verification": [
      "Compile applicability: docs/report-only allowed_files, no code changes; record compile not_applicable with reason and link predecessor actual compile/test/smoke results, never fabricate a new pass.",
      "Perform actual read-only documentation link/status consistency checks and source/evidence walkthrough smoke for all10 ACs; review status cannot convert blocked runtime/hardware gate into passed.",
      "Obtain passing scoped documentation review and retain actual static-check/evidence report before completing this docs-only task; no product-test waiver or unauthorized release operation."
    ]
  }
]
```

- [ ] <!-- evcrate-task:document-focused-git-release-evidence --> Document implemented focused Git and honest qualification disposition (open: docs manager active, review pending)

## Conflict prevention / transfers
Sequential owner waits for every predecessor terminal result. Any repair in another owner's source is an explicit ordered transfer/task-contract revision, never concurrent implicit write authority. Preserve unrelated plans/user edits.

## Compile-dependency closure (planned, not observed)
Docs-only task consumes evidence-complete unchanged implementation/qualification. It introduces no code/interface dependency. Record compile not_applicable for prose scope per installed evidence schema, not a waiver for any earlier implementation task. Read-only changed-link/source/evidence checks and walkthrough smoke + passing docs review remain required.

## Acceptance and future verification
Static source/evidence/link/status inspection only for prose; no product suite rerun solely due to docs. Release readiness requires all required actual07 gates, not this task checkbox. Missing hardware is honest blocked release disposition even if documentation deliverable complete.

## Risks, security, failure and rollback
Shared docs writers in editor/recovery/sidebar plans must serialize under coordinator. Preserve unrelated historical evidence rather than rewriting pass counts. Sensitive evidence redacted, links actual artifacts. Rollback client version only; no automatic force push, reset, deployment or signing operation.

## Next / unresolved
Proceed only through declared dependencies. No unresolved product choice; actual compile/runtime/device evidence remains pending. Planning authoring is not implementation approval or a passing qualification result.
