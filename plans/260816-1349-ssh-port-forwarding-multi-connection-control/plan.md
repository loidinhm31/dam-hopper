---
title: "Windows SSH Established-Connection Forwarding"
description: "Separate authenticated SSH connections from port rules and retain successful Windows credentials for 30 days without repeated prompts."
status: in-progress
priority: P2
effort: 96h
branch: features/ssh-port-forwarding-control
tags: [feature, native, frontend, ssh, security, windows]
created: 2026-08-16
---

# Windows SSH Established-Connection Forwarding

## Overview

Replace v1's one-session-per-forward lifecycle with explicit target connection establishment. One active DamHopper scope may own up to 16 native-validated connections, 64 enabled rules, and many ports per connection; successful passwords/passphrases remain available from Windows Credential Manager for 30 days.

## Fixed decisions

- Persist credential-free connection profiles and forwarding rules as separate v2 collections in one atomically replaced scope document.
- Key live entries by stable connection profile ID plus numeric expected generation; one established entry owns one reusable russh `SshSession` and independent port children.
- Save successfully authenticated passwords and encrypted-key passphrases in Windows Credential Manager for a fixed 30 days. Disconnect, scope switch, trust change, and shutdown clear live memory but retain the vault entry; Forget, profile delete, scope purge, successful replacement, or expiry removes/replaces it.
- Vault persistence never bypasses endpoint-first host trust. A changed host key blocks before authentication; after explicit repair/approval, the retained credential may be reused.
- Keep one active DamHopper scope, endpoint-first host trust, explicit approval/retry, loopback-only bind/target, numeric counters, authoritative snapshots, event-as-hint semantics, and Windows-only release gates.
- No Axum/server forwarding routes, state, flags, WebSocket events, or changes under `server/`.

## Phases

| # | Phase | Status               | Progress | Effort | Link |
|---|---|----------------------|---:|---:|---|
| 1 | V2 durable contract and atomic migration | Completed 2026-08-16 | 100% | 14h | [phase-01](./phase-01-v2-contract-atomic-migration.md) |
| 2 | Native established-connection registry | Completed 2026-08-17 | 100% | 20h | [phase-02](./phase-02-native-established-connection-registry.md) |
| 3 | Credential vault, trust, and reconnect lifecycle | Completed 2026-08-17 | 100% | 20h | [phase-03](./phase-03-credential-trust-reconnect-lifecycle.md) |
| 4 | Tauri and TypeScript contract compatibility | Completed 2026-08-18 | 100% | 12h | [phase-04](./phase-04-tauri-typescript-contract-compatibility.md) |
| 5 | Explicit-connect multi-port UI | Completed 2026-08-18 | 100% | 14h | [phase-05](./phase-05-explicit-connect-multi-port-ui.md) |
| 6 | Automated and packaged Windows release gates | Complete             | 0% | 16h | [phase-06](./phase-06-tests-windows-release-gates.md) |

## Dependency order

`01 -> 02 -> 03 -> 04 -> 05 -> 06`. Add focused tests inside each phase; Phase 6 is the integrated qualification gate.

## Historical baseline

- `5b0195a`: native manager/store/trust/listener foundation.
- `1db0216`: shared desktop control surface.
- `3fa7b22`: credential prompts, caches, Windows storage/packaging hardening, and four-handshake auto-start.
- `e3cad6c8`: plan/docs completion only; no runtime behavior.
- HEAD `91fbce5`: no later forwarding implementation after `3fa7b22`.

## Rollout and rollback

- Migrate validated v1 data transactionally on first v2 scope load; preserve a protected pre-migration v1 rollback artifact and never publish half-migrated collections.
- Roll back failed migration automatically. For binary rollback, stop DamHopper, restore the retained v1 artifact, then install the prior package. Never down-convert live v2 state in process.
- Before binary rollback, use v2 Forget actions to delete saved vault entries. Older binaries cannot use them but also cannot perform the 30-day expiry sweep.
- Ship only after commit-bound packaged Windows evidence passes. Non-Windows/mobile hosts remain unavailable and command-free.

## Unresolved Questions

None.
