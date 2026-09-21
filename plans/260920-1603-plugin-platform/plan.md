---
title: "DamHopper trusted plugin platform"
description: "Add a generic owner-account plugin host, isolated UI, lifecycle management, and Linux/LAN qualification for the evcrate replacement."
status: completed
priority: P1
effort: unestimated
branch: main
tags: [feature, backend, frontend, api, auth, infra, security]
created: 2026-09-20
updated: 2026-09-21
---

# DamHopper trusted plugin platform

## Goal and scope

Implement DamHopper's generic half of the cross-repository plugin system: versioned contracts/SDK, runner-owned package/grant registry, owner-account worker supervision, actor/target authorization, isolated iframe bridge, lifecycle administration, and Linux release qualification. The first real consumer is evcrate. This plan does not implement evcrate semantics and does not authorize a marketplace, malicious-code sandbox, arbitrary filesystem/exec bridge, source mutation, cross-server aggregation, or permanent dual mode.

Current standalone evcrate remains operational through G4. Final evcrate E05 removes picker-specific standalone entry/build/preview/release paths while retaining shared app/views/validators; DamHopper never carries a standalone compatibility mode.

## Sources

[Immutable cross-repo contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md) · [Repository evidence](reports/repository-analysis.md) · [Command entry](cmd-plan.md) · [Proposed architecture](../../docs/system-architecture.md#proposed-trusted-plugin-platform-2026-09-20-not-implemented)

## Phases

| ID | Deliverable | Joint dependency / gate | Status |
|---|---|---|---|
| [D00](phase-00-contracts-and-feasibility.md) | Contract candidate, grant matrix, opaque-`srcdoc`/cancel/budget feasibility | E00 → G0 | Completed 2026-09-21 |
| [D01](phase-01-package-registry.md) | Runner-owned safe package/trust staging; early real evcrate candidate intake | G0; overlaps E01/E02 | Pending |
| [D02](phase-02-owner-runner.md) | Owner UID runner, framed UDS/pipes, supervision/cancel/restart/service | G0; overlaps D01/E01/E02 | Pending |
| [D03](phase-03-authorized-api.md) | Actor/grant/target contexts over existing REST+WS owner transport | D01/D02 interfaces; E01/E02 → G1 | Pending |
| [D04](phase-04-isolated-ui-host.md) | Inert bytes, host CSP, opaque iframe bridge, dynamic route/nav | G1; E03 → G2 | Pending |
| [D05](phase-05-management-and-lifecycle.md) | Admin install/update/rollback/disable/remove and crash recovery | G1; may overlap D04/E03; E04 → G3 | Pending |
| [D06](phase-06-linux-lan-qualification.md) | Release-manager owner deployment and real evcrate LAN/workload proof | G2 + G3; E05 → G4 | Pending |

G1 and G2 do not wait for lifecycle polish: D01 accepts E02's early immutable package candidate, then D01–D03 + E01–E02 prove a real snapshot summary; D04 + E03 prove all four views. E04 later supplies the production lifecycle artifact for G3. No fixture worker or loader-only milestone is platform completion.

## Cross-repository gates

- **G0:** jointly pin D00/E00 candidate versions and digests after actor/grant, exact path identity, schema fixtures, cancellation/isolation experiments, and measured budget review.
- **G1:** real installed evcrate worker returns an authorized snapshot summary through API → owner runner → worker; deny wrong owner/grant, prove cancel and crash. Not releasable platform completion.
- **G2:** separate LAN browser renders Overview, History/detail, Configuration, Evaluations inside the isolated frame; profile/project switch clears stale state; no picker or frame credentials/network.
- **G3:** independent host/plugin artifacts update, disable/remove, recover, and restore a matched pair. Current disabled/revoked security intent outranks rollback.
- **G4:** D06/E05 satisfy all acceptance and workload/deployment evidence. Only then replace the standalone artifact.

## G0 candidate delivery

- **Recorded:** 2026-09-21
- **SDK package:** `dam-hopper-plugin-sdk-0.1.0.tgz`
- **SDK SHA-256:** `75fd47b1dec6e3a297c4ace71a0897b893adb9bb8f7c00d8bc373ffbdff02888`
- **Opaque UI fixture SHA-256:** `6dfb5e43d05f4fedf2b31ee0b4d033e3022bcf6a0b21d2b7dde592ae0ac9a36e`
- These are the D00 candidate inputs for the joint E00/G0 version-and-digest pin; the domain candidate pin remains cross-repository follow-up.

## Acceptance ownership (A1–A12)

| Requirement | Host phases | Evcrate join |
|---|---|---|
| A1 lifecycle without host rebuild | D01, D05, D06 | E04/E05 |
| A2 four LAN views, no picker | D04, D06 | E03/E05 |
| A3 selected target/current-policy truth | D03, D04, D06 | E01–E03 |
| A4 peer/actor/grant/path negatives | D02, D03, D06 | E01/E02/E05 |
| A5 no frame credentials/stale cross-owner data | D03, D04, D06 | E03/E05 |
| A6 bounded failure/cancel/crash states | D00, D02–D04, D06 | E02/E03/E05 |
| A7 honest snapshots/metrics/missingness | D00, D03, D06 | E00–E03/E05 |
| A8 matched compatibility/rollback | D00, D01, D05, D06 | E00/E04/E05 |
| A9 source immutability | D01, D03, D05, D06 | E01–E05 |
| A10 Linux owner deployment/recovery | D02, D06 | E02/E05 |
| A11 digest/domain parity fixtures | D00, D06 | E00–E02/E05 |
| A12 measured 10k workload | D00, D06 | E00/E05 |

## Planning status

D00 contracts, feasibility evidence, and immutable candidate delivery completed 2026-09-21. G0 candidate package/fixture digests are recorded above; joint E00 domain publication and cross-repository pin remain the next gate. Effort remains unestimated until G0 feasibility evidence plus named staffing/hardware. The active-plan helper could not persist because no session ID was available; use this directory explicitly.

## Unresolved questions

Deployment inputs remain: owner account/UID/home, configured targets and sources, admin/read subjects, Linux distribution, artifact handoff, HTTPS termination, LAN browser host, hardware and staffing. D00 must freeze the Node >=22.19 distribution and any budget changes; missing inputs block deployment, not this plan.
