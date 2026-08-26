---
title: "Native SSH Port-Forwarding Control"
description: "Add ordered desktop-local SSH forwarding through a narrow Tauri/Rust capability and browser-safe shared UI host."
status: complete
priority: P2
effort: 88h
branch: features/ssh-port-forwarding-control
tags: [feature, native, frontend, rust, ssh, security]
created: 2026-08-08
---

# Native SSH Port-Forwarding Control

## Overview

Implement SSH local forwarding in Tauri desktop: shared React UI -> `SshForwardHost` -> 14-command Windows desktop IPC -> native Rust manager -> desktop `127.0.0.1` listener -> SSH `direct-tcpip` -> remote `127.0.0.1` target. Browser, native mobile, Axum, existing server forwarding/SSH/PTY, and shared WebSocket transport remain outside the feature.

**Accepted scope (2026-08-15): Windows desktop only.** This plan is complete for the Windows implementation, automated native/package gates, and release-evidence workflow. macOS, Linux, Android, iOS, and future signed-updater expansion are separate follow-up scope, not completion blockers for this plan.

## Architecture constraints

- V1: local forwarding only; fixed ports `1..=65535`; desktop bind and remote target host exactly `127.0.0.1`; no IPv6/wildcard/port 0/non-loopback target.
- Active `ServerProfile` hostname and port 22 only prefill a new reviewed form. Saved SSH endpoint never follows HTTP URL edits.
- Stable desktop identity + per-process manager session + Rust-issued client epoch + caller-monotonic decimal activation token make A/B/C ordering manager-authoritative across reloads.
- All IPC revisions/generations/epochs/tokens are canonical decimal strings on the wire, parsed to `u64`/`BigInt` and compared numerically; lexical comparison is forbidden. Timestamps are RFC3339 UTC milliseconds. Overflow fails closed.
- `app_config_dir` stores hashed per-scope profiles/trust/meta; runtime is memory-only. Observed profile deletion purges inactive scope; unobserved orphans quarantine 30 days.
- Every native store/backup/quarantine/purge uses contained no-follow/reparse-safe handles. Changed trust uses a stopped-app locked maintenance mode and protected recovery, never IPC override.
- Windows-only native scope: OS agent preferred; when unavailable, the desktop UI can unlock an
  opaque no-follow inventory key with an ephemeral passphrase sent only over Tauri IPC. The
  decrypted key is profile-scoped in memory and is never persisted, logged, or sent to the server.
  The lifecycle prompt also offers VS Code-style ephemeral SSH username/password authentication;
  the password is zeroized in native memory, cleared after failed authentication, and never
  persisted or sent to the HTTP server. No path picker, keychain, password persistence, shell, or
  general filesystem capability.
- Endpoint-first canonical host trust accepts only exact pre-recorded algorithm/key; unknown endpoint needs exact fingerprint approval; changed key/algorithm hard-fails to stopped-app remediation.
- Commands/snapshots are authoritative; scope/generation events only hint refetch. Same-scope reload rehydrates; Stop/scope switch/actual Tauri exit close listeners within 5 seconds.
- Any local desktop process can use the listener. Product owner must accept this limitation; SSH encryption starts after local loopback.
- Existing `server/src/port_forward/**`, PTY detection, `/api/ssh/*`, Git credentials, Axum/WS state/routes, `queries.ts`, and `ws-transport.ts` are explicitly protected from changes/removal.

## Phases

| # | Phase | Status | Progress | Effort | Link |
|---|---|---|---:|---:|---|
| 1 | Windows dependency, ACL, and platform feasibility gates | Complete | 100% | 10h | [Phase 01](./phase-01-dependency-platform-gates.md) |
| 2 | Contracts, persistence, scope retention | Complete | 100% | 12h | [Phase 02](./phase-02-native-contracts-persistence.md) |
| 3 | SSH transport, authentication, trust, errors | Complete | 100% | 14h | [Phase 03](./phase-03-ssh-transport-trust.md) |
| 4 | Manager ordering, lifecycle, IPC, shutdown | Complete | 100% | 16h | [Phase 04](./phase-04-native-manager-tauri-ipc.md) |
| 5 | Browser-safe host and ordered adapter | Complete | 100% | 10h | [Phase 05](./phase-05-host-context-native-adapter.md) |
| 6 | Desktop-only control surface | Complete | 100% | 10h | [Phase 06](./phase-06-desktop-control-surface.md) |
| 7 | Windows verification and release gates (re-scoped) | Complete (Windows-only) | 100% | 16h | [Phase 07](./phase-07-cross-platform-release-gates.md) |

