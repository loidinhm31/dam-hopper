# Phase 05 Documentation Management Report: Authenticated Semantic WebSocket Gateway

**Date:** 2026-10-23  
**Author:** EvcDocsManager  
**Scope:** Architecture and technical documentation for the authenticated semantic WebSocket gateway (`/ws/semantic/v1`) under Phase 05 of the TypeScript/JavaScript LSP Server Integration plan.  
**File Output:** `plans/reports/docs-manager-261023-1514-phase-05-gateway.md`  

---

## 1. Executive Summary

Phase 05 delivered the dedicated, authenticated semantic WebSocket gateway (`/ws/semantic/v1`) for TypeScript/JavaScript language server operations. The implementation establishes:
- Exact subprotocol negotiation (`dam-hopper.semantic.lsp.v1`).
- Origin allowlist and authentication policy parity with core `/ws`, integrated with client presence reservations.
- Cancellation-first live auth watcher invalidating supervisor admission and reaping child process trees before network close delivery.
- Finite resource boundaries: 4 MiB max frame/message size, token-bucket rate limiter (40 tokens/s refill, burst 80 tokens), and max 8 concurrent in-flight navigation requests.
- Filtered JSON-RPC 2.0 lifecycle allowlist (`damHopper/attachTarget`, `initialize`, `initialized`, `textDocument/didOpen`, `textDocument/didChange`, `textDocument/didClose`, `textDocument/definition`, `textDocument/implementation`, `$/cancelRequest`, `shutdown`, `exit`).
- Strict bidirectional virtual URI containment (`dam-hopper://semantic/<target-id>/<encoded-path>`), single percent-decode, path traversal rejection, and non-disclosing `outsideTarget: true` filtering.

Documentation was created and updated across `docs/architecture/`, `docs/api/`, `docs/system-architecture.md`, `docs/code-standards.md`, `docs/ws-protocol-guide.md`, `docs/api-reference.md`, and `docs/codebase-summary.md`. All files conform to the 800 LOC limit (`docs.maxLoc`). Link checks confirmed 298 working internal links (45 in `docs/architecture/`) with 0 broken links; heuristic code-reference/config-key scanner warnings remain.

---

## 2. Documentation Changes

### A. New Architectural Specification: `docs/architecture/semantic-websocket-gateway.md` (252 LOC)
Created comprehensive architectural reference for the `/ws/semantic/v1` gateway:
1. **Scope and Isolation:** Delineates independent socket tasks, bounded queues, and complete decoupling from core `/ws` multiplexed channels. Explains default-disabled supervisor state (`is_enabled() == false`).
2. **Handshake & Auth Parity:** Details subprotocol negotiation, Origin allowlist validation (`websocket_origin_allowed`), token query precedence over cookies, V2 claims evaluation, and presence upgrade reservation (`PendingUpgradeGuard`).
3. **Cancellation-First Live Invalidation:** Specifies 5-second polling interval, 2-second persistent store lookup bound, and strict three-stage invalidation order (supervisor admission revocation + tree reaping FIRST -> close code delivery -> reader/writer task cancellation).
4. **Resource Bounds & Rate Limiting:** Documents 4 MiB frame/message cap (`MAX_FRAME_BODY_BYTES`), token-bucket limiter (40 msg/s sustainable, 80 burst; throttling with `-32004 RATE_LIMIT_EXCEEDED`), max 8 in-flight navigation requests (`MAX_IN_FLIGHT_REQUESTS`), 32 outbound queue depth, 2s send timeout, and 60s inactivity timeout.
5. **Filtered JSON-RPC Profile:** Documents strict lifecycle state machine (`Unattached` -> `Attached` -> `Initializing` -> `Ready` -> `ShuttingDown` -> `Terminated`), supported method allowlist, and `damHopperDocumentVersion` extension requirement and stripping.
6. **Virtual URI Grammar & Containment:** Documents `dam-hopper://semantic/<target-id>/<encoded-path>`, single percent-decode, traversal/NUL/drive/separator rejection, RFC 3986 unreserved character rules, `dunce::canonicalize` symlink escape prevention, and `outsideTarget: true` filtering.
7. **Taxonomy:** Tables for WebSocket close codes (`1000`, `1008`, `1011`, `1013`, `4401`, `4403`) and standard/DamHopper JSON-RPC error codes (`-32700`, `-32600`, `-32601`, `-32602`, `-32603`, `-32000` to `-32005`).

### B. Updated API Documentation: `docs/api/websocket.md` (141 LOC)
- Added dedicated section `## Semantic WebSocket Gateway (/ws/semantic/v1)` alongside `## Core WebSocket Endpoint (/ws)`.
- Documented handshake parameters, required subprotocol header, origin rules, JSON-RPC single-object format, rate limits, filtered method table, virtual URI grammar, and error/close codes.
- Added cross-links to detailed architectural specification.

### C. Updated Protocol Guide: `docs/ws-protocol-guide.md` (611 LOC)
- Scoped blanket `kind` envelope specification explicitly to the core multiplexed `/ws` route (`## Core Multiplexed Route (/ws) Message Format`).
- Added prominent notice clarifying that `/ws/semantic/v1` uses JSON-RPC 2.0 frames with `dam-hopper.semantic.lsp.v1` subprotocol rather than `{ kind: ... }`.

