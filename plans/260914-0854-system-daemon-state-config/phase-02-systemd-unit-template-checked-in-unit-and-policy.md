# Phase 02 — Systemd unit template, checked-in unit, and unit policy

## Context links

- [Plan](plan.md)
- [Phase 01](phase-01-layout-and-descriptor-relative-runtime-provisioning.md)
- [Scout report](agent://ScoutConfigUsage)
- [Research report](../reports/researcher-260914-0854-daemon-state-config.md)
- [`dam-hopper-api.service.in`](../../deploy/systemd/dam-hopper-api.service.in) · [`unit_policy.rs`](../../server/src/linux_release/unit_policy.rs)

## Overview

- Priority: P2
- Status: pending
- Effort: 6h
- Goal: cut production systemd startup to the canonical state TOML and make template, checked-in rendered example, strict Rust policy, integration tests, and staged output agree exactly.
- Dependency: Phase 01 must provision `/var/lib/dam-hopper/dam-hopper.toml` before the existing `ExecStartPre` returns.

## Key Insights

- The API template and checked-in unit still pass `/etc/dam-hopper/dam-hopper.toml`; strict policy repeats the same stale literal.
- `@API_HOME@` is already allowlisted and rendered to `/var/lib/dam-hopper`; no new template token or configurable path input is needed.
- The existing one privileged `ExecStartPre` closes explicit start, boot, and `Restart=on-failure` bypasses. It must remain the sole gate and must precede `ExecStart`.
- Existing unit tests assert only the server executable prefix. Positive canonical and negative legacy assertions are needed to make the path contract observable.
- Unit edits must not disturb identity, HOME/XDG, working directory, runtime PID directory, environment files, CORS, hardening, stop hooks, or restart policy.

## Requirements

### Unit contract

- Template `ExecStart` must be exactly `@RELEASE_ROOT@/bin/dam-hopper-server --config @API_HOME@/dam-hopper.toml --host 0.0.0.0 --port 4801`.
- Checked-in rendered unit must resolve it exactly to `/opt/dam-hopper/current/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`.
- `validate_api_unit_policy` must require the exact rendered canonical path using `ctx.api_home`; it must reject the legacy `/etc` path, alternate state paths, missing `--config`, duplicate `ExecStart`, and extra arguments through its existing exact equality check.
- Preserve exactly one `ExecStartPre=+<release-root>/bin/dam-hopper-manager provision-api-runtime`; no operands, duplicates, shell, or path override.
- Preserve `Type=exec`, one non-root `User=`/`Group=`, `WorkingDirectory`, `HOME`, `XDG_CONFIG_HOME`, `RuntimeDirectory`, `PIDFile`, lifecycle hooks, `UMask=0077`, `Restart=on-failure`, `RestartSec=5s`, and all existing environment/hardening directives.
- Keep `StateDirectory` and `StateDirectoryMode` absent. No systemd path creation may race or repair Phase 01 state.
- Retain `/etc/dam-hopper/server.env` and `server-safety.env` as root-managed environment inputs; they are not daemon TOML authorities and are outside this path cutover.

### Side-effect review checklist

- [ ] Only API `ExecStart` path changes in unit assets.
- [ ] One privileged prestart remains byte-for-byte and order-equivalent.
- [ ] User/group/HOME/XDG/working directory/mode/restart/PID/hardening remain unchanged.
- [ ] No `StateDirectory*`, shell wrapper, fallback config, optional config, or new token is introduced.
- [ ] Web, helper, recovery, rootless direct invocation, and format-2 legacy unit contracts remain unchanged.

## Architecture

```text
systemd start/restart
  -> privileged fixed ExecStartPre
       -> parse final unit User/Group
       -> Phase 01 provision/validate canonical config + audit
       -> failure: stop unit start
  -> unprivileged ExecStart
       -> --config /var/lib/dam-hopper/dam-hopper.toml
       -> AppState audit beside canonical config
```

The template uses existing `@API_HOME@` for DRY source intent. Rendering resolves all tokens; strict policy compares a concrete absolute command. The checked-in unit is a human/operator example and must match the same concrete contract, but remains generated from known production defaults rather than becoming a second policy source.

## Related code files

| Action | File | Change |
| --- | --- | --- |
| Modify | `deploy/systemd/dam-hopper-api.service.in` | Use `@API_HOME@/dam-hopper.toml` in exact `ExecStart` |
| Modify | `deploy/systemd/dam-hopper-api.service` | Keep checked-in rendered unit synchronized at `/var/lib/dam-hopper/dam-hopper.toml` |
| Modify | `server/src/linux_release/unit_policy.rs` | Build exact expected command from `ctx.release_root` and `ctx.api_home` |
| Modify | `server/tests/linux_release_unit_policy.rs` | Assert canonical command and reject legacy/alternate commands |
| Modify | `server/tests/linux_release_staging.rs` | Assert staged API unit contains canonical path, no legacy path, and no unresolved token |
| Modify | `tests/deploy/linux-release-security.sh` | Deferred to Phase 03 smoke: static positive/negative production path check |
| Review only | `server/src/linux_release/unit.rs` | Existing `@API_HOME@` allowlist/substitution; no new token |
| Review only | `server/src/linux_release/stage_units.rs` | Existing render→parse→policy pipeline remains the single staging route |

## Implementation Steps

1. Change the template's config operand to `@API_HOME@/dam-hopper.toml`; do not reorder other directives.
2. Update the checked-in concrete API unit to the exact `/var/lib/dam-hopper/dam-hopper.toml` command.
3. Change `validate_api_unit_policy` expected `ExecStart` to format from `ctx.api_home`; preserve exact equality and all other assertions.
4. Strengthen `test_render_api_unit_success`: compare parsed `ExecStart` exactly, assert canonical path present, `/etc/dam-hopper/dam-hopper.toml` absent, and no unresolved token.
5. Add one meaningful negative unit-policy case by replacing only canonical with legacy and expecting `UnitPolicyViolation`; avoid redundant rows for arbitrary alternate paths because exact equality already covers them.
6. Extend staging verification to parse/read the staged API unit and assert the exact release-root command plus canonical state path and legacy absence.
7. Review the full template/checked-in diff for unchanged prestart, identity, HOME/XDG, state-directory absence, hardening, and restart semantics.

## Todo list

- [ ] Cut template `ExecStart` to `@API_HOME@/dam-hopper.toml`.
- [ ] Synchronize checked-in concrete unit.
- [ ] Tighten strict expected command in `unit_policy.rs`.
- [ ] Add canonical positive and legacy negative policy assertions.
- [ ] Add exact staged-unit path assertion.
- [ ] Complete unit side-effect review.

## Success Criteria

- Rendered and checked-in commands resolve to exactly `/var/lib/dam-hopper/dam-hopper.toml`; neither contains the legacy TOML path.
- A template changed back to legacy fails strict unit rendering/policy validation.
- Staged Server/Both API units have the canonical path and no unresolved token; Web role still stages no API unit.
- Exactly one privileged prestart remains before exact unprivileged `ExecStart`; provisioning failure semantics are unchanged.
- Focused proof commands: `cargo test -p dam-hopper-server --test linux_release_unit_policy` and `cargo test -p dam-hopper-server --test linux_release_staging`.

## Risk Assessment

- **Template/policy drift:** change both in one phase and assert the final parsed command, not a substring.
- **Checked-in unit drift:** include it in the same review and deployment security smoke.
- **Accidental fallback to `/etc`:** explicit negative assertions in policy, staging, and Phase 03 smoke.
- **Privilege regression:** preserve one exact `+` prestart and non-root `ExecStart`; reject duplicate/altered prestart.
- **Systemd repairs state:** continue forbidding `StateDirectory*` in policy and tests.

## Security Considerations

- Config location is fixed through allowlisted render context; no unit environment, host file, or CLI input can redirect production startup.
- Root runs only the zero-operand provisioner. The server reads/writes canonical state as its final non-root identity.
- Exact command comparison prevents shell insertion, unexpected flags, optional fallback paths, and multiple config operands.
- Root-managed environment files remain data inputs, not executable command construction or config path authority.

## Next steps

Phase 03 must update preflight and operator tooling before rollout, then prove actual staged/installed service behavior. Do not publish a release with Phase 02 units while old preflight still protects only the legacy SQLite path.

**Unresolved questions:** None.
