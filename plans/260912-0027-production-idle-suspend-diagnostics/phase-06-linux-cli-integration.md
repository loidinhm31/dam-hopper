# Phase 06 — Linux CLI, role-aware host adapters, atomic output and exit semantics

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md) · [Phase 05](phase-05-bundle-correlation-engine.md)
- [Collector research](research/researcher-02-collector-cli-contract.md)
- `server/src/linux_release/{cli.rs,layout.rs,privilege.rs,status.rs,systemd.rs,process.rs,health.rs}`
- `server/src/bin/dam-hopper.rs` · `server/src/api/idle_suspend.rs`

## Overview

- Date: 2026-09-12
- Description: expose `dam-hopper diagnose --json`; add fixed role-aware systemd/journal/local-API/current-probe adapters; safely write the bundle and map complete/partial/fatal exits.
- Priority: P1
- Implementation status: pending
- Review status: Linux security/CLI/output review required
- Effort: 16h
- Ownership: Linux diagnostics owner edits CLI/privilege/layout and creates host adapters/output. One binary-dispatch owner handles stdout/exit behavior.
- Dependency: Phase 05 collector interfaces and bundle schema approved.

## Key Insights

- Current `dam-hopper` privilege gate runs before dispatch; `Diagnose` must explicitly permit non-root without weakening mutating commands.
- Existing systemd helpers accept arbitrary strings and health journal code returns raw text. Diagnostics needs a closed command enum and sanitized structured output.
- API is latest-only and may be unavailable/auth-required. It is attempted through fixed loopback only, never historical authority.
- Safe output means same-directory exclusive temp, `0600`, file sync, atomic rename, directory sync; partial bundle still prints a path.

## Requirements

- Add exactly `dam-hopper diagnose --json`; `--json` required. No since/output/source/unit/URL/command/verbosity/upload option.
- Sample EUID once. Never execute sudo/setuid/pkexec. Non-root applicable helper audit is `permissionDenied` and exit `2` after valid bundle write.
- Load role only from `Layout::host_config_path`; unknown/invalid role is partial and never converts absent units to `notApplicable`.
- Commands limited to exact API/helper unit properties, exact per-unit journal window, inhibitors. Fixed executable/argv, null stdin, locale `C`, 5-second timeout, byte cap, discarded/sanitized stderr, no shell.
- Local API uses fixed loopback endpoint/token path, bounded body/deadline, no redirects/external egress. Auth failure is `authRequired`; status marked latest.
- Current probes are read-only: boot identity, fixed PID/enrollment/socket metadata, RTC wakealarm content/ownership, `/sys/power/state` capability, inhibitor aggregate, bounded proc accessibility and netlink diagnostic capability/counts. Label non-historical; omit identities/text/addresses.
- Use `TargetRole::includes_server` for applicability. Web-only idle sources are `notApplicable`.
- Root output fixed under `Layout::diagnostics_dir`; non-root under safe resolved user state directory. Directory `0700`, final `0600`, no-follow/ownership checks, exclusive temp, sync/rename/sync-dir.
- Stdout exactly absolute final path plus newline for exits `0`/`2`; sanitized bounded stderr only; exit `1` prints no stdout.
- No adapter mutates RTC, suspend, systemd, source logs, config, socket, PID enrollment, or service state.
- Tests fake commands/API/clock/EUID/files/probes/output. Non-goals: generic command/provider plugins, daemon, automatic retry/upload, terminal output, live suspend.
- Rollback: old binary lacks command; producer files remain. No new service/unit or configuration cleanup required.

## Architecture

- `DiagnoseArgs { json: bool }` and `Commands::Diagnose` route to `run_diagnose(layout, adapters)` before any human-oriented prints.
- `CollectorAdapters` has narrow typed seams: `Clock`, `EuidProvider`, `ReadOnlyFileSystem`, `HostCommandRunner` over closed `HostCommand`, `LocalIdleStatusClient`, `CurrentHostProbeReader`. Production and fakes implement only these fixed capabilities; no registration/runtime plugin.
- `HostCommand::{ShowApiUnit,ShowHelperUnit,JournalApi,JournalHelper,ListInhibitors}` compiles internally to fixed argv and caps.
- Systemd properties retained: `ActiveState`, `SubState`, `MainPID`, `ExecMainStatus`, `Result`, `InvocationID`, active/exit timestamps; journal projection retains only fixed metadata, never `MESSAGE`.
- Output writer receives already bounded bytes and returns absolute path only after durable rename/directory sync.

## Related code files with modify/create/delete and dependency

