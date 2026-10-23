# Code Review — Phase 08 Lifecycle Invalidation and Recovery (Cycle 1)

Date: 2026-10-23 | Reviewer: EvcCodeReviewer | Branch: `feat/lsp-server-integration-reassess`
Plan: `plans/260901-1000-lsp-server-integration/phase-08-lifecycle-invalidation-and-recovery.md`

## Score: 8.2 / 10

Cycle 0 blockers **C-1**, **H-1**, **H-2**, **H-3**, **W-4**, and **W-7** are resolved cleanly; **C-2**, **H-4**, and **W-3** are resolved with minor residual edge cases detailed below. No critical vulnerabilities or deadlocks remain.

---

## Evaluation of Cycle 0 Fixes

| Item | Verdict | Evidence & Analysis |
|---|---|---|
| **C-1**: Remove `this.sessionGeneration++` from `resyncDocument` | **RESOLVED** | `packages/ui/src/api/semantic-client.ts:575-590`: global `sessionGeneration++` removed; `resyncDocument` bumps per-document wire version and sends full `textDocument/didChange`. Post-resync navigation verified in `semantic-client.test.ts:547-590`. |
| **C-2**: `handleServerInvalidation()` on `-32005` | **PARTIAL (Warning W-C2a/b)** | `semantic-client.ts:543-570`: catches `-32005`, transitions to `"disconnected"`, closes WS, schedules 1000ms auto-reconnect. Tested in `semantic-client.test.ts:593-661`. **New defect (W-C2a)**: reconnect `setTimeout` is untracked and not cleared in `disconnect()`, so releasing/disconnecting a client within 1s after `-32005` resurrects a zombie WebSocket connection (reproduced via Vitest probe). Also (`W-C2b`): server tombstone does not push/close idle sockets until next query, and `handleServerInvalidation` relies on async `ws.onclose` to clear wire bindings/pending requests rather than invoking `handleClose()` immediately. |
| **H-1**: `invalidate_project_worktrees` non-blocking reap | **RESOLVED** | `server/src/state.rs:195-208`: uses `prepare_invalidate_project` / `prepare_invalidate_all` + `spawn_reap_sessions(handles)` so child teardown never blocks `workspace_context_guard.write()`. Also fixes Cycle 0 **W-2** in `server/src/api/settings.rs:261-263` (`spawn_reap_sessions` on config restore). |
| **H-2**: `reload_config_locked` project diff | **RESOLVED** | `server/src/api/config.rs:730-748`: diffs `(name, path)` `HashSet` between old and new `DamHopperConfig` before calling `prepare_invalidate_all()`. Unrelated config edits no longer tombstone active semantic sessions. |
| **H-3**: `setProfileSemanticEnabled` notifies `toggleListeners` | **RESOLVED** | `packages/ui/src/stores/semantic-navigation.ts:86-107`: computes `prevGlobal !== nextGlobal` across `profileSemanticEnabled` and invokes `toggleListeners(nextGlobal)`, ensuring `defaultSemanticMonacoManager.deactivate()` runs when all profiles are disabled. |
| **H-4**: `EditorTabs.tsx` calls `resetOptions()` on unmount | **PARTIAL (Warning W-H4)** | `packages/ui/src/components/organisms/EditorTabs.tsx:277-281`: cleanup calls `defaultSemanticMonacoManager.resetOptions()` via dynamic `import()`. However, because it is unguarded across multiple `EditorTabs` instances (`WorkspacePage.tsx:2417,2573,2766`) and runs inside an async `.then()`, unmounting one split pane or re-running the effect can clear `onOpenCodeEditor` set by a still-mounted or newly-mounted `EditorTabs` instance. (`getClientForModel` is safe because `semantic-monaco.ts:245,282` falls back to `findClientForTab`.) |
| **W-3**: Remove `"default"` fallback at `MonacoHost.tsx:341` | **PARTIAL (Low L-W3)** | `packages/ui/src/components/organisms/MonacoHost.tsx:189,197,223,228,337,341`: all `"default"` fallbacks removed and guarded by `effectiveTab.target?.profileId`. In `semantic-navigation.ts:124-126`, `isSemanticEnabledForProfile` still falls back to `get().globalSemanticEnabled` when `profileId` is not yet recorded in `profileSemanticEnabled`. |
| **W-4**: Concurrent reaping in `reap_sessions` | **RESOLVED** | `server/src/semantic/supervisor.rs:601-617`: uses `futures_util::future::join_all` over per-handle `timeout(TOTAL_TEARDOWN_BUDGET, handle.shutdown())`, bounding batch reap time by 5s total instead of $5\text{s} \times N$. |
| **W-7**: `EditorStatusBar.tsx` status display & tests | **RESOLVED** | `packages/ui/src/components/organisms/EditorStatusBar.tsx:92-126`: renders distinct labels/colors for `ready`, `error`, `disconnected`, `unsupported`, and starting states (`connecting`/`attaching`/`initializing`/`replaying`). Verified in `EditorStatusBar.test.tsx:34-90`. |

