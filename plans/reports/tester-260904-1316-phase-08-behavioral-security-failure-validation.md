# Phase 08 Test Report — Behavioral, Security, and Failure-Injection Validation

## Test Results Overview

- Requested validation commands: 8
- Commands passed: 8
- Commands failed: 0
- Result: 100% terminal pass (all exit 0)
- Deterministic test totals reported by runners:
  - Rust: 1,018 passed, 0 failed, 2 ignored across 31 suites.
  - UI command as requested: 1,447 passed, 0 failed across 214 files.
  - Supplemental direct config-file invocation: 45 passed, 0 failed across 2 files (`runtime-config.test.ts`, `server-config.test.ts`). These tests are included in the requested all-files run; not added to the aggregate.
- Deploy validation: 6 modular scripts passed; no failure output.

## Validation Commands

1. `cargo test --manifest-path server/Cargo.toml --features vendored`
   - **PASS**, exit 0.
   - Runner summary: `1,018 passed (31 suites, 2 ignored, 0 failed)`.

2. `pnpm --filter @dam-hopper/ui test -- runtime-config.test.ts server-config.test.ts`
   - **PASS**, exit 0.
   - Vitest summary: `214` files passed; `1,447` tests passed; `0` failed.
   - The package script expands to `vitest run -- ...`; Vitest treated the separator as an all-suite invocation. A direct supplemental invocation of the two requested files also passed: `2` files / `45` tests.

3. `pnpm --filter @dam-hopper/ui build && pnpm --filter @dam-hopper/web build`
   - **PASS**, exit 0.
   - UI TypeScript build completed.
   - Browser-extension staging/build completed (`7` modules transformed); web Vite production build completed (`6,019` modules transformed).
   - No build warnings or errors observed.

4. `bash -n deploy/release/*.sh tests/deploy/*.sh`
   - **PASS**, exit 0, no output/errors.
   - Syntax checked 11 shell files: 2 release scripts and 9 deploy test scripts.

5. `pnpm release:verify`
   - **PASS**, exit 0.
   - Release version alignment verified: `v0.1.0` / `0.1.0`.
   - Included shell syntax and Node syntax checks; no errors.

6. `pnpm release:package-twice --version v0.1.0`
   - **PASS**, exit 0.
   - Two independent archives: both `22,278,394` bytes and byte-identical.
   - Both SHA256: `edbfe8bbec069ad4065650cf99407b18d6689a3ccc6f01b47681737b72afaa0c`.
   - Release manifest generated with `156` entries; SPDX SBOM with `153` files.
   - Local asset gate passed for all 4 assets: installer, SBOM, archive, and manifest.

7. `pnpm release:rootless-smoke`
   - **PASS**, exit 0.
   - Started real rootless web host and API server processes on ephemeral loopback ports.
   - Both health probes returned success; SIGTERM cleanup accepted; terminal summary: `Rootless API/web process smoke passed`.

8. `pnpm test:deploy`
   - **PASS**, exit 0.
   - Clean-install journey: server, web, and both roles (`3` role scenarios).
   - Upgrade/role-change/rollback journey: `4` reported steps (active release, upgrade, manual rollback, automatic rollback with diagnostics).
   - Crash-recovery journey: `3` reported state-boundary cases (STAGED, SWITCHED/PROBING, COMMITTED).
   - Security journey: unit identities/sandboxing, archive secret exclusion, and `4` nested-secret negative fixtures rejected.
   - Web contract journey: runtime-config schema, health schema, and built-distribution contract passed.
   - Fedora 44 format-2 rehearsal: `4` reported migration/rollback steps passed.
   - All 6 modular scripts reached their success terminal message; no `FAIL` output.

## Coverage Metrics

Coverage instrumentation was not requested or run. No line, branch, or function percentages available. The requested gate is behavioral/contract validation rather than a coverage threshold run.

## Failure and Security Checks

- Failed tests: **None**.
- Rust and Vitest suites reported zero failures.
- Deploy scripts completed without assertion failures.
- Runtime config and health samples use `schemaVersion: 1`.
- Generated release manifest uses `schemaVersion: 1` and declares Fedora 44, x86_64, systemd minimum 259.
- Security checks passed; archive scanner rejected all 4 nested secret fixtures and found no disallowed secret/runtime files in the built archive.
- Evidence/log output remained bounded to versions, hashes, counts, ports, and statuses; no token, credential, environment body, or config secret emitted.

## Performance Metrics

- Rust vendored test command wall time: 16.44s.
- Requested UI Vitest command wall time: 13.09s (Vitest reported 12.31s).
- Direct 2-file UI confirmation wall time: 1.09s (Vitest reported 493ms).
- UI/web build command wall time: 42.06s (web Vite build reported 33.58s).
- Shell syntax: 0.08s.
- Release verify: 0.53s.
- Package-twice: 9.29s.
- Rootless smoke: 0.60s.
- Modular deploy suite: 0.99s.
- No flaky behavior or slow outlier observed in this run.

## Build Status

- UI TypeScript build: pass.
- Browser-extension staging/build: pass.
- Web production Vite build: pass.
- Release package/archive, manifest, SBOM, and asset gate: pass.
- Host profile independently confirmed: Fedora Linux 44, x86_64, systemd 259 (`systemctl --version`).

## Critical Issues

None for the requested Phase 08 command gate.

## Recommendations

- Preserve the direct two-file Vitest invocation in addition to the existing package command if the intent is to limit execution to those two files; the requested command currently runs all 214 files because of the `--` argument passed to `vitest`.
- Keep protected-host runtime evidence workflow separate from this local gate; this run validates the listed local/rootless/rehearsal commands, not a disposable-host reboot/SELinux evidence job.

## Next Steps

1. Main agent incorporates this terminal pass into Phase 08 completion review.
2. Main agent runs project-wide validation after all concurrent changes land.
3. Run protected Fedora evidence workflow when its self-hosted disposable runtime is available, if required for final release publication.

## Unresolved Questions

None for the listed commands. Protected-host evidence workflow execution is outside the requested command list.