| Action | Path/symbol | Planned change | Dependency |
| --- | --- | --- | --- |
| Modify | `server/src/linux_release/cli.rs::{Commands,DiagnoseArgs}` | Add required `diagnose --json` grammar | Contract |
| Modify | `server/src/linux_release/privilege.rs::verify_privileges` | Permit non-root Diagnose only; preserve root requirements elsewhere | CLI variant |
| Modify | `server/src/linux_release/layout.rs::Layout` | Exact source/root-output/token/RTC/PID/socket path helpers, root-testable with `with_root` | Phase 01 paths |
| Create | `server/src/linux_release/diagnostics/host_commands.rs` | Closed command compiler/runner/parser with timeout/caps | Phase 05 model |
| Create | `server/src/linux_release/diagnostics/local_api.rs` | Fixed authenticated loopback status client | Status DTO |
| Create | `server/src/linux_release/diagnostics/host_probes.rs` | Read-only fixed host probes and fake seam | Existing proc/netlink/preflight patterns |
| Create | `server/src/linux_release/diagnostics/output.rs` | Safe directory/temp/mode/sync/rename writer | Bounded bundle bytes |
| Modify | `server/src/linux_release/diagnostics/collector.rs` | Orchestrate typed adapters and role applicability | New adapters |
| Modify | `server/src/linux_release/mod.rs` | Export Diagnose args/run entry narrowly | Integration complete |
| Modify | `server/src/bin/dam-hopper.rs::main` | Dispatch with zero extra stdout; map `0/2/1` | CLI/run result |
| Modify | module-local/CLI integration tests | Grammar, command allowlist, role/EUID/API/probes/output/exits | Production adapters |
| Delete | None | No unit/service/source removed | — |

## Implementation Steps

1. Add Clap variant/args; prove missing `--json`, extra positional/URL/output/source/since flags fail parse while exact command succeeds.
2. Update privilege match explicitly: Diagnose allowed any EUID; every existing mutation retains current rules. Add regression around all command variants.
3. Add root-aware `Layout` getters for fixed inputs/output and use `with_root` in tests. Add safe non-root user-state resolver without `/tmp` fallback.
4. Implement closed command enum/production runner with kill-on-timeout, null stdin, locale C, bounded stdout, sanitized exit. Parse allowlisted unit/journal/inhibitor fields only.
5. Implement local API client: fixed `127.0.0.1:4801` status route, fixed token read into header memory, no redirect, bounded response/deadline. Drop token before errors/model.
6. Implement current probes using read-only opens/existing parsers; snapshot before output write, label collection time/non-historical, retain only allowed aggregates.
7. Compose role/EUID/files/commands/API/probes into independent source attempts; one failure does not abort others. Non-applicable sources are not opened/commanded.
8. Serialize bounded bundle, choose root/non-root fixed destination, verify owned non-symlink directory, create exclusive temp `0600`, write/sync, rename, sync directory. Clean temp on failure where safely owned.
9. Dispatch command without generic status/progress prints. Return path/exit class; binary prints path only after success, stderr only on warnings/fatal.
10. Add fake-backed scenarios: root complete; non-root partial/no sudo; web role all notApplicable; unknown role partial; API auth/down; command timeout/oversize/exit; malformed journal; unsafe output dir/symlink; write/rename/sync failures; exact stdout/stderr/exits; source metadata unchanged.
11. Run focused commands: `cargo test -p dam-hopper-server linux_release::diagnostics`, CLI parse tests, and `cargo test -p dam-hopper-server --bin dam-hopper`. Perform security review of subprocess/network/filesystem surfaces.

## Todo list

- [ ] Add exact CLI grammar and privilege exception.
- [ ] Add fixed layout/role/EUID resolution.
- [ ] Add closed systemd/journal, API, and host-probe adapters.
- [ ] Add atomic root/non-root output writer.
- [ ] Wire path-only stdout and exit `0/2/1`.
- [ ] Complete fake-backed fault/security review.

## Success Criteria

- Root server-role fake produces complete valid `0600` bundle, stdout one absolute path, exit `0`; non-root produces valid helper-denied partial, no sudo call, same stdout contract, exit `2`.
- Unsafe/unwritable/symlink destination or serialization/write/rename/sync failure prints no stdout and exits `1` without partial final file.
- Web role never probes server/helper sources and marks them `notApplicable`; unknown role cannot do so.
- Fake runner observes only fixed commands/argv, null stdin, locale/deadline/caps; fake API observes only fixed loopback request/no redirects.
- Before/after fixture hashes and fake mutation counters prove no source, RTC, suspend, service, audit, config, socket, or PID mutation.
- Exact CLI/focused diagnostics/binary tests pass; review approves privilege, egress, process, and atomic-output boundaries.

## Risk Assessment

- Non-root destination ownership ambiguity: resolve canonical user state dir, verify owner/mode/no symlink, otherwise exit `1`.
- Child timeout leaks process: spawn with controlled kill/wait lifecycle and test hanging fake.
- Root bundle disclosure: directory `0700`, file `0600`, no path until durable completion.
- Optional API error pollutes stdout: all warnings route through bounded sanitized stderr after output decision.

## Security Considerations

- Command enum makes shell/operator interpolation unrepresentable; never reuse free-form `systemctl_show_property` at this boundary.
- Token exists only in memory/header; no argv/env/log/bundle/error. No host other than loopback and no redirect.
- Root reads use fixed no-follow regular files. Non-root never escalates.
- Raw journal/helper/inhibitor/netlink/proc content passes strict parser/projector before bundle serialization.

## Next steps

Phase 07 exercises cross-layer failures/security, performs architecture-to-code verification, then updates docs and runs staged read-only host smoke/rollout gates.

## Unresolved questions

None. Any request for public tuning/output/source flags is deferred beyond v1 and requires new product/security review.
