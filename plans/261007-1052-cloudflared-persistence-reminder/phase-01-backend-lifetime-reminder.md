# Phase 1 — Backend lifetime and reminder

## Context links
[Parent plan](plan.md); [architecture](../../docs/system-architecture.md#tunnel-isolation-and-port-forwarding). Independent of phase 2 under parent wire contract.

## Overview
2026-10-07. P2. Implementation: complete. Review: source approved. Actor: `evcrate-astra-high`, configured GPT-6 Astra high role/model retained.

## Key insights
Removed former port/PTY-triggered tunnel cancellation rather than debouncing it. Real connector retained identity across listener loss/reopen, PTY exit/Kill/reuse, and detection owner replacement. Registry remains process-local.

## Requirements
Parent acceptance 1–4, 7–8; all Rust callers migrated; no obsolete API shims. Keep detected-port lifetime fences independent.

## Architecture
`create(port,label)` has no PTY ownership. Remove `create_for_owner`, port/owner-stop APIs, ownerless monitor and its dead coupling. Add serialized `reminderDue` false; watcher selects events and creation deadline at three hours, sets due once only for active ready session, emits `tunnel:reminder {id}`. Watcher teardown cancels reminder; no late event after Stop/exit. REST exposes due even when clients disconnected. No expiry/restart/debug flags.

## Related code files
`server/src/tunnel/{manager,session,tests}.rs`; `server/src/port_forward/{manager,detector}.rs`; `server/src/api/{tunnel,ws_protocol}.rs`; affected Rust main/PTY/tests callers.

## Implementation steps
1. Read exact callers, remove tunnel/port lifecycle coupling and tunnel owner metadata, update API/wiring and obsolete tests.
2. Implement monotonic deadline with one due transition and active-session guard, update wire enum and snapshots.
3. Add/repair consumer behavior and paused-clock boundary/cancellation regression tests. Skip build/lint/tests/formatters during actor work.

## Todo list
- [x] Origin and PTY independent connector lifecycle.
- [x] Three-hour due state/event with cleanup.
- [x] Migrated Rust callsites and behavior regressions.

## Success criteria
No port detection path can stop a tunnel. Due state survives REST reads; no reminder before three hours or after stop. Existing duplicate/start/dispose behavior retained.

## Risk assessment
Removing coupling must not remove stale detected-port persistence cleanup. In-flight start/stop and timer boundary races require deterministic tests.

## Security considerations
Public port persists and can serve a replacement binder. Existing auth/creation validation unchanged. Stop/disposal reaps children.

## Next steps
Complete: cargo check/build, 46 tunnel/port/protocol tests plus 172 PTY tests passed (one PTY test ignored). Real connector lifecycle/three-hour deadline/Stop/shutdown evidence in [runtime report](reports/runtime-and-review.md). No connector restart or cross-server-restart restoration.