---

## Critical Issues

None.

---

## Warnings (High / Medium Priority)

1. **[W-C2a] Untracked auto-reconnect timer in `handleServerInvalidation` resurrects disposed `SemanticClient` (Medium/High)**
   - **Location**: `packages/ui/src/api/semantic-client.ts:552-570`, `773-786`
   - **Problem**: `handleServerInvalidation()` schedules an untracked `setTimeout(..., 1000)` that checks only `if (this.status === "disconnected")`. When a consumer calls `disconnect()` (via `releaseClient` or `setProfileSemanticEnabled(id, false)`), `this.status` remains `"disconnected"`. When the 1000ms timer fires on the disposed client, it calls `this.connect()` and opens a leaked WebSocket connection.
   - **Evidence**: Confirmed via temporary Vitest probe (`connect` -> `-32005` -> `client.disconnect()` -> wait 1.3s -> `MockWebSocket.instances.length === 2`).
   - **Fix**: Store `private reconnectTimer: ReturnType<typeof setTimeout> | null = null;` (or a `disposed` flag), clear it in `disconnect()` and `connect()`, and call `this.handleClose()` synchronously inside `handleServerInvalidation()` before scheduling reconnect. Also clear the timer at the end of the `-32005` test (`semantic-client.test.ts:593`) or call `client.disconnect()` in cleanup so the 1s timer cannot fire during subsequent tests.

2. **[W-H4] Async `resetOptions()` on `EditorTabs` cleanup can clobber active `onOpenCodeEditor` (Medium)**
   - **Location**: `packages/ui/src/components/organisms/EditorTabs.tsx:211-282`
   - **Problem**: `EditorTabs` cleanup runs `void import("@/lib/semantic-monaco.js").then(({ defaultSemanticMonacoManager }) => defaultSemanticMonacoManager.resetOptions())`. Because `defaultSemanticMonacoManager` is a singleton and `WorkspacePage` can mount multiple `EditorTabs` instances (or re-run the effect on dependency change), an unmount cleanup can clear `onOpenCodeEditor` belonging to another active instance.
   - **Fix**: Pass an owner token or callback reference to `setOptions` / `resetOptions(owner)` so `resetOptions` only clears options if the caller is still the active owner.

3. **[W-C2b] Server-side invalidation is reactive on next RPC rather than proactive on idle sockets (Low/Medium)**
   - **Location**: `server/src/semantic/supervisor.rs:553-565`, `server/src/api/semantic_ws.rs`
   - **Problem**: `prepare_invalidate_all` tombstones connection epochs (`None`), and the gateway returns `-32005` on the next request (`SemanticClient` then transitions to `"disconnected"` and reconnects). While idle (before the user triggers a navigation request), the status bar remains `"TS/JS Ready"`. Acceptable for lazy recovery, but proactive WS close or notification would make status transition immediate.

