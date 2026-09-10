# Phase 01 — Operator policy and shared contracts

## Context links

- [Plan](plan.md), [normative contract](design-contract.md).
- [Architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture), [configuration schema](../../server/src/config/schema.rs), [startup policy](../../server/src/idle_suspend/policy.rs).
- Produces contracts consumed by [PTY seam](phase-02-pty-observation.md), [discovery](phase-03-process-discovery.md), [TCP observer](phase-04-tcp-observation.md), and [coordinator](phase-05-sampler-coordinator.md).

## Overview

- Date: 2026-09-10.
- Description: add explicit startup-owned policy selection and bounded executable configuration without changing existing deployments or timing authority.
- Priority: P2. Estimated implementation effort: 6h.
- Implementation status: DONE — 2026-09-11. Review status: user validation incorporated; implementation contract review remains required.
- Progress: 100% (11/11 implementation steps; 8/8 todo items).
- Dependencies: none. This phase freezes interfaces; it does not enable a partially implemented observer.

## Key Insights

- `IdleSuspendConfig` is compared as a whole when full-config changes are admitted. Adding fields without preserving them in manually reconstructed maps can silently reset policy.
- Startup policy is copied back into configuration in config reload, settings reload, and workspace activation. All three paths must retain new fields.
- Canonical TOML writing is manual in `config/parser.rs`; serde JSON aliases alone do not implement persistence.
- Browser command recognition is command-text UX, not process identity evidence. Do not import its regex/pattern model into server suspend configuration.
- Live-terminal automatic suspension is a behavior change. Keeping `empty-fleet` default avoids silently changing an already-enabled host after upgrade.

## Requirements

1. Add enum `IdleSuspendAutomaticPolicy::{EmptyFleet, AgentActivity}`, serialized as `empty-fleet` and `agent-activity` respectively; default `EmptyFleet`.
2. Add config `automatic_policy` / JSON `automaticPolicy` and `agent_executables` / JSON `agentExecutables`. Preserve existing camelCase serialization and snake_case TOML aliases.
3. Default executable entries: `codex`, `omp`, `claude`, `agy`. Entries are literal, case-sensitive basenames or normalized absolute paths, never regular expressions.
4. Validate 1–32 unique entries and 1–256 UTF-8 bytes each. Reject whitespace/control/NUL, shell/glob/regex syntax, relative slash-containing paths, `.`/`..` path components and broad interpreter names. Reject invalid input rather than silently normalizing, dropping duplicates or expanding environment variables.
5. For implementation clarity, permit only ASCII letters, digits, `_`, `-`, `.`, `+`, `@` in each literal path component, with `/` only as the separator in absolute paths. No trailing/repeated `/`. The 256-byte cap remains byte-based. This conservative literal grammar intentionally excludes paths containing spaces or pattern metacharacters; operator can use a qualifying basename instead.
6. Reject generic interpreter basenames even in absolute paths: `node`, `nodejs`, `bun`, `python`, versioned `python` names, `sh`, `bash`, `dash`, `zsh`, `ksh`, `fish`. Agent matching never treats the interpreter itself as the configured agent. A script entrypoint with a generic name needs an explicit path; phase03 specifies resolution.
7. Both fields are immutable for the running server, including full-config PUT/import/reload/workspace change. Timing remains the only existing runtime mutation: full bounded pair, same defaults and ranges.
8. Do not change enabled default, enrollment, helper protocol, capability selection, auth, or the exact timing-handoff conflict.
9. User confirmed the existing 900-second (15-minute) quiet default and explicit startup opt-in. Keep automatic `enabled = false` by default and `empty-fleet` for omitted policy, including upgrades. Do not add new-install migration exceptions.
10. Blocked-measurement warnings are read-only status, not configuration. Add no warning settings or limits to TOML/UI. The validated warning exposes PID, continuous blocked duration and qualified executable identity without arguments only through authenticated/no-store status; Phase03–06 own this projection. Matcher lists remain private to startup authority.

