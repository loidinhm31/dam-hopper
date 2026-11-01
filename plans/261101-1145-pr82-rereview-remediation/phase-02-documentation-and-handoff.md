# Phase 02 — Architecture Reconciliation and Changelog

## Context and Overview

- Canonical authority: [plan.md](plan.md); priority P2; status pending; estimate 0.5h.
- Dependency: `repair-producer-lifecycle`, including observed verification/review evidence; see [Phase 01](phase-01-producer-repair-and-regressions.md).
- Owner: documentation owner designated by coordinator; no concurrent architecture/changelog writer. This phase does not run product checks again or grant implementation/Git permission.
- References: [`docs/system-architecture.md`](../../docs/system-architecture.md#read-only-session-changes-review), [`docs/code-standards.md`](../../docs/code-standards.md#session-changes-review), [`docs/CHANGELOG.md`](../../docs/CHANGELOG.md).

## Insights, Requirements and Architecture

- Existing architecture already requires owner-fenced, bounded, first-touch capture with fail-open unproven state. Explain the repaired local producer lifecycle, not a new server protocol or diff architecture.
- `globalGeneration` and active session are not authoritative lifetime checks for a verified retained-root result. Original object identity plus immutable tuple and reset epoch define that result chain's owner.
- Distinguish bounded **recent ambiguity** from the always-authoritative pending-map collision check. Do not describe bounded history as "ever ambiguous" or lifetime replay protection.
- Explain that a reset clears correlation/tombstone/history state while monotonic instance epoch invalidates outstanding local async continuations. Epoch is not a transmitted protocol field or a guarantee about arbitrary externally delivered events after identity reuse.
- Update only claims established by this repair. The predecessor's open integrated Linux OMP, Tauri, Windows and no-viewer disk qualification is not resolved by producer Bun tests.
- Architecture gate: coordinator reviews the proposed design in this plan before source execution; this phase reconciles the existing architecture overview with the implementation actually accepted in Phase 01. If design changes affect existing invariants, coordinator resolves them before execution rather than silently treating final documentation as design approval.

## Related Code Files

Project root: `/home/loidinh/WS/dam-hopper`.

| Action | Project-relative file | Change |
| --- | --- | --- |
| Modify | `docs/system-architecture.md` | Add concise producer retained-root chunk/tuple/object/epoch contract and dynamic-versus-bounded ambiguity/cleanup bounds in the Session Changes section. |
| Modify | `docs/CHANGELOG.md` | Add date-appropriate bugfix entry naming P2 late-chunk loss and P3 unbounded/stale ambiguity state; report only actual qualification. |
| Intentionally unchanged | `docs/code-standards.md` | Existing ownership-after-await, bounded state, read-only and unknown semantics already cover this repair; no new coding convention needed. |
| Intentionally unchanged | `docs/project-roadmap.md` | No product milestone, rollout or platform qualification change. Do not mark predecessor release gates complete. |

No new product files, dependency/version changes or deletions.

## Task `document-producer-remediation`

1. Read the final Phase 01 implementation and coordinator's exact compile/test/smoke/review results. Do not infer results from plan checkboxes or predecessor completion labels.
2. Reconcile only the Session Changes architecture bullets: verified origin survives activation switches; exact root replacement/reset/tuple/disable/deadline fences terminate follow-on work; 128-entry history/tombstone bounds plus pending-map ambiguity checks; full clear cleanup and monotonic reset epoch.
3. Add a scoped changelog bugfix entry. Distinguish "paths posted by verified late results" from "every file edited anywhere"; retain unknown/unproven and bounded-deadline caveats.
4. Manually inspect the Markdown change and source/design alignment; check links and literal constant names. Do not run builds/tests/formatters for Markdown-only changes or repeat Phase 01 checks unless documentation decisions require code changes.
5. Return concise actual changes, Phase 01 evidence disposition, intentional unchanged docs, outstanding risks and any blocker to coordinator. Coordinator owns final plan review/validation/task-state reconciliation; this phase cannot claim those gates on its own.

## Success Criteria, Failure and Rollback

- Architecture names both ambiguity scopes, their bounds, clear/reset semantics and result-chain invalidation accurately.
- Changelog covers both findings without invented counts, host qualification or implementation approval.
- Existing platform/release caveats, transport/auth/read-only contracts and unrelated changelog content remain intact.
- Missing verification or source/contract disagreement blocks this phase; return it for scoped repair, never paper over a failing implementation with optimistic documentation.
- Roll back only this phase's authorized Markdown edits if the underlying remediation is withdrawn. Do not overwrite unrelated document edits.

## Security and Remaining Risk

No secrets, real tool content or private paths in docs/evidence. Keep loopback bearer controls and no-store behavior unchanged. Requests already dispatched are not rolled back; bounded history intentionally forgets old collisions outside the pending-map guarantee. This documentation phase does not broaden product authority or qualification.

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "document-producer-remediation",
    "title": "Reconcile producer lifecycle architecture and document both PR 82 fixes",
    "blocked_by": ["repair-producer-lifecycle"],
    "allowed_files": ["docs/system-architecture.md", "docs/CHANGELOG.md"],
    "constraints": [
      "Documentation owner writes only the existing Session Changes architecture section and a scoped changelog entry; preserve unrelated/user changes and serialize other document writers.",
      "Use actual accepted implementation and Phase 01 verification/review evidence; do not claim installed OMP, Rust service, browser, Tauri or Windows qualification from Bun producer tests.",
      "Preserve unknown/unproven, single-deadline, read-only and private-loopback contracts; bounded recent history is not lifetime collision proof.",
      "No product code, dependency/version, roadmap milestone, unrelated plan or task-state edits; no repeat product builds/tests for Markdown-only changes."
    ],
    "acceptance": [
      "Architecture accurately states strict original-root object/tuple/epoch fences, activation-independent verified late-result delivery, dynamic outstanding ambiguity and 128-entry recent-history/tombstone bounds with clear cleanup.",
      "Changelog explicitly covers both findings and limits qualification claims to exercised Phase 01 evidence; unrelated release gates remain unchanged.",
      "Document/source agreement and links receive manual inspection and documentation review; missing evidence or unresolved contract drift is reported rather than labeled complete."
    ],
    "verification": [
      "Inspect actual architecture/changelog sections against accepted source, R1 through R13 observations and exact Phase 01 results; compilation and tests are not applicable to this Markdown-only task.",
      "Coordinator obtains documentation review and confirms no statement closes predecessor live OMP/Tauri/platform gates or implies retroactive originals, unlimited history, retries or transport rollback.",
      "Report intentional unchanged code-standards/roadmap files and preserve exact Phase 01 failure/skip/block status; do not rerun product verification unless documentation forces a reviewed code change."
    ]
  }
]
```

- [ ] <!-- evcrate-task:document-producer-remediation --> Reconcile architecture and changelog with the accepted producer remediation.

## Unresolved Questions

None. Final planning review and validation remain coordinator-owned; implementation acceptance requires actual Phase 01 evidence.
