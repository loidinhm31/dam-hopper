# Phase 08 QA Qualification Evidence & Triage Report

- **Date:** 2026-11-04 (261104)
- **Operation:** `run` (code validation)
- **Authority:** Execution only; no product repair, no test weakening.
- **Resources Loaded:** `test-principles.md`, `code-validation.md`
- **Overall Status:** **FAIL** (Qualification blocked by compilation, typecheck, build, lint, and test contract failures)

---

## 1. Executive Summary & Gates Status

| Check / Gate | Command / Surface | Result | Passed / Total | Failure Mechanism |
|---|---|---|---|---|
| **Rust PTY Tests** | `cargo test --manifest-path server/Cargo.toml pty::tests` | **BLOCKED (Compile)** | 0 executed | 5 compiler errors (`server/src/pty/manager.rs`, `server/src/api/tests.rs`) |
| **Rust API Tests** | `cargo test --manifest-path server/Cargo.toml api::tests` | **BLOCKED (Compile)** | 0 executed | Same compiler errors block test binary generation |
| **UI Unit Tests** | `pnpm --filter @dam-hopper/ui test` | **FAIL** | 320 / 330 files (48 failed tests) | Mock missing export, fixture contract mismatch, undefined variables |
| **UI E2E Typecheck** | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | **PASS** | `tsc -p tsconfig.e2e.json` | Clean (exit code 0) |
| **UI Package Build** | `pnpm --filter @dam-hopper/ui build` | **FAIL** | `tsc -p tsconfig.json` | Syntax error TS17008, TS1381, TS1005 in `OsShell.tsx` |
| **Full Workspace Check** | `pnpm check` | **FAIL** | Exited at step 1 (`pnpm build`) | Web app build failed due to syntax error in `OsShell.tsx` (lint & cargo tests never reached) |
| **Workspace Lint** | `pnpm lint` (`eslint apps/ packages/`) | **FAIL** | 2 errors, 314 warnings | Syntax error in `OsShell.tsx:1604`, render-time ref mutation in `review-retirement.tsx:44` |
| *Exploratory: Shared* | `pnpm --filter @dam-hopper/shared test` | **PASS** | 1 file, 6 tests | All 6 unit assertions passed |
| *Exploratory: Bridge* | `pnpm --filter @dam-hopper/browser-bridge test` | **PASS** | 5 files, 19 tests | All 19 assertions passed |
| *Exploratory: Admin* | `node --test tests/create-admin.test.mjs` | **PASS** | 15 tests | All 15 node test runner cases passed |
| *Unexecuted Surfaces* | Browser Vitest (`test:browser`), Playwright E2E (`test:e2e`) | **NOT RUN / UNVERIFIED** | - | Blocked by UI build and unit breakages |

---

## 2. Compiler & Build Blockers

### A. Rust Server Compilation Blockers (`server/Cargo.toml`)
1. **Undefined identifier `recorder` (`src/pty/manager.rs:4044:13`)**:
   - `recorder.record(crate::workflow::WorkflowObservation::TerminalRestarted { ... })`
   - In `supervisor_loop`, `recorder` was not bound from `workflow_recorder_cell` (`workflow_recorder_cell.read().unwrap().clone()`).
2. **Borrow conflicts (`src/pty/manager.rs:2701:24`, `2702:25`)**:
   - In guarded termination, `session` mutably borrows `inner.dead.get_mut(id)`.
   - Simultaneous immutable access to `inner.fleet.is_restart_pending` and `inner.pending_replacements` violates Rust borrow rules.
3. **Borrow conflicts (`src/pty/manager.rs:4093:13`, `4096:9`)**:
   - In supervisor dead cleanup, `tombstone` mutably borrows `guard.dead.get_mut(session_id)`.
   - `guard.fleet.is_restart_pending` (immutable) and `guard.fleet.cancel_restart_pending` (mutable) conflict with the live `tombstone` reference.
4. **Type mismatch (`src/api/tests.rs:7528:9`)**:
   - `crate::api::router::build_router_with_origins(state, &[HeaderValue::from_static(...)])` expected `Vec<HeaderValue>`, found reference `&[HeaderValue; 1]`.

### B. UI Build & Typecheck Blockers (`packages/ui/src/os/OsShell.tsx`)
- Lines 1603–1605: JSX element `<ShellInputProvider>` (opened at 1514) has no matching closing tag before file termination at line 1604.
- Causes `tsc -p tsconfig.json`, Vite build, and ESLint parse failure.

### C. Lint Blocker (`packages/ui/src/os/review-retirement.tsx`)
- Line 44:3: `targetRef.current = target;` inside component body triggers React compiler / hook rule: `Error: Cannot access refs during render`.

---

## 3. UI Test Failure Breakdown (`packages/ui test`)

10 failed test files out of 330 (48 failing tests):

