# Linux Release Plugin Runner Validation

## Test Results Summary — 19/19 passed

- Release version check: pass.
- Release script syntax/integrity check: pass.
- Plugin runner `--version`: pass; reports `0.5.0`.
- Local all-bin release build: pass.
- Positive deterministic package smoke and archive contents: pass.
- Negative preflight / asset-gate cases: 5/5 pass.
- `pnpm test:deploy`: 9/9 component scripts pass.
- Failed final validations: none. One initial positive packaging attempt stopped at missing `dam-hopper` in the release target; built all release bins and reran successfully.

## Validation Commands & Output Logs

### Version alignment and release checks

```text
$ pnpm release:check-version
✓ Release version alignment verified: v0.5.0 (0.5.0)

$ pnpm release:verify
✓ Release version alignment verified: v0.5.0 (0.5.0)
EXIT=0
```

`release:verify` also ran `bash -n deploy/release/*.sh tests/deploy/*.sh` and `node -c` on the manifest generator, asset gate, and Windows archive builder; these checks emitted no errors.

### Runner version and package build

```text
$ cargo run --manifest-path server/Cargo.toml --release --bin dam-hopper-plugin-runner -- --version
Finished `release` profile [optimized] target(s)
Running `server/target/release/dam-hopper-plugin-runner --version`
dam-hopper-plugin-runner 0.5.0

$ cargo build --manifest-path server/Cargo.toml --release --bins
Compiling dam-hopper-server v0.5.0
Finished `release` profile [optimized] target(s) in 2m 10s
```

Package version alignment and binary version both match `0.5.0`.

### Positive deterministic package smoke

```text
$ pnpm release:package-twice --version v0.5.0 \
  --target-dir server/target/release --web-dist apps/web/dist --output-dir <temporary>
Verified deterministic package twice: dam-hopper-v0.5.0-linux-x86_64-systemd.tar.gz
  sha256 71b75fedeb44c5b7af6c5b947fcd2d17c1476b534552c3729d6fb9e21ac9f870
✓ Local release asset gate passed for v0.5.0
EXIT=0
```

Two archives were byte-identical (25,105,806 bytes each); manifest generation found 163 inventory entries. Tar inspection confirmed:

```text
bin/dam-hopper-plugin-runner                       mode=0755
systemd/dam-hopper-plugin-runner.service           mode=0644
tmpfiles.d/dam-hopper-plugin-runner.conf           mode=0644
ARCHIVE_CHECK=PASS
```

### Full deploy suite

```text
$ pnpm test:deploy
EXIT=0; elapsed 9.45 s
```

All nine chained scripts passed:

1. `linux-release-clean-install.sh` — clean install roles verified.
2. `linux-release-upgrade-rollback.sh` — upgrade and rollback journeys verified.
3. `linux-release-crash-recovery.sh` — recovery boundaries verified.
4. `linux-release-security.sh` — sandboxing, identities, secret exclusion verified.
5. `linux-release-reset-smoke.sh` — reset refusal, dry-run, atomic update verified.
6. `linux-release-web-contract.sh` — web and health contracts verified.
7. `fedora44-format2-migration.sh` — migration and rollback rehearsal passed.
8. `linux-release-plugin-runner-owner-smoke.sh` — owner, tmpfiles, service hardening, and source immutability passed.
9. `linux-release-plugin-upgrade-rollback.sh` — plugin update and host rollback passed.

## Negative & Boundary Test Cases

All cases used isolated temporary fixtures/output paths; no release output was created for failed preflights.

| Case | Observed result |
| --- | --- |
| Direct `build-release-archive.sh` with all other required input binaries present but runner absent | Exit 1: `Error: 'dam-hopper-plugin-runner' binary not found ...`; no output directory/archive created. |
| `linux-release-package-twice.sh` with all other required executable inputs present but runner absent | Exit 1: `Error: required executable is missing or not executable: .../dam-hopper-plugin-runner`; no output directory/archive created. |
| Asset gate with `bin/dam-hopper-plugin-runner` removed from archive and inventory regenerated | Rejected: `release manifest.inventory is missing required paths: bin/dam-hopper-plugin-runner`. |
| Asset gate with `systemd/dam-hopper-plugin-runner.service` removed and inventory regenerated | Rejected: `release manifest.inventory is missing required paths: systemd/dam-hopper-plugin-runner.service`. |
| Asset gate with `tmpfiles.d/dam-hopper-plugin-runner.conf` removed and inventory regenerated | Rejected: `release manifest.inventory is missing required paths: tmpfiles.d/dam-hopper-plugin-runner.conf`. |

## Build, Coverage, Performance & Diff Review

- Build status: release runner and all Rust release bins built successfully; no build warnings observed.
- Coverage: not measured; no coverage command/report was part of this release-packaging validation.
- Performance: deploy suite completed in 9.45 seconds. Two deterministic package runs completed successfully; their elapsed time was not separately captured.
- `git diff` review: six modified tracked files, all related to runner versioning, required Linux release packaging/asset validation, or CI artifact wiring. No unrelated tracked diff found. Post-run status showed no test-generated changes; unrelated untracked files were already present before validation and were left untouched.
- GitHub Actions workflows were inspected locally; hosted CI execution was not performed.

## Conclusion & Readiness for Code Review

Ready for code review. Required runner binary is versioned, packaged as executable, included in manifest inventory, and enforced by both packaging preflights and all three asset-gate requirements. Version checks, release syntax checks, deterministic package smoke, negative cases, and full deploy suite pass.

## Unresolved Questions

None.
