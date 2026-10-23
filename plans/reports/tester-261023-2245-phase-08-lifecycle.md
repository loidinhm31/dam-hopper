# Test Report: Phase 08 — Lifecycle Invalidation and Recovery (Cycle 2 Verification)

- **Date**: 2026-10-23 | **Author**: EvcTester (Senior QA Execution Specialist)
- **Operation**: `run` (code validation) | **Authority**: Execution and reporting only; zero source/test/CI edits.
- **Plan**: `plans/260901-1000-lsp-server-integration/phase-08-lifecycle-invalidation-and-recovery.md`
- **Worktree**: `/home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration`
- **Verdict**: **PASS (Requested Scope); Lifecycle review findings remain open and Phase 08 acceptance not established.** (100% pass rate across executed suites; architectural lifecycle fences and deferred qualifications remain open).

---

## 1. Request & Execution Scope

Re-validate Phase 08 Lifecycle Invalidation and Recovery after C1/C2/W1/W2/W3 review remediation:
1. **Backend Semantic Integration Suites**: `cargo test --manifest-path server/Cargo.toml --test 'semantic_*'`
2. **Frontend UI Semantic Suites**: `pnpm --filter @dam-hopper/ui test src/stores/semantic-navigation.test.ts src/lib/semantic-monaco.test.ts src/lib/semantic-model-uri.test.ts src/api/semantic-client.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx src/components/organisms/EditorStatusBar.test.tsx src/stores/editor.test.ts`
3. **Backend Typecheck**: `cargo check --manifest-path server/Cargo.toml`
4. **Frontend Typecheck**: `pnpm --filter @dam-hopper/ui exec tsc --noEmit`
5. **Supplementary Verification**:
   - `cargo check --manifest-path server/Cargo.toml --tests`
   - `cargo test --manifest-path server/Cargo.toml --lib semantic::`
   - `pnpm --filter @dam-hopper/ui test:browser browser-tests/semantic-navigation.browser.tsx`
   - `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`)

---

## 2. Seven-Question Gate & Risk Assessment

1. **Targeted Behavior**: Two-phase invalidation and reap; target-key alignment between editor tabs and Monaco models; phase-1 session handle invalidation and request draining; RPC -32005 error handling on immediate submit; socket callback owner fencing; owner-scoped Monaco manager options.
2. **Failure Risks**:
   - Client-side model resolution failure due to mismatched composite vs simple target keys (C1).
   - In-flight execution leaks during phase-one invalidation before actor reap (C2).
   - Post-reap navigation submission failures returning generic internal errors instead of -32005 reconnect signal (W1).
   - Late WebSocket callbacks or unhandled handshake rejections tearing down replacement connections (W2).
   - Unmounting editor tabs erasing shared Monaco manager callbacks (W3).
3. **Existing Coverage & Layers**: Rust integration suites (`server/tests/semantic_*.rs`); Vitest component/store suites (`packages/ui/`); Playwright/Chromium browser tests.
4. **Oracle & Defect Reasoning**: Verified exit codes, exact stdout/stderr logs, assertion counts, and static code inspection of applied review fixes.
5. **Gaps & Surface Limits**:
   - Asynchronous mailbox dispatch for `invalidate()` without synchronous acknowledgment or barrier.
   - Handshake catch rejection race when `this.ws` is cleared before `onopen` settles.
   - Per-scope rather than per-instance `ownerId` in `SemanticMonacoManagerOptions`.
   - Real MongoDB auth revocation, live non-reading WebSocket backpressure bounds, and worktree git route target-scoped invalidation.

---

## 3. Execution Results

### Summary Table