1. **`src/api/terminal-session-contract.test.ts` (27 failed)**:
   - **Root cause:** Test harness reads `fixture.row` and `fixture.state` directly, whereas `terminal-termination-fixtures.json` schemas wrap properties in `fixture.input` (`fixture.input.row`, `fixture.input.state`).
   - Also, `same_id_different_epoch_target_mismatch` passes `observation` with undefined `owner`.
2. **`src/components/organisms/ContextMenuConsumers.test.tsx` (11 failed)**:
   - **Root cause:** `FileTree.tsx` calls `useWorkspaceStatus`, which was not provided in the `vi.mock("@/api/queries.js")` definition.
3. **`src/components/organisms/TerminalPanel.test.tsx` (2 failed)**:
   - **Root cause:** `ReferenceError: cognitoShortcut is not defined` inside `TerminalPanel.tsx:928` (`shouldConsumeCognitoModeTerminalKey`).
4. **`src/components/organisms/VideoPreview.test.tsx` (2 failed)**:
   - **Root cause:** `issueVideoTicket` and `startVideoDownload` called with object `ProjectTarget` (`{ kind: "project", ... }`) instead of raw string `"demo"`.
5. **`src/components/organisms/ImagePreview.test.tsx` (1 failed)**:
   - **Root cause:** `issueImageTicket` called with `ProjectTarget` object instead of string `"demo"`.
6. **`src/components/pages/settings-page/SettingsImportExportPanel.test.tsx` (1 failed)**:
   - **Root cause:** Text content assertion mismatch ("Download the active workspace" expected vs actual "Download the server config.toml").
7. **`src/os/recipes/recipe-engine.test.ts` (1 failed)**:
   - **Root cause:** Assertion expected command `'cargo build'`, received `'bash'`.
8. **`src/os/deep-links.test.ts` (1 failed)**:
   - **Root cause:** Expected `'Malformed generation parameter "bad"'`, received complete tuple error requirement reason.
9. **`src/os/window-ops.test.ts` (1 failed)**:
   - **Root cause:** Bounds calculation returned `y: 760`, test expected `<= 750`.
10. **`src/hooks/use-terminal-manager.test.ts` (1 failed)**:
    - **Root cause:** `findCustomCommandSessionIds` returned `[]` instead of matching session ID `custom:proj:build:1`.

---

## 4. Test Evidence Defect Observations

Audit during triage revealed potential false confidence in existing test definitions once repaired:
- **Lifecycle cascade checks:** Accept any finite positive position offset; do not assert the contractual 28px offset step.
- **Recipe step confirmation:** Uses conditional checks where `excludedCount >= 0` always passes vacuously.
- **Cutover verification:** Only checks window element existence; `.first()` selector can match the pre-existing Agent Hub without verifying deduplication or backend process persistence.
- **Browser tests:** Multiple tests titled "filters", "drag threshold", and "outside click" assert initial render state without triggering or asserting the corresponding user interaction.

---

## 5. Triage Handoff for Debug / Fix Pipeline

1. **Rust Server (`server/src/pty/manager.rs`, `server/src/api/tests.rs`)**:
   - Bind `let recorder = workflow_recorder_cell.read().unwrap().clone();` before line 4044.
   - Refactor borrows in guarded termination (lines 2698-2708) and dead cleanup (lines 4086-4097) by querying fleet status/cancellation without holding an open mutable reference to `inner.dead` or `guard.dead`. Retain the atomic check under lock.
   - Convert slice to `vec![HeaderValue::from_static(allowed_origin)]` at `tests.rs:7528`.
2. **UI Syntax & Lint (`packages/ui`)**:
   - Restore `</ShellInputProvider>\n);\n}` in `packages/ui/src/os/OsShell.tsx:1603-1605`.
   - In `packages/ui/src/os/review-retirement.tsx:44`, move `targetRef.current` assignment inside `useEffect` or read directly from parameters.
   - In `packages/ui/src/components/organisms/TerminalPanel.tsx:928`, resolve missing `cognitoShortcut` variable.
3. **UI Test Harness / Contract Alignment**:
   - In `terminal-session-contract.test.ts`, access `fixture.input` rather than `fixture.row`.
   - In `ContextMenuConsumers.test.tsx`, mock `useWorkspaceStatus` in `vi.mock("@/api/queries.js")`.
   - In `ImagePreview.test.tsx` and `VideoPreview.test.tsx`, update mock expectations to accept `ProjectTargetRef` target objects.

---

## 6. Unresolved Questions
1. Should `startVideoDownload` and `issueVideoTicket` support both string and object `ProjectTarget` contracts, or is the object target now the sole authoritative signature?
2. Has the Settings Import/Export copy intentionally moved from "active workspace" to "server config.toml", requiring permanent test expectation update?
