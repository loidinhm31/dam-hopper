# Phase 10 — Reconcile documentation and controlled rollout evidence

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `reports/planning-intake.md:25–40; reports/design-direction.md:74–80`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: pending. Effort: not-estimated. Planning only; commands below are future obligations, not exercised checks.
- Deliverable: Reconcile documentation and controlled rollout evidence.

## Key insights
Preferred architecture.md files are absent; maintained system-architecture and browser architecture are baseline. Plan contract describes intended architecture only until actual implementation and qualification. Native browser is admin-provisioned and not bundled.

## Requirements
Reconcile docs/changelog with implemented behavior, install prerequisites/no-system-Node, auth/reset/profile semantics, explicit trust boundaries, rolling protocol compatibility, rollback and final evidence. No old iframe fallback.

## Architecture
Final documentation owner is the integration owner or designated docs writer after sequential product cutover; one finalizer reconciles evidence and human pending gates. No automatic task hydration/Git/release publication.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — document-browser-architecture
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/README.md` | Update maintained architecture API and feature documentation; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/AGENTS.md` | Replace retired OsBrowserKeepAliveHost entry in existing architecture map only; preserve installed workflow/agent instructions. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/system-architecture.md` | Update maintained architecture API and feature documentation; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/architecture/agent-store-ports-and-browser.md` | Update maintained architecture API and feature documentation; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/api-reference.md` | Update maintained architecture API and feature documentation; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/api/authentication.md` | Update maintained architecture API and feature documentation; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/configuration/server-configuration.md` | Update maintained architecture API and feature documentation; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/CHANGELOG.md` | Update maintained architecture API and feature documentation; exact responsibilities in numbered steps below. |

### File map — document-rollout-and-finalize
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/deployment-guide.md` | Document installation compatibility rollback and final evidence; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/linux-systemd.md` | Document installation compatibility rollback and final evidence; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/windows-release-packaging.md` | Document installation compatibility rollback and final evidence; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/docs/configuration/server-environment-auth.md` | Document installation compatibility rollback and final evidence; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/plans/261108-0237-host-browser-cdp-streaming/reports/rollout-evidence.md` | Document installation compatibility rollback and final evidence; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### document-browser-architecture
- Dependencies: qualify-performance-and-human.
- Bounded outcome: Update maintained architecture API and feature documentation.
1. Replace retired iframe Browser continuity descriptions in README/system architecture and AGENTS.md's existing architecture map with root canvas/managed target facts; preserve AGENTS workflow instructions and extension/HtmlPreview docs. Describe exact API/protocol/limits and capability-unavailable behavior from observed implementation, not intended-plan prose.
2. Document per-principal shared profile, live reconnect vs restart, actor+source-class artifacts, explicit keep-data/server-revoking logout vs live-confirmed shared-data clear/reset, sibling impact, passive revoke/expiry and local Remove profile distinction. **V1: no preselected logout choice**, no dispatch on Enter before explicit selection.
3. Explain high-privilege instance-scoped raw CDP, cooperative lease bypass, loopback/local-user exposure, best-effort HTTP policy not egress isolation, no DOM accessibility/audio/smooth-media promises. Include qualified engine/platform versions/capacity and measured tuning outcomes.
4. Add changelog entry and reconcile API logout destructive preconditions, cleanupPending status, source-specific artifact authorization and no-auth origin restrictions without implying global admin elevation.
- Consumer-visible acceptance:
  - Public architecture/API/config docs describe actual tested feature and credential/security behavior; no stale Browser iframe or target-sandbox claims.
  - Changelog distinguishes keep-data server logout from explicitly confirmed destructive shared-principal clear/reset and required browser provisioning.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui build`
  - Smoke: documentation owner follows documented create/attach/agent/logout examples against qualified build, verifies exact routes/statuses and redacted outputs; record in rollout-evidence.md.

