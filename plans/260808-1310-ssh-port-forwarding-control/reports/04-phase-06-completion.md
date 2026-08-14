# Phase 06 Desktop Control Surface Completion

**Date:** 2026-08-14
**Scope:** Windows-only native desktop control surface
**Status:** Complete; Phase 07 remains deferred

## Scope delivered

- Host-gated `/ssh-forwarding` route and navigation; browser and native mobile remain unavailable.
- Explicit reviewed profile create/edit form with fixed loopback bind/target policy and no HTTP-profile resynchronization.
- Snapshot-authoritative Start, Stop, Restart, Stop-before-Edit/Delete, bounded reconnect, and visible auto-start-skip behavior.
- Agent-first authentication with on-demand opaque safe-key inventory; no path picker, password, passphrase, keychain, or arbitrary SSH option controls.
- Unknown-host fingerprint approval with explicit subsequent Start; changed-key/algorithm hard failure with runtime-resolved stopped-app remediation copy and no override action.
- Persistent local-process/loopback security boundary copy and browser/mobile zero-call coverage.

## Security boundaries

- Desktop bind and SSH remote target are fixed to `127.0.0.1`; wildcard, IPv6, port 0, remote/SOCKS, and arbitrary target controls remain excluded.
- Browser/mobile have no route, host, Tauri invoke/listen, REST, or WebSocket forwarding path.
- Rust/native validation remains authoritative for ports, generations, trust, lifecycle, and storage. UI never edits trust storage or displays raw native errors.
- Any local process can use the desktop loopback listener. Loopback blocks LAN reachability but does not provide local-process isolation or authentication; SSH encryption begins after the local listener.
- Runtime updater/restart/relaunch controls remain absent; `createUpdaterArtifacts` is packaging metadata only.

## Validation evidence

| Surface | Result |
|---|---:|
| UI | 181 files / 1,050 passed |
| Chromium | 28 files / 121 passed |
| Rust | 140 passed / 1 ignored |
| Build, lint, `cargo check`, `cargo fmt`, diff check | Passed |

## Review and approval

Phase 06 is approved and marked complete for the Windows-only desktop scope on 2026-08-14. This approval covers the control surface and its automated validation; it does not approve Phase 07 or claim release readiness.

## Deferred Phase 07 and manual gates

- macOS/Linux desktop and Android/iOS dependency, build, and runtime evidence.
- Real OpenSSH/remote-loopback service, packaged Tauri runtime, listener closure after Stop/scope switch/exit, long-idle/concurrent channels, and second-local-process smoke evidence.
- Protected runtime evidence bound to the exact commit/artifact hash, named release-engineer execution, security approval of ACL/trust/fixed-target/remediation behavior, product acceptance of local-process exposure, protected source-diff/redaction checks, and manual release gates.

### Unresolved questions

- Named release owners and protected environment for Phase 07 evidence are still to be configured.
- Final packaged platform path and stopped-app trust-repair command details remain release-gated and must come from runtime resolution.
