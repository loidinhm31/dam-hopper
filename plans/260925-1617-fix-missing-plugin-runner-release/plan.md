---
title: "Fix missing plugin runner in Linux releases"
description: "Make the plugin runner a required, versioned Linux release binary from build through archive validation."
status: complete
priority: P1
effort: 5h
branch: main
tags: [bugfix, infra, release, linux]
created: 2026-09-25
---

# Fix missing plugin runner in Linux releases

## Summary & requirements

The v0.5.0 Linux archive included `dam-hopper-plugin-runner.service` but omitted its `ExecStart` binary. Server/both installs fail `systemd-analyze verify`; the binary was silently optional in packaging and absent from workflow artifacts and preflight checks. See [diagnostic findings](../reports/debugger-260925-1617-missing-plugin-runner.md). Restore one fail-closed contract: every Linux release carries executable `bin/dam-hopper-plugin-runner` plus its service and tmpfiles configuration, and the built binary reports the release version. Preserve the existing archive/manifest format, deterministic packaging and Windows release path; no installer or runtime redesign.

Existing flow: `cargo build --bins` → `build-rust` artifact → `package-release` download → `linux-release-package-twice.sh` → `build-release-archive.sh` → generated inventory/manifest → `check-release-assets.mjs`. The [runner runtime architecture](../../docs/system-architecture.md) already specifies the service/binary contract; this is a packaging invariant fix, not an architecture change.

| Phase | Scope | Effort | Dependency |
| --- | --- | --- | --- |
| 1 | Binary attributes & release packaging | 1h | None |
| 2 | Asset gate & validation scripts | 1h | Phase 1 |
| 3 | CI/CD workflow synchronization | 1h | Phases 1–2 |
| 4 | Testing & end-to-end verification | 2h | Phases 1–3 |

## Phase 1 — Binary attributes & release packaging

1. Modify `server/src/bin/dam-hopper-plugin-runner.rs`: add Clap `version` to the existing `#[command(...)]` attributes, matching sibling binaries. `dam-hopper-plugin-runner --version` must exit 0 and contain `server/Cargo.toml` package version without starting the service or requiring `--registry-dir`.
2. Modify `deploy/release/build-release-archive.sh`: assign `RUNNER_BIN="${TARGET_DIR}/dam-hopper-plugin-runner"` in the upfront binary prerequisites and error/exit if not a regular file. Remove its late `if [[ -f ... ]]`; always `cp -p` to `bin/dam-hopper-plugin-runner` and `chmod 0755` like server/helper. Since Phase 2 requires the runner unit/tmpfiles in every archive, also validate the existing `.service.in` and `.conf.in` templates in the required-asset preflight and copy them unconditionally at their existing destinations with 0644. Keep the existing deterministic staging/mtime behavior.
3. Proof: direct packager invocation with runner absent fails before creating an output archive; present runner yields exactly one executable archive entry and the matching service/tmpfiles entries. No synthetic fallback binary in production.

## Phase 2 — Asset gate & validation scripts

1. Modify `deploy/release/check-release-assets.mjs`: add `bin/dam-hopper-plugin-runner`, `systemd/dam-hopper-plugin-runner.service`, and `tmpfiles.d/dam-hopper-plugin-runner.conf` to `REQUIRED_INVENTORY_PATHS`. Reuse the existing inventory-kind, role, and executable-bit checks for these paths; do not add a second validator or change the schema. Missing entries must fail the existing archive/manifest gate, not merely pass when the runner is present.
2. Modify `tests/deploy/linux-release-package-twice.sh`: include `dam-hopper-plugin-runner` in the required executable loop before either packaging pass. Preserve its existing failure message and deterministic two-run comparison.
3. Proof: removing the runner from inputs fails package-twice preflight, while directly invoking the packager fails its own preflight; an archive/manifest missing any one of the three required inventory paths fails `check-release-assets.mjs`. Existing mock deploy bundles already include all three, so avoid rewriting the fixture.

## Phase 3 — CI/CD workflow synchronization

1. Modify `.github/workflows/release-linux.yml` `build-rust`: run `server/target/x86_64-unknown-linux-gnu/release/dam-hopper-plugin-runner --version` alongside the other binary checks; include that exact path in `rust-binaries` upload (`if-no-files-found: error`). In `package-release`, include `artifacts/bin/dam-hopper-plugin-runner` in `chmod +x` after download and before `release:package-twice`. Leave build target and download/artifact names intact.
2. Modify `.github/workflows/ci.yml` `build-linux`: add `--bin server/target/release/dam-hopper-plugin-runner` to the existing `check-version-alignment.mjs` call and add that path to `dam-hopper-linux-x86_64-binaries` upload. Preserve `--bins`, existing build/test gates and Windows jobs.
3. Proof: a missing build output fails version/upload; a missing downloaded artifact fails `chmod`/package preflight, not release publication or host installation. The normal release asset gate validates archive contents before upload.

