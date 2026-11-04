# P09 — Evidence-backed documentation and handoff

Priority P2 · Status pending · Effort 4h · Owner DocsFinalizer.

## Context, prerequisites and ownership
Read [architecture contracts](architecture-contracts.md), [intake/related plans](reports/planning-intake.md), [acceptance](acceptance-matrix.md), actual P08 qualification/capture/human evidence and current live docs before editing. Project files actually located: `docs/system-architecture.md`, `docs/frontend-components.md`, `docs/api-reference.md`, `docs/CHANGELOG.md`, `docs/project-roadmap.md`, `docs/codebase-summary.md`. Do not create assumed `docs/architecture.md`, `docs/project-changelog.md` or a second roadmap convention.
Sequential after `human-full-app-visual-review`; one DocsFinalizer holds all doc writes. Coordinator owns task-state finalization, no duplicate docs/Git finalizer. If runtime/human gate blocked, documentation may truthfully describe pending limitations but phase cannot claim finished delivery. Related-plan docs writers require external exclusive handoff before execution; no other plan edits.

## Requirements, rationale and architecture
Document exercised behavior only: Close presentation; End captured live request then observed exit OR exact pending-restart cancellation before admission; additive exact-string/state inventory with fail-closed original headers/epoch and origin-specific loss reconciliation. Preserve numeric/array compatibility while unsafe downstream joins/replay remain unavailable, not coercion. Inventory-first Hub/ordinary beside/metadata Review, Recipe capture not execution and interaction rules unchanged. Intended prose not deployed proof; preserve unresolved AC8/F1/unrelated H1/H2 history.

### Task `reconcile-docs-handoff`
**Modify:** `docs/system-architecture.md`, `docs/frontend-components.md`, `docs/api-reference.md`, `docs/CHANGELOG.md`, `docs/project-roadmap.md`, `docs/codebase-summary.md`. **Create:** `plans/261104-1529-os-session-management-and-interactions/qualification/handoff.md`. **Delete:** none. README intentionally unchanged: existing map/auth/dev commands remain accurate; no release/version bump/manifests authorized. Acceptance matrices and plan status managed by coordinator via actual execution evidence, not duplicate author rewriting.

1. Reconcile architecture/frontend with actual owner/generation/PTY epoch/exact-string identity through hosts/claims and six flat states, one renderer/claim, zero placement attach/replay/reset vsClose/reopen, live/pending Close service and origin completion. Record unsafe downstream numeric agent/Review/replay refusal, hidden retirement/sibling scope, real modal/Cognito/reversible geometry. Remove only contradicted scoped statements, retain unrelated invariants.
2. API reference: same-response headers/CORS/no-store, legacy arrays/numeric/detail keys +additive `incarnationExact`/`terminationState` in BOTH projections from one snapshot; canonical positive-u64 inclmax, malformed/missing exact no numeric fallback, compare legacy only safe/equal. Strict512-byte request, 202 terminationRequested vs200 restartCancelled/envelopes/errors, pending replacement precedence/no effect, exact pending cancellation/history retention/no signal, normal respawn/later same-ID create preserved. Live signal !=exit; pending loss needs retained exact cancellation marker (ordinary exited/absence insufficient). Headerless server read-only; no web DELETE fallback, legacy unrelated clients not newly safe.
3. Document Recipe explicit source/canonical context/count/exclusion/offline/late-discovery/value-bound confirmation behavior, inert import/export warning. State capture spec != complete app/layout restoration. Retain predecessor AC8 missing restoration/adoption and F1 unknown-create/concurrency/post-await gates; no hidden executor repair scope.
4. Add normal unreleased changelog entry for delivered changes only; no invented release/date/test counts, issue ID or version bump. Roadmap/codebase summary record observed scope, pending gates and links; administrative predecessor DONE labels remain historical not fresh proof. H1/H2 claims limited to P08 exercised PTY/input surfaces; unrelated predecessor defects remain open.
5. Handoff lists exact changed files, canonical plan, check commands/results/failures/skips/blocks, human review provenance, safe rollback and unsupported server guidance. Record migration no-op preservation, remaining operational prerequisites and known limits. Link actual evidence, not invented receipts. Coordinator alone reconciles durable execution state through installed task helper when separately authorized; no hand-edited tasks.json/native board or automatic commit/push/release.
6. DocsFinalizer checks links and wire examples against actual code/P08 evidence (read-only comparison); any behavioral discrepancy returns to IntegrationOwner under scoped revision, then affected runtime qualification before final docs. Do not add tests for prose wiring or run duplicate product suites solely because docs changed.

## Consumer acceptance and exact future checks
Docs describe behavior a reader can reproduce with P08 exact scenarios; headers/error examples match actual server/client, preserved limitations explicit, no runtime/human approval fabricated. Future checks: open each modified doc and linked evidence, compare request/response examples to P08 captured sanitized HTTP results and [acceptance matrix](acceptance-matrix.md); verify local Markdown link targets with coordinator's existing read-only path checker. No new executable validation script/path invented.

## Failure, rollback, security and resources
Missing P08 or human evidence blocks finished handoff. Roll back only owned doc changes if inaccurate, not implementation or historic ledgers. No secrets/screens with private content; use synthetic sanitized examples. No new resources or runtime work. No Git authorization inferred from implementation completion.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "reconcile-docs-handoff",
    "title": "Reconcile architecture, API, frontend, changelog and evidence handoff",
    "blocked_by": [
      "human-full-app-visual-review"
    ],
    "allowed_files": [
      "docs/system-architecture.md",
      "docs/frontend-components.md",
      "docs/api-reference.md",
      "docs/CHANGELOG.md",
      "docs/project-roadmap.md",
      "docs/codebase-summary.md",
      "plans/261104-1529-os-session-management-and-interactions/qualification/handoff.md"
    ],
    "constraints": [
      "DocsFinalizer only after actual runtime/human evidence; coordinator owns state finalization.",
      "No issue/release/version/Git invention or unrelated plan writes."
    ],
    "acceptance": [
      "Exercised exact/state inventory compatibility, live202 vs pending200/origin-specific completion, unsafe downstream limits and user behavior documented with actual evidence links.",
      "AC8/F1 and unrelated historical qualification gaps remain honest; H1/H2 claims bounded to actual new evidence."
    ],
    "verification": [
      "Read changed docs against actual P08 sanitized HTTP/runtime/human records; verify local links with read-only coordinator check; do not rerun product suites for prose."
    ]
  }
]
```

- [ ] <!-- evcrate-task:reconcile-docs-handoff --> Reconcile architecture, API, frontend, changelog and evidence handoff
