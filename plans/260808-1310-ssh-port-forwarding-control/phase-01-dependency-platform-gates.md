# Phase 01: Windows Dependency, ACL, and Platform Feasibility Gates

## Context links

- [Plan](./plan.md)
- [Native IPC research](./research/researcher-03-native-ipc-report.md)
- [Native codebase delta](./research/researcher-04-native-codebase-delta.md)
- [Architecture correction](./reports/02-native-ipc-architecture-correction.md)
- [System architecture](../../docs/system-architecture.md#ssh-port-forwarding-control-planned-native-desktop-v1)
- [Current native build script](../../apps/native/src-tauri/build.rs)
- [Current native capabilities](../../apps/native/src-tauri/capabilities/default.json)

## Overview

- **Priority:** P1
- **Status:** Complete — limited Windows GO; secure-store implementation remains blocked (2026-08-10)
- **Effort:** 10h
- **Description:** Block implementation until the SSH crate, crypto/agent APIs, Windows reparse-safe storage primitives, Tauri app-command ACL, Windows Cargo graph, and mobile/non-Windows exclusion compile on supported targets.
- **Estimate gate:** Remaining 78h/88h total is conditional on all mandatory proofs. A second platform stack, missing safe store/maintenance primitive, or narrowed OS support stops work for explicit scope/support/effort replan.

## Key Insights

- Windows agent, contained-handle, and atomic-replace claims need native proof before domain/storage code commits to an API.
- Tauri custom commands remain broadly callable unless `AppManifest::commands` activates app ACL resolution. A capability file alone is insufficient.
- Capabilities merge. Existing `default.json` grants the main window `core:default`, which already includes event listen/unlisten/emit. This feature can add zero core permissions but cannot claim the main window has only minimal event rights.
- SSH dependencies must be target-gated by real Cargo target OS predicates; Rust `#[cfg(desktop)]` alone does not keep them out of Android/iOS resolution.
- This phase produces go/no-go evidence, not forwarding product behavior.

## Requirements

### SSH/storage feasibility

- Pin one maintained Rust SSH crate/version/crypto backend only after proving: strict host-key callback before auth, OS-agent signing, public-key auth from verified bytes/open handle, `direct-tcpip`, cancellation, keepalive, clean close, error classification, Tokio compatibility, MSRV, advisories, and MIT/Apache-compatible transitive licenses.
- Prove the Windows OpenSSH named-pipe agent protocol on the current runner; Pageant is supported only if explicitly proven and accepted.
- Prove Windows reparse-safe contained handles for app-config root, every scope directory, all profile/trust/meta reads/writes, backup/quarantine, tombstone purge, and key inventory. Include deterministic junction/reparse/hard-link/component-swap races and same-handle parsing.
- Prove same-directory atomic replace and feature runtime/maintenance locking on Windows: repeated overwrite, crash-before/after replace, cleanup, backup recovery, and ACL behavior.

### Concrete Tauri ACL

- Define one `SSH_FORWARD_COMMANDS` constant with exactly 12 snake_case commands: `ssh_forward_open_client`, `ssh_forward_activate_scope`, `ssh_forward_snapshot`, `ssh_forward_create_profile`, `ssh_forward_update_profile`, `ssh_forward_delete_profile`, `ssh_forward_start`, `ssh_forward_stop`, `ssh_forward_restart`, `ssh_forward_list_keys`, `ssh_forward_approve_host`, `ssh_forward_purge_scope`.
- `build.rs` preserves browser-debug asset work and calls `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(SSH_FORWARD_COMMANDS)))` for desktop targets. Mobile target build gets no SSH-forward command manifest.
- Check in `permissions/ssh-forward.toml` with this exact intended application-permission shape:

```toml
[[permission]]
identifier = "ssh-forward"
description = "Allows the main desktop webview to control native SSH local forwards."
commands.allow = [
  "ssh_forward_open_client", "ssh_forward_activate_scope", "ssh_forward_snapshot",
  "ssh_forward_create_profile", "ssh_forward_update_profile", "ssh_forward_delete_profile",
  "ssh_forward_start", "ssh_forward_stop", "ssh_forward_restart",
  "ssh_forward_list_keys", "ssh_forward_approve_host", "ssh_forward_purge_scope",
]
```

- Check in `capabilities/ssh-forward.json` with exact inclusion:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "ssh-forward-main",
  "description": "Native SSH forwarding for the main desktop webview.",
  "windows": ["main"],
  "platforms": ["windows"],
  "permissions": ["ssh-forward"]
}
```
- Do not add `core:event:*` to the SSH capability: the existing main `default` capability already supplies `core:default`, including listen/unlisten. Record this merged effective baseline and test it. Future narrowing of `default.json` must explicitly add `core:event:allow-listen` and `core:event:allow-unlisten`; frontend never needs emit/emit-to for this feature.
- Command handlers also require `WebviewWindow.label()=="main"`; capability and label checks are both tested. No remote URL capability, shell, filesystem, dialog, opener, or HTTP permission.

### Desktop-only dependency graph

- Put SSH, agent, desktop socket/storage helpers under Cargo target dependencies for `cfg(any(target_os="windows",target_os="macos",target_os="linux"))`; modules/state/handlers remain `#[cfg(desktop)]`.
- Android and iOS dependency trees must contain no accepted SSH/agent/native-handle crates. Build script command manifest and invoke handler exclude all 12 commands on mobile.
- Prove `cargo check` for Android and iOS targets in their native CI environments; TypeScript mobile factory remains host-null/zero-call.

