# Test Validation Report: Phase 01 Policy and Configuration Contracts

- Date: 2026-09-11
- Phase: Phase 01: Policy/configuration contracts
- Target: `server` crate (`dam-hopper-server`)
- Status: PASSED (100% pass rate)

## Test Results Overview

| Test Command | Scope | Passed | Failed | Filtered | Pass Rate |
|---|---|---|---|---|---|
| `cargo test --manifest-path server/Cargo.toml config::tests` | Config unit/parsing tests | 82 | 0 | 1091 | 100% |
| `cargo test --manifest-path server/Cargo.toml startup_idle_suspend_policy` | Startup policy workspace switch preservation | 1 | 0 | 1172 | 100% |
| `cargo test --manifest-path server/Cargo.toml idle_suspend` | Idle-suspend unit & integration tests | 86 (72 lib + 14 int) | 0 | 1087 | 100% |
| `cargo test --manifest-path server/Cargo.toml test_agent_executables` | Agent executable grammar and list validation | 1 | 0 | 1172 | 100% |
| `cargo test --manifest-path server/Cargo.toml config_put_rejects` | PUT config immutability rejection tests | 3 | 0 | 1170 | 100% |

Total test runs across 5 suites: 173 passed, 0 failed, 0 skipped/ignored.

## Command Execution Details

1. `cargo test --manifest-path server/Cargo.toml config::tests`
   - Command result: 82 passed, 0 failed (0.01s lib test execution)
   - Verifies configuration discovery, parsing, roundtrips, path validations, and TOML formatting.

2. `cargo test --manifest-path server/Cargo.toml startup_idle_suspend_policy`
   - Command result: 1 passed (`api::tests::workspace_switch_preserves_startup_idle_suspend_policy`)
   - Verifies workspace switch preserves running startup idle suspend policy, automatic policy (`empty-fleet`), and default executables.

3. `cargo test --manifest-path server/Cargo.toml idle_suspend`
   - Command result: 86 passed (72 lib tests + 14 integration tests in `tests/idle_suspend.rs`)
   - Covers `IdleSuspendAutomaticPolicy` serialization, `AgentExecutableSet` validation, TOML roundtrip with custom executables and agent-activity policy, timing bounds, immutability, coordinator lifecycle, and force suspend.

4. `cargo test --manifest-path server/Cargo.toml test_agent_executables`
   - Command result: 1 passed (`idle_suspend::tests::test_agent_executables_validation`)
   - Validates syntax grammar: ASCII charset, absolute vs basename, rejection of relative slashes, `.`, `..`, globs/regex, trailing/repeated slashes, 1-32 list length bounds, 1-256 byte bounds, duplicate rejection, and generic interpreter rejection (`node`, `python`, `sh`, `bash`, etc.).

5. `cargo test --manifest-path server/Cargo.toml config_put_rejects`
   - Command result: 3 passed:
     - `api::tests::config_put_rejects_idle_suspend_delta`
     - `api::tests::config_put_rejects_automatic_policy_delta`
     - `api::tests::config_put_rejects_agent_executables_delta`
   - Verifies full-config `PUT /api/config` rejects any delta modifying `automaticPolicy` or `agentExecutables` with 400 Bad Request.

## Failure Details

- None. 0 failures encountered.

## Build Warnings (Non-blocking)

- `src/idle_suspend/tests.rs:35:65`: unused imports `ManualAuditRecord` and `ServerAuditRecord`.
- `src/api/tests.rs:6938:9`: unused variable `state`.

## Phase 01 Requirements Verification

- [x] Req 1: `IdleSuspendAutomaticPolicy` enum (`EmptyFleet`, `AgentActivity`), serialized as `empty-fleet` / `agent-activity`, default `EmptyFleet`.
- [x] Req 2: Config fields `automatic_policy` / `automaticPolicy` and `agent_executables` / `agentExecutables` with snake_case TOML and camelCase JSON aliases.
- [x] Req 3: Default agent executables `["codex", "omp", "claude", "agy"]`. Literal case-sensitive basenames or normalized absolute paths.
- [x] Req 4 & 5: Validated 1-32 unique entries, 1-256 UTF-8 bytes each. Grammar permits ASCII letters, digits, `_`, `-`, `.`, `+`, `@`, with `/` only as separator in absolute paths. Rejects whitespace, control characters, globs/regex, relative slashes, `.`, `..`, trailing/repeated slashes.
- [x] Req 6: Generic interpreter rejection (`node`, `nodejs`, `bun`, `python*`, `sh`, `bash`, `dash`, `zsh`, `ksh`, `fish`) in basenames and absolute paths.
- [x] Req 7: Immutability on running server enforced across `PUT /api/config`, settings import, and workspace switch.
- [x] Req 8 & 9: Timing remains runtime-mutable via PATCH; defaults preserved (`enabled = false`, quiet 900s, wake 600s).
- [x] Req 10: Blocked-measurement warnings remain read-only status; no warning fields in configuration schemas.

All Phase 01 requirements confirmed met by tests.

## Unresolved Questions

- None.
