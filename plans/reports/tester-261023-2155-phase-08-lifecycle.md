# Test Report: Phase 08 — Lifecycle Invalidation and Recovery (Cycle 2)

- **Date**: 2026-10-23 | **Author**: EvcTester (Senior QA Execution Specialist)
- **Operation**: `run` (code validation) | **Authority**: Execution and reporting only; zero source/test/CI edits.
- **Plan**: `plans/260901-1000-lsp-server-integration/phase-08-lifecycle-invalidation-and-recovery.md`
- **Worktree**: `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration`
- **Verdict**: **PASS (Requested Scope); Phase 08 acceptance not established.** (100% pass rate in requested scope; global acceptance remains unexercised).

---

## 1. Request & Execution Scope

Re-validate Phase 08 Lifecycle Invalidation and Recovery after review fixes:
1. **Backend Semantic Integration Suites**: `cargo test --manifest-path server/Cargo.toml --test 'semantic_*'`
2. **Frontend UI Semantic Suites**: `pnpm --filter @dam-hopper/ui test src/stores/semantic-navigation.test.ts src/lib/semantic-monaco.test.ts src/lib/semantic-model-uri.test.ts src/api/semantic-client.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx src/components/organisms/EditorStatusBar.test.tsx src/stores/editor.test.ts`
3. **Backend Typecheck**: `cargo check --manifest-path server/Cargo.toml`
4. **Frontend Typecheck**: `pnpm --filter @dam-hopper/ui exec tsc --noEmit`
5. **Supplementary Checks**: `cargo check --manifest-path server/Cargo.toml --tests`, `cargo test --manifest-path server/Cargo.toml --lib semantic::`, `pnpm --filter @dam-hopper/ui test:browser browser-tests/semantic-navigation.browser.tsx`, and `pnpm --filter @dam-hopper/ui build`

---

## 2. Seven-Question Gate & Risk Assessment

1. **Targeted Behavior**: Two-phase invalidation & reap; tombstone enforcement; resync navigation recovery without global session teardown; RPC -32005 invalidation handling; status bar rendering; dynamic client lookup across generation bumps.
2. **Failure Risks**: Broken navigation post-resync (C-1); permanent zombie status on server invalidation (C-2); inline teardown stall under write guard (H-1); over-invalidation via raw path comparison (H-2); stale toggle listeners (H-3); unmount option leaks (H-4).
3. **Existing Coverage & Layers**: Rust integration tests (`server/tests/semantic_*.rs`); Vitest component/unit tests (`packages/ui/`); Playwright/Chromium browser tests.
4. **Oracle & Defect Reasoning**: Post-resync definition retrieval asserting 1 returned location; `-32005` error causing status transition to `disconnected`; non-blocking reap via `spawn_reap_sessions`.
5. **Gaps & Surface Limits**: Real MongoDB auth revocation; non-reading socket backpressure bounds; full dirty-model replay under foreign roots; worktree routes in `git.rs`.

---

## 3. Execution Results

### Summary Table