### D. Updated API Reference Index: `docs/api-reference.md` (85 LOC)
- Updated WebSocket route entry to reference both core multiplexed WebSocket (`/ws`) and dedicated semantic gateway (`/ws/semantic/v1`).

### E. Updated System Architecture: `docs/system-architecture.md` (616 LOC)
- Updated Code Boundaries section to list `/ws/semantic/v1` under `server/src/api/` and `semantic` domain under `server/src/`.
- Cross-referenced `docs/architecture/semantic-websocket-gateway.md`.

### F. Updated Code Standards: `docs/code-standards.md` (147 LOC)
- Added durable standards under `### TypeScript/JavaScript LSP Semantic Navigation Subsystem`:
  - WebSocket gateway & subprotocol isolation.
  - Cancellation-first live auth invalidation sequence.
  - Finite framing (4 MiB), token-bucket rate limiting (40/80 tokens/s), and in-flight concurrency caps (8).
  - Filtered JSON-RPC profile and `damHopperDocumentVersion` extension stripping.
  - Bidirectional virtual URI containment, single percent-decode, and `outsideTarget: true` filtering.

### G. Updated Codebase Summary: `docs/codebase-summary.md` (99 LOC)
- Updated backend inventory table row for `semantic/` (14 files, 6,078 LOC plus `semantic_ws.rs`).
- Updated subsystem summaries (lines 50 and 85) to record Phase 05 completion and deliverables.

---

## 3. Metrics & File Line Counts

All documentation files remain strictly within the `docs.maxLoc` ceiling (800 LOC):

| File | Status | LOC | Ceiling | Headroom |
| --- | --- | ---:| ---:| ---:|
| `docs/architecture/semantic-websocket-gateway.md` | Created | 260 | 800 | 540 lines |
| `docs/api/websocket.md` | Modified | 146 | 800 | 654 lines |
| `docs/ws-protocol-guide.md` | Modified | 611 | 800 | 189 lines |
| `docs/api-reference.md` | Modified | 85 | 800 | 715 lines |
| `docs/system-architecture.md` | Modified | 616 | 800 | 184 lines |
| `docs/code-standards.md` | Modified | 147 | 800 | 653 lines |
| `docs/codebase-summary.md` | Modified | 99 | 800 | 701 lines |
| `docs/CHANGELOG.md` | Verified (PM-managed) | 687 | 800 | 113 lines |

---

## 4. Quality Assurance & Validation

- **Link & Reference Validation:** Ran `node ~/.omp/agent/evcrate/scripts/validate-docs.cjs docs/`. Confirmed 298 working internal links with 0 broken links. Scoped run on `docs/architecture/` confirmed 45 working internal links with 0 broken links. The validator reported heuristic code-reference and config-key warnings (e.g. flagging PascalCase identifiers and ALL_CAPS constants in prose); link integrity across the documentation tree is verified.
- **Evidence Cross-Referencing:** Verified contracts directly against source implementation in `server/src/api/semantic_ws.rs`, `server/src/semantic/gateway.rs`, `server/src/semantic/uri.rs`, and `server/src/semantic/resources.rs`.
- **Test Evidence Attribution:** Scoped semantic test suite execution documented in `plans/reports/tester-261023-1514-phase-05-gateway.md` (87 scoped semantic/gateway checks passing, 141 total Cycle 2 checks passing) and Cycle 3 code review report (`plans/reports/code-reviewer-261023-1514-phase-05-gateway-cycle-3.md`, 64 unit/integration tests).
- **Coordination with Peers:** Coordinated with `EvcProjectManager` on `docs/CHANGELOG.md`, `docs/project-roadmap.md`, `plans/260901-1000-lsp-server-integration/plan.md`, and `phase-05-authenticated-semantic-websocket-gateway.md` without race conditions or conflicting edits.

---

## 5. Unresolved Questions & Implementation Notes

1. **`outsideTarget` Classification Folding:** In `server/src/semantic/uri.rs:filter_single_location_or_link`, malformed child location items (e.g. non-object or non-string URI) return `Ok(None)`, which folds into the `outsideTarget` counter. Thus an entirely malformed child array produces `{"outsideTarget": true}`. Documented as current behavior; tracked for refinement in Phase 06/07.
2. **Cancelled Request ID Echoing (Tracked W-B):** Tracked review item W-B notes that cancelled requests currently respond with `id: null` rather than the client's original ID. Documented client-side implications; fix scheduled for Phase 06/07.
3. **Invalid Request ID Handling (Tracked W-C):** Requests with invalid ID types (e.g. boolean, array, or object) return error frames with `id: null` rather than echoing the invalid value. Documented in public API; tracked for Phase 06/07.
4. **Reader Loop Termination on Dead Outbound Writer (Tracked W-A):** If incoming traffic keeps resetting the 60-second read timeout, an active client can keep the reader loop alive after its writer dies. Documented as a known limitation; explicit select arm (`outbound_tx.closed()`) scheduled for Phase 06/08.
5. **Pre-Actor Rejection Overlay Desync (Tracked W-D):** Pre-actor validation errors on subsequent operations trigger explicit `did_close` to prevent in-memory overlay desynchronization. Documented for Phase 06/07.
6. **Unopened Destination Coordinate Freshness (Tracked G5):** Destination coordinate association for unopened files remains an open gate tracked for Phase 07/09.
