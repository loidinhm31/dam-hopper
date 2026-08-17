# Phase 04: Tauri and TypeScript contract compatibility

## Context Links

- [Plan](./plan.md)
- [Phase 03](./phase-03-credential-trust-reconnect-lifecycle.md)
- [Current-flow research](./research/researcher-01-commit-current-flow-report.md)
- Baseline symbols: command functions/`EXPECTED_COMMANDS` in `commands.rs`; `command_names.in.rs`; `NATIVE_SSH_FORWARD_COMMANDS`/`validSnapshot`/`NativeSshForwardHost` in `native-ssh-forward-host.ts`; `SshForwardHost` in `ssh-forward-host.ts`.

## Overview

- Date: 2026-08-16
- Completed: 2026-08-18
- Description: Publish one synchronized v2 Rust/Tauri/TypeScript contract and fail closed on stale or malformed native data.
- Priority: P2
- Implementation status: Complete
- Progress: 100% (9/9 implementation steps; 6/6 todo items)
- Review status: Approved after final read-only review on 2026-08-18; no critical or important findings remain

## Key Insights

- The native binary and bundled webview ship together; data migration needs v1 compatibility, but legacy lifecycle command aliases would expand capability surface without product value.
- Four command surfaces must match exactly: Rust handlers, canonical include list/build manifest, checked-in permission allowlist, and TypeScript command map.
- Snapshot remains authority. `ssh-forward:changed` stays a bounded identity/revision hint that only schedules refetch.

## Requirements

- Canonical v2 commands: bootstrap/snapshot; connection CRUD; rule CRUD; explicit connect/disconnect; set rule enabled; key inventory/load key/load password; forget saved credential; exact host approval; inactive scope purge.
- Remove legacy combined-profile/start/stop/restart handler exposure after all callers migrate. Tests must prove old command names are absent.
- Every command validates desktop main window, desktop/manager/client context, activation token, scope/generation, relevant expected revisions, UUIDs, exact parent/rule relationship, and expected numeric generations.
- Port enable/disable input includes connection profile ID, expected connection generation, rule ID, expected rule generation, enabled boolean; no credential attempt/material fields.
- `loadKey`/`loadPassword` accept the fixed remember intent (`rememberForDays: 30` or off). Only native post-auth success may write the vault. `forgetCredential` accepts exact connection identity/generation and returns authoritative safe metadata.
- Snapshot fields: context/activation/scope identities; `connectionsRevision`, `rulesRevision`, `trustRevision`; connection profiles/runtimes; forwarding rules/runtimes; safe credential state/`expiresAt`; connection-scoped host challenges; optional trust repair metadata.
- Event hint fields add optional connection/rule IDs and generations plus all current identity/revision fields. Adapter parses counters with `BigInt`, rejects extra/malformed fields, and never compares strings lexically.
- Browser/native-mobile remain hostless. Desktop non-Windows/mobile generated handlers and accepted dependency trees contain no SSH commands.

## Architecture

`packages/ui SshForwardHost -> apps/native strict adapter -> Tauri allowlisted handler -> SshForwardManager -> authoritative snapshot`.

- Exact command list (18): `ssh_forward_open_client`, `ssh_forward_activate_scope`, `ssh_forward_snapshot`; `ssh_forward_create_connection`, `ssh_forward_update_connection`, `ssh_forward_delete_connection`; `ssh_forward_create_rule`, `ssh_forward_update_rule`, `ssh_forward_delete_rule`; `ssh_forward_connect`, `ssh_forward_disconnect`, `ssh_forward_set_rule_enabled`; `ssh_forward_list_keys`, `ssh_forward_load_key`, `ssh_forward_load_password`, `ssh_forward_forget_credential`, `ssh_forward_approve_host`, `ssh_forward_purge_scope`.
- Rust wire counters serialize as canonical decimal strings. TypeScript brands/parses them and converts to `BigInt` before order/equality decisions.
- Credential calls are establishment-only. Port rule call DTOs are structurally unable to carry secrets.

