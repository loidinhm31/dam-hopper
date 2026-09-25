# Project Management Handoff: Missing Linux Plugin Runner

**Disposition:** implementation and verification complete; release publication pending. Plan status `complete` means all four source-fix phases passed, not that v0.5.1 has been released. Current package metadata remains `0.5.0`; the published v0.5.0 Linux `server`/`both` archive remains broken. `web`-only installations are unaffected.

## Plan completeness against all phases

Plan: [`plans/260925-1617-fix-missing-plugin-runner-release/plan.md`](../260925-1617-fix-missing-plugin-runner-release/plan.md). Frontmatter includes all required fields (`title`, `description`, `status`, `priority`, `effort`, `branch`, `tags`, `created`): status `complete`, priority P1, effort 5h, branch `main`.

| Phase | Status | Completion evidence |
| --- | --- | --- |
| 1 — Binary attributes and packaging | Complete | Runner now reports the Cargo package version. Archive builder fails fast if runner or templates are absent and always packages the runner executable (`0755`), service and tmpfiles config (`0644`). Positive archive inspection and missing-runner preflight passed. |
| 2 — Asset gate and validation | Complete | All three runner paths are required in the existing manifest inventory gate; package-twice requires the executable. Removing each path individually is rejected; all five negative preflight/asset-gate cases passed. |
| 3 — CI/CD synchronization | Complete | Release workflow checks runner version, uploads it as a required artifact and restores execute mode; CI alignment and artifact paths include it. Existing Windows release path was left unchanged. Hosted workflow execution was not performed. |
| 4 — Testing and end-to-end verification | Complete | Syntax/version checks, release build, runner `--version`, deterministic package-twice smoke, archive modes/inventory inspection, negative boundaries, runner target test and deployment suite passed. Tester reports 19/19 total validation outcomes, including 9/9 deploy scripts. Positive package smoke used aligned v0.5.0 packages; v0.5.1 artifacts remain unbuilt/unverified. A separate rootless/systemd host install smoke is not reported. |

All required acceptance criteria are supported by recorded local tests and static review; the optional host-level smoke is not separately evidenced. Remaining tag/publication/advisory steps are explicitly outside implementation-phase completion and remain release gates.

## Subagent deliverables

- **Debugger** — [`debugger-260925-1617-missing-plugin-runner.md`](debugger-260925-1617-missing-plugin-runner.md): traced v0.5.0 failure to the service being archived without its `ExecStart` binary; identified omissions in package preflight, asset inventory, workflows and version check; documented Linux role impact and safe rollback behavior.
- **Planner** — created the four-phase, 5h P1 implementation plan with acceptance criteria and risks. The plan is the planner deliverable; no separate planner report was requested.
- **Tester** — [`tester-260925-1617-missing-plugin-runner.md`](tester-260925-1617-missing-plugin-runner.md): reports 19/19 validations passed. This includes `pnpm release:check-version`, `pnpm release:verify`, release-bin build and runner version `0.5.0`, two byte-identical package outputs, correct tar modes, 5/5 negative cases, and `pnpm test:deploy` (9/9 scripts).
- **Code reviewer** — [`code-reviewer-260925-1617-missing-plugin-runner.md`](code-reviewer-260925-1617-missing-plugin-runner.md): score 10/10, no critical issues or warnings; confirmed fail-closed gates and no Windows release regression. Reviewer also reports the runner-target Cargo test passed.
- **Docs manager** — [`docs-manager-260925-1617-missing-plugin-runner.md`](docs-manager-260925-1617-missing-plugin-runner.md): updated seven release/manifest/systemd/navigation/codebase-summary pages with the invariant, v0.5.1 checklist and v0.5.0 advisory. Documentation validation checked 39 files and found 637 internal links valid; the report documents remaining validator heuristic/source-root advisories. PM wrap-up also updated [`docs/project-roadmap.md`](../../docs/project-roadmap.md) and [`docs/CHANGELOG.md`](../../docs/CHANGELOG.md) to distinguish completed implementation from pending publication.

## Advisor mentoring checkpoints

Two review cycles settled. Cycle 1 returned `ADVICE_READY` and requested archive-level proof plus reconciliation of validation totals; tester evidence now records the binary and mode `0755`, companion files and modes, and the overall 19/19 total. Cycle 2 returned `ADVICE_READY` with `has_concerns: false`. Final advisor state is `gate_status: completed`, outcome `resolved`, with no pending consultation or unresolved episode.

## Git status and verification state

Latest parent snapshot reports branch `main` and 13 modified tracked files:

- `.github/workflows/ci.yml`, `.github/workflows/release-linux.yml`
- `deploy/release/build-release-archive.sh`, `deploy/release/check-release-assets.mjs`
- `server/src/bin/dam-hopper-plugin-runner.rs`, `tests/deploy/linux-release-package-twice.sh`
- `docs/README.md`, `docs/codebase-summary-release.md`, `docs/codebase-summary.md`, `docs/linux-release-manager.md`, `docs/linux-release-manifest.md`, `docs/linux-release-publisher-bootstrap.md`, `docs/linux-systemd.md`

After that snapshot, this PM task modified `docs/project-roadmap.md` and `docs/CHANGELOG.md` and created this report; therefore the known tracked working tree is dirty with at least 15 modified files. No newer porcelain result was captured after PM edits. Tester reported unrelated pre-existing untracked items and left them untouched; the current untracked inventory is not available. No commit, merge, v0.5.1 tag or publication is reported. Targeted local verification is green per tester/reviewer; hosted CI and the tagged-release dry run have not been run.

## Next steps for v0.5.1 publication

1. Align `server/Cargo.toml` and `apps/web/package.json` to `0.5.1`; confirm the protected `v0.5.1` tag is available and matches both manifests.
2. Run the documented release checks and build the candidate package:

   ```bash
   node deploy/release/check-version-alignment.mjs v0.5.1
   pnpm release:verify
   pnpm release:package-twice --version v0.5.1 \
     --target-dir artifacts/bin \
     --web-dist apps/web/dist \
     --output-dir artifacts/final
   node deploy/release/check-release-assets.mjs \
     --profile linux --tag v0.5.1 --dir artifacts/final
   ```

3. Inspect archive and manifest: runner present, executable mode `0755`; service and tmpfiles entries present with mode `0644`; all three entries have `server` role. Confirm deterministic package-twice and all manifest, asset and attestation gates.
4. Run the tagged workflow dry run. Publish protected `v0.5.1` only after the release gates pass; do not repair or republish the immutable v0.5.0 bytes under the old tag.
5. Publish the operator notice with v0.5.1: “Linux v0.5.0 omitted `bin/dam-hopper-plugin-runner` although its systemd unit was present. Linux `server` and `both` staging fails unit verification. Use v0.5.1 or later for these roles; web-only installs are unaffected.” Until publication, advise operators not to use v0.5.0 for Linux `server`/`both`.

## Unresolved questions

No open question blocks implementation completion. Two follow-up decisions remain outside the v0.5.1 release gate:

1. Should the full real `release:package-twice` gate run on every pull request or remain limited to release builds (CI cost vs. earlier regression detection)?
2. Should deploy integration tests replace `create_mock_release_bundle` with real packager output to reduce mock/production drift?
