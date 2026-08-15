---
title: "Native SSH Port-Forwarding Control"
description: "Add ordered desktop-local SSH forwarding through a narrow Tauri/Rust capability and browser-safe shared UI host."
status: blocked
priority: P2
effort: 88h
branch: features/ssh-port-forwarding-control
tags: [feature, native, frontend, rust, ssh, security]
created: 2026-08-08
---

# Native SSH Port-Forwarding Control

## Overview

Implement SSH local forwarding in Tauri desktop: shared React UI -> `SshForwardHost` -> 12-command desktop IPC -> native Rust manager -> desktop `127.0.0.1` listener -> SSH `direct-tcpip` -> remote `127.0.0.1` target. Browser, native mobile, Axum, existing server forwarding/SSH/PTY, and shared WebSocket transport remain outside the feature.

## Architecture constraints

- V1: local forwarding only; fixed ports `1..=65535`; desktop bind and remote target host exactly `127.0.0.1`; no IPv6/wildcard/port 0/non-loopback target.
- Active `ServerProfile` hostname and port 22 only prefill a new reviewed form. Saved SSH endpoint never follows HTTP URL edits.
- Stable desktop identity + per-process manager session + Rust-issued client epoch + caller-monotonic decimal activation token make A/B/C ordering manager-authoritative across reloads.
- All IPC revisions/generations/epochs/tokens are canonical decimal strings on the wire, parsed to `u64`/`BigInt` and compared numerically; lexical comparison is forbidden. Timestamps are RFC3339 UTC milliseconds. Overflow fails closed.
- `app_config_dir` stores hashed per-scope profiles/trust/meta; runtime is memory-only. Observed profile deletion purges inactive scope; unobserved orphans quarantine 30 days.
- Every native store/backup/quarantine/purge uses contained no-follow/reparse-safe handles. Changed trust uses a stopped-app locked maintenance mode and protected recovery, never IPC override.
- OS agent preferred; optional opaque no-follow inventory for safe unencrypted keys. No path/passphrase/keychain/password/shell/general filesystem capability.
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
| 7 | Deferred cross-platform and product release gates | In progress (Windows subset only) | 35% | 16h | [Phase 07](./phase-07-cross-platform-release-gates.md) |

## Explicit non-goals

- No remote forwarding, SOCKS, IPv6, remote non-loopback target, local-client auth claim, password, encrypted-key prompt, keychain, arbitrary SSH option/path, or browser/mobile fallback.
- No server feature flag/API/manager/store/event/credential reuse and no removal/refactor of existing server forwarding/SSH/PTY behavior.
- No runtime updater/restart/relaunch in v1; updater artifacts remain packaging metadata until coordinator-backed packaged disposal is proven.

## Release dependencies

- Windows Phase 01 limited GO for exact SSH crate/crypto/agent/ACL and Windows storage graph; Phase 02 contract design may proceed.
- Durable-store implementation remains blocked pending production deterministic per-operation race/fault coverage and durable replacement proof.
- Windows automated/package runtime evidence; Linux/macOS/iOS evidence is deferred with platform expansion.
- Security approval of ACL/trust/target/remediation and product acceptance of other-local-process exposure.
- The 88h estimate remains conditional on Windows-only Phase 01 proofs. Any failed mandatory Windows gate, fallback, updater/relaunch enablement, or trust-repair primitive gap stops later phases. Adding Linux/macOS/iOS support requires a separate scope and estimate review.

## Unresolved Questions

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

**2026-08-15T22:39:00+07:00 - Phase 07 final Windows-only review:** The Windows subset is implemented and validated for temporary OpenSSH remote-loopback E2E, redacted evidence schema/validator, exact artifact/hash and commit binding, protected approval-ID binding, native Rust/CI/release pre-bundle checks, WebView2/OpenSSH preflight, and the NSIS package profile. The unsigned profile disables updater artifact creation because signing credentials and an updater endpoint are unavailable; runtime updater/relaunch remains absent. Protected packaged-runtime evidence, release-engineer/security-reviewer/product-owner approvals, macOS/Linux/Android/iOS gates, signed updater artifacts, and final product/security acceptance remain pending. Overall plan status remains **blocked**; Phase 07 remains incomplete.
