# Web Assets Fix Validation Report

- **Date:** 2026-09-19
- **Scope:** pnpm 10 workspace configuration, `apps/web` production build, release gates, and modified GitHub Actions workflow YAML syntax.
- **Environment:** Linux x64; Node.js v24.16.0; pnpm 10.28.2.

## Test Results Overview

| Validation | Result | Exit code | Observed result |
|---|---:|---:|---|
| `pnpm install --frozen-lockfile` | PASS | 0 | Lockfile up to date; resolution skipped; already up to date; no `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. |
| `pnpm --filter @dam-hopper/web build` | PASS | 0 | Browser extension staged; Vite production SPA build completed. |
| `pnpm release:verify` | PASS | 0 | Release version alignment verified: `v0.4.0` / `0.4.0`; shell and Node release-script syntax checks passed. |
| YAML syntax validation (4 workflows) | PASS | 0 | PyYAML 6.0.3 loaded all four workflow files successfully. |

**Required checks:** 4/4 passed; failures: 0; skipped: 0.

## Frozen Installation

Command:

```text
pnpm install --frozen-lockfile
```

Output summary:

```text
Scope: all 7 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 554ms using pnpm v10.28.2
```

The pnpm v10 lockfile configuration is accepted. No lockfile configuration mismatch occurred.

## Web SPA Build

Command:

```text
pnpm --filter @dam-hopper/web build
```

Build evidence:

- `@dam-hopper/web` prebuild staged the browser-debug extension successfully.
- Vite v6.4.1 transformed 6,056 modules.
- Vite emitted `dist/index.html` and the production `dist/assets/*` bundles, including CSS, JavaScript chunks, web workers, fonts, and Monaco assets.
- Vite reported `built in 29.06s`; command wall time was 30.83s.
- The workflow target `apps/web/dist` is therefore populated with the SPA entry point and asset bundles.

Representative output:

```text
vite v6.4.1 building for production...
✓ 6056 modules transformed.
dist/index.html  0.70 kB │ gzip: 0.36 kB
...
✓ built in 29.06s
```

## Release Verification

Command:

```text
pnpm release:verify
```

Result:

```text
✓ Release version alignment verified: v0.4.0 (0.4.0)
```

The command also completed `bash -n deploy/release/*.sh tests/deploy/*.sh` and Node syntax checks for the release manifest and asset validation scripts without errors. Wall time: 0.47s.

## Workflow YAML Syntax

Validated with Python PyYAML 6.0.3 using `yaml.safe_load`:

- `.github/workflows/release-linux.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-pages.yml`
- `.github/workflows/release.yml`

All four files parsed successfully. This check covers YAML syntax; GitHub-hosted semantic/runtime validation is outside the local parser.

## Coverage Metrics

Not applicable. This assignment validates installation, production asset compilation, release scripts, and workflow syntax rather than application test coverage. No unit/integration test suite or coverage command was requested or exercised.

## Performance Metrics

- Frozen install: 0.554s reported by pnpm (0.65s command wall time).
- Web production build: 29.06s reported by Vite (30.83s command wall time).
- Release verification: 0.47s command wall time.
- No slow or flaky test cases observed; no test runner was involved.

## Build Status

**PASS.** pnpm 10.28.2 accepts the frozen lockfile, the web SPA compiles successfully, and the release verification scripts pass. The original pnpm 9 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` condition is not reproduced under the configured pnpm 10 toolchain.

## Critical Issues

None found in the required validation scope.

## Recommendations / Next Steps

1. Keep CI/release workflow pnpm setup pinned to pnpm major version 10 (or the repository package-manager patch version) so it remains compatible with the lockfile's `patchedDependencies` format.
2. Preserve the `pnpm install --frozen-lockfile` gate in release workflows to detect future lockfile/configuration drift.
3. Consider a separate CI job for application tests and coverage; this validation did not measure coverage.

## Unresolved Questions

None.