## Architecture

```text
Feasibility spike
  |-- pinned SSH/crypto/agent APIs on Windows
  |-- contained key handle + atomic replace Windows proofs
  |-- AppManifest 12-command ACL + checked-in permission/capability
  `-- Android/iOS Cargo tree and compile exclusion
       |
       `-- go -> Phase 02 contracts/storage; no-go -> revise plan before code
```

No server or shared transport code participates. Existing `server/src/port_forward/**`, PTY forwarding detection, `/api/ssh/*`, and `packages/ui/src/api/ws-transport.ts` stay untouched and protected.

## Related code files

### Create

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\permissions\ssh-forward.toml` - exact 12-command application permission.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\capabilities\ssh-forward.json` - main-window desktop capability.
- `G:\ws\sharing\dam-hopper\plans\260808-1310-ssh-port-forwarding-control\reports\03-native-dependency-platform-gate.md` - pinned versions, licenses, API/platform evidence, go/no-go result.

### Modify

- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\build.rs` - desktop app manifest and command list while preserving browser-debug build.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.toml` - target-gated candidate dependencies.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\Cargo.lock` - reviewed dependency graph after gate passes.
- `G:\ws\sharing\dam-hopper\apps\native\src-tauri\src\lib.rs` - desktop-only registration spike/test seam.

### Delete

- None.

## Implementation Steps

1. Spike candidate SSH crate/crypto backend against strict trust, agent, verified-byte key auth, direct-TCP/IP, keepalive, cancellation, and close. Reject path-only key parsing or blind trust APIs.
2. Review upstream activity, advisories, MSRV, features, duplicate crypto backends, and all transitive licenses; record exact evidence.
3. Prototype contained/no-follow root/scope/file handles, feature runtime lock, atomic replace, backup/quarantine, and purge on each desktop runner with deterministic race/fault injection across all native stores and key inventory.
4. Add the exact 12-command constant, desktop `AppManifest`, checked-in permission TOML, and capability JSON. Generate schemas; assert permission resolves only for main desktop window.
5. Inspect merged capabilities: document existing `core:default`; ensure this feature adds no core/plugin capability beyond `ssh-forward`.
6. Gate dependencies by target OS. Run desktop Cargo trees and mobile Cargo trees; assert SSH/agent/native-handle crates are absent on Android/iOS.
7. Run desktop and mobile compile checks. Test unauthorized window, remote origin, mobile handler absence, and main event listen/unlisten availability.
8. Write the gate report. Do not continue if any mandatory desktop platform/API/ACL/mobile exclusion fails; record contingency options and obtain a revised scope/support/estimate before code continues.

## Todo list

- [x] Windows SSH/crypto/API feasibility and advisory review recorded; release approval remains separate.
- [x] Windows OpenSSH named-pipe agent proof recorded.
- [x] Windows reparse-safe contained-handle, atomic-replace, locking, junction, hard-link, and name-swap proofs pass.
- [ ] Every profile/trust/meta read/write/backup/quarantine/purge rejects link/reparse/component swaps.
- [x] App manifest lists exactly 12 commands.
- [x] Permission TOML and capability schema resolve.
- [x] Effective `core:default` merge documented; no new core permission added.
- [x] Android/iOS Cargo trees exclude SSH dependencies and handlers.
- [x] Go/no-go report completed before Phase 02.

**2026-08-10 status:** Windows agent signing and primitive retained-handle storage proofs passed. Phase 02 contract design may proceed, but durable-store implementation remains blocked until every operation has race/fault coverage. Linux/macOS/iOS runner evidence remains deferred.

## Success Criteria

- `cargo tree --manifest-path apps/native/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc -i <accepted-ssh-crate>` shows the reviewed desktop path.
- `cargo tree --manifest-path apps/native/src-tauri/Cargo.toml --target aarch64-linux-android | Select-String <accepted-ssh-crate>` returns no match.
- `cargo tree --manifest-path apps/native/src-tauri/Cargo.toml --target aarch64-apple-ios | grep <accepted-ssh-crate>` returns no match.
- `cargo check --manifest-path apps/native/src-tauri/Cargo.toml --target aarch64-linux-android` and macOS-runner iOS equivalent exit 0.
- Generated ACL schema contains `ssh-forward`; main invoke succeeds, unauthorized/remote/mobile invokes deny.
- Gate report names exact supported agent protocols and does not infer runtime support from compilation.

## Risk Assessment

- **Crate gap:** Stop; do not add subprocess `ssh -L` fallback or weaken trust/key rules.
- **ACL mismatch:** Test generated manifest/capability behavior; command label check remains defense-in-depth.
- **Mobile dependency leak:** Target dependency blocks plus Cargo-tree assertions.
- **Platform primitive mismatch:** Isolate adapter and require native proof before storage/auth implementation.

## Security Considerations

- Permission file is an allowlist of exact commands, not wildcard/default permission.
- Existing broad `core:default` is acknowledged honestly; feature adds no shell/general filesystem/network plugin.
- Spikes use generated temporary identities only and never developer keys.
- No raw dependency error, key material, endpoint, or path enters the report artifact.

## Next steps

- Phase 02 starts only after a documented go decision.
- Carry exact versions, ACL identifiers, and supported agent protocols forward without reinterpreting them.

### Unresolved Questions

- `russh 0.62.5` with `ring` and the Windows OpenSSH named pipe are the approved Phase 01 feasibility choices.
- Does existing native app behavior permit future narrowing of `core:default`, or must that remain a separate security-hardening plan?
