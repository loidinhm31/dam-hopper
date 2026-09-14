# Validation Report: Unverified Publish Override

## Test Results Overview

- `node -c deploy/release/check-release-assets.mjs`: PASS (exit 0).
- `pnpm release:verify`: PASS (exit 0).
  - Release version alignment: `v0.3.1 (0.3.1)`.
  - Shell syntax and release manifest/checker syntax checks passed.
- `cargo test --test linux_release_publisher_contract` (from `server/`): PASS.
  - 10 passed, 0 failed, 0 ignored; 0.93s.
- Workflow-context CLI override: PASS (exit 0, no output/error).
  - `GITHUB_ACTIONS=true GITHUB_JOB=publish-release GITHUB_REF=refs/tags/v0.3.1 node deploy/release/check-release-assets.mjs --tag v0.3.1 --allow-unverified-publish`
- Workflow-context environment override: PASS (exit 0, no output/error).
  - `ALLOW_UNVERIFIED_PUBLISH=true GITHUB_ACTIONS=true GITHUB_JOB=publish-release GITHUB_REF=refs/tags/v0.3.1 node deploy/release/check-release-assets.mjs --tag v0.3.1`

## Coverage Metrics

- Not generated. Requested validation is syntax, release verification, targeted Rust contract suite, and checker smoke scenarios; no coverage script applies.

## Failed Tests

- None among required checks.
- Additional probe with `REQUIRE_MIGRATION_GATE=1` and no publication directory stopped at the expected prerequisite error (`required migration gate needs --dir so evidence can bind to published bytes`), before stable-hold evaluation. This does not affect the workflow contract, where `REQUIRE_MIGRATION_GATE` is unset and the override paths exit successfully.

## Performance Metrics

- Syntax check: 0.11s.
- `pnpm release:verify`: 0.54s.
- Targeted Rust contract suite: 0.93s.
- Override smoke commands: 0.08–0.10s each.

## Build Status

- Release verification build gate: PASS.
- No build warnings observed in requested commands.

## Critical Issues

- None.

## Recommendations

- Keep both workflow wiring forms (`ALLOW_UNVERIFIED_PUBLISH=true` and `--allow-unverified-publish`) as defense in depth; both were observed in the workflow and both bypass smoke checks passed.

## Next Steps

1. Merge the validated checker/workflow changes.
2. When external migration evidence is wired, remove the temporary unverified override from the publish step and re-enable the required migration gate through the normal release process.

## Unresolved Questions

- None.
