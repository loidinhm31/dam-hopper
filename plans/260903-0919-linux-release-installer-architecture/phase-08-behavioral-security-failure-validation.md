# Phase 08 — Behavioral, Security, and Failure-Injection Validation

## Context Links

- [Parent plan](./plan.md)
- [Phase 05 transaction runtime](./phase-05-durable-activation-rollback-recovery.md)
- [Phase 06 publisher](./phase-06-central-github-publisher-bootstrap.md)
- [Phase 07 migration](./phase-07-format-2-migration-runner-retirement.md)
- [Current CI workflow](../../.github/workflows/ci.yml)
- [Current production fixture](../../tests/deploy/linux-production-fixtures.sh)
- [Development rules](../../docs/code-standards.md)

## Overview

- **Date:** 2026-09-03
- **Description:** Prove artifact, role, runtime, migration, rollback, reboot, and least-privilege behavior on real Fedora 44/systemd 259 before documentation or publication cutover.
- **Priority:** P1
- **Implementation status:** DONE 2026-09-04 13:30:00 +07:00
- **Review status:** Approved (Terminal Gate Passed)
- **Effort:** 20h

## Key Insights

- Unit tests can prove parsers and durable files, but only a real systemd host proves cgroups, effective sandboxing, SELinux, listeners, reboot enablement, and account behavior.
- Failure injection must target observable boundaries without production-only bypass flags. Watch durable state, kill the real manager, mutate staged test artifacts before verification, and use real processes/ports/health responses.
- Release publication must consume same-commit protected runtime evidence, following the repository's existing native evidence-binding pattern without coupling desktop and Linux artifacts.
- Workflow gates are blocking: terminal tester result, fixes, fresh tester result, holistic reviewer result, and rerun after review-driven code changes.

## Requirements

### Functional

- Cover clean server, web, and both installs; same-role upgrades; explicit role transitions; manual rollback; automatic rollback; format-2 takeover; status human/JSON; recovery and reboot.
- Cover release manifest/schema/version, archive extraction, attestation, deterministic package, bootstrap, unit policy, web HTTP behavior, API-only behavior, frontend runtime profile, and old-path absence.
- Inject failures for manifest/archive/attestation, candidate binary, unit syntax/policy, web assets, occupied ports, foreign processes, account/owner/mode, SQLite holder, API/web wrong health version, HTML health, startup timeout, early crash, second service failure, stop timeout, and restoration failure.
- Kill the real manager immediately after each durable state appears: `STAGED`, `PENDING`, `QUIESCED`, root/unit switch, `SWITCHED`, `PROBING`, enablement, and `COMMITTED`; rerun `recover` and assert the state table.
- Reboot before first activation, during pre-switch, after switch/pre-commit, and after commit. Assert no first-install autostart, conservative rollback mid-transaction, and committed role autostart.
- Prove API/web independent supervision and lockstep both-role version.
- Prove old production scripts/unit/package aliases/references are absent after migration cutover.

### Non-functional

- Tests use real temp files, tarballs, local HTTP listeners, processes, and Fedora systemd. No mocked systemctl, fake pass result, source-text-only behavioral assertion, or disabled security control.
- Protected runtime host matches Fedora 44, x86_64, glibc 2.43, systemd 259, SELinux enforcing. Any mismatch is unsupported, not a pass.
- Test release versions/config/state are isolated from operator production and removed only after marker/state ownership verification.
- Capture bounded evidence: tag/commit, manifest/archive digests, OS versions, unit properties, state transitions, exact health/version, PIDs/UIDs/listeners, and pass/fail summaries; never env/token/config bodies.

## Architecture

Three layers:

1. **Deterministic tests:** Rust integration tests, UI Vitest, shell syntax, JSON Schema, package-twice digest comparison.
2. **Rootless process smoke:** real manager/web/API processes against temp roots and local ports; malicious archives and HTTP failures.
3. **Protected Fedora runtime:** isolated host snapshot, actual `/opt`/`/etc/systemd`/`/var/lib`, system users, SELinux, systemd, process namespaces, crash/reboot injection, and format-2 migration.

`.github/workflows/linux-release-runtime-evidence.yml` runs only on a protected self-hosted label and uploads a sanitized signed-by-Actions evidence summary bound to `github.sha`. `release-linux.yml` queries the successful same-commit run and verifies artifact digest before its publish job. The evidence workflow never publishes releases.

## Related Code Files

### Create

- `.github/workflows/linux-release-runtime-evidence.yml` — protected Fedora 44 runtime gate.
- `tests/deploy/linux-release-common.sh` — shared exact assertions/cleanup, kept focused.
- `tests/deploy/linux-release-clean-install.sh` — role/pending/explicit activation/reboot journeys.
- `tests/deploy/linux-release-upgrade-rollback.sh` — upgrades, role change, manual/automatic rollback.
- `tests/deploy/linux-release-crash-recovery.sh` — journal boundary kill/reboot matrix.
- `tests/deploy/linux-release-security.sh` — owner/mode/symlink/account/sandbox/secret checks.
- `tests/deploy/linux-release-web-contract.sh` — real static/runtime/health/cache/API-origin checks.
- `tests/deploy/linux-release-evidence-check.mjs` — bounded evidence schema and commit binding.

### Modify