## Architecture

Configuration flow:

`TOML/JSON -> IdleSuspendConfig::validate -> StartupIdleSuspendPolicy -> coordinator/observer`

Keep enum/config validation in `config/schema.rs`. Phase01 implements private `AgentExecutableSet` in `idle_suspend/policy.rs`: validated literal entries tagged basename versus absolute path, compiled once and retained by `StartupIdleSuspendPolicy`. Phase03 borrows this set per sample. No regex engine, registry, cache persistence or per-sample config parsing.

Shared private interface responsibility:

| Boundary                                                       | Owner   | Contract                                                      |
| -------------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| Policy enum and executable validation                          | Phase01 | Startup immutable, canonical TOML, no runtime mutation        |
| `ProcessIdentity`, `TerminalIdentity`, PTY observation handles | Phase02 | PID + start ticks; session + incarnation; raw atomic counter  |
| Process/owned-socket snapshots                                 | Phase03 | Complete bounded ownership or typed unavailable               |
| Socket counters and coverage                                   | Phase04 | Cookie/family/namespace identity; per-socket cumulative bytes |
| `ActivityObservation`, opaque claim ticket, public status DTO  | Phase05 | Contract fields, monotonic revisions, single admission owner  |
| Client DTO/display mapping                                     | Phase06 | Consume frozen status, missing old-server fields mean legacy  |

Only define types when their owning phase implements real behavior. Do not land placeholder collectors or report available before qualification. Phase03/04 agree typed owned-socket input and bounded diagnostic ownership before concurrent coding; Phase04 never duplicates matching. Private process/start/terminal/socket identity structures and matcher lists are not public. The sole diagnostic projection is an attributable PID plus safe executable identity in authenticated `measurementWarning`, never arguments, logs or audit fields.

Shared module boundary: Phase03 owns creation of `idle_suspend/activity/mod.rs` and common `ActivityUnavailable`; Phase04 owns its network implementation files and supplies module declarations to the Phase03 owner. After both integrate, Phase05 becomes the sole owner of `activity/mod.rs`. No concurrent edits to the same module root.

## Related code files

Modify:

- `server/src/config/schema.rs`: enum, fields, defaults, validation.
- `server/src/config/mod.rs`: existing exports as needed, no compatibility aliases.
- `server/src/config/parser.rs`: `server_to_toml` idle-suspend table, explicit canonical fields.
- `server/src/idle_suspend/policy.rs`: `StartupIdleSuspendPolicy` immutable fields and construction.
- `server/src/api/config.rs`: `preserve_and_reject_idle_suspend_mutation`, reload policy copy.
- `server/src/api/settings.rs`: reload policy copy.
- `server/src/api/workspace.rs`: activation policy copy.
- `server/src/config/tests.rs`, `server/src/api/tests.rs`, `server/src/idle_suspend/tests.rs`: observable regressions and affected struct construction.
- `server/src/state.rs`: startup construction only if validation/compiled policy requires it.

Inspect, preserve unless contract requires a change:

- `server/src/idle_suspend/timing_store.rs`: timing-only persistence must preserve the new TOML fields and unrelated content.
- `packages/ui/src/api/client.ts`: existing config type; Phase06 owns any necessary additive TypeScript declarations.

No helper/deployment changes in this phase. Operator documentation lands after runtime proof in Phase08.

## Implementation Steps

