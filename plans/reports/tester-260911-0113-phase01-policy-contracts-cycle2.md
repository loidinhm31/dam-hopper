# Test Validation Report: Phase 01 Policy & Configuration Contracts (Cycle 2)

- Date: 2026-09-11
- Phase: Phase 01: Policy/configuration contracts
- Target: `server` crate (`dam-hopper-server`)
- Status: PASSED (100% pass rate)

## Test Results Overview

| Test Command | Scope | Passed | Failed | Filtered | Pass Rate |
|---|---|---|---|---|---|
| `cargo test --manifest-path server/Cargo.toml config::tests` | Config unit/parsing tests | 82 | 0 | 1089 | 100% |
| `cargo test --manifest-path server/Cargo.toml startup_idle_suspend_policy` | Startup policy workspace switch preservation | 1 | 0 | 1170 | 100% |
| `cargo test --manifest-path server/Cargo.toml idle_suspend` | Idle-suspend unit (70) & integration (14) tests | 84 | 0 | 1087 | 100% |
| `cargo test --manifest-path server/Cargo.toml test_agent_executables` | Agent executable grammar and list validation | 1 | 0 | 1170 | 100% |
| `cargo test --manifest-path server/Cargo.toml config_put_rejects` | Full config PUT immutability rejection tests | 3 | 0 | 1168 | 100% |

Total across 5 suites: 171 passed, 0 failed, 0 ignored. 100% pass rate.

## Command Execution Details

1. `cargo test --manifest-path server/Cargo.toml config::tests`
   - Result: 82 passed, 0 failed (0.00s test execution)
   - Verifies config discovery, TOML serialization, path constraints, roundtrip integrity.

2. `cargo test --manifest-path server/Cargo.toml startup_idle_suspend_policy`
   - Result: 1 passed (`api::tests::workspace_switch_preserves_startup_idle_suspend_policy`)
   - Verifies startup idle suspend policy, `empty-fleet` policy, and default executables preserved across workspace switches.

3. `cargo test --manifest-path server/Cargo.toml idle_suspend`
   - Result: 84 passed (70 lib tests + 14 integration tests in `tests/idle_suspend.rs`)
   - Validates `IdleSuspendAutomaticPolicy` serialization, `AgentExecutableSet` validation, TOML roundtrips with custom executables and agent-activity policy, coordinator transitions, preflight checks, timing bounds, and force suspend flows.

4. `cargo test --manifest-path server/Cargo.toml test_agent_executables`
   - Result: 1 passed (`idle_suspend::tests::test_agent_executables_validation`)
   - Validates syntax grammar: ASCII charset, basename vs absolute path normalization, rejection of relative slashes, `.`, `..`, globs/regex, trailing/repeated slashes, 1-32 bounds, 1-256 byte limits, duplicate rejection, and generic interpreter rejection (`node`, `python`, `sh`, `bash`, etc.).

5. `cargo test --manifest-path server/Cargo.toml config_put_rejects`
   - Result: 3 passed:
     - `api::tests::config_put_rejects_automatic_policy_delta`
     - `api::tests::config_put_rejects_agent_executables_delta`
     - `api::tests::config_put_rejects_idle_suspend_delta`
   - Validates running server immutability: `PUT /api/config` delta on `automaticPolicy` or `agentExecutables` rejected with 400 Bad Request.

## Failure Details

- None. 0 failures encountered.
- Build warnings: 0 compiler warnings. Unused imports/variables from review clean.

## Phase 01 Requirements Verification

- [x] Req 1: `IdleSuspendAutomaticPolicy` enum (`EmptyFleet`, `AgentActivity`), serialized as `empty-fleet` / `agent-activity`, default `EmptyFleet`.
- [x] Req 2: Config fields `automatic_policy` / `automaticPolicy` and `agent_executables` / `agentExecutables` with snake_case TOML and camelCase JSON aliases.
- [x] Req 3: Default agent executables `["codex", "omp", "claude", "agy"]`. Case-sensitive basenames or normalized absolute paths.
- [x] Req 4 & 5: Validated 1-32 unique entries, 1-256 UTF-8 bytes each. Grammar permits ASCII letters, digits, `_`, `-`, `.`, `+`, `@`, `/` (absolute path separator). Rejects whitespace, control chars, globs/regex, relative slashes, `.`, `..`, trailing/repeated slashes.
- [x] Req 6: Generic interpreter rejection (`node`, `nodejs`, `bun`, `python*`, `sh`, `bash`, `dash`, `zsh`, `ksh`, `fish`) in basenames and absolute paths.
- [x] Req 7: Immutability on running server enforced across `PUT /api/config`, settings import, and workspace switch.
- [x] Req 8 & 9: Timing remains runtime-mutable via PATCH; defaults preserved (`enabled = false`, quiet 900s, wake 600s).
- [x] Req 10: Blocked-measurement warnings remain read-only status; no warning fields in configuration schemas.

All Phase 01 requirements confirmed met by tests.

## Unresolved Questions

- None.
