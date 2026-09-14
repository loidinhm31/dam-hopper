# Host/config scout report

## Findings

- `server/src/config/schema.rs:347-375` defines `ServerConfig`, currently session persistence, telemetry, and `host_resources`; `DamHopperConfigRaw` defaults the whole `[server]` section at `382-392`. Add an opt-in idle-suspend subsection here, with strict validation/defaults and snake_case TOML compatibility. `server/src/config/resolve.rs` and `server/src/config/parser.rs` are the parse/resolve validation path to inspect when adding config tests.
- `server/src/state.rs:37-110` is the shared `AppState`; `host_resource_monitor` and `host_actions` are existing long-lived services. `AppState::new` at `180-284` constructs both from resolved config (`host_resources` at `199-203`, host-action audit directory at `204-209`) and is the natural wiring point for a new coordinator/service. Config reload code may replace `config` but does not rebuild services, so decide explicitly whether this feature is startup-only or supports live reload.
- `server/src/main.rs:296-316` starts monitor/sweep/proc/telemetry tasks and builds the router. `main.rs:325-371` owns SIGTERM/CTRL-C graceful shutdown and currently shuts down monitor, tunnels, browser artifacts, telemetry, then PTY/persistence. An idle-suspend coordinator should be started after state construction/restoration and have an explicit shutdown/cancellation/join before process teardown; avoid letting `rtcwake` run during shutdown.
- `server/src/host_actions/types.rs:4-24` is the typed allowlist (`DropCleanCaches`, `TerminateSameUserProcess`), with validation at `46-64`; `HostAction` has no suspend action. `server/src/host_actions/helper_client.rs:18-31` deliberately exposes only typed intents and currently uses `UnavailableExecutor`. `service.rs:35-65,93-170,296-360` provides approval, bounded queue, serialized executor, execution state, and audit lifecycle; `audit.rs` writes mode-0600 JSONL with bounded retention. The current API advertises `available: false` and only two action names, so an automatic idle suspend must not silently reuse this HTTP approval endpoint or invoke shell/sudo; either add a separate tightly-scoped local coordinator/helper design or keep the feature disabled until the privileged architecture gate is reopened.
- `server/src/api/host_actions.rs` and `server/src/api/router.rs:267-291` expose the existing authenticated action lifecycle/audit routes. They are relevant only if product explicitly chooses to integrate suspend into the typed action contract; no route currently exists for automatic policy execution.

## Docs and fixtures

- `docs/configuration-guide.md:185-212` documents `[server.host_resources]` and explicitly says action/helper/IPC/host-mutation settings remain deferred. The new plan must update this policy text only after security/product approval, documenting opt-in, Linux-only behavior, bounded delay, and fail-closed semantics.
- `docs/system-architecture.md:2239-2244` says existing lifecycle scaffolding has no privileged executor; `2376-2400` is the deferred remediation contract and explicitly prohibits sudo/polkit/PTY escalation, generic command execution, and automatic remediation. These are mandatory architecture/security constraints for any `rtcwake` design. `docs/system-architecture.md:2088-2108` documents AppState/startup/shutdown ownership.
- `__fixtures__/workspace/dam-hopper.toml:1-17` is the minimal workspace fixture and has no `[server]` section. Add config-parser/validation coverage using a temporary TOML fixture or extend this fixture only if the test suite convention requires it. Search tests that construct `DamHopperConfig`/`AppState` directly (`server/tests/common/mod.rs`, `server/tests/*`, `server/src/api/tests.rs`) because adding a non-optional struct field can break literals.

## Likely plan files

- Modify: `server/src/config/schema.rs`, `server/src/config/parser.rs` or config tests, `server/src/state.rs`, `server/src/main.rs`, and possibly a new `server/src/system/idle_suspend.rs` (policy/state machine) plus a separately reviewed executor/helper module.
- Modify tests: config parser/schema tests; service/coordinator tests using a fake executor; startup/shutdown tests if available; PTY/WebSocket terminal-count integration tests should verify the coordinator sees server-authoritative session lifecycle rather than UI presence.
- Modify docs: `docs/configuration-guide.md`, `docs/system-architecture.md`, likely `docs/api-reference.md` if a status/control API is added, and `docs/codebase-summary.md` after implementation.

## Validation signals

- `cargo fmt --check` / targeted `cargo test` for config and new coordinator modules; `pnpm check` only for cross-cutting changes.
- Verify default config keeps the feature disabled and rejects unsafe values (zero/overflow delay, unsupported platform/command mode, unknown keys if strict schema is retained).
- Verify no path reaches `sudo` or arbitrary shell execution; fake executor tests must cover no-terminal race, reconnect/restart, cancellation, and shutdown.

## Unresolved questions

- Is `sudo rtcwake -m mem -s 600` intended literally? This conflicts with the repository's current explicit prohibition on sudo/automatic remediation and should require a new architecture/security gate.
- What is the authoritative “no terminal running” event/state: PTY manager live-session count, persisted session state, or a debounced event stream? UI WebSocket presence must not be the safety authority.
- Should suspension be configured per workspace/server, and should a user-authenticated API arm/cancel it, or should it be a local operator-only policy?
