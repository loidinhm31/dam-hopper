# Plan validation answers

Validated: 2026-10-04. Workflow: installed `/cmd-plan__validate` interview template; ordinary newly authored plan, no active advice-controlled plan mutation. Three materially distinct questions asked after user opted into validation. **Planning only; no implementation authorization inferred.**

## Confirmed decisions
| Topic | User selection | Contract / consequence |
|---|---|---|
| Runtime isolation | Production app + Mongo containers | Reuse production Dockerfile actual SPA/backend; fixture-owned private network/data. Controlled container `/etc` closes effective Advisor HOME override. No host-home mounts, production test-only home seam or auth bypass. Local Docker/Podman required. |
| Authentication scope | Seed real authenticated sessions | Canonical Rust AuthStore/session/claims seed in isolated Mongo. Normal JWT/session/admin admission active. Only ordinary persisted profile/auth bootstrap in fresh browser. Login/MFA UI remains explicitly inventoried gap, not claimed coverage. |
| Human evidence gate | Colocated review.md | Actual human inspection beside cases, exact fresh run/source/image identities and checkpoint decision. Regenerate/re-review after relevant source changes. CI functional success and image existence alone do not certify visual acceptance. |

## Plan disposition
All three selections match existing phase design. No phase revisions or acceptance reductions needed. [Plan](../plan.md) status remains pending; [acceptance matrix](../acceptance-checks.md) A01–A08 / E01–E07 / L01–L06 / C01–C05 remains intact.

## Planning verification
- Completed static source inventory: 53 unique browser files, 259 source-declared cases; 3 existing E2E-labelled component harnesses.
- Structural script observed PASS before this validation addendum: 11 markdown artifacts, 5 phases with required section order, 42 resolved local links, 26 unique acceptance checks, overview under 80 lines; no missing suite row or duplicate filename.
- Source/images/configs inspected; `docker info` observed reachable rootless Podman. No app image build, application service launch, tests, new screenshots or human screenshot reviews executed during planning.
- Global active-plan script ran but EVCRATE_SESSION_ID absent; hook metadata not persisted. Directory used explicitly throughout.

## Execution-time gates
Implement the five phases; exercise actual app integration/cleanup/capture-disabled parity; generate final-source fresh images; obtain real human inspection. This interview validates design, not application image acceptance.

## Unresolved questions
None blocking implementation. Runtime qualification and actual human screenshot review remain required execution evidence, not unanswered design choices.
