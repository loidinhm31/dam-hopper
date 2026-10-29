## Code Review Summary

**Status: changes requested. Approval: not yet.** Static review complete; no builds, tests, linters, or smoke runs executed in this review (main-agent verification ownership).

### Scope
Reviewed `server/src/auth/config.rs`, auth dispatch and affected tests/callsite in `server/src/main.rs`, all nine tests in `server/tests/auth_backend_startup.rs`, changed README/deployment/environment/auth architecture documentation, and `packages/ui/e2e/fixtures/application-services.ts`. Supporting evidence: `docs/code-standards.md`, PDR, `server/src/state.rs`, auth secret/store implementations, locked MongoDB 3.5.2 driver source. No plan assigned or updated.

### Findings

1. **High — startup MongoDB ping is not actually bounded.** `server/src/main.rs:630-640` awaits URI resolution and `run_command` without an application deadline. Driver `serverSelectionTimeoutMS` bounds server selection, not waiting for a selected server to reply. Locked driver `mongodb-3.5.2/src/cmap/conn.rs:257` directly awaits the response read; its `client/options.rs:1022-1029` explicitly says socketTimeoutMS is unsupported. A server that completes hello but stalls ping can leave startup hanging indefinitely, contrary to `docs/configuration/server-environment-auth.md:81` and changelog. **Correction:** apply an explicit finite `tokio::time::timeout` to startup URI-resolution/connectivity work, fail closed on expiry, and cover stalled-response behavior. Current unreachable test (`server/tests/auth_backend_startup.rs:291-318`) exercises only refused connections with URI-provided short selection/connect timeouts. **Confidence: high.**

2. **Medium — credential redaction does not cover startup driver errors (remaining risk, not newly introduced by selection).** `server/src/main.rs:632-639` interpolates raw driver Display errors into fatal output. Redacting `AuthBackendConfig::Debug` does not protect these paths. Driver URI parsing echoes invalid addresses (`client/options.rs:307-310`); for example malformed `mongodb://user:supersecret` is interpreted as a host/invalid port and includes `user:supersecret` in the error. This violates secret-exclusion expectations in `docs/code-standards.md:35`. **Correction:** emit non-sensitive configuration/connectivity categories rather than arbitrary driver text, or apply proven redaction before output; add a malformed-secret URI stderr regression. **Confidence: high, source-derived; not runtime-exercised.**

3. **Medium — successful-startup subprocesses leak on assertion/HTTP failures.** Examples: `server/tests/auth_backend_startup.rs:191-195,357-364` assert readiness before killing/reaping the child; `:148-165` performs fallible assertions and requests before cleanup. `std::process::Child` does not kill on Drop. A readiness timeout or failed assertion can leave the server running after its temp directory is removed. Blocking `cmd.output()` failure tests also lack a harness deadline. **Correction:** use a kill-and-wait RAII child owner and bounded process completion; keep diagnostic output on timeout. **Confidence: high.**

4. **Medium — canonical docs still specify the retired selection contract.** `docs/system-architecture.md:354` says unset/empty/false/0 selects MongoDB and forbids automatic detection. `docs/project-overview-pdr.md:14,29` and `docs/project-roadmap.md:34` still call MongoDB the default; `docs/linux-systemd.md:196` labels MongoDB and SQLite both default. These contradict the changed resolver and operator guidance. **Correction:** synchronize current architecture/PDR/roadmap/deployment descriptions with the new precedence matrix; retain historical changelog entries unchanged. **Confidence: high.**

### Invariants and positive observations
- Pure selector correctly distinguishes genuinely absent Mongo variables from empty/whitespace/non-Unicode values; malformed/partial values fail rather than silently selecting SQLite.
- Explicit true/1 takes precedence and ignores Mongo inputs, including malformed inputs. Explicit false/0 requires Mongo configuration. Empty/whitespace selector retains automatic selection semantics.
- Startup dispatch has no MongoDB-to-SQLite connection fallback; `--no-auth` skips both storage paths.
- URI-bearing config Debug is redacted and regression-covered. Errors for selector/environment classification avoid echoing environment values.
- SQLite path resolution, subsystem collision checks, production MFA validation, and selected-store ownership are preserved. Mongo index warning policy remains intentionally unchanged.
- Unit coverage includes selection forms, invalid/non-Unicode values, path failures, precedence and alias collisions; process coverage includes default/forced SQLite, missing/partial/blank Mongo, refused Mongo, production MFA presence, and no-auth bypass.

### Recommended acceptance checks (main agent)
- Run Rust backend selector tests, server binary tests, and `auth_backend_startup` suite after fixes; run the repository-supported compile/lint gates.
- Add/exercise bounded stalled-ping and credential-safe fatal-output cases; verify successful authenticated Mongo startup through existing real-Mongo fixture coverage.
- Harden subprocess cleanup before relying on failing-startup regression behavior.

### Unresolved evidence
Runtime/build/test results not established by this review. Successful real-Mongo startup and stalled ping behavior were not exercised here; findings above are grounded in repository and locked-driver source inspection.