| Category | Command / Target | Result | Passed | Failed | Runner Time | Wall Time | Evidence / Artifact |
|---|---|---|---|---|---|---|---|
| **Backend Semantic Suites** | `cargo test --manifest-path server/Cargo.toml --test 'semantic_*'` | **PASS** | **61** | **0** | 5.95s | 18.15s | `artifact://114` |
| **Frontend Semantic Suites** | `pnpm --filter @dam-hopper/ui test <8-files>` | **PASS** | **73** | **0** | 0.66s | 5.54s | Stdout (8 files passed) |
| **Backend Typecheck** | `cargo check --manifest-path server/Cargo.toml` | **PASS** | N/A | 0 | 0.18s | 0.18s | Exit code 0 (incremental cache) |
| **Frontend Typecheck** | `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | **PASS** | N/A | 0 | N/A | 8.65s | Exit code 0 (clean) |
| **Mandatory Scope Total** | **4 primary verification gates** | **PASS** | **134** | **0** | **—** | **—** | **100% pass rate** |
| Backend Tests Check | `cargo check --manifest-path server/Cargo.toml --tests` | PASS | N/A | 0 | 12.14s | 12.21s | Exit code 0 (recompiled, 0 warnings) |
| Backend Unit Tests | `cargo test --manifest-path server/Cargo.toml --lib semantic::` | PASS | 38 | 0 | 0.00s* | 39.80s | `artifact://122` |
| Frontend Browser Test | `pnpm --filter @dam-hopper/ui test:browser <browser-spec>` | PASS | 2 | 0 | 0.11s | 4.91s | Stdout (2 passed) |
| Frontend Build Script | `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) | PASS | N/A | 0 | N/A | 8.62s | Exit code 0 (0 warnings emitted) |
| **Complete Overall Total** | **Mandatory (134) + Supplementary (40)** | **PASS** | **174** | **0** | **—** | **—** | **174 distinct tests** |

*\*Note: Rust runner reports 0.00s for sub-millisecond execution phases.*

---

## 4. Test Suite Details

### 4.1 Backend Semantic Integration Suites (`cargo test --test 'semantic_*'`) — 61 Passed, 0 Failed
- `tests/semantic_child_process.rs` (11 passed, 8.56s): Normal LSP lifecycle, handle/drop cleanup, crash reporting/reap, malformed stdout, stuck signal escalation, descendant spawn/sigkill, queue overflow, stderr flood drain, fragmented frames.
- `tests/semantic_resources.rs` (8 passed, 0.00s): Resource policy defaults, frame/doc/header limits, adaptive sync threshold boundary, cgroup scope/portable fallback/invalid session fail-closed.
- `tests/semantic_settings.rs` (7 passed, 1.34s): Default off, admin toggle lifecycle, admin auth enforcement, serialized mutation, workspace config PUT rejection, raw FS tamper rejection, safe recovery.
- `tests/semantic_supervisor.rs` (16 passed, 2.05s): Concurrency limits, multi-connection isolation, clean shutdown reap, actor drop reap, child crash restart/replay, adaptive sync crossing, document close isolation, multi-change batch, two-phase invalidation reap, shutdown admission revocation, epoch mismatch rejection, invalidated connection rejection, tombstone resurrection prevention, project invalidation scoping, version extension staleness fence.
- `tests/semantic_tool_profile.rs` (11 passed, 0.00s): Passive integrity, digest validation, permissions, missing binary/tsls detection, non-executable node rejection.
- `tests/semantic_websocket.rs` (8 passed, 5.95s): Subprotocol/auth matrix, lifecycle attach, rate limiting/binary rejection, virtual URI containment, cancellation cutoff, session reap on disconnect.

### 4.2 Frontend Semantic Test Suites (`pnpm --filter @dam-hopper/ui test`) — 73 Passed, 0 Failed
Individual suite counts obtained via single-file diagnostic runs:
- `src/stores/semantic-navigation.test.ts`: **5 passed**, 0 failed — Status tracking, toggle action, client status maps, ref-count tracking.
- `src/lib/semantic-monaco.test.ts`: **5 passed**, 0 failed — Provider registration, URI resolution, dispose unbind.
- `src/lib/semantic-model-uri.test.ts`: **13 passed**, 0 failed — Virtual wire URI parsing, scheme validation, project mapping.
- `src/api/semantic-client.test.ts`: **8 passed**, 0 failed (previously 7) — Gained -32005 reset test + post-resync definition assertion.
- `src/components/organisms/MonacoHost.semantic.test.tsx`: **3 passed**, 0 failed — Dynamic client resolution, mount unbind, generation bump.
- `src/components/organisms/EditorTabs.semantic.test.tsx`: **3 passed**, 0 failed — Semantic connection gating, generation change teardown, disabled state.
- `src/components/organisms/EditorStatusBar.test.tsx`: **2 passed**, 0 failed (previously 0 semantic) — Status indicator rendering and tooltip test.
- `src/stores/editor.test.ts`: **34 passed**, 0 failed — Tab lifecycle, model retention, buffer state preservation.

---

## 5. Code Reviewer Findings Audit

| Finding | Description | Status | Evidence |
|---|---|---|---|
| **C-1** | `-32003` resync breaks navigation | **Appears Addressed** | `sessionGeneration++` removed from `semantic-client.ts`; `semantic-client.test.ts:569-590` asserts definition returns 1 location post-resync. |
| **C-2** | No recovery after server invalidation | **Appears Addressed (UI-side)** | `handleServerInvalidation()` added on `-32005` in `semantic-client.ts`; `semantic-client.test.ts:593-650` passes. Server push notification remains absent. |
| **H-1** | Reap awaited under write guard | **Appears Addressed** | `state.rs:204,207` uses `spawn_reap_sessions` instead of awaiting sequential teardown inline. |
| **H-2** | Over-invalidation / raw path cmp | **Unchanged** | `state.rs:199` still compares raw `Path` without canonicalization; target-scoped invalidation unused in worktree routes. |
| **H-3** | Turning OFF leaves providers dead | **Appears Addressed** | `semantic-navigation.ts:99-106` triggers `toggleListeners` when `prevGlobal !== nextGlobal`. |
| **H-4** | Singleton options closure leak | **Appears Addressed** | `EditorTabs.tsx:279` invokes `defaultSemanticMonacoManager.resetOptions()` on unmount. |
| **W-7** | Status bar unsupported label / missing test | **Appears Addressed** | `EditorStatusBar.tsx` renders indicator; `EditorStatusBar.test.tsx` adds 2 passing test cases. |

---

## 6. Triage & Runner Diagnostics

1. **Diagnostic Reruns**: Executed one summary run with `-- --reporter=verbose` (summary only) and one 8-step single-file shell loop to record exact per-file counts (5, 5, 13, 8, 3, 3, 2, 34). All diagnostic runs passed with zero fail-then-pass instability.
2. **Typecheck Caches**: Initial `cargo check` completed in 0.18s against cached artifacts; secondary `cargo check --tests` triggered fresh compile (12.14s) confirming zero warnings or errors.
3. **Working Tree Cleanliness**: Zero source, test, or CI files modified or deleted by QA. `EditorTabs.semantic.test.tsx` remains untracked.

---

## 7. Disposition & Verdict

- **Verdict**: **PASS (Requested Scope); Phase 08 acceptance not established.**
- **Pass Rate**: **100%** (134/134 mandatory tests passed, 174/174 overall tests passed, 0 failures, 0 skipped, 0 typecheck errors).
- **Scope Limits & Remaining Risks**:
  - Live auth failure, session revocation, and MFA expiry against real MongoDB backends.
  - Non-reading socket backpressure and stream cutoff bounds under continuous server generation.
  - Full dirty-model replay into new wire URIs under foreign endpoint/root mismatches.
  - Worktree route wiring in `server/src/api/git.rs` (untouched in this worktree; H-2 raw path comparison remains).
  - Live browser multi-provider coexistence (G8 / C-2) deferred to Phase 09 qualification.

---

## 8. Unresolved Questions & Follow-ups

1. **Path Canonicalization (H-2)**: Will `server/src/state.rs:199` adopt canonicalized path comparison to prevent unintended fallback to `prepare_invalidate_all` during worktree changes?
2. **Server-Side Invalidation Push (C-2)**: Will Phase 09 or a future iteration push a close frame / notification directly from `semantic_ws.rs` when an epoch is tombstoned, rather than waiting for the next client request to receive `-32005`?
3. **Live Auth Qualification**: When will MongoDB-backed authentication revocation test harness be wired for live WebSocket cutoff validation?