## Related Code Files

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\model.rs` — **modify**: final v2 command inputs/results, snapshots, events, deny-unknown/camelCase contracts.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\commands.rs` — **modify**: v2 handler set and canonical-list parity test; remove legacy handler functions.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\command_names.in.rs` — **modify**: exact 18-name source used by build manifest/tests.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\permissions\ssh-forward.toml` — **modify**: allow exactly v2 names, no legacy commands.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\capabilities\ssh-forward.json` — **modify**: retain main-window/Windows-only grant; update description only if contract naming changes.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\build.rs` — **modify**: keep `AppManifest::commands` driven by canonical include and add/retain parity validation.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\lib.rs` — **modify**: Windows `tauri::generate_handler!` list and manager setup; non-Windows handler list remains SSH-free.
- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\ssh-forward-host.ts` — **modify**: v2 types/errors/host methods and strict counter helpers.
- `G:\ws\sharing\dam-hopper\apps\native\src\native-ssh-forward-host.ts` — **modify**: command map, v2 invoke payloads, exact validators, hint freshness, disposal.
- `G:\ws\sharing\dam-hopper\packages\shared\src\ssh-forward-contract-fixtures.json` — **modify**: parity samples for every v2 DTO family, omitted optionals, limits, stale counters.
- `G:\ws\sharing\dam-hopper\packages\shared\src\ssh-forward-contract-fixtures.test.ts` — **modify**: sample inventory/order, casing, optional/null, secret-absence assertions.
- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\ssh-forward-host.test.ts` — **modify**: v2 parsing, numeric counters, malformed payload, and secret-absence cases.
- `G:\ws\sharing\dam-hopper\apps\native\src\native-ssh-forward-host.test.ts` — **modify**: exact commands, invoke payloads, snapshot/hint identity, and stale-generation cases.
- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\ssh-forward-error-definitions.ts` — **modify**: safe v2 error presentation table.
- `G:\ws\sharing\dam-hopper\packages\ui\src\lib\ssh-forward-error-copy.test.ts` — **modify**: fixed copy coverage for new error codes without native detail leakage.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\ssh_forward\credential_vault.rs` — **modify**: DTO-safe status projection and Forget result tests; never expose vault targets/blobs.

## Implementation Steps

1. [x] Freeze DTO field tables before handler work. Specify required/optional/null behavior and safe error codes for each command/result.
2. [x] Update Rust models with `deny_unknown_fields`, bounds, relationship validation, and canonical serialization; add serde roundtrip/negative tests.
3. [x] Replace command handler surface and update `EXPECTED_COMMANDS`, canonical include, permission allowlist, build manifest, and Windows generated handler in one commit.
4. [x] Add a test that compares all four native command-name sources and rejects legacy names; verify generated mobile/non-Windows handlers remain free of SSH symbols.
5. [x] Replace shared TypeScript types/`SshForwardHost` methods. Keep web availability behavior unchanged when host is null.
6. [x] Update `NativeSshForwardHost` exact validators for two revisions, two runtime arrays, safe credential status/UTC expiry, challenge connection IDs, optional hint IDs/generations, bounds (16/64/64), and redacted errors.
7. [x] Preserve adapter sequencing: open client -> activate scope -> snapshot; same-scope reload retains native sessions; disposal only removes listeners, while app shutdown coordinator owns native teardown.
8. [x] Replace contract fixtures and assert no password/passphrase/private-key/vault-target/credential-attempt fields occur in snapshots/events/rule commands. Secret-bearing load inputs must never appear in fixture output/log snapshots.
9. [x] Run Rust handler/serde tests, shared fixture tests, adapter tests, typecheck, desktop build, and target-OS dependency/handler audits.

## Todo List

- [x] Freeze v2 DTO field/state/error tables.
- [x] Synchronize exact 18-command native surfaces.
- [x] Remove legacy command exposure/callers.
- [x] Update shared host types and strict adapter validators.
- [x] Replace contract fixtures and negative samples.
- [x] Verify Windows-only capability/generated-handler boundaries.

## Completion Record

Completed on 2026-08-18. The implementation and final read-only review cover the following:

- Rust/Tauri publishes the exact 18-command v2 surface for client/scope bootstrap, connection and rule CRUD, connect/disconnect, rule enablement, key/password operations, credential forgetting, host approval, and scope purge. The Rust handler list, canonical command include, permission allowlist, Windows generated handler, TypeScript map, and parity tests agree; legacy IPC command names are absent from authoritative source surfaces.
- Rust DTOs use camelCase wire fields, deny unknown fields, bounded collections, canonical decimal-string counters, UUID/context/scope/revision/generation checks, exact connection/rule parent validation, and safe redacted error/result projections. Snapshots and event hints carry v2 connection/rule revisions, runtimes, credential status/expiry metadata, connection-scoped host challenges, and optional trust repair data.
- The shared `SshForwardHost` contract and native adapter implement connection/rule models and lifecycle methods, strict snapshot/hint validation, duplicate and cross-reference rejection, bounded arrays, canonical host validation, and five-dimension numeric freshness (`scopeGeneration`, `connectionsRevision`, `rulesRevision`, `profilesRevision`, and `trustRevision`) using `BigInt`. Concurrent snapshots remain monotonic; event hints schedule authoritative refetches; connection/rule revision conflicts recover through refresh; and failed activation does not poison retry state.
- Compatibility remains deliberate: local v1-shaped UI wrappers route through v2 IPC without restoring legacy command exposure; v1 projections remain available where needed for the next phase; browser/mobile and non-Windows hosts remain hostless and SSH-free. Same-scope reload preserves native sessions, while disposal removes listeners only.
- Credential material is restricted to key/password establishment inputs. Rule enablement carries no secrets, `rememberForDays` accepts only `0` or `30`, vault writes occur only after post-authentication success, and snapshots/events/errors expose only bounded safe credential metadata.

## Validation Record

Validation completed on 2026-08-18:

- `cargo fmt --manifest-path apps/native/src-tauri/Cargo.toml -- --check` — passed.
- `cargo test --manifest-path apps/native/src-tauri/Cargo.toml --lib` — passed: 194 passed, 1 ignored.
- `cargo check --manifest-path apps/native/src-tauri/Cargo.toml` — passed.
- `pnpm --filter @dam-hopper/shared test` — passed: 15 tests.
- `pnpm --filter @dam-hopper/ui test` — passed: 1,115 tests across 184 files.
- `pnpm --filter @dam-hopper/ui build` — passed.
- `pnpm --filter @dam-hopper/native test` — passed: 33 tests across 3 files.
- `pnpm --filter @dam-hopper/native exec tsc -p tsconfig.json --noEmit` — passed.
- `pnpm --filter @dam-hopper/native build` — passed.
- `pnpm lint` — passed.
- `git diff --check` — passed.
- Command, legacy-name, secret-absence, Windows-only, browser/mobile hostless, freshness, and dependency/handler audits — passed. Authoritative command parity is exactly 18 names.

Non-blocking existing warnings and follow-ups:

- Rust check/test output retains dead-code warnings for compatibility/legacy manager projection helpers; these remain for the phase-5 transition and do not fail validation.
- The native smoke/evidence test reports existing release-evidence metadata warnings while exiting successfully.
- Ignored autogenerated Tauri schema/permission artifacts retain historical legacy strings. They were not edited in this phase; authoritative tracked handlers, permissions, canonical command list, and TypeScript map are clean. Regenerate or clean these artifacts before packaging.

## Success Criteria

- Rust handlers, include list, Tauri permission, generated handler, TypeScript map, and tests agree exactly.
- A rule enable command cannot deserialize credential material and rejects non-Established/stale/wrong-scope parents natively.
- Malformed/extra/stale snapshots and hints are ignored/rejected; valid higher numeric revisions trigger one refetch.
- Browser/mobile render no route/navigation/invoke/listener; non-Windows builds contain no SSH command handlers.
- Fixture and adapter tests cover every DTO family and secret absence.
- Saved credential metadata is bounded and safe; Forget is exact-identity native authority and cannot delete another connection's entry.

## Risk Assessment

- **High — capability mismatch breaks packaged app:** exact-source parity test plus packaged smoke.
- **High — stale adapter accepts wrong connection:** exact identity and numeric freshness validators.
- **Medium — breaking older hot-reload UI:** fail closed; native/bundled UI are version-locked, no legacy aliases.
- **Medium — DTO drift:** canonical fixtures consumed by Rust/TypeScript tests where practical.

## Security Considerations

- Keep permission limited to `main` on Windows; add no shell, general filesystem, opener, HTTP, or core capability.
- Keep Tauri error serialization fixed/redacted; never expose raw source chains.
- Never expose Credential Manager target names, account fields, blob bytes, or raw Win32 errors through IPC.
- Validate every boundary independently; TypeScript validation is defense in depth, not authorization.
- Events never cause direct state mutation or forwarding action.

## Next Steps

- Phase 05 consumes only the frozen host contract.
- Any DTO/command change after UI begins requires rerunning parity, fixtures, and capability review.

## Unresolved Questions

None.