---

## Suggestions (Low Priority)

1. **[L-W3] Unknown profile fallback in `isSemanticEnabledForProfile`** (`packages/ui/src/stores/semantic-navigation.ts:124-126`): `get().profileSemanticEnabled[profileId] ?? get().globalSemanticEnabled` lets an uninitialized profile inherit `true` from another profile until its own `EditorTabs` effect runs. Prefer `?? false` unless legacy callers depend on `setGlobalSemanticEnabled(true)` without profile registration.
2. **[L-Reap] Direct lock in `spawn_reap_sessions`** (`server/src/semantic/supervisor.rs:620-631`): `active_reap_tasks` is a `tokio::sync::Mutex` only ever locked briefly to push/take `JoinHandle`s. Replacing it with `std::sync::Mutex<Vec<JoinHandle<()>>>` eliminates the second `tokio::spawn` and closes the tiny registration race before `shutdown()`.
3. **[L-Resync] Serialize `resyncDocument` on document queue** (`packages/ui/src/api/semantic-client.ts:575-590`): Enqueue the resync `didChange` through `enqueueDocumentOp(tabKey, ...)` so it cannot interleave with concurrent `notifyDidChange` calls on the same tab.

---

## Reviewed Files

- `packages/ui/src/api/semantic-client.ts`
- `packages/ui/src/api/semantic-client.test.ts`
- `packages/ui/src/stores/semantic-navigation.ts`
- `packages/ui/src/stores/semantic-navigation.test.ts`
- `packages/ui/src/stores/editor.ts`
- `packages/ui/src/lib/semantic-monaco.ts`
- `packages/ui/src/components/organisms/EditorTabs.tsx`
- `packages/ui/src/components/organisms/EditorTabs.semantic.test.tsx`
- `packages/ui/src/components/organisms/MonacoHost.tsx`
- `packages/ui/src/components/organisms/MonacoHost.semantic.test.tsx`
- `packages/ui/src/components/organisms/EditorStatusBar.tsx`
- `packages/ui/src/components/organisms/EditorStatusBar.test.tsx`
- `server/src/semantic/supervisor.rs`
- `server/src/state.rs`
- `server/src/api/config.rs`
- `server/src/api/settings.rs`
- `server/src/api/workspace.rs`
- `server/src/api/semantic_ws.rs`
- `server/src/main.rs`
- `server/tests/semantic_supervisor.rs`
- `plans/260901-1000-lsp-server-integration/phase-08-lifecycle-invalidation-and-recovery.md`

---

## Validation Commands & Results

| Command | Result |
|---|---|
| `pnpm --filter @dam-hopper/ui exec vitest run src/api/semantic-client.test.ts src/stores/semantic-navigation.test.ts src/components/organisms/EditorStatusBar.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx src/components/organisms/MonacoHost.semantic.test.tsx` | **PASS** (5 files, 21 passed) |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | **PASS** (0 errors) |
| `cargo test --manifest-path server/Cargo.toml --test semantic_supervisor` | **PASS** (16 passed) |
| Tester Cycle 2 report (`plans/reports/tester-261023-2155-phase-08-lifecycle.md`): full backend + frontend + browser semantic suites | **PASS** (174/174 passed) |

---

## Unresolved Questions

1. Should server-side connection epoch tombstoning (`prepare_invalidate_all`) proactively close open WebSocket streams so idle clients immediately reflect `"disconnected"` and reconnect, or is lazy detection on the next `-32005` RPC response sufficient for Phase 08?
2. Should `isSemanticEnabledForProfile(profileId)` default to `false` when `profileId` is absent from `profileSemanticEnabled`, or must it preserve `globalSemanticEnabled` fallback for tests that only call `setGlobalSemanticEnabled(true)`?