## Phase 4 — Testing & end-to-end verification

1. Static checks from repo root: `bash -n deploy/release/build-release-archive.sh tests/deploy/linux-release-package-twice.sh`; `node -c deploy/release/check-release-assets.mjs deploy/release/check-version-alignment.mjs`. Inspect workflow YAML for correct job, target-directory and artifact-path placement.
2. Build on Linux with `cd server && cargo build --release --features vendored --bins` and build web dist if absent (`pnpm --filter @dam-hopper/web build`). Execute `server/target/release/dam-hopper-plugin-runner --version` and `node deploy/release/check-version-alignment.mjs --bin server/target/release/dam-hopper-plugin-runner` (or pass the same version checker the full CI binary list). Use the tag matching `server/Cargo.toml` and `apps/web/package.json` for any release checks; never use a dummy mismatched tag.
3. Packaging smoke (locally isolated output; the script has no `--dry-run` option): run `bash tests/deploy/linux-release-package-twice.sh --version <matching-vX.Y.Z> --target-dir server/target/release --web-dist apps/web/dist --output-dir <temporary-directory>`. It packages twice, compares bytes, creates manifest, and calls the Linux asset gate. Inspect tar member presence/mode 0755 and generated inventory for runner, service and tmpfiles; remove only temporary artifacts afterward.
4. Negative regression proof: temporarily provide a target directory with all required inputs except runner and assert both package-twice preflight and direct archive builder fail with a missing-runner error and no archive output; then validate an isolated, otherwise valid bundle/manifest with each of the three required paths removed in turn and assert the asset gate rejects it. Retain a focused regression test only if it exercises this consumer-visible failure through the existing deploy test conventions; no source-text or mock-echo assertions.
5. Unit/integration tests: run `cargo test --manifest-path server/Cargo.toml --features vendored --bin dam-hopper-plugin-runner` for binary target compilation/tests and `pnpm test:deploy` for existing Linux deployment contracts. If available on the test host, do a rootless server-role installation smoke using the produced release and verify the staged runner unit's `ExecStart` resolves to the packaged executable; don't claim host-level verification if unavailable.

## Acceptance criteria

- A missing/non-regular runner aborts archive creation; package-twice rejects a missing/non-executable runner before packaging.
- A valid Linux archive has the runner executable with mode 0755, its systemd service and tmpfiles config, all recorded and required by the manifest asset gate. Missing any of the three fails validation.
- The built runner responds to `--version` with the canonical release version; CI and tagged-release artifacts carry and verify the same binary path; the release package job restores its executable bit.
- Syntax/version checks, deterministic packaging smoke, negative checks and relevant unit/deploy tests pass without changing Windows release behavior or the manifest schema.

## Risks & mitigations

- Existing v0.5.0 Linux assets remain broken: code changes cannot repair published tarballs. After verification, release a patched tag/assets and warn operators that v0.5.0 is unsuitable for Linux server/both installs; publication is separate release operations.
- Artifact download may strip executable mode: explicitly `chmod +x` all five binaries, including runner, before package preflight.
- Gate alone could fail late if service/tmpfiles templates disappear: validate them alongside input binaries before staging, then always copy.
- Fixture-backed deploy tests already contain a mock runner and may pass even when real workflow artifacts omit it: combine negative packager cases with a real compiled-binary package smoke.


## Implementation & Review Status

- Phase 1 (Binary attributes & packaging): COMPLETE. `server/src/bin/dam-hopper-plugin-runner.rs` Clap `version` added; `deploy/release/build-release-archive.sh` validates runner binary and unit/tmpfiles templates upfront and packages unconditionally with 0755/0644.
- Phase 2 (Asset gate & validation): COMPLETE. `deploy/release/check-release-assets.mjs` added runner binary, unit, and tmpfiles config to `REQUIRED_INVENTORY_PATHS`; `tests/deploy/linux-release-package-twice.sh` added runner binary to required executable loop.
- Phase 3 (CI/CD workflow synchronization): COMPLETE. `.github/workflows/release-linux.yml` and `.github/workflows/ci.yml` synchronized with runner version check, upload artifacts, and `chmod +x`.
- Phase 4 (Testing & verification): COMPLETE. Tester validated positive deterministic packaging, 5/5 negative fail-closed boundary cases, version alignment, and full deploy suite (9/9 passed).

## Next Steps

1. Tag and trigger patched Linux release (e.g., v0.5.1) containing the complete Linux binary and unit set.
2. Post release advisory noting v0.5.0 archive omission of plugin-runner binary for Linux server/both roles.
## Unresolved questions

None for this scoped fix. Running the full real package-twice gate on every PR (rather than only on release) is a separate CI-cost decision, not a prerequisite for this plan.
