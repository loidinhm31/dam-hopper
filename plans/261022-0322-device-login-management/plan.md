---
title: "Device login management and access revocation"
description: "Manage account login sessions on a selected saved server without crossing profile or credential ownership."
status: in-progress
priority: P2
effort: 16h
branch: feat/device-login-management
tags: [feature, auth, backend, frontend, api]
created: 2026-10-22
---

# Device login management

## Contract and context
- Frozen interface: [contracts.md](./contracts.md); authoritative over scout recommendations.
- Sources: [architecture design](../../docs/system-architecture.md#login-device-management-design), [code standards](../../docs/code-standards.md), [testing](../../docs/testing.md), [PDR](../../docs/project-overview-pdr.md), [inventory](../../docs/codebase-summary.md).
- Research inputs: `agent://ScoutAuthDevices`, `agent://ScoutUiDevices`; planning Advisor consulted.
- Scope: existing account sessions on one selected server; no physical-device identity, IP/fingerprinting, project ACLs, or lifetime changes.
- Deliver list/pagination, explicit confirmed revoke, exact-profile self logout, legacy persistence compatibility and real runtime proof.

## Phases
| Phase | Status | Effort | Deliverable |
| --- | --- | --- | --- |
| [01 Backend](./phase-01-backend.md) | Complete | 6h | Store parity, v2 migration, metadata, Bearer-only revoke, no Set-Cookie |
| [02 Frontend](./phase-02-frontend.md) | Complete | 6h | Typed client, saved-profile Login devices, draft protection, no cookie auth |
| [03 Validation](./phase-03-validation.md) | In progress | 3h | Suites/cutoffs/E2E/reviews pass; human visual review pending in review.md |
| [04 Documentation](./phase-04-docs.md) | Complete | 1h | Roadmap, changelog, PDR, and API/usage docs updated; overall release gated on visual review |

## Dependency graph and execution
```text
Frozen contract + architecture + plan
             |               |
        01 backend      02 frontend
             +-------+-------+
                     |
            03 integration / tester
                     |
          independent code/security review
                     |
            04 docs + final plan evidence
```
Spawn 2 implementation agents, wait for both terminal results and readable artifacts, then synthesize. Neither runs builds/tests/lint/formatters mid-flight. Parent owns the integration gate; one tester executes checks after the join. Findings return to the original file owner; rerun only affected checks after fixes. Documentation follows runtime and review evidence, never projected success.

## Exclusive file ownership
| Stage / owner | Writable files | Explicit exclusions |
| --- | --- | --- |
| 01 backend | `server/**`, including constructors, migrations and server tests/examples | `packages/ui/**`, `docs/**`, `plans/**` |
| 02 frontend | `packages/ui/**`, including client/component/browser/E2E regression sources | `server/**`, `docs/**`, `plans/**`, `apps/**` |
| Parent during 01+02 | `plans/**`, coordination only | All implementation files |
| 03 parent/tester after join | Runtime artifacts/reports; sequential ownership transfer for integration regression fixes under `server/**` or `packages/ui/**` | No concurrent editing with implementation owners; reviewer read-only |
| 04 docs owner then parent | Docs owner: `docs/**`; parent: plan/status/evidence files | Source changes return to original owner |

## Side-effect checklist
- Persistence: additive SQLite v1 upgrade; nullable legacy Mongo metadata; stable useful indexes; retain auth/backend policy.
- Privacy: bounded untrusted user-agent only; no token/IP/fingerprint in DTO, cache keys, logs or evidence.
- Authorization: username+ID mutation predicate; no foreign-ID disclosure; no-store also on middleware errors.
- Cleanup: revoke target session/media only; Bearer-only DELETE emits no Set-Cookie, preserving unrelated/replacement cookies.
- Async: fence profile, URL, credential and generation; cancel stale requests; dialog draft protection prevents Save of revoked token.
- UX: confirmation/current warning, errors/retry/pagination, accessible narrow scroll/wrap; unsaved fields never authority.
- Qualification: periodic WS/SSE and read-driven media cutoff reported honestly; no-auth explicitly unavailable; no invented runtime proof.

## Completion and evidence
- Implementation complete and approved: [backend review](./reports/review-backend-final.md), [frontend review](./reports/review-frontend-final.md).
- Automated verification passed: [initial tester](./reports/tester.md), [review-fixes validation](./reports/review-fixes-validation.md), [live runtime cutoffs](./reports/live-revocation.md), [interactive browser](./reports/interactive-browser.md), [final status](./reports/final-status.md).
- Evidence captures: `packages/ui/e2e/device-login-management/evidence.json` (run `e2e-run-1792621601955-c069185b`).
- Pending gate: human visual review of 3 PNG checkpoints remains PENDING in `packages/ui/e2e/device-login-management/review.md`.

## Unresolved questions
None requiring user input. Release qualification remains gated on human visual review sign-off.
