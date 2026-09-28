# Documentation Closeout — Agent Store Settings and Install Path

**Date:** 2026-09-28  
**Plan:** [Agent Store paths and notifications](../260928-2225-agent-store-settings-install-path/plan.md)  
**Status:** Documentation updates complete; plan recorded as completed (4/4 phases, 100%) by explicit project approval. This closeout does not claim that every original acceptance criterion is implemented or independently qualified.

## Current State Assessment

The Agent Store now presents **Store / Memory Files / Agent Settings / Import**. Agent Settings replaces the former Integrations tab and the notification panel was removed from Appearance. The UI obtains server-side path eligibility from `GET /api/agent-status/paths`; OMP eligibility requires configured/runtime path equality and a current managed extension, while Codex eligibility requires matching reported paths and an existing `config.toml`.

The documentation describes important boundaries rather than promising full fail-closed delivery:

- `~/` expansion and runtime-path selection use server-side identity/environment rules, not the browser user's home or each PTY's environment.
- The save-time API gate rechecks OMP path and extension status. Codex save-time validation requires the configured `config.toml` but does not independently compare it with `CODEX_HOME`.
- Notification dispatch checks the persisted `enabled` preference and does not revalidate path eligibility. A previously enabled preference can remain active after its path or installation becomes invalid.
- Filesystem operations are constrained by the API service account's actual permissions.

The plan frontmatter and implementation status record completion, while the project-manager closeout preserves the remaining review risks and the distinction between administrative completion and verified acceptance.

## Changes Made

- Updated [Agent Status architecture](../../docs/architecture/agent-status.md) with the Agent Settings tab cutover, path-inspection endpoint, path expansion/runtime-path semantics, exact (non-canonicalized) path comparison, OMP/Codex eligibility rules, backend save-time checks, permissions boundary, and dispatch-time limitation.
- Added the 2026-09-28 entry to [CHANGELOG.md](../../docs/CHANGELOG.md). To keep the current changelog below the 800-line target, moved entries dated 2026-09-12 and earlier into [CHANGELOG-archive.md](../../docs/CHANGELOG-archive.md); the archive links back to the current changelog.
- Refreshed the Agent Store and Agent Status entries in [codebase-summary.md](../../docs/codebase-summary.md) from the generated `repomix-output.xml` compaction. Repomix included 2,368 files; its security scan excluded five files from full compaction, so source and focused tests remain authoritative.
- The project manager separately updated [configuration-guide.md](../../docs/configuration-guide.md) and [linux-systemd.md](../../docs/linux-systemd.md) with the path settings and API identity/access guidance.
- The project manager's [final status report](./project-manager-260928-2335-agent-store-settings-final.md) records the plan closeout and implementation evidence.

## Gaps Identified

1. **Runtime notification eligibility remains unverified at dispatch.** Saved enabled policy can outlive a path, config, or extension change. Do not describe this implementation as fail-closed delivery.
2. **Codex eligibility has a narrower check than the plan proposed.** The path endpoint uses `config.toml.is_file()`; it does not prove readability or valid TOML. The save-time policy gate also does not compare the configured Codex path to `CODEX_HOME`.
3. **The path check is not PTY-specific.** API-process runtime environment and resolved server home may differ from per-terminal overrides. The API service identity may also lack access to a user's private agent files.
4. **Original filesystem constraints are not all met.** The OMP install endpoint can create a missing target directory. The project-manager report also records that Agent Settings does not consume `profileId` and uses draft paths for actions rather than requiring the saved verified path.
5. **Documentation size warning remains.** Current measured sizes: `configuration-guide.md` 1,474 lines and `linux-systemd.md` 855 lines, above the 800-line target. Both already exceeded the target before the narrow updates recorded here; they were left intact at Main's direction. The touched docs are below the limit: current changelog 301, archive 539, architecture 242, codebase summary 798 lines.
6. **Validator warnings need triage.** The docs validator checked 42 files and reported 745 working internal links, plus 1,461 potential code-reference issues and 372 potential config-key issues. Its examples include historical code names in the archived changelog and `CODEX_HOME` absent from `.env.example`; the latter is a host runtime override, not an application config key. Warnings are heuristic and the validator exits successfully even when warnings remain, so the counts are not a documentation-coverage score.

## Recommendations

1. Before relying on fail-closed notification delivery, gate dispatch against current owner/path eligibility and explicitly compare Codex's selected path with its effective runtime path; retain the present caveat until then.
2. Tighten Codex file safety/validity checks and OMP install behavior to match the accepted filesystem contract, or explicitly record any product decision to retain the current behavior.
3. Preserve the reported 800-line warning for the already-oversized configuration and Linux guides. They were left intact at Main's direction; avoid adding further content unless the size policy is resolved separately.
4. Triage validator warnings against source and refine its code-reference/config-key rules or add a documented exception mechanism. Keep the passing internal-link result as the actionable automated check meanwhile.
5. Capture a live service-identity smoke for access to the selected paths, install/status lifecycle, and an actual notification before claiming those production behaviors qualified.

## Metrics and Maintenance

| Metric | Result |
|---|---|
| Documentation files checked | 42 |
| Internal links validated | 745 working |
| Potential code-reference warnings | 1,461 |
| Potential config-key warnings | 372 |
| Measured documentation coverage percentage | Not available; no coverage instrument is defined by the validator |
| Latest documented update | 2026-09-28 |
| Files under 800 LOC among measured closeout docs | 4 of 6; `configuration-guide.md` and `linux-systemd.md` exceed the target |

No project-wide tests or builds were run for this documentation-only assignment. The plan's targeted implementation test evidence is summarized in the linked project-manager report and test report, not rerun here.