## Explicit non-goals

- No remote forwarding, SOCKS, IPv6, remote non-loopback target, local-client auth claim, password
  persistence, keychain, arbitrary SSH option/path, or browser/mobile fallback. The Windows desktop
  may prompt for an encrypted local key or SSH username/password and keeps all resulting credentials
  only in memory.
- No server feature flag/API/manager/store/event/credential reuse and no removal/refactor of existing server forwarding/SSH/PTY behavior.
- No runtime updater/restart/relaunch in v1; updater artifacts remain packaging metadata until coordinator-backed packaged disposal is proven.

## Release dependencies

- Windows Phase 01 limited GO for exact SSH crate/crypto/agent/ACL and Windows storage graph; Phase 02 contract design may proceed.
- Durable-store implementation remains blocked pending production deterministic per-operation race/fault coverage and durable replacement proof.
- Windows automated/package gates and the protected runtime-evidence workflow are implemented. Protected runtime evidence and the three role approvals remain operational prerequisites before a production tag is released; they do not block completion of this implementation plan.
- macOS/Linux/Android/iOS evidence, signed updater artifacts, and platform expansion are deferred to a separate scope and estimate review.
- The 88h estimate remains conditional on Windows-only Phase 01 proofs. Any failed mandatory Windows gate, fallback, updater/relaunch enablement, or trust-repair primitive gap stops a future release.

## Deferred scope

- Named release/security/product owners and protected runtime-evidence environment must be configured before a production release candidate.
- Non-Windows support wording and release evidence require a future cross-platform plan.

## Current status

**2026-08-10 — Phase 01 limited GO:** Windows dependency, ACL, identity-listing/signing, and platform primitive feasibility is complete. Windows OpenSSH named-pipe signing passed with a disposable Ed25519 identity; retained-handle probes cover junction, hard-link, ancestor-junction, atomic-replace, locking, and name-swap denial. Phase 02 contract design may proceed. Durable-store implementation remains blocked pending production deterministic per-operation race/fault coverage and durable replacement proof. Linux/macOS/iOS evidence remains deferred.

**2026-08-11 — Phase 02 complete:** Final review/remediation closed the staging-file race, decoded-fingerprint canonicality, and real process crash/restart/recovery proofs, including idempotent purge proofs. Contract and persistence validation is accepted for continued implementation. Windows automated/package runtime evidence and cross-platform (Linux/macOS/iOS) evidence remain deferred; no release/platform work is claimed complete.

**2026-08-11 — Phase 03 approved:** SSH transport, authentication, endpoint-first host trust, scoped approval challenges, redacted errors, bounded credentials, aggregate timeouts, and Windows-safe trust recovery passed validation and security review. Phase 04 manager/IPC lifecycle work remains pending.

**2026-08-13 — Phase 04 blocked:** Manager ordering, active-forward admission, full-context challenge binding, stop-state guards, ordered lifecycle disposal, reconnect listener rejection, deterministic concurrent auto-start, exact IPC command-list checks, and shutdown coordination are implemented. Static Rust gates pass. Native test executables compile but fail before assertions on this Windows host with `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`; root cause remains unconfirmed. Runtime validation is deferred to a known-good Windows environment. Root `pnpm test` also reports unrelated `windows_by_handle` `E0658`. Phase 04 is not approved, complete, runtime-validated, or release-ready.

