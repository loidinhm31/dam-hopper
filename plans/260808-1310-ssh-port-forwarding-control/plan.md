---
title: "Native SSH Port-Forwarding Control"
description: "Add ordered desktop-local SSH forwarding through a narrow Tauri/Rust capability and browser-safe shared UI host."
status: in_progress
priority: P2
effort: 88h
branch: features/ssh-port-forwarding
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
| 2 | Contracts, persistence, scope retention | Design only — durable store blocked pending Phase 01 secure-store GO | 0% | 12h | [Phase 02](./phase-02-native-contracts-persistence.md) |
| 3 | SSH transport, credentials, trust, errors | Pending | 0% | 14h | [Phase 03](./phase-03-ssh-transport-trust.md) |
| 4 | Manager ordering, lifecycle, IPC, shutdown | Pending | 0% | 16h | [Phase 04](./phase-04-native-manager-tauri-ipc.md) |
| 5 | Browser-safe host and ordered adapter | Pending | 0% | 10h | [Phase 05](./phase-05-host-context-native-adapter.md) |
| 6 | Desktop-only control surface | Pending | 0% | 10h | [Phase 06](./phase-06-desktop-control-surface.md) |
| 7 | Deferred cross-platform and product release gates | Deferred | 0% | 16h | [Phase 07](./phase-07-cross-platform-release-gates.md) |

## Explicit non-goals

- No remote forwarding, SOCKS, IPv6, remote non-loopback target, local-client auth claim, password, encrypted-key prompt, keychain, arbitrary SSH option/path, or browser/mobile fallback.
- No server feature flag/API/manager/store/event/credential reuse and no removal/refactor of existing server forwarding/SSH/PTY behavior.
- No runtime updater/restart/relaunch in v1; updater artifacts remain packaging metadata until coordinator-backed packaged disposal is proven.

## Release dependencies

- Windows Phase 01 go decision for exact SSH crate/crypto/agent/ACL and Windows storage graph.
- Windows automated/package runtime evidence; Linux/macOS/iOS evidence is deferred with platform expansion.
- Security approval of ACL/trust/target/remediation and product acceptance of other-local-process exposure.
- The 88h estimate remains conditional on Windows-only Phase 01 proofs. Any failed mandatory Windows gate, fallback, updater/relaunch enablement, or trust-repair primitive gap stops later phases. Adding Linux/macOS/iOS support requires a separate scope and estimate review.

## Unresolved Questions

## Current status

**2026-08-10 — Phase 01 limited GO:** Windows OpenSSH named-pipe identity listing and signing passed with a disposable Ed25519 identity. The retained-handle storage probes cover junction, hard-link, ancestor-junction, atomic-replace, locking, and name-swap denial. Phase 02 durable-store work remains blocked until per-operation race and fault coverage is complete. Linux/macOS/iOS evidence remains deferred.

- Phase 02 must retain the approved `russh`/`ring` and Windows OpenSSH named-pipe choices until a separate security review changes them.
- Named release/security/product owners and protected runtime-evidence environment must be configured.
- Non-Windows support wording and release evidence remain deferred until a future scope expansion.
