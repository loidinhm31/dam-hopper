# Phase D06 — Linux release integration and LAN qualification

## Context Links

- [Plan](plan.md)
- [D02 owner runner](phase-02-owner-runner.md)
- [D05 lifecycle](phase-05-management-and-lifecycle.md)
- [Shared joint gates](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md#joint-gates-and-handoffs)
- [Repository evidence](reports/repository-analysis.md)
- Existing release docs: [`linux-release-manager.md`](../../docs/linux-release-manager.md), [`linux-systemd.md`](../../docs/linux-systemd.md), [`linux-release-manifest.md`](../../docs/linux-release-manifest.md)
- Existing release tests: [`tests/deploy`](../../tests/deploy)

## Overview

- **Date:** 2026-09-20
- **Priority:** P1
- **Implementation status:** Pending
- **Review status:** Pending
- **Dependencies:** G2, G3, frozen G0 runtime/limits, D01–D05 and E05 qualification package/scenarios.
- **Gate contribution:** D06 + E05 complete G4: packaged owner deployment, upgrade/rollback/recovery, all A1–A12 scenarios and measured 10k-history LAN workload. Only after joint G4 may E05 retire the standalone viewer.
- **Effort:** Unestimated.

Integrate the owner runner, pinned Node runtime and plugin configuration into the Linux release manager. Qualify clean install, upgrade, host rollback, plugin rollback, boot recovery and real separate-machine LAN use against the final evcrate package and owner data. Evidence must name actual artifacts, hardware, browser, network and commands; this plan claims none were run.

## Key Insights

- Release manager already owns immutable archives, inventory, units, transaction/recovery and n-1 rollback. Extend those mechanisms rather than add a plugin installer.
- Runtime identity cannot be inferred from `$HOME`, current shell or source permissions. Fresh install requires an explicit non-root advisor owner plus explicit admin subjects/targets.
- A service-created Unix socket avoids systemd-listener credential ambiguity. Installer/tmpfiles provisions a restrictive volatile directory; owner runner creates the socket and API reconnects.
- Host rollback and plugin rollback are separate transactions. Host rollback must restore a compatible API/runner/Node/unit set while leaving the runner's durable plugin registry and current security intent intact.
- Performance budgets are not promises until measured on declared hardware, dataset, browser and <=10 ms reference LAN.

## Requirements

### Release artifact and manifest

1. Freeze at G0 one exact supported Node >=22.19 distribution, source, version, license, architecture and SHA-256. Bundle it as an immutable release member (proposed `/opt/dam-hopper/releases/<version>/runtime/node/bin/node`); never search `PATH`, owner home or a checkout.
2. Add `dam-hopper-plugin-runner`, its service template, tmpfiles/runtime-directory template and plugin runtime metadata to the release archive inventory, manifest, SBOM/attestation and reproducibility checks.
3. Rev the release manifest schema only if required (proposed v3) and manager-state schema only for durable deployment inputs (proposed v2). Provide strict one-way migration from current v2 manifest/v1 state and retain n-1 rollback readability; reject unknown/incompatible state.
4. Package no plugin artifact in the host release. E04/E05 evcrate package remains independently reviewed/versioned and is installed through D05 without host rebuild.

### Identity, filesystem and units

5. Extend `install`/`role set` with explicit `--plugin-owner-user` and repeatable `--plugin-admin-subject`; require explicit values to enable plugins. Resolve user/UID/home through system account data, reject root/API/web identities, absent/ambiguous accounts and writable unsafe homes.
6. Preserve API UID `dam-hopper`. Provision a dedicated shared group for API↔runner socket access and add only API plus advisor owner to it; do not grant API access to advisor sources.
7. Provision `/run/dam-hopper/plugin-runner/` at boot through a root-owned tmpfiles rule as owner:shared-group mode `0750`. Runner validates ancestry, removes only its own stale socket, binds it owner:shared-group `0660`, and API validates endpoint/peer before use.
8. Keep runner durable registry under a runner-owned `StateDirectory` (proposed `/var/lib/dam-hopper-plugin-runner`) inaccessible to ordinary API/web users. Do not relocate/copy/chown advisor sources.
9. Order runner after local filesystems/tmpfiles and before API readiness; API retries the local socket and reports plugins unavailable without crashing unrelated DamHopper routes. systemd alone starts/stops runner; runner alone starts workers.
10. Harden runner with `NoNewPrivileges`, `ProtectSystem=strict`, private tmp, restricted address families (AF_UNIX only where compatible), bounded file/process descriptors, `MemoryMax=1GiB`, `TasksMax=64` and cgroup process kill. Source access exceptions must be explicit and owner-natural, not broad bind grants. This is defense in depth, not a malicious-code sandbox.
11. Validate rendered units/config/tmpfiles before activation. Health requires runner protocol handshake, registry invariants and worker state classification; it must not execute hidden user data as a probe.

### Upgrade, rollback and recovery

12. Stage/validate complete host artifact before stop. Activate units in dependency order, verify runner then API/web, and commit release state only after all configured-role health passes.
13. Host upgrade/rollback restores a matched manager/API/runner/Node/unit set. Plugin registry/package directories persist. If the prior host cannot read current plugin contract/state, keep plugins fail-closed/unavailable and report incompatibility; never mutate or downgrade security state.
14. Boot/crash recovery reconciles release transaction, unit state, runner socket and plugin lifecycle journal in that order. It does not guess an owner, approval or package generation.
15. Stop/clean/reset semantics distinguish release-owned paths, plugin registry and advisor sources. Explicit destructive reset requires separate confirmation/scope; ordinary host reinstall/rollback never deletes plugin registry or sources.

### G4 qualification and acceptance matrix

16. Use a real separate browser machine over authenticated HTTPS or a documented trusted encrypted network. Record server/client OS, CPU/RAM/storage, browser/version, exact host/plugin/contract digests, dataset generator/source, RTT and timestamps.
17. Use a 10,000-entry history with approved policy/evaluation data and <=10 ms reference LAN RTT. Run five cold/warm refreshes and at least 20 samples per read interaction; report p50/p95/max and peak runner/worker/API/browser memory without discarding failures.
18. Targets: refresh p95 <=10 s; summary/page <=500 ms; detail <=1 s; cancel acknowledgement <=250 ms and original settlement <=1 s. Page and payload limits remain frozen; no ceiling is raised merely to pass.
19. Execute and retain evidence for all acceptance requirements:
    - **A1:** install/update final evcrate package without host rebuild; disable/remove cleanly.
    - **A2:** Overview, History/detail, Configuration and Evaluations render over LAN with no picker.
    - **A3:** selected `{ project, worktreePath? }` and explicit current-account policy permission determine truth.
    - **A4:** wrong peer/actor/grant/target/path alias/symlink/owner deny safely.
    - **A5:** frame has no credentials/network and profile/project/worktree/reconnect switches show no stale cross-owner data.
    - **A6:** limits, timeout, cancel, worker crash/restart exhaustion and API/runner disconnect produce bounded explicit states.
    - **A7:** snapshot IDs, missingness, metric provenance and unavailable/partial/error states remain honest across all views.
    - **A8:** incompatible package rejects; failed update restores only a matched pair/non-security settings while current revoke/disable intent wins.
    - **A9:** source content/owner/mode/size/mtime inventory is identical before/after install, reads, failures, rollback, remove and host operations.
    - **A10:** clean Linux install runs runner as the explicit owner; boot/crash recovery and unit hardening behave as documented.
    - **A11:** host/worker/browser digest and domain golden fixtures agree exactly.
    - **A12:** declared 10k workload meets—or transparently fails—the recorded targets without hidden retries or warmed-only reporting.
20. G4 requires joint DamHopper/evcrate sign-off. Only afterward does E05 delete standalone picker/entry/build/preview/release members and obsolete tests; shared views/validators remain. No dual-mode compatibility is introduced.

## Architecture

```text
release archive: manager + API + web + runner + pinned Node + units/tmpfiles
                                      │
root install: explicit owner/admins ──┼─ immutable version + state migration
                                      │
owner runner service ── self-created AF_UNIX socket ── dam-hopper API
        │
 persistent plugin registry + independent E05 package
        │
separate HTTPS/LAN browser ── four isolated views + qualification evidence
```

Release state records explicit owner username/UID, admin-config digest, runtime version/digest and plugin-platform enabled state. It does not store source paths beyond existing configured project targets or copy runner package authority. `status --json` distinguishes host release health, runner transport, installation states and version incompatibility.

## Related Code Files

### Create

- `/home/loidinh/WS/dam-hopper/deploy/tmpfiles.d/dam-hopper-plugin-runner.conf.in` — restrictive volatile runtime directory.
- `/home/loidinh/WS/dam-hopper/tests/deploy/linux-release-plugin-runner-owner-smoke.sh` — owner/socket/unit/source-immutability deployment scenario.
- `/home/loidinh/WS/dam-hopper/tests/deploy/linux-release-plugin-upgrade-rollback.sh` — independent host/plugin and security-race recovery scenario.
- `/home/loidinh/WS/dam-hopper/tests/deploy/plugin-platform-lan-qualification.mjs` — orchestrate/record declared G4 interactions and sample metadata.
- `/home/loidinh/WS/dam-hopper/docs/plugin-platform-linux.md` — operator inputs, trust/install/lifecycle/recovery and qualification procedure, created only with implementation.

### Modify

- `/home/loidinh/WS/dam-hopper/server/src/linux_release/constants.rs` — runner/runtime/unit/schema constants and managed service order.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/cli.rs` — explicit owner/admin inputs and status fields.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/account.rs` — validate existing non-root owner and shared-group membership.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/layout.rs` — immutable Node/runner/template paths and persistent registry exclusions.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/manifest.rs` — release member/runtime digest fields.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/manifest_validation.rs` — exact new role/runtime compatibility.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/state_record.rs` — explicit deployment inputs and schema state.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/migration.rs` — strict n-1 state migration.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/stage_units.rs` — render runner service and tmpfiles policy.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/unit_policy.rs` — validate runner service and tmpfiles invariants.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/activate.rs` — ordered runner/API activation.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/rollback.rs` — matched host rollback and plugin fail-closed compatibility.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/recovery.rs` — release then plugin-runtime recovery ordering.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/health.rs` — runner handshake/state health classification.
- `/home/loidinh/WS/dam-hopper/server/src/linux_release/status.rs` — separate release/runner/plugin health output.
- `/home/loidinh/WS/dam-hopper/deploy/systemd/dam-hopper-plugin-runner.service.in` — final owner, registry, runtime, hardening and ordering directives.
- `/home/loidinh/WS/dam-hopper/deploy/systemd/dam-hopper-api.service.in` — shared socket group and runner ordering/readiness only; API UID stays unchanged.
- `/home/loidinh/WS/dam-hopper/deploy/release/build-release-archive.sh` — bundle runner, pinned Node and templates reproducibly.
- `/home/loidinh/WS/dam-hopper/deploy/release/generate-release-manifest.mjs` — emit exact inventory/runtime metadata.
- `/home/loidinh/WS/dam-hopper/deploy/release/check-release-assets.mjs` — verify runner/Node/template assets.
- `/home/loidinh/WS/dam-hopper/deploy/release/release-manifest.schema.json` — schema for the new members/runtime contract.
- `/home/loidinh/WS/dam-hopper/package.json` — add focused deployment/qualification commands and update runtime packaging metadata; existing project engine is not worker runtime authority.
- `/home/loidinh/WS/dam-hopper/tests/deploy/linux-release-common.sh`
- `/home/loidinh/WS/dam-hopper/tests/deploy/linux-release-clean-install.sh`
- `/home/loidinh/WS/dam-hopper/tests/deploy/linux-release-upgrade-rollback.sh`
- `/home/loidinh/WS/dam-hopper/tests/deploy/linux-release-crash-recovery.sh`
- `/home/loidinh/WS/dam-hopper/tests/deploy/linux-release-security.sh`
- `/home/loidinh/WS/dam-hopper/docs/linux-release-manager.md`
- `/home/loidinh/WS/dam-hopper/docs/linux-systemd.md`
- `/home/loidinh/WS/dam-hopper/docs/linux-release-manifest.md`
- `/home/loidinh/WS/dam-hopper/docs/system-architecture.md` — after G4, replace the PROPOSED label only with evidence-backed implemented behavior and retain plan link.

### Delete

- None in DamHopper. E05 owns post-G4 standalone evcrate retirement.

## Implementation Steps

1. At G0 choose the exact Node distribution and supported target profile. Extend manifest/inventory generation to hash it and the runner/service/tmpfiles members reproducibly.
2. Add explicit CLI/state fields for plugin owner/admins/enabled state with strict migration and reinstall/role-change semantics. Never infer missing inputs.
3. Extend account provisioning with a narrow shared socket group while preserving API UID and owner source permissions.
4. Install the tmpfiles rule and render the service-created socket configuration. Validate runtime-directory ancestry/mode/ownership and both peer identities on the real distro.
5. Wire runner service ordering, immutable Node path, registry state, cgroup/resource hardening and health into stage/activate/status/stop/recover.
6. Extend release transaction/rollback so matched host components move together while plugin registry/current security intent persist and incompatible prior host fails closed.
7. Update release build/schema/asset verification and deterministic package-twice coverage. Add focused owner/socket clean-install, upgrade/rollback and crash-recovery scenarios.
8. Install E05's exact reviewed package through D05 on the actual server owner account and configured targets. Capture before-source inventory.
9. Run A1–A11 destructive/negative/recovery scenarios, including auth expiry/logout, grant revoke/disable during failed update, path alias/symlink, direct asset navigation and profile/project reconnect switches.
10. Run A12 workload from a separate browser machine under recorded network/hardware conditions; retain raw samples and failures, calculate percentiles reproducibly and capture resource peaks.
11. Compare post-source inventory, contract/domain golden fixtures and package/host digests. Joint reviewers sign G4 only if all criteria and evidence are complete.
12. After signed G4, coordinate E05 standalone retirement. Update implemented docs from observed behavior; do not retain a hidden dual-mode path.

## Todo List

- [ ] Pinned Node/runner/unit/tmpfiles members are reproducible and manifest-verified.
- [ ] Explicit owner/admin deployment preserves API identity and source permissions.
- [ ] Clean install, upgrade, host rollback and boot/crash recovery cover runner/plugin compatibility.
- [ ] All A1–A11 functional/security/parity/source scenarios retain evidence.
- [ ] A12 10k workload records actual hardware/network/browser/raw samples and resource peaks.
- [ ] Joint G4 sign-off precedes standalone retirement and implemented-doc claims.

## Success Criteria

- Future existing commands, after integration: `pnpm release:verify`, `pnpm release:package-twice`, and `pnpm test:deploy` pass with the runner/Node/service/tmpfiles/state members included.
- Future proposed focused command: `bash tests/deploy/linux-release-plugin-runner-owner-smoke.sh` proves exact non-root owner, API UID preservation, socket identity/mode, immutable Node path, cgroup limits and source immutability.
- Future proposed focused command: `bash tests/deploy/linux-release-plugin-upgrade-rollback.sh` proves independent plugin lifecycle, matched host rollback and current security-intent precedence.
- Future proposed qualification command: `node tests/deploy/plugin-platform-lan-qualification.mjs --evidence-dir <operator-owned-path>` records—not fabricates—five refreshes, 20 interaction samples, four views, cancellations, failures, browser/network/runtime metadata and raw timing/resource data.
- Host package changes are not required for a reviewed compatible evcrate package update. Host rollback does not delete/downgrade registry security state or advisor sources.
- A1–A12 each have linked evidence and pass/fail disposition. Missing deployment input, unsupported browser/runtime or budget miss blocks G4 rather than being waived silently.
- Only a jointly signed G4 permits E05 standalone deletion; DamHopper exposes no permanent standalone/plugin mode switch.

## Risk Assessment

- Bundled Node increases archive size and supply-chain surface. Pin/checksum/license/SBOM it and qualify every supported architecture; do not opportunistically use system Node.
- Release state migration can strand older installations. Preserve strict n-1 reading/rollback and test current v2-manifest/v1-state fixtures before schema promotion.
- Shared group/tmpfiles mistakes can expose runner RPC. Verify live filesystem and peer credentials, not only rendered text.
- LAN numbers can be misleading under warm caches or local browser. Declare cold/warm sequence, separate machine, RTT and all samples/failures.
- Host rollback may be contract-incompatible with a newer plugin registry. Fail closed with actionable status; never rewrite newer security state to force compatibility.

## Security Considerations

- HTTPS/trusted encrypted transport and authenticated production mode are mandatory; `--no-auth` cannot load real packages or owner data.
- Runner service hardening limits accidents/resources but trusted same-UID plugin code can access what that owner can. No malicious-code sandbox claim.
- Diagnostic/evidence bundles redact tokens, source paths and domain content while retaining digests, versions, timing and typed outcomes.
- Installer/recovery never chmods/chowns advisor sources or guesses owner/admin/grant configuration.

## Next Steps

1. Complete joint G4 review against the A1–A12 evidence matrix and unresolved deployment checklist.
2. If G4 passes, E05 performs the clean standalone replacement and both repositories update release/docs references.
3. If a target or feasibility budget fails, reopen the owning phase/contract explicitly; do not ship dual mode or relax security limits implicitly.

## Unresolved Questions

- Required deployment inputs: owner account/UID/home, configured targets/sources, admin/read subjects, target distro/CPU, artifact handoff, HTTPS termination, separate LAN client/browser and acceptable evidence location.
- G0 must select Node distribution/version/source/license and supported architectures; G4 requires named hardware and staffing. Until supplied, effort remains unestimated.