- `.github/workflows/ci.yml` — deterministic scoped test/build/package checks with no release mutation.
- `.github/workflows/release-linux.yml` — require successful same-commit Fedora evidence before publish.
- `package.json` — wire focused contributor validation commands without restoring old production aliases.
- `server/tests/linux_release_manifest.rs` — malformed/cross-field matrix completion.
- `server/tests/linux_release_archive.rs` — malicious tar/decompression/TOCTOU matrix completion.
- `server/tests/linux_release_cli.rs` — privilege/argument/status matrix completion.
- `server/tests/linux_release_web_host.rs` — HTTP/cache/graceful shutdown completion.
- `server/tests/linux_release_state_machine.rs` — every durable boundary and retention completion.
- `server/tests/linux_release_health.rs` — listener/process/JSON stability failures.
- `server/tests/linux_release_format2_migration.rs` — all known/drifted legacy states.
- `packages/ui/src/api/runtime-config.test.ts` — runtime config boundary matrix.
- `packages/ui/src/api/server-config.test.ts` — managed/user profile precedence and token safety.

### Delete

- None; obsolete fixture deletion occurs in Phase 07 after these replacements pass.

## Implementation Steps

1. Complete deterministic Rust and UI contract tests. Each must fail against at least one plausible defect (path traversal acceptance, profile overwrite, mixed version, premature commit, unsafe retention).
2. Add package-twice test with clean inputs and exact SHA comparison; validate schema, manager projection, ELF/GLIBC, SBOM, installer, and asset set.
3. Add rootless real-process smoke for web host HTTP/HEAD/cache/traversal/SIGTERM and API-only routes/runtime config bootstrap.
4. Build modular Fedora scripts. Each asserts clean preconditions, records owned transaction IDs, and cleans only verified test assets.
5. Exercise clean roles/upgrades/role change. Measure that install leaves current health/PID unchanged and activation honors 20s startup + 10s stable-health contract.
6. Inject acquisition/stage/unit/account/process/port/database/health failures and assert zero mutation or verified rollback as appropriate.
7. Observe state transitions from root-owned state via bounded status output, send `SIGKILL` to manager at each boundary, and verify recovery. Do not add production fault toggles.
8. Reboot at required boundaries using disposable Fedora snapshots; verify enablement and recovery one-shot ordering.
9. Prove web isolation inside its actual mount namespace and effective credentials; verify API retains documented broader `loidinh` behavior without root service execution.
10. Rehearse exact format-2 import, candidate failure restoration, successful cutover, manual rollback, next upgrade, and eventual imported-release retention.
11. Run exact planned commands:
    - `cargo test --manifest-path server/Cargo.toml --features vendored`
    - `pnpm --filter @dam-hopper/ui test -- runtime-config.test.ts server-config.test.ts`
    - `pnpm --filter @dam-hopper/ui build && pnpm --filter @dam-hopper/web build`
    - `bash -n deploy/release/*.sh tests/deploy/*.sh`
    - focused release package/check command from `package.json`
    - protected Fedora evidence workflow with `publish=false`.
12. Delegate the complete artifact and command list to `evcrate-tester`. If any failure: fix root cause, rerun affected compile proof, then delegate a fresh full tester gate; repeat until terminal pass.
13. After tester pass, delegate all changed paths and bounded evidence to `evcrate-code-reviewer`. Fix every blocking finding and rerun the tester gate after any code/workflow/test change. Require terminal reviewer approval.

## Todo List — DONE 2026-09-04 13:30:00 +07:00

- [x] Complete deterministic parser/archive/state/frontend coverage.
- [x] Add real-process web/API/bootstrap smoke.
- [x] Add protected Fedora role, migration, rollback, crash, reboot, and isolation scripts.
- [x] Bind stable publisher to same-commit runtime evidence.
- [x] Run full listed validation through `evcrate-tester` until pass.
- [x] Run holistic `evcrate-code-reviewer`; fix and retest until approved.
## Success Criteria

- All accepted brainstorm criteria 1–15 have one named automated or protected-host check with bounded evidence.
- Server/web/both clean install and upgrade pass; fresh install/reboot opens no port; old release PID/health is unchanged until activate.
- Every listed failure either performs zero privileged mutation, restores exact previous health/version, or reports `RECOVERY_REQUIRED`; no case reports false success.
- Every state-boundary kill and four reboot scenarios resolve to the documented deterministic state.
- Web/API fail independently; both role never exposes mixed versions; runtime state digest remains unchanged.
- Web service cannot read API env/token/SQLite/home/projects/manager state or write release bytes; API/web never run as root.
- Stable release job refuses missing, stale, wrong-commit, malformed, or failed Fedora evidence.
- `evcrate-tester` terminal report passes every listed command/scenario; final `evcrate-code-reviewer` has no unresolved blocking findings.

## Risk Assessment

- **Self-hosted host contamination:** Use disposable snapshot and marker-bound cleanup; abort on pre-existing production assets.
- **Flaky timing:** Assert state/events with bounded monotonic deadlines; health stability is consecutive success, never fixed sleep alone.
- **Destructive reboot tests:** Run only protected disposable host with explicit environment approval.
- **Evidence spoofing:** Validate schema, workflow/run conclusion, exact commit, artifact digest, and trusted workflow identity.
- **Test-only backdoor pressure:** Observe public state/processes and mutate inputs externally; no shipped fault environment flags.

## Security Considerations

- Sanitize all evidence and logs. Never upload runtime env, token, config, SQLite, home listings, HTTP authorization, or arbitrary journal bodies.
- Runtime workflow permissions remain read-only except artifact upload/id token required for evidence; it cannot publish.
- Tester/reviewer failures cannot be waived inside workflow. Any accepted exception requires explicit owner disposition and plan update.

## Next Steps

Only a clean tester result and holistic reviewer approval unlock Phase 09 documentation/release cutover. Unresolved questions: none.
