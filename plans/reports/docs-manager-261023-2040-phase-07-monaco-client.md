# Documentation Manager Report: Phase 07 Shared Monaco Semantic Client & Navigation

- **Date:** 2026-10-23
- **Author:** DocsManagerPhase07 (Senior Technical Documentation Specialist)
- **Scope:** Technical documentation synchronization for Phase 07 (Shared Monaco semantic client and navigation) under `plans/260901-1000-lsp-server-integration/`
- **Plan Reference:** `plans/260901-1000-lsp-server-integration/phase-07-shared-monaco-semantic-client-and-navigation.md`
- **Review Predecessors:**
  - `plans/reports/tester-261023-2012-phase-07-monaco-client.md` (Cycle 2 validation)
  - `plans/reports/code-reviewer-261023-2030-phase-07-monaco-client-cycle-3.md` (Cycle 3 review: 6/10, not approved)

---

## 1. Current State Assessment

Phase 07 integrates the narrow TypeScript and JavaScript LSP client into the Monaco editor and React application lifecycle. It implements:
- `SemanticClient` (`packages/ui/src/api/semantic-client.ts`): owner-bound `/ws/semantic/v1` client with `dam-hopper.semantic.lsp.v1` subprotocol, 64 KiB single-capability adaptive sync, and sequential document queues.
- `SemanticModelRegistry` (`packages/ui/src/lib/semantic-model-uri.ts`): decouples stable local Monaco model identity (`inmemory://dam-hopper/...`) from replaceable session wire bindings (`dam-hopper://semantic/<target-id>/<encoded-relative-path>`).
- `SemanticMonacoManager` (`packages/ui/src/lib/semantic-monaco.ts`): model-scoped `DefinitionProvider` and `ImplementationProvider` delegating semantic models to `SemanticClient` and falling back to Monaco's built-in TypeScript worker for non-semantic models.
- `useSemanticNavigationStore` (`packages/ui/src/stores/semantic-navigation.ts`): ephemeral navigation state and 10s TTL `NavigationRevealIntent` routing.
- Host integration in `MonacoHost.tsx`, `EditorTabs.tsx`, and `editor.ts`.
- Server gateway updates (`server/src/semantic/gateway.rs`, `server/src/semantic/session.rs`): `RPC_ERR_REQUEST_CANCELLED = -32800` propagation and malformed-change desync protection (document closure).

Documentation across `docs/` required synchronization to reflect these delivered primitives while maintaining strict accuracy regarding qualification boundaries (G8 component browser mode qualified; full Playwright E2E journey testing against live containerized language servers deferred to Phase 10) and known review findings (e.g., C-1 client ref caching across generation shifts).

---

## 2. Changes Made

### A. `docs/codebase-summary.md`
- **Repomix Metrics:** Updated snapshot to latest repomix compaction: 3,230 files, 8,051,909 tokens packed, 33,849,870 characters (excluding dot-folders, build artifacts, lockfiles, and 7 security-flagged source/test files).
- **Backend Subsystem Map:** Updated `semantic/` row to 15 files and 6,637 LOC, noting Phase 07 gateway/session cancellation propagation (`-32800`) and malformed-change desync protection via document closure.
- **Shared UI Map:** Updated module inventories:
  - `components/`: 239 files, ~53k LOC (including `MonacoHost.tsx`, `EditorTabs.tsx`, and `MonacoHost.semantic.test.tsx`).
  - `api/`: 28 files, ~19.1k LOC (including `semantic-client.ts` and `semantic-client.test.ts`).
  - `lib/`: 124 files, ~16.8k LOC (including `semantic-model-uri.ts`, `semantic-monaco.ts`, and test suites).
  - `stores/`: 12 files, ~4.3k LOC (including `semantic-navigation.ts` and test suite).
- **Current Architecture & Invariants:** Added comprehensive description of Phase 07 shared Monaco semantic client, stable model registry, adaptive sync, model-scoped providers, ephemeral reveal intents, and test boundaries.

