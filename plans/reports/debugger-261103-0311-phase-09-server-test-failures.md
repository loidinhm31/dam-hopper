# Phase 09 server test failure diagnosis

## Findings

1. **Compile blocker: stale telemetry fixture configuration.** `server/src/config/schema.rs:550-581,610-621` defines `ServerConfig` and its defaults without `telemetry`. Remaining fields: session database path/buffer TTL, host resources, workflow retention/staleness, idle suspend, session changes. The example already uses `ServerConfig { idle_suspend: ..., ..Default::default() }`; line 116 alone still dereferences removed telemetry. `server/src/config/tests.rs:127-150` explicitly tests legacy telemetry TOML is tolerated and ignored; that compatibility does not create a Rust struct field. Delete the assignment, do not restore telemetry or substitute an unrelated database field. Remove `mut` at line 96 because that assignment is the only configuration mutation. Authentication already uses a temporary SQLite `auth.db` at example lines 142-143.

2. **Runtime prerequisite: real MongoDB intentionally mandatory for SSE qualification.** Six tests in `server/tests/host_resource_sse_qualification.rs` call `AuthTestFixture::mandatory()` (lines 188, 249, 324, 382, 430, 461). `server/tests/common/auth_fixtures.rs:43-59,210-215` reads `TEST_MONGODB_URI`, defaults to `mongodb://127.0.0.1:27018`, constructs a client, and pings a UUID-named database. Invalid URI/client initialization or failed ping returns `None`; `mandatory()` panics rather than skipping. Thus the reported panic establishes failed client initialization/ping, not whether the variable itself was missing. No feature flag or ignore attribute gates these tests. SQLite application defaults, `DAM_HOPPER_LITE_MODE`, `MONGODB_URI`, and `--no-auth` do not replace this explicit Mongo fixture. Use a disposable test Mongo instance with database/index/write/drop permissions; do not suppress the qualification failure or swap its fixture to SQLite.

## Exact recommended source diff (not applied)

```diff
--- a/server/examples/agent_free_consent_fixture.rs
+++ b/server/examples/agent_free_consent_fixture.rs
@@ -96,1 +96,1 @@
-    let mut config = DamHopperConfig {
+    let config = DamHopperConfig {
@@ -116,1 +116,0 @@
-    config.server.telemetry.db_path = tmp.path().join("telemetry.db").display().to_string();
```

## Canonical test entrypoints

- `AGENTS.md:87-99`: `pnpm test`, equivalent to `cd server && cargo test`; Windows resource-limited variant adds `-j 1`.
- `package.json:27-29,47`: `test` and `test:run` both execute unrestricted `cd server && cargo test`; `check` ends with the same command after build/lint.
- `scripts/run-all-tests.sh:71-77`: calls `pnpm test` first; neither creates MongoDB nor sets its URI. `pnpm test:all` invokes this script.
- `.github/workflows/pr-quality-gate.yml:142-157,184-187`: Linux CI provisions `mongo:8.0`, waits on its ping healthcheck, exports `TEST_MONGODB_URI=mongodb://127.0.0.1:27017`, then runs unrestricted `cargo test`. `--lib --bins` there belongs to Clippy, not the full test invocation. Windows compiles all tests with `--no-run` then runs three focused `--lib` filters (lines 199-205).
- Unrestricted Cargo tests also compile examples; the stale example therefore blocks the canonical suite even though it is not itself an integration test. `--lib`, `--bins`, or `--test NAME` selects narrower targets, not a fix for the example or evidence of full-suite success. `--no-run` only avoids runtime prerequisites, not compilation errors.
- `scripts/qualify-host-resource-sse.mjs:182-196` launches a separate ignored **library live harness** with `--lib ... -- --ignored --exact`; it is not the runner or a skip flag for `server/tests/host_resource_sse_qualification.rs`.

## Verification commands for Main (not executed)

From repository root, after applying the diff:

```bash
# Compile the formerly broken example, then all default test targets.
cargo check --manifest-path server/Cargo.toml --example agent_free_consent_fixture
cargo test --manifest-path server/Cargo.toml --no-run

# Disposable local MongoDB; use Podman instead of Docker if appropriate.
docker run --detach --rm --name dam-hopper-test-mongo \
  --publish 127.0.0.1:27018:27017 mongo:8.0
until docker exec dam-hopper-test-mongo mongosh --quiet \
  --eval 'quit(db.runCommand({ping:1}).ok ? 0 : 1)' >/dev/null 2>&1; do
  sleep 1
done
export TEST_MONGODB_URI=mongodb://127.0.0.1:27018

# Focused runtime qualification, then canonical full server suite.
cargo test --manifest-path server/Cargo.toml \
  --test host_resource_sse_qualification
pnpm test

# Stop only the disposable container created above.
docker stop dam-hopper-test-mongo
```

For intentionally restricted unit-only diagnosis, `cargo test --manifest-path server/Cargo.toml --lib --bins` excludes the reported example and integration target; label results as partial, never the Phase 09 full test gate. No `cargo clean` needed for either diagnosed failure.

## Evidence / validation status

Read current schema/defaults, example, auth fixture, qualification callsites, test scripts, repository guidance, CI workflow. Accepted tester-reported failures as ground truth; did not rerun them. No builds/tests/checks executed; no source changes made. This report records recommendations, not a passing-test claim.

## Unresolved questions

- Tester environment's exact Mongo connection failure (unset variable/default-port mismatch versus invalid URI, stopped service, or ping/auth/network failure) is not distinguishable from the generic panic: the fixture discards the client/ping error. Not needed to determine the prerequisite or minimal source fix.