**2026-08-13 — Phase 05 complete:** Final independent review scored 8.8/10 with conditional acceptance and no critical findings. UI 981/981 and native 17/17 passed; builds, lint (0 errors/0 warnings), `cargo fmt`, `cargo check`, `cargo clippy`, and diff check passed. This phase acceptance does not claim feature or release readiness; Phase 04 remains blocked by the Windows native runtime failure above.

**2026-08-14 — Phase 04 complete:** The Windows Common Controls v6 manifest fixed native test-process startup. Full native validation passed with 139 tests passed and 1 ignored, including real russh listener start/stop, host-key challenge approval plus explicit restart, scope-switch/dispose closure, staged/idempotent purge, force-close contention, randomized activation schedules, and bounded shutdown/event seams. Phase 07 packaging and release gates remain deferred.

**2026-08-14 — Phase 06 complete (Windows-only):** The desktop-only control surface is complete and approved for the Windows scope: host-gated route/navigation, explicit reviewed profile form, lifecycle controls, safe key inventory, host-key approval and stopped-app remediation presentation, fixed security/error copy, and browser/mobile zero-call coverage. Validation passed with UI 181 files/1,050 tests, Chromium 28 files/121 tests, and Rust 140 passed/1 ignored; build, lint, `cargo check`, `cargo fmt`, and diff checks passed. Phase 07 remains deferred, so the overall plan remains **blocked** on cross-platform, packaged-runtime, security, product, and manual release dependencies. No Phase 07 completion is claimed.

- Phase 02 must retain the approved `russh`/`ring` and Windows OpenSSH named-pipe choices until a separate security review changes them.
- Named release/security/product owners and protected runtime-evidence environment must be configured.
- Non-Windows support wording and release evidence remain deferred until a future scope expansion.

**2026-08-15T22:39:00+07:00 - Windows-only re-scope accepted:** The Windows implementation and release-gate scope is complete. Validation covers temporary OpenSSH remote-loopback E2E, redacted evidence schema/validator, exact artifact/hash and commit binding, protected approval-ID/timestamp binding, native Rust/CI/release pre-bundle checks, WebView2/OpenSSH preflight, and the NSIS package profile. The unsigned profile disables updater artifact creation because signing credentials and an updater endpoint are unavailable; runtime updater/relaunch remains absent. Protected runtime evidence remains a production-release prerequisite, while non-Windows/mobile/signed-updater expansion is deferred to a separate plan. Overall plan status is **complete for the accepted Windows-only scope**.

**2026-08-16 - Windows passphrase UX amendment:** When agent authentication is unavailable, the
desktop control surface lists encrypted local key candidates, prompts for the passphrase in-app,
decrypts through the Windows native Tauri boundary, and retries the requested lifecycle operation.
The passphrase is never persisted, logged, or sent to the HTTP server; only the profile-scoped
decrypted key remains in memory for the active desktop session.

**2026-08-16 - Windows flow correction:** Save Forward now closes only after the authoritative
profile mutation succeeds, so a pending request cannot be submitted repeatedly. The form resets
from the selected native profile whenever it opens. Local-key authentication binds an opaque local
key ID to the forward (encrypted keys are allowed and prompt at Start/Restart); OS-agent profiles
remain agent-first and label any passphrase fallback with the forward name.

**2026-08-16 - Windows password-auth UX amendment:** The lifecycle credential prompt now offers
`Username and password` alongside `SSH key passphrase`, matching the practical VS Code Remote-SSH
flow. The username is prefilled from the forward but editable for the current retry. Password
credentials travel only through the Windows Tauri IPC boundary, are used for the requested
Start/Restart attempt, and remain absent from profiles, storage, logs, the HTTP server, and the
 browser host snapshot.

**2026-08-19 - Final Windows completion correction:** The explicit SSH connect path now releases
its admission locks before finalization, so successful authentication reaches `Established` instead
of being reported as an internal timeout. Child forwarding rules can be added, edited, removed, or
have desired enablement changed while disconnected; enabled intent is reconciled after Connect.
Native validation passed with 207 tests and 1 ignored; UI validation passed with 1,177 tests, plus
build, lint, formatting, and the local SSH forwarding regression. The accepted Windows-only plan
scope is complete.
