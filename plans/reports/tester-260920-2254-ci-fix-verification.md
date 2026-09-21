# Release Version Alignment Fix Verification

- Date: 2026-09-20
- Scope: local alignment script and GitHub Actions run `35521188560`
- Repository: `loidinhm31/dam-hopper`
- Workflow: `Release Linux (x86_64)`
- Ref: `v0.4.2`

## Test Results Overview

| Check | Result | Evidence |
|---|---|---|
| `node deploy/release/check-version-alignment.mjs "v0.4.2"` | PASS | Exit code 0; `Release version alignment verified: v0.4.2 (0.4.2)` |
| `gh run view 35521188560 --repo loidinhm31/dam-hopper` | PASS for validation job | `Validate release version and metadata` completed successfully in 5s |
| Validation step 5: `Verify version alignment across Cargo and web packages` | PASS | Step 5 completed with success at `2026-09-20T15:57:40Z` |

## GitHub Actions Evidence

- Run: `35521188560`
- Validation job: `106105443214` (`Validate release version and metadata`)
- Job status/conclusion: `completed` / `success`
- Step 5 status/conclusion: `completed` / `success`
- Other validation steps (checkout, Node setup, tag resolution, cleanup): success.
- Run URL: https://github.com/loidinhm31/dam-hopper/actions/runs/35521188560
- Job URL: https://github.com/loidinhm31/dam-hopper/actions/runs/35521188560/job/106105443214

At inspection time the overall workflow remained `in_progress` because web and Rust build jobs were still running. This does not affect the completed validation job or Step 5 result.

## Coverage Metrics

Not applicable. This is a release metadata smoke check; no test instrumentation or coverage report is produced.

## Failed Tests

None for the targeted local or CI alignment checks.

## Performance Metrics

- Local script: approximately 0.13s wall time.
- CI validation job: 5s reported duration.

## Build Status

- Version alignment validation: PASS.
- Release workflow downstream web/Rust build jobs: in progress when inspected.
- GitHub annotations: Node.js 20 deprecation notice for checkout/setup-node actions and future `ubuntu-latest` image migration notice; neither is related to version alignment.

## Critical Issues

None blocking the version-alignment fix. The previously failing validation path now passes locally and in Step 5 of the triggered release run.

## Recommendations / Next Steps

1. Allow run `35521188560` downstream build jobs to finish before treating the complete release workflow as green.
2. Schedule action-runtime updates for Node.js 24 compatibility before Node.js 20 enforcement; unrelated to this fix.

## Unresolved Questions

- Final conclusions of the downstream web and Rust build jobs were not available at the time of this targeted validation inspection.