| Category | Command / Target | Result | Passed | Failed | Runner Time | Wall Time | Evidence / Artifact |
|---|---|---|---|---|---|---|---|
| **Backend Semantic Suites** | `cargo test --manifest-path server/Cargo.toml --test 'semantic_*'` | **PASS** | **61** | **0** | 5.96s | 18.16s | `artifact://172` |
| **Frontend Semantic Suites** | `pnpm --filter @dam-hopper/ui test <8 files>` | **PASS** | **73** | **0** | 0.67s | 5.55s | `artifact://175` |
| **Backend Typecheck** | `cargo check --manifest-path server/Cargo.toml` | **PASS** | N/A | 0 | 0.18s | 0.18s | Exit code 0 |
| **Frontend Typecheck** | `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | **PASS** | N/A | 0 | N/A | 8.55s | Exit code 0 |
| **Mandatory Scope Total** | **4 primary verification gates** | **PASS** | **134** | **0** | **—** | **—** | **100% pass rate** |
| Backend Tests Compile | `cargo check --manifest-path server/Cargo.toml --tests` | PASS | N/A | 0 | 13.23s | 13.31s | Exit code 0 |
| Backend Unit Tests | `cargo test --manifest-path server/Cargo.toml --lib semantic::` | PASS | 38 | 0 | 0.00s* | 43.16s | `artifact://180` |
| Frontend Browser Tests | `pnpm --filter @dam-hopper/ui test:browser <browser-spec>` | PASS | 2 | 0 | 0.13s | 5.05s | Exit code 0 |
| Frontend Type Compilation | `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) | PASS | N/A | 0 | N/A | 8.52s | Exit code 0 |
| **Complete Overall Total** | **Mandatory (134) + Supplementary (40)** | **PASS** | **174** | **0** | **—** | **—** | **174 distinct tests** |

*\*Note: Rust runner reports 0.00s for sub-millisecond execution phases.*

---

## 4. Test Suite Details

### 4.1 Backend Semantic Integration Suites (`cargo test --test 'semantic_*'`) — 61 Passed, 0 Failed (`artifact://172`)
- `tests/semantic_child_process.rs` (11 passed, 8.55s): LSP lifecycle, handle/drop cleanup, crash reporting/reap, malformed stdout, stuck signal escalation, descendant spawn/sigkill, queue overflow, stderr flood drain, fragmented frames.
- `tests/semantic_resources.rs` (8 passed, 0.00s): Adaptive sync boundary, document/frame/header limits, cgroup scope/portable fallback/invalid session fail-closed.
- `tests/semantic_settings.rs` (7 passed, 1.32s): Default off, admin toggle lifecycle, admin auth enforcement, serialized mutation, workspace config PUT rejection, raw FS tamper rejection, safe recovery.
- `tests/semantic_supervisor.rs` (16 passed, 2.05s): Concurrency limits, multi-connection isolation, clean shutdown reap, actor drop reap, child crash restart/replay, adaptive sync crossing, document close isolation, multi-change batch, two-phase invalidation reap, shutdown admission revocation, epoch mismatch rejection, invalidated connection rejection, tombstone resurrection prevention, project invalidation scoping, version extension staleness fence.
- `tests/semantic_tool_profile.rs` (11 passed, 0.00s): Passive integrity, digest validation, permissions, missing binary/tsls detection, non-executable node rejection.
- `tests/semantic_websocket.rs` (8 passed, 5.96s): Subprotocol/auth matrix, lifecycle attach, rate limiting/binary rejection, virtual URI containment, cancellation cutoff, session reap on disconnect.

### 4.2 Frontend Semantic Test Suites (`pnpm --filter @dam-hopper/ui test`) — 73 Passed, 0 Failed (`artifact://175`)
- `src/lib/semantic-model-uri.test.ts`: **13 passed**, 0 failed — Local/wire URI formatting, path normalization/traversal rejection, stable identity, incarnation bump, wire version increment, wire index clearing.
- `src/components/organisms/EditorStatusBar.test.tsx`: **2 passed**, 0 failed — Git stats rendering, semantic status indicator and tooltip rendering.
- `src/api/semantic-client.test.ts`: **8 passed**, 0 failed — Handshake lifecycle, adaptive sync threshold, definition query with damHopperDocumentVersion, local & remote cancellation, config auto-reply, -32003 resync recovery with follow-up definition query, -32005 server invalidation reset.
- `src/stores/editor.test.ts`: **34 passed**, 0 failed — Bulk closing, Git mutation reconciliation, project target isolation (root vs worktree), preview guards, view state hydration, freshness checking, blame toggle.
- `src/components/organisms/MonacoHost.semantic.test.tsx`: **3 passed**, 0 failed — Model mount registration, model unmount preservation, replacement client edit routing, unsupported file path exclusion.
- `src/components/organisms/EditorTabs.semantic.test.tsx`: **3 passed**, 0 failed — Disabled semantic gating, client creation and connection when enabled, unmount release via `releaseClient`.
- `src/stores/semantic-navigation.test.ts`: **5 passed**, 0 failed — Deterministic scope key, reveal intent management, global toggle, profile-scoped client disconnection, reference-counted shared clients.
- `src/lib/semantic-monaco.test.ts`: **5 passed**, 0 failed — Coordinate conversions (1-based <-> 0-based), provider activation/restoration, model-scoped definition routing, out-of-target null return.

---

## 5. Review Findings & Remediation Audit

Static code inspection reveals partial mitigation with important structural gaps remaining:

| Issue | Title | Status in Code | QA Assessment & Remaining Gap |
|---|---|---|---|
| **C1** | Target key mismatch between client and model registry | **Partially Mitigated** | `EditorTabs.tsx:182` now computes `targetKey = projectTargetCacheKey(targetRef)` for client options matching `MonacoHost.tsx:199`. However, `EditorTabs.semantic.test.tsx` still hard-codes `targetKey: project`, and tests do not assert real end-to-end lookup between an open editor tab and registered model. |
| **C2** | Phase-one detachment does not revoke actor handles | **Partially Mitigated** | `supervisor.rs:553,574,599` now calls `h.invalidate().await` in phase 1, transitioning actor state to `Invalidated` and failing in-flights. However, `invalidate()` merely enqueues `SessionCommand::Invalidate` across an mpsc channel without synchronous acknowledgment; held locks during prepare can stall if the actor mailbox is full. |
| **W1** | Post-reap navigation submission error mapping | **Mitigated in Gateway; Incomplete Test Oracle** | `server/src/semantic/gateway.rs:962-973` now maps `SessionError::Invalidated` to `RPC_ERR_AUTH_INVALIDATED` (-32005). However, frontend unit test `semantic-client.test.ts:593-651` asserts only `disconnected` status and immediately calls `disconnect()`, never asserting the 1-second reconnect timer, model replay, or successful subsequent query. |
| **W2** | Socket callbacks and status publication fencing | **Partially Mitigated; Handshake Race Remains** | `semantic-client.ts:150-181` adds `this.ws !== ws` checks to `onopen`, `onmessage`, `onerror`, `onclose`. However, `performHandshake()` operates on mutable `this.ws`; its catch block sets `this.ws = null`, which can cause `onopen`'s catch to see `this.ws !== ws` and silently return without rejecting `connect()`. |
| **W3** | Shared Monaco options cleanup race | **Partially Mitigated; Scope Collisions Remain** | `semantic-monaco.ts:151-156` adds `ownerId?: string` to `resetOptions()`. However, `EditorTabs.tsx:216` uses `scopeKey` as `ownerId`. Multiple editor instances sharing a scope key can still clear each other's manager options on unmount. Furthermore, `onOpenCodeEditor` continues to capture outer `targetRef` in certain paths. |
| **W4** | Foreign-binding dirty replay guard | **Open** | No validation of exact endpoint/root/actor equivalence before dirty replay; string equality alone remains. |
| **W5** | Worktree invalidation scoping in git routes | **Open** | `git.rs` worktree routes still invoke project-wide session invalidation without using target-scoped invalidation. |
| **W6** | Visible status accuracy for active models | **Open** | Status bar renders supplied status prop, but dynamic active-model status derivation remains bounded by client-level state. |

---

## 6. Triage & Runner Diagnostics

1. **Test Runner Stability**: Zero test flakes observed across multiple diagnostic iterations. Frontend test runner duration remained steady at ~4.9s - 5.5s; backend integration runner completed in 5.96s (18.16s wall time).
2. **Compilation Artifacts**: Backend check (`cargo check`) completed cleanly in 0.18s; backend test compilation (`cargo check --tests`) finished in 13.23s with 0 warnings.
3. **Frontend Typecheck & Build**: `pnpm --filter @dam-hopper/ui exec tsc --noEmit` and `pnpm --filter @dam-hopper/ui build` both executed with exit code 0 and zero emitted diagnostics.
4. **Working Tree Cleanliness**: QA introduced zero modifications to source, test, or CI files. `packages/ui/src/components/organisms/EditorTabs.semantic.test.tsx` remains in working tree.

---

## 7. Disposition & Verdict

- **Verdict**: **PASS (Requested Scope); Lifecycle review findings remain open and Phase 08 acceptance not established.**
- **Pass Rate**: **100%** (134/134 mandatory tests passed, 174/174 overall tests passed, 0 failures, 0 skipped, 0 typecheck errors).
- **Core Verification Deficiencies**:
  - The executed tests prove code compiles and existing test assertions pass.
  - Review findings C1, C2, W1, W2, W3 have partial code remediations but retain behavioral gaps (queued rather than synchronous invalidation, handshake catch race, per-scope rather than per-instance Monaco ownership).
  - Test suites do not exercise end-to-end model-to-client matching with real store tabs, nor do they exercise successful post-invalidation reconnect and replay.
  - Runtime qualification gates (G5/G8 coexistence, live MongoDB auth revocation, non-reading socket backpressure) remain deferred to Phase 09.

---

## 8. Unresolved Questions & Follow-ups

1. **Synchronous Revocation Fence (C2)**: Should `prepare_invalidate_*` set an atomic/shared revocation token directly on the session/target before queuing actor shutdown, ensuring immediate rejection without relying on mailbox drain under lock?
2. **Handshake Error Handling (W2)**: Can `performHandshake()` capture the local `ws` instance and guarantee that `connect()` rejects reliably even when `this.ws` is modified concurrently?
3. **Per-Instance Monaco Registration (W3)**: Should `SemanticMonacoManager` assign a unique random instance ID per mounted component rather than using `scopeKey`, preventing sibling tabs in the same scope from clobbering manager options?
4. **Integration Test Gap**: Will an end-to-end test combining real `useEditorStore` tabs, `SemanticModelRegistry`, and `SemanticNavigationStore` client lookup be added before Phase 08 closure?