### B. `docs/system-architecture.md`
- **Code Boundaries:** Updated overview to reference semantic language server client and Monaco semantic navigation in `packages/ui/src/` and cancellation handling in `server/src/semantic/`.
- **Phase 07 Primitives Subsection:** Added `### Implemented Primitives: Phase 07 Shared Monaco Semantic Client and Navigation` detailing:
  - Stable local model identity vs. replaceable wire bindings (`SemanticModelRegistry`).
  - Owner-bound `SemanticClient` lifecycle and 64 KiB adaptive sync.
  - Model-scoped Monaco provider integration (`SemanticMonacoManager`).
  - Ephemeral reveal coordination and editor lifecycle (`useSemanticNavigationStore`, `NavigationRevealIntent`).
  - Reconnection guarantees and qualified boundaries (documenting that local model retains text/undo/view state, while client ref refresh across generation shifts is tracked under review item C-1).
  - Backend gateway integration: cancellation completed with original request ID (`-32800`) and malformed-change document closure.
  - Browser qualification status: G8 provider coexistence verified in Chromium component mode; full application journey qualification deferred to Phase 10.
- **Production Qualification Subsection:** Replaced provisional notes with `### Remaining Production Qualification (Phase 10)` covering G2 bundle ceilings and live language server container Playwright journeys.

### C. `docs/architecture/semantic-websocket-gateway.md`
- **Specification Status:** Updated header to `Phase 05 Delivered; Phase 07 Shared Monaco Client Integrated`.
- **JSON-RPC Error Code Taxonomy:** Added `-32800` (`REQUEST_CANCELLED` / `Client cancelled request via $/cancelRequest or session interrupted`).
- **Canonical Client Architecture Section:** Added `## Client Integration: Shared Monaco Semantic Client (Phase 07)` detailing:
  1. Connection lifecycle and subprotocol handshake (`dam-hopper.semantic.lsp.v1`, `?token=...`).
  2. Stable local identity vs. replaceable wire bindings (`dam-hopper://semantic/<target-id>/<encoded-relative-path>`).
  3. Adaptive document synchronization (<64 KiB full, ≥64 KiB incremental) and monotonic wire versions.
  4. Model-scoped Monaco provider coexistence and clean mode restoration to defaults (`definitions: true, implementations: true`).
  5. Ephemeral reveal coordination (10s TTL, zero localStorage persistence of document text or intents).
  6. Gateway cancellation and desync protection hardening.

### D. `docs/architecture/workbench-files-editor-and-git.md`
- **Monaco Semantic Navigation Subsection:** Added `### Monaco Semantic Navigation Integration` under Editor and Previews detailing local in-memory model URI preservation, wire binding separation, reconnect text/undo retention, and cross-document reveal routing, linking to the canonical gateway client specification.

### E. `docs/frontend-components/terminal-and-ide.md`
- **Monaco Semantic Navigation Integration Subsection:** Added concise summary under editor viewState persistence documenting locations (`MonacoHost.tsx`, `EditorTabs.tsx`, `semantic-client.ts`, `semantic-model-uri.ts`, `semantic-monaco.ts`), purpose, stable identity mapping, adaptive wire sync, and reveal coordination. Maintained file size at 768 LOC (<800 LOC ceiling).

### F. `docs/api/websocket.md`
- **Reconciliation of Outdated Phase 05 Text:**
  - Updated subsystem state to document runtime administrative hot-toggle via `PATCH /api/semantic/settings` (Phase 06).
  - Updated inactivity & writer decoupling to document reader termination on writer closure (`outbound_tx.closed()`, Phase 07).
  - Corrected deviation notes: removed outdated claim that cancelled requests reply with `{ id: null }`; documented that cancelled requests echo original client request ID with `-32800 REQUEST_CANCELLED`.
  - Added malformed change desync protection note (document closure).
  - Added `-32800` (`REQUEST_CANCELLED`) to JSON-RPC error codes list.

### G. `docs/project-overview-pdr.md`
- **PR-029 Status:** Updated requirement status to reflect Phase 07 shared Monaco client delivery and explicit G8 qualification boundaries.
- **Acceptance Criteria:** Updated semantic code navigation section to document Phase 07 client integration, adaptive 64 KiB sync, model-scoped provider coexistence, and Phase 10 qualification deferral.

