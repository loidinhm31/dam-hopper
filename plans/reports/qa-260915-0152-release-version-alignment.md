# Release Version Alignment QA

## Test Results Overview

- `node deploy/release/check-version-alignment.mjs "v0.3.1"`: PASS, exit 0.
- `pnpm release:verify`: PASS, exit 0.
  - Version checker: PASS.
  - `bash -n deploy/release/*.sh tests/deploy/*.sh`: PASS.
  - Node syntax checks for release manifest/assets scripts: PASS.
- Additional touched-script syntax: `bash -n scripts/run-uat.sh tests/deploy/linux-release-rootless-smoke.sh`: PASS.
- No broad unit/integration suite run; scope limited to release alignment/configuration validation.

## Version Coverage

Parsed and checked JSON/TOML manifests:

- 8 JSON files: PASS.
- 4 TOML files: PASS.
- 11 release version declarations: all `0.3.1`.
- Includes `server/Cargo.lock` root package and `apps/native/src-tauri/Cargo.lock` root package.

Validated declarations:

- `apps/browser-extension/package.json`
- `apps/native/package.json`
- `apps/native/src-tauri/Cargo.toml`
- `apps/native/src-tauri/Cargo.lock`
- `apps/native/src-tauri/tauri.conf.json`
- `apps/web/package.json`
- `packages/browser-bridge/package.json`
- `packages/shared/package.json`
- `packages/ui/package.json`
- `server/Cargo.toml`
- `server/Cargo.lock`

`cargo metadata --no-deps --locked --format-version 1` passed for both server and native manifests. `pnpm install --lockfile-only --offline --frozen-lockfile` passed for all 7 workspace projects.

## Coverage Metrics

- Code coverage: N/A; no production code path changed.
- Configuration/version declarations: 11/11 validated (`100%`).

## Performance Metrics

- Version checker: <1 s.
- `pnpm release:verify`: <1 s.
- Workspace lockfile parse: <1 s.
- No slow validation step observed.

## Build Status

- Release validation/build prerequisite syntax checks: PASS.
- Full production build intentionally not run; unrelated and outside release-alignment scope.

## Critical Issues

None.

## Recommendations

- Keep native `Cargo.lock` root package version synchronized with its `Cargo.toml` during future bumps; it was corrected to `0.3.1` and revalidated here.
- Consider extending `check-version-alignment.mjs` to inspect all workspace package/native versions if release policy requires automated enforcement beyond server/web.

## Next Steps

1. Proceed with v0.3.1 release/tag verification.
2. Preserve the manifest version synchronization in release automation.

## Unresolved Questions

None.