### document-rollout-and-finalize
- Dependencies: document-browser-architecture.
- Bounded outcome: Document installation compatibility rollback and final evidence.
1. Provide admin install/version-validation steps for external Chrome/Chromium executable, service-user Linux dependencies/sandbox/fonts and Windows ACL/Job prerequisites; browser not included in bundles and target hosts need no Node. Do not change blanket systemd KillMode or grant no-sandbox workaround.
2. Roll backend first with Browser disabled, deploy matching SPA, then enable qualified config. New client against old backend sees unavailable/404; protocol mismatch/new backend with old client refuses Browser attachments, never silently falls back. Existing unrelated APIs remain functional.
3. Rollback disables Browser, drains/cancels/terminates managed processes and restores prior binaries/config while preserving credential directory; old iframe path is not a rollback feature. Explicitly cleared/reset credentials already deleted are irrecoverable; keep-data logout does not delete them. Keep cleanup tombstones until reconciled.
4. Reconcile all acceptance rows, exact future task evidence and review/human receipts; no pass inferred from status labels. Record deployment canary/rollback smoke, remaining unsupported capacity and irreversible wipe warning. Single finalizer handles any separately authorized publication; this plan itself grants none.
- Consumer-visible acceptance:
  - Operator can provision supported native engine, enable matching web/backend safely, observe unsupported state and roll binaries/config back without unintended credential deletion.
  - Final evidence contains actual checks/review/human acceptance and no unresolved security/platform gate; absent receipt prevents release, not silently waived.
- Future verification (from repository root; new targets above are planned):
  - `cargo check --manifest-path server/Cargo.toml --all-targets`
  - `pnpm --filter @dam-hopper/ui build`
  - Smoke: follow documented backend-first disabled canary, matching SPA enablement, incompatible-client refusal and rollback on native Linux and Windows; record exact versions/results.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "document-browser-architecture",
    "title": "Update maintained architecture API and feature documentation",
    "blocked_by": [
      "qualify-performance-and-human"
    ],
    "allowed_files": [
      "README.md",
      "AGENTS.md",
      "docs/system-architecture.md",
      "docs/architecture/agent-store-ports-and-browser.md",
      "docs/api-reference.md",
      "docs/api/authentication.md",
      "docs/configuration/server-configuration.md",
      "docs/CHANGELOG.md"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Public architecture/API/config docs describe actual tested feature and credential/security behavior; no stale Browser iframe or target-sandbox claims.",
      "Changelog distinguishes keep-data server logout from explicitly confirmed destructive shared-principal clear/reset, documents no preselected logout choice (V1), and required browser provisioning."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui build",
      "Smoke: documentation owner follows documented create/attach/agent/logout examples against qualified build, verifies exact routes/statuses and redacted outputs; record in rollout-evidence.md."
    ]
  },
  {
    "id": "document-rollout-and-finalize",
    "title": "Document installation compatibility rollback and final evidence",
    "blocked_by": [
      "document-browser-architecture"
    ],
    "allowed_files": [
      "docs/deployment-guide.md",
      "docs/linux-systemd.md",
      "docs/windows-release-packaging.md",
      "docs/configuration/server-environment-auth.md",
      "plans/261108-0237-host-browser-cdp-streaming/reports/rollout-evidence.md"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Operator can provision supported native engine, enable matching web/backend safely, observe unsupported state and roll binaries/config back without unintended credential deletion.",
      "Final evidence contains actual checks/review/human acceptance and no unresolved security/platform gate; absent receipt prevents release, not silently waived."
    ],
    "verification": [
      "cargo check --manifest-path server/Cargo.toml --all-targets",
      "pnpm --filter @dam-hopper/ui build",
      "Smoke: follow documented backend-first disabled canary, matching SPA enablement, incompatible-client refusal and rollback on native Linux and Windows; record exact versions/results."
    ]
  }
]
```

- [ ] <!-- evcrate-task:document-browser-architecture --> Update maintained architecture API and feature documentation
- [ ] <!-- evcrate-task:document-rollout-and-finalize --> Document installation compatibility rollback and final evidence

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
Rollback cannot resurrect wiped credentials or promise old Browser implementation. Existing in-progress plan/doc writers must be serialized before reconciliation.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
Never publish tokens/debug endpoints/profile archives in docs or evidence. Installation must preserve sandbox and restricted credential ownership.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Return implementation evidence to coordinator for independent review/final approval; this authoring result is not ready-to-code authorization. No unresolved product questions beyond stated logout interpretation; actual runtime gates remain future.
- Parent owns independent plan review/optional validation and implementation permission. This phase text neither executes tasks nor supplies approval.

## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
