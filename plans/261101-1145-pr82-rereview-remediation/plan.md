---
title: "PR #82 re-review: preserve late chunks and bound ambiguity"
description: "Keep verified late tool results on their original registration and bound ambiguity history without weakening outstanding-collision rejection."
status: pending
priority: P2
effort: 4h
branch: feat/session-changes-omp
tags: [bugfix, backend, tech-debt]
created: 2026-11-01
---

# PR #82 Re-review Remediation

Authoring disposition: submitted for review; implementation not authorized by this document. Required installed frontmatter uses `pending`, not unsupported `ready-for-review`. Independent review and final validation belong to the coordinating route and remain unclaimed.

## Problem Statement

- **P2:** A verified result originating in session A can need multiple `/capture` requests. Switching to B before delivery or between requests causes the loop to stop after its first request, losing server-side file records for later chunks.
- **P3:** `sharedAmbiguousCalls` retains every observed collision indefinitely; `clear()` leaves that set and consumed-key tombstones behind. Repeated sessions accumulate memory and stale rejection state.
- Outcome: deliver all result-only paths to their verified origin while that exact registration remains live and the original deadline permits; retain bounded duplicate/ambiguity state and safe reset fencing.

## Root Cause

- [`handleToolResult`](../../server/src/agent_status/assets/omp-session-changes.ts#L1107), especially lines 1271–1294, finds the correct pending descriptor but then uses ambient `globalGeneration`/`activeSessionId` as post-await ownership. A normal switch changes these without invalidating retained A.
- Registry lines 509–626, producer collision insertion lines 893–898, and agentless lookup lines 1143–1160 conflate live collisions with permanent history. `clear()` also resets `globalGeneration` to zero, allowing old/new async generations to compare equal after reset (ABA).
- Existing [regressions](../../server/tests/omp-session-changes.test.ts#L687) check one late path and in-memory sets, not complete multi-chunk wire delivery; collision tests do not churn history or reset the registry.

## Architecture & Contracts

1. Preserve authoritative `(ompSessionId, agentId, toolCallId)` descriptor matching, atomic consumption and bounded consumed-key tombstones; never fall back to B for a missing/ambiguous A descriptor.
2. Once matched and tuple-validated, capture `originalRoot`, its immutable identity values `(ompSessionId, serverEpoch, terminalIncarnation, rootId, baselineId)`, and the registry reset epoch. Before **every** result-chunk request and immediately after **every** awaited request, require `this.registry.roots.get(root.ompSessionId) === originalRoot`, unchanged tuple/epoch, `!root.disabled && !this.isPermanentlyDisabled`, and recomputed `remainingMs > 0`.
3. Remove both ambient active-session and switch-generation checks **only from verified result delivery**. Session switches retain A; removal, replacement (even equal tuple), tuple mutation, reset, disablement and deadline exhaustion stop undispatched chunks. Do not undo a request already sent.
4. Derive outstanding ambiguity directly from `pendingCalls`: zero matches rejects, at least two matches always reject agentless lookup, exactly one is eligible only if absent from recent history. Replace `sharedAmbiguousCalls` with insertion-ordered `ambiguousCallHistory`, capped at `MAX_PENDING_CALLS` (128), refreshing collision recency and evicting oldest history only. Explicit agent matching remains unchanged.
5. `clear()` empties `consumedCallKeys` and `ambiguousCallHistory` alongside existing maps; a monotonic registry-instance reset epoch advances and never resets/repeats. Async registration and shared-state publication must compare their captured epoch so pre-clear work cannot repopulate or disable a new registry lifecycle.
6. Reuse `chunkCapturePaths`, UTF-8 request bounds, original single 1500 ms budget, fail-open behavior and unknown/unproven classification. No retries, queues, persistence, protocol/schema changes, broader pre-edit switch-policy rewrite, UI work or Agent Status changes.
7. Bounded history deliberately forgets old ambiguity; it is not lifetime duplicate proof. Live multi-descriptor ambiguity is never evicted with history. Detailed lifecycle, ordering, limits and test oracles are in the phase contracts.

## Implementation Phases

| Phase | Owner | Effort | Status | Artifact |
| --- | --- | --- | --- | --- |
| 01 | Single producer integration owner | 3.5h | Pending | [Producer repair, regressions and qualification](phase-01-producer-repair-and-regressions.md) |
| 02 | Documentation owner, after Phase 01 | 0.5h | Pending | [Architecture reconciliation and changelog](phase-02-documentation-and-handoff.md) |

Task dependency: `repair-producer-lifecycle -> document-producer-remediation`. Phase 01 owns both source findings and all tests to avoid competing writers; coordinator runs its coherent verification once after those edits land. Phase 02 changes Markdown only.

## Verification Plan

- Deterministic Bun regressions: A→B before multi-chunk delivery; switch during paused chunk 1; remove/replace/tuple-change/reset/disable/deadline during paused chunk 1; all-path origin assertions from recorded HTTP requests, not only `unprovenPaths`.
- Ambiguity regressions: overflow recent history while two target descriptors remain pending; agentless lookup still rejects without consuming either. Verify recent-history rejection with one survivor, explicit-agent routing, both 128-entry bounds and full reset cleanup/ABA fencing.
- Coordinator, after implementation: build both existing assets into an isolated temporary directory, run `bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts`, and collect independent code review. Exact commands, required assertions and cleanup are in Phase 01. No builds/tests executed during authoring.
- Planning review is required for lifecycle/concurrency risk; route owns that review and optional/required final interview. Valid durable task fences and links are authoring output, not hydrated task state or approval.

## Remaining Risks

- A chunk already dispatched before invalidation may reach the server; this repair stops subsequent work and preserves existing server tuple enforcement, not transport rollback or exactly-once delivery.
- Deadline/capacity rejection can still leave undispatched paths unproven locally; intentionally no retry/backfill and no claim that all possible tool paths become server records.
- History eviction permits very old agentless ambiguity to be forgotten when fewer than two descriptors remain; bounded-memory tradeoff is explicit. Caller-supplied origin IDs remain preferable.
- [Related refactor](../261031-0949-lightweight-session-changes-refactor/plan.md), particularly Phase 03, overlaps source/tests; informational predecessor, no task-state import or edit. Its open live OMP/Tauri qualification is not closed here. Coordinator must serialize any concurrent writer of these paths or docs.
- Architecture contract is reviewed here as proposed design, not a claim of deployed behavior; coordinator retains architecture-gate review before execution. Rollback: disable tracking using existing server setting; revert only authorized remediation changes, never user work or restore unbounded tracking as a permanent fallback.

## Unresolved Questions

None on implementation scope/design. Independent review and coordinator-owned validation remain pending gates, not unanswered product decisions.