1. Read complete affected config and policy sections. Run LSP references on exported `IdleSuspendConfig` and `StartupIdleSuspendPolicy` before modification when the language server is available; collect every struct literal and mutation path. Fall back to repository search only if no server is available.
2. Add the enum and fields using adjacent serde/default conventions. Validate both modes' executable lists consistently; do not allow invalid latent agent policy even when disabled.
3. Implement a single bounded entry validator. Validate lexical syntax only: do not require executable existence at config load, resolve symlinks globally, launch commands or inspect another user's home. The same config may start before an agent is installed.
4. Extend immutable startup policy. Store owned entries once; sample code borrows them. Keep `from_config` consistent with existing validated construction instead of creating another authority route.
5. Extend manual TOML serialization. An omitted entire idle-suspend table retains existing defaults. Nondefault policy/list survives read-write-read; keys remain snake_case.
6. Extend full-config preservation maps and all startup-policy overlay paths. Omitted protected block preserves current values; a changed block is rejected. Reloading a file with different policy does not alter the running policy; restart is the deliberate application point.
7. Keep timing PATCH and its store narrow: updating the timing pair must retain policy/list, enrollment, unrelated sections and atomic-write failure semantics. Never grant timing endpoint authority over matchers.
8. Migrate affected struct literals and frontend config declarations through their designated owner. Default-valued construction in tests should use existing fixture builders where appropriate; do not add tests pinning field-copy implementation details.
9. Extend behavioral tests for mutation rejection/preservation and TOML round trips. Use a compact boundary set, not dozens of redundant parameter rows.
10. Run the focused phase gate only once edits have integrated. Do not start agent-activity mode operationally until phases02–07 pass.
11. Hand off validated policy defaults and the read-only warning boundary: no configuration field is added for reports, no new endpoint, and no mutation surface gains matcher authority. Preserve observer-only qualification with `agent-activity, enabled = false` in Phase05.

## Todo list

- [x] Add policy enum and bounded literal executable validation.
- [x] Preserve defaults and canonical TOML/JSON naming.
- [x] Freeze new fields in startup policy.
- [x] Migrate every protected config and reload path.
- [x] Verify timing writes preserve non-timing configuration.
- [x] Migrate affected constructors and contract consumers.
- [x] Preserve validated 15-minute default and explicit startup opt-in without warning settings.
- [x] Pass focused configuration and authority regressions.

## Success Criteria

Observable cases to keep as regressions:

- Old config behaves identically and selects empty-fleet without requiring new keys.
- Explicit agent policy and custom entries survive canonical TOML round trip.
- Invalid or duplicate entries fail with actionable validation errors; no pattern execution.
- Full-config request cannot change either field; omitting the block does not erase them.
- Settings/config reload and workspace activation retain startup values; timing remains current runtime pair.
- A successful timing change preserves list/policy on disk; failed atomic write changes neither runtime pair nor protected values.

Future commands, from repository root:

```sh
cargo test --manifest-path server/Cargo.toml config::tests
cargo test --manifest-path server/Cargo.toml startup_idle_suspend_policy
cargo test --manifest-path server/Cargo.toml idle_suspend
```

The implementation owner must ensure any newly named tests are included by these filters; zero matched tests is not proof. Broad gates belong Phase07. No current test result is claimed by this plan.

## Risk Assessment

- Manual serialization missing a field: highest regression risk; round-trip and runtime-overlay checks address it.
- Large or permissive lists turn matching into broad service detection: hard caps and literal grammar prevent this.
- Startup policy duplicated in several current paths: extend existing authority pattern consistently, do not add another registry or generalized config framework.
- Grammar may exclude unusual executable paths: deliberate conservative limitation, documented rather than silently interpreted.

## Security Considerations

- No regex evaluation, shell expansion, process launch, network lookup or filesystem traversal from configuration validation.
- Keep matcher lists, arguments and raw configuration paths out of activity status/audit. A qualified basename or necessary exact configured executable path may appear only as one attributable process's safe identity inside authenticated `measurementWarning`; this is not exposure of the matcher list. Existing authorized full-config representation is unchanged in scope.
- No new endpoint or privilege; existing auth and timing origin defenses remain.

## Next steps

Phase02 implements the PTY evidence boundary. Phases03/04 may proceed concurrently only after their shared ownership snapshot types are agreed. Hand off the final enum, validator behavior and protected-callsite inventory; do not hand off a partially enabled observer.

## Unresolved questions

None blocking the design. Literal path support is intentionally conservative; relaxing it would require an explicit contract change and new boundary analysis.
