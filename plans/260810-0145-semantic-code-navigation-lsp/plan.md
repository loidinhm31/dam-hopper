---
title: "Semantic Code Navigation via LSP"
description: "Add bounded, authenticated semantic navigation with bundled language-server runtimes and project trust."
status: in-progress
priority: P2
effort: 148h
branch: main
tags: [feature, frontend, backend, api, security, packaging]
created: 2026-08-10
---

# Semantic Code Navigation via LSP

## Overview

Deliver VS Code-like definition, implementation, and reference navigation for Rust and JS/TS first. Monaco uses public providers/actions; a dedicated typed WebSocket reaches a backend-owned LSP registry/supervisor. DamHopper, not the project or host PATH, supplies pinned per-platform server/runtime bundles. Java stays capability-disabled until its separate trust, indexing, and latency gate passes.

## Architecture Invariants

- Explorer language filtering, scans, filesystem events, config load, and tab churn never start an LSP. A supported, hydrated active tab must remain active for 750 ms before one idempotent prewarm; an explicit navigation request bypasses the dwell.
- Browser contracts contain profile/project-relative identities only. Host paths, `file://` URIs, bundle locations, checksums, and raw stderr remain server-side.
- One process per authenticated client/project/descriptor/trust-policy fingerprint; lazy demand, bounded caps/deadlines, cancellation, and idle LRU eviction apply.
- Open buffers sync with monotonic versions; reconnect/restart replays current snapshots; navigation never persists edits.
- V1 executes only DamHopper-bundled, pinned commands. No shell, project executable, download, browser-supplied initialization, extension host, or raw LSP passthrough.
- Restricted is the default per-project policy. Trusted is explicit, persisted, revocable, and changes only server-selected initialization policy; it never lets a project select executables or arguments.
- Missing bundle/capability, restricted limitations, server/indexing/crash states degrade navigation only. Editing, save, terminal, and primary `/ws` remain independent.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---:|---:|---|
| 1 | Contract, trust, bundle, and Monaco compatibility gate | DONE — 2026-08-11 14:01:37 +07:00 | 12h | [phase-01](./phase-01-contract-and-monaco-compatibility-gate.md) |
| 2 | Bundled registry, trust store, supervisor, and lifecycle | Pending | 36h | [phase-02](./phase-02-registry-supervisor-and-resource-lifecycle.md) |
| 3 | Trust-aware semantic WebSocket, sync, and navigation | Pending | 24h | [phase-03](./phase-03-semantic-websocket-document-sync-navigation.md) |
| 4 | Monaco providers, trust UX, and delayed prewarm | Pending | 24h | [phase-04](./phase-04-monaco-providers-and-navigation-ux.md) |
| 5 | Rust + JS/TS release, bundle verification, and rollout gates | Pending | 28h | [phase-05](./phase-05-language-rollout-performance-release-gates.md) |
| 6 | Java enablement and qualification gate | Pending | 24h | [phase-06](./phase-06-java-enablement-and-qualification-gate.md) |

## Dependencies

- Monaco 0.55.1 public provider/action/opener APIs, proven in Phase 1 before UI commitment.
- Release-owned bundles for each supported OS/architecture: `rust-analyzer`; Node runtime plus `typescript-language-server` and `typescript`; JDK plus Eclipse JDT LS. Bundle manifest records version, checksum, license, SBOM component, and size budget.
- Existing `ProjectSandbox`, profile authentication, editor store, shared context menu, Tokio process/runtime, `sysinfo`, and release packaging pipeline.

## Starting Budgets and SLOs

- Enforced: 3 live servers/client, `min(logical CPUs, 8)` global (hard maximum 8), 32 queued requests/server, 2 interactive requests/server, 5 MiB document, 8 MiB LSP frame, 500 targets/1 MiB response.
- Lifecycle: 750 ms stable-active-tab prewarm dwell; 10-minute idle grace; idle LRU first; 250 ms then 1/2/4/8/30 s crash backoff; quarantine after 5 crashes/10 minutes.
- Warm Rust/TS fixture navigation p95 ≤300 ms and p99 ≤1 s; cancellation forwarded ≤100 ms; Rust/TS initialize p95 ≤2 s. Java targets are measured and approved only in Phase 6; indexing is always reported separately.
- RSS warning: 1 GiB/process and 4 GiB aggregate; best-effort termination at 2 GiB/process or 70% available memory only where reliable. Process/queue/deadline caps are enforced; CPU/RSS isolation is otherwise observed, not a kernel sandbox.

## Non-goals

Runtime debugging, completion, hover, diagnostics UI, rename, symbols, call hierarchy, extension marketplace/host, automatic tool download, project-selectable binaries, remote/static index, arbitrary language configuration, and dependency/library-source navigation.

## Rollout Gate

Ship Rust and JS/TS only after Phase 1 selects a public-API UI path; bundle matrix, SBOM/licenses/checksums, offline behavior, and security-update process are verified; and both language fixtures pass definition, implementation, references, unsaved-buffer, cancellation, missing-bundle, crash, reconnect, restricted/trusted/revoked, sandbox, and SLO gates. Java remains disabled until Phase 6 passes. Roll back by disabling the semantic capability; no editor data migration exists.

## Validation Summary

**Validated:** 2026-08-10
**Outcome:** Architecture approved. All required revisions incorporated into Phases 1–6 and the estimate.

- Bundled, pinned per-OS/architecture delivery replaces host-installed tools; supply-chain and offline gates are Phase 5.
- Rust + JS/TS are the initial release; Java has a standalone Phase 6 enablement gate.
- Persisted project trust, confirmation, restricted/trusted policies, and revocation span Phases 1–4 and release tests.
- Prewarm has a fixed 750 ms active-tab dwell and explicit churn proof in Phases 2 and 4.
- Re-estimated from 88h to 148h.

## Unresolved Questions

- Confirm the release target OS/architecture matrix against product support before publishing the Phase 5 manifest; unsupported targets must advertise `bundleUnavailable`, not fall back to host tools.
