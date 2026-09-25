# DamHopper plugin-platform planning command entry

[Plan](plan.md) · [Repository evidence](reports/repository-analysis.md) · [Cross-repo contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md)

## Selected workflow

Hard cross-repository planning: new executable trust boundary, actor/grant authorization, owner-account IPC/process supervision, opaque-origin UI isolation, durable package transactions, release-manager migration, and real LAN qualification. Planning skill and output standards were read directly. No native slash-command tool was available; the workflow was executed with repository research and planning tools. No implementation or runtime validation.

## Enhanced planning prompt

```text
Create DamHopper phases D00–D06 for the generic host half of the accepted evcrate replacement. Preserve the immutable shared contract: runner is sole durable registry/grant authority and sole worker supervisor; API is an authenticated revision-cache façade; admin allowlist is out-of-band empty/deny; every invoke rechecks actor, enabled session, grant/binding revision, target, operation and activation generation; production plugin endpoints deny --no-auth; cookie management cannot bypass CSRF.

Freeze generic candidate SDK/schemas/fixtures first, let E00 consume its digest, then jointly pin G0. Preserve evcrate's normalize + no-dot + no-symlink + native-realpath-equality identity; never silently realpath aliases, rehash, chmod, or relax ownership. Prove real Vite/React classic self-contained output, host-injected CSP, inert octet-stream delivery, opaque srcdoc, nonce/WindowProxy/port acknowledgement and navigation revocation. Prove framed cancellation, one scan/worker, 64 MiB aggregate buffered-frame cap and proposed numeric budgets.

After G0 overlap D01/D02 with E01/E02. Accept E02's early immutable package candidate in D01 so D01–D03 can prove the real G1 slice before E04 release polish. D04/E03 reaches G2 independently of D05. D05/E04 reaches G3 with serialized update/disable/grant changes; rollback restores a matched package pair and compatible non-security settings only, never revoked grants, disabled intent, source bindings or old authorization revisions. D06/E05 reaches G4 with owner-account systemd, Node >=22.19, platform rollback, source immutability, separate LAN browser, real artifact and 10k workload. Keep standalone operational until G4, then replace rather than support dual mode. Do not claim loader-only completion, malicious-code sandbox, builds/tests, estimates, or runtime evidence.
```

## Phase execution index

| Order | Phase | Gate output |
|---|---|---|
| 1 | [D00 contracts and feasibility](phase-00-contracts-and-feasibility.md) | Joint G0 input |
| 2A | [D01 package registry](phase-01-package-registry.md) | Early E02 candidate staged |
| 2B | [D02 owner runner](phase-02-owner-runner.md) | Supervised real worker path |
| 3 | [D03 authorized API](phase-03-authorized-api.md) | G1 with E01/E02 |
| 4A | [D04 isolated UI host](phase-04-isolated-ui-host.md) | G2 with E03 |
| 4B | [D05 management/lifecycle](phase-05-management-and-lifecycle.md) | G3 with E04 |
| 5 | [D06 Linux/LAN qualification](phase-06-linux-lan-qualification.md) | G4 with E05 |

D01 and D02 start together after G0. D05 implementation may overlap D04/E03 after G1; G2 does not wait for management polish. D06 final acceptance requires both G2 and G3.

## Resume rules

Read the shared contract first, then this plan and the target phase. Treat all statuses/checkboxes as pending. Distinguish existing commands from proposed-after-created commands. Preserve unrelated work. Do not run project-wide validation while slices are incomplete; the implementation integration owner runs final gates once.

## Unresolved questions

Deployment-only inputs: owner UID/account/home, concrete targets/sources, admin/read subjects, distro, artifact handoff, HTTPS, LAN client, hardware/staffing. G0 must freeze Node distribution and measured budget revisions.
