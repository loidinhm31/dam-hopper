# Documentation Report: Missing Linux Plugin Runner

## Current-state assessment

The release fix is implemented and its four plan phases are complete. The release follow-up is not: the plan still calls for tagging and publishing v0.5.1 and posting the v0.5.0 advisory. At review time, both `server/Cargo.toml` and `apps/web/package.json` remain at `0.5.0`, so the patch release still needs version alignment before tagging.

The manifest and publisher guides previously described runner assets as conditional or omitted them from archive assembly. The systemd and runtime guides already describe the server-role runner lifecycle; those runtime contracts remain unchanged.

## Documentation updates

| File | Update |
| --- | --- |
| `docs/linux-release-manifest.md` | Made the three runner paths required in every published Linux archive; documented `server` role, package modes, fail-closed gate behavior, role projection, and the distinction between release requirements and optional runtime fields used by fixtures. |
| `docs/linux-release-publisher-bootstrap.md` | Synchronized binary/artifact and archive assembly descriptions; specified unconditional runner asset preflight/copy; added a v0.5.1 release checklist, local gates, archive inspection criteria, and operator advisory text. Corrected outdated helper-binary optionality for the stable packager. |
| `docs/linux-release-manager.md` | Linked the operator guide to the release checklist/advisory and manifest contract. |
| `docs/linux-systemd.md` | Added a pointer to the publisher guide's release advisory. Runtime role behavior unchanged. |
| `docs/README.md` | Updated deployment navigation description for the runner invariant and v0.5.1 checklist. |
| `docs/codebase-summary.md` | Regenerated summary metadata from the refreshed `repomix-output.xml`; added the packaging invariant and pending release follow-up. |
| `docs/codebase-summary-release.md` | Recorded the packaging fix and v0.5.0/v0.5.1 release boundary. |

`plans/260925-1617-fix-missing-plugin-runner-release/plan.md` remains `complete`: implementation and verification phases are complete, while release publication/advisory remain explicit next steps. No status change made.

## Standards and packaging invariant

Every published Linux release archive MUST contain all three inventory paths, including releases later installed as `web`:

| Archive path | Inventory role | Packaged mode / contract |
| --- | --- | --- |
| `bin/dam-hopper-plugin-runner` | `server` | Executable, `0755` |
| `systemd/dam-hopper-plugin-runner.service` | `server` | Regular file, `0644` |
| `tmpfiles.d/dam-hopper-plugin-runner.conf` | `server` | Regular file, `0644` |

The archive builder preflights the runner binary and both templates before staging, then copies them unconditionally. `check-release-assets.mjs` requires all three inventory paths, their `server` role and file kind, and an execute bit on the binary. The release workflow verifies the runner's version output, uploads it as a required build artifact, and restores executable mode before packaging. Missing any path is a release failure, not an optional-feature downgrade.

The archive-level invariant is separate from role projection: `server` and `both` views contain the `server`-role entries; the `web` view excludes them during extraction. The manifest generator emits `components.runner` and `services.runner` for release archives. Optional Rust manifest fields remain a local/test-fixture compatibility detail and MUST NOT weaken the publisher archive requirement.

## Release operator runbook and v0.5.1 advisory

The v0.5.0 Linux archive contains the runner service but omits its `ExecStart` binary. Candidate staging for `server` and `both` fails at `systemd-analyze verify`; web-only installs are unaffected. The published v0.5.0 bytes cannot be repaired by the source fix and must not be republished under the same tag.

Before cutting the required patch release:

1. Set Cargo and web package versions to `0.5.1`; verify the protected tag and both package versions align.
2. Run `node deploy/release/check-version-alignment.mjs v0.5.1` and `pnpm release:verify`.
3. Run `pnpm release:package-twice --version v0.5.1 --target-dir artifacts/bin --web-dist apps/web/dist --output-dir artifacts/final`, then `node deploy/release/check-release-assets.mjs --profile linux --tag v0.5.1 --dir artifacts/final`.
4. Inspect the archive and manifest: runner binary mode `0755`; service and tmpfiles files mode `0644`; all three entries have `server` role. Missing paths must fail packaging or the asset gate.
5. Run the tagged workflow's dry run, then publish protected `v0.5.1` only after package-twice, manifest, asset, and attestation gates pass. Post an operator notice with the patch release.

Recommended notice: “Linux v0.5.0 omitted `bin/dam-hopper-plugin-runner` although its systemd unit was present. Linux `server` and `both` staging fails unit verification. Use v0.5.1 or later for these roles; web-only installs are unaffected.” Until v0.5.1 is published, operators must not use v0.5.0 for Linux `server` or `both`; after publication, stage the exact v0.5.1 bundle using the normal release-manager flow. Do not hand-edit the unit or substitute an unversioned binary.

## Gaps, recommendations, and metrics

- **Release follow-up (P1):** publish v0.5.1 and distribute the advisory; source metadata remains v0.5.0 at review time.
- **Validation-tool follow-up (P2):** the docs validator checked 39 files and found all 637 internal links valid, but also emitted 1,515 code-reference and 363 uppercase/config-token advisories. Its default source roots omit this monorepo's `server/src`, `apps`, and `packages` trees, and its config heuristic compares uppercase tokens to root `.env.example`; review these as validator limitations, not resolved documentation defects.
- **Size debt (P2, outside this change):** existing `docs/code-standards.md` (2,466 LOC), `docs/api-reference.md` (2,654), `docs/configuration-guide.md` (1,408), and `docs/frontend-components.md` (1,573) exceed the 800-LOC target. No content was added to those pages. Split before future expansion.
- **Coverage/update metrics:** Seven existing documentation pages updated; all
  seven remain below 800 LOC. The repository defines no documentation-coverage
  percentage or update-frequency metric, so neither is asserted. Recommended
  cadence: update release docs whenever the packaging contract changes.

## Unresolved questions

- Should the full real `release:package-twice` gate run on every pull request, rather than only in the release pipeline? The plan records this as a separate CI-cost decision, not a prerequisite for v0.5.1.