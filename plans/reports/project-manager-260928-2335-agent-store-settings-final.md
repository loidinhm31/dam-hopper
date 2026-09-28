# Project Manager Final Status — Agent Store Settings and Install Path

**Date:** 2026-09-28 23:57:01 +07:00  
**Plan:** [Agent Store paths and notifications](../260928-2225-agent-store-settings-install-path/plan.md)  
**Status:** Completed, 4/4 phases (100%), per explicit project approval.

## Executive Summary

Plan frontmatter and phases 1–4 now show `completed`, each timestamped `2026-09-28 23:57:01 +07:00`. The refactor adds the Agent Settings surface, path persistence/verification, and a server-side notification enablement gate. The plan and roadmap record closure and link this report.

This is an approved administrative close-out, not a claim that every detail in the original broad acceptance criteria was independently verified. Several review findings remain visible in current source and are listed below so the completed status does not conceal them.

## Achievements

- Agent Store tabs were cut over to Store / Memory Files / Agent Settings / Import; the old OMP extension manager and Appearance notification panel were removed.
- Added persisted OMP/Codex path choices, typed path verification transport, and the server `GET /api/agent-status/paths` contract.
- The server save-time gate now rejects OMP notification enablement when the selected install path differs from the runtime path or its managed extension is not current. Codex enablement requires an existing `config.toml`.
- Architecture and configuration/Linux guides now describe the implemented surface, save-time gate, and current limitations; the changelog records the feature, and the roadmap links this status report.

## Verification Evidence

The [targeted test report](./test-report-260928-2315-agent-store-settings-install-path.md) records:

| Validation | Result |
|---|---:|
| `cargo test --manifest-path server/Cargo.toml agent_status` | 17 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --test agent_status_runtime` | 8 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --test agent_status_integration` | 6 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml update_global_ui_at_path` | 12 passed, 0 failed |
| `pnpm --filter @dam-hopper/ui test` | 1,939 passed across 277 files |
| `update_global_ui_rejects_enablement_when_requirements_not_met` | Passed after the backend gate change, as reported by Main |
| Documentation validator | 42 files; 745 working internal links; 1,461 potential code-reference warnings; 372 potential config-key warnings |

No coverage measurement, standalone production build, or live production-service/user-home smoke is recorded in the test report.

The [documentation close-out](./docs-manager-260928-2357-agent-store-settings-final.md) classifies validator warnings as heuristic, not a coverage score. It also records that `configuration-guide.md` (1,474 lines) and `linux-systemd.md` (855 lines) remain above the 800-line target; both exceeded it before these narrow additions and were left intact at Main's direction.

## Review Findings and Risks

The [23:25 code review](./code-review-260928-2325-agent-store-settings-install-path.md) predates the new save-time backend gate, so its “missing backend policy gate” finding is superseded by that change and the passing focused test. Other findings remain relevant; source inspection for this close-out found:

1. `install_omp_extension` still creates a missing target directory, contrary to the plan's existing-directory constraint.
2. The GET verification endpoint treats `config.toml.is_file()` as sufficient; it does not establish readability, regular-file/no-symlink safety, or valid TOML. The backend save gate also does not independently compare the configured Codex directory with `CODEX_HOME`.
3. Notification dispatch still checks persisted `policy.enabled` rather than revalidating current path/profile eligibility. A stale enabled policy can therefore outlive a removed or mismatched runtime target.
4. `AgentSettings` accepts but does not consume `profileId`; path queries and install/remove actions use draft input rather than requiring the saved verified path. Draft changes also trigger path queries without debounce.
5. Production filesystem identity/permissions remain an operational constraint. The API service account cannot write a user's private config unless deployment uses the same OS identity or narrowly provisioned access.

These are not represented as passing acceptance checks. The completion timestamp records the explicit approved phase close-out; it does not remove the above risks or prove a live alert/install lifecycle.

## Next Steps and Quality Gates

- Before relying on fail-closed notifications in production, close or explicitly accept the dispatch-time eligibility and Codex runtime-path gaps.
- Remove arbitrary OMP target-directory creation and harden Codex config eligibility before treating filesystem safety requirements as complete.
- Add profile-switch and saved-path behavior coverage; use targeted tests for each remaining boundary.
- Perform a service-identity smoke against a provisioned target home: verify read/write permissions, install/status at one explicit OMP path, restart OMP in a DamHopper PTY, and observe the real notification behavior.
- Keep the review caveats linked from the plan and roadmap until resolved or explicitly accepted as release limitations.

## Unresolved Questions

- For production access to user-owned OMP/Codex files, will deployment run the API as the same OS identity as terminal users or provision narrow ACLs for the exact required directories?