### H. Coordinated Files Preserved
- `docs/project-roadmap.md` and `docs/CHANGELOG.md` were retained from concurrent PM coordination (`ProjectManagerPhase07`).
- Plan files under `plans/260901-1000-lsp-server-integration/` remained untouched.

---

## 3. Gaps Identified & Open Review Items

1. **MonacoHost Client-Ref Caching (C-1):** `MonacoHost.tsx` caches `semanticClientRef` in a deps-limited effect. On connection generation change or socket drop, edits route to the disposed client while the new client diverges. Documented as a qualified boundary; implementation remediation tracked for Cycle 4.
2. **G8 Full Application Proof:** Component browser tests (`semantic-navigation.browser.tsx`) verify provider coexistence in headless Chromium, but full end-to-end multi-tab application journeys and live TSLS process execution in real browser DOMs remain open for Phase 10.
3. **Destination Freshness (W-1):** Destination reveal intents coordinate coordinates without verifying post-load content version hash; documented as unqualified.
4. **Visible Client Status UI (W-2):** `clientStatuses` are stored in zustand but not yet rendered in editor UI status bars; errors currently fold into empty results.

---

## 4. Recommendations

1. **Cycle 4 Remediation:** Resolve C-1 by resolving `findClientForTab(tabKey)` dynamically at call time in `onChange` and subscribing to client generation in effect deps.
2. **Status Indicator Component:** Surface `clientStatuses` (connecting, replaying, ready, error, unsupported) in an editor tab header badge or Monaco status bar item.
3. **Phase 10 E2E Playwright Suite:** Implement Playwright journey exercising simultaneous owned and non-owned TS models with real TSLS background processes in containerized production build.
4. **Modularization Watch:** `docs/frontend-components/terminal-and-ide.md` is currently at 768 LOC; if further IDE components are added, split into topic subdirectories (`docs/frontend-components/terminal/` and `ide/`).

---

## 5. Metrics & Validation Results

### Documentation Size Limits (`docs.maxLoc`: 800 LOC)
| Documentation File | LOC Before | LOC After | Headroom | Status |
|---|---:|---:|---:|---|
| `docs/codebase-summary.md` | 99 | 99 | 701 | PASS |
| `docs/system-architecture.md` | 638 | 667 | 133 | PASS |
| `docs/architecture/semantic-websocket-gateway.md` | 259 | 304 | 496 | PASS |
| `docs/architecture/workbench-files-editor-and-git.md` | 294 | 304 | 496 | PASS |
| `docs/frontend-components/terminal-and-ide.md` | 758 | 768 | 32 | PASS |
| `docs/api/websocket.md` | 145 | 146 | 654 | PASS |
| `docs/project-overview-pdr.md` | 141 | 142 | 658 | PASS |

*All 71 markdown files across `docs/` are strictly under 800 LOC.*

### Validation Commands & Results
- **Repomix Codebase Compaction:**
  `repomix` -> 3,230 files packed, 8,051,909 tokens, 33,849,870 characters (7 suspicious files excluded). Packed output in `repomix-output.xml` (gitignored).
- **Documentation Validation Script:**
  `node /home/loidinh/.omp/agent/evcrate/scripts/validate-docs.cjs docs/`:
  - Scanned: 33 files.
  - Internal Links: 300/300 working (0 broken links).
  - Code references: 5 confirmed, 802 heuristic warnings (triaged; historical terms in CHANGELOG and architectural prose).
  - Config keys: 305 heuristic warnings (triaged; environment constants not in `.env.example`).
- **Source Verification:**
  All referenced symbols (`SemanticClient`, `SemanticModelRegistry`, `SemanticMonacoManager`, `useSemanticNavigationStore`, `monacoPositionToLsp`, `lspRangeToMonaco`, `buildLocalModelUri`, `parseSemanticWireUri`, `RPC_ERR_REQUEST_CANCELLED = -32800`, `SessionError::Cancelled`) verified directly against source files.

---

## 6. Unresolved Questions

1. Should `SemanticMonacoManager` preserve and restore previous Monaco TypeScript mode configuration options rather than resetting to unconditional defaults (`definitions: true, implementations: true`) upon deactivation?
2. When client status transitions to `error` or `unsupported`, should Monaco immediately fallback to the built-in TypeScript worker or display an inline diagnostic banner indicating language server failure?
