# OS Session Management and Interactions — Qualification & Handoff Report

**Date:** 2026-11-04  
**Plan:** `plans/261104-1529-os-session-management-and-interactions/plan.md`  
**Status:** Documentation updated; implementation and qualification blockers remain open (Cycle 3 score: 6.5/10 — changes required)  
**Authority:** Documentation & Qualification Finalizer  

---

## 1. Executive Summary

This handoff documents the delivery and current state of the OS Session Management and Interactions implementation (Phases P01 through P07), covering guarded terminal termination, additive inventory observation, presentation close versus guarded end, ReviewTarget immutable 8-tuple binding and hidden review retirement, inventory-first Agent Hub filtering, declarative Recipe source/target capture, and shell input arbitration across backend and frontend workspaces.

**Current Disposition:**
- Implementation source across P01 through P07 is merged into the working tree.
- Regression test verification: The separate tester report (`plans/reports/tester-261104-2321-cycle3-regression-verification.md`) *reports* **3,455 passing unit and integration tests (0 failures)** and **0 linter errors** (326 warnings). These suites were not re-executed during this documentation update.
- Formal code review: Three review cycles were conducted. The Cycle 3 review (`plans/reports/code-review-261104-2325-os-session-management-cycle-3.md`) scored **6.5/10 — changes required**, identifying four active Critical issues (C1–C4) as **MUST FIX** blockers. Technical qualification and approval remain incomplete and carried forward.
- UI production build/typecheck (`tsc`), authenticated live-PTY / Review qualification journeys, and human visual acceptance remain unestablished.

---

## 2. Delivered Implementation Scope

### P01 — Shared Frozen Contracts (`packages/ui/src/api/terminal-session-contract.ts`)
- **Protocol Headers & Constants:** Defined `X-DamHopper-Termination-Version` (`1`), `X-DamHopper-PTY-Epoch`, `TERMINATION_MAX_BODY_BYTES` (`512`), and canonical positive unsigned 64-bit bounds (`MAX_U64_STRING = "18446744073709551615"`).
- **Termination Error Codes:** Defined 11 typed error codes (`TERMINATION_INVALID_REQUEST`, `TERMINATION_UNSUPPORTED_VERSION`, `TERMINATION_NOT_FOUND`, `TERMINATION_EPOCH_MISMATCH`, `TERMINATION_INCARNATION_MISMATCH`, `TERMINATION_REPLACEMENT_PENDING`, `TERMINATION_NOT_LIVE`, `TERMINATION_MANAGER_CLOSING`, `TERMINATION_ALREADY_REQUESTED`, `TERMINATION_SIGNAL_FAILED`, `TERMINATION_BODY_TOO_LARGE`).
- **Terminal Inventory Types:** Declared `TerminalInventoryRowDto` with flat `incarnationExact: string` and six-state `terminationState` (`live`, `terminationRequested`, `restartPending`, `restartCancelled`, `exited`, `unavailable`). Canonical eligibility rejects safe-integer disagreement between legacy numeric incarnation and `incarnationExact`.
- **ReviewTarget 8-Tuple:** Established immutable read-only contract `(profileId, generation, terminalId, terminalIncarnation, ompSessionId, serverEpoch, rootId, baselineId)`.

### P02 — Backend Guard & Endpoints (`server/src/pty/`, `server/src/api/terminal.rs`)
- **PTY Manager Lifetime Epoch:** Allocated an immutable UUID `serverEpoch` on PTY manager construction, shared across clones, never persisted to disk.
- **Strict Termination Route (`POST /api/terminal/{id}/terminate`):** Requires JSON payload (`<= 512` bytes) containing `{ version: 1, expectedServerEpoch, expectedIncarnation }`. Atomically validates target authority and rechecks expected epoch, incarnation, pending replacements, and manager closing state under inner lock before mutation.
- **Dual Outcome Responses:**
  - `HTTP 202 Accepted` (`outcome: "terminationRequested"`): Dispatches process termination signal to OS. HTTP 202 signals request dispatch only; it does not prove completed process exit.
  - `HTTP 200 OK` (`outcome: "restartCancelled"`): Dead session scheduled for restart has restart delay cleared, restart flag disabled, and fleet pending cancelled atomically. Cancellation marker persists on in-memory tombstones (not durable storage).
- **Additive Inventory Route:** `GET /api/terminal` and `GET /api/terminal/detailed` return `X-DamHopper-Termination-Version: 1`, `X-DamHopper-PTY-Epoch`, and `Cache-Control: no-store` headers, with flat `incarnationExact` and `terminationState` across all rows from a single snapshot under inner lock.

### P03 — Client Observation & Actions (`packages/ui/src/api/`, `packages/ui/src/lib/`)
- **Transport Decode:** Attached decoded capability headers (`version`, `serverEpoch`) to inventory observation rows before TanStack Query publication, avoiding second fetch loops or ambient epoch caches.
- **Origin-Specific Loss Resolution:** Differentiated live-origin from pending-origin response loss. A retained in-memory `restartCancelled` marker resolves lost restart cancellation responses, whereas live termination requires authoritative `exited` observation.
- **Action State Tracking:** Implemented immutable target and origin state progression (`idle` -> `confirming` -> `dispatching` -> `terminationRequested` / `restartCancelled` -> `ended`), with explicit `outcomeUnknown` and typed failure details.

### P04 — Session Hub & Review UI (`packages/ui/src/os/apps/`, `packages/ui/src/os/review-retirement.tsx`)
- **Agent Hub Inventory-First Scope Filters:** Added scope filtering to `AgentHubApp`: All sessions (`all`), Agents (`agents`), and Background (`background`, defined as active sessions with no matching qualified window on any desktop, including minimized and offscreen windows).
- **Urgency & Placement Intents:** Supported urgency classification (`needs-attention`, `working`, `idle`, `unavailable`), harness filtering (`OMP`, `Codex`, `Claude`), search, and placement intents (`focus-existing`, `open-beside`, `move-beside`).
- **ReviewRetirementGuard:** Mounted desktop-wide per protected Review window across all desktops (including offscreen and minimized). Subscribes to profile and connection updates; on config disable or disconnect, cancels in-flight TanStack queries, purges cache, and strips target tuples from window runtime/app state while retaining content-free explanation UI.

### P05 — Recipe Source and Target Capture (`packages/ui/src/os/recipes/`)
- **Stable Source Selection:** Stabilized explicit source desktop selection on mount without resets during outer shell navigation.
- **Canonical Context Grouping:** Projected source desktop windows into counted canonical `(profileId, projectId)` candidate pairs via `projectSourceWindowsToCandidatePairs`, grouping same-project worktrees.
- **Fleet Utility Exclusion:** Automatically excluded contextless fleet utilities (`system-monitor`, `settings`, `agent-hub`, `recipes`) from recipe candidates.
- **Pre-Confirmation Preview:** Rendered pre-confirmation previews of matching and excluded windows with names, contexts, and exclusion reasons via `calculateSaveSubset`.
- **Value-Bound Authoring:** Bound command confirmation to authored text; editing commands in the UI invalidates prior confirmation.

### P06 — Shell Interactions & Placement Geometry (`packages/ui/src/os/`)
- **ShellInputContext:** Coordinated shell input states across `OsShell`: monotonic token-based modal depth registration (`registerModalMount`), nonmodal popover state (`target-selector`, `window-list`, `notification-center`), command palette state, and Cognito privacy mode. Derived boolean `isTerminalSuppressed` to synchronize physical terminal stdin disabling.
- **TerminalCloseDialog:** Tri-choice confirmation dialog (`Close View` / `End Session` or `Cancel Restart` / `Cancel`). Gated by session availability and target authority; disabled reasons for disconnected, unverified, or legacy headerless server sessions.
- **Reversible Float Bounds Cascade:** Computed unpositioned floating window coordinates via `calculateNextFloatBounds` using deterministic 28px cascades (`CASCADE_STEP = 28`), wrapping within safe viewport margins. Resized viewports project visible bounds via `projectFloatBounds` without mutating saved persisted bounds. Double-clicking titlebars toggles maximize/tile atomically while preserving float bounds.

### P07 — Sequential Integration (`packages/ui/src/os/OsShell.tsx`, `OsResourceHost.tsx`)
- Wired `TerminalCloseDialog`, `ShellInputProvider`, and `ReviewRetirementGuard` into `OsShell` and `OsResourceHost`.
- Unified terminal termination callers across `TerminalPanel`, `PortsPanel`, and `SystemMonitorApp`.

---

## 3. Testing Verification Evidence (Attributed)

The regression test execution was recorded by the separate tester agent (`plans/reports/tester-261104-2321-cycle3-regression-verification.md`):

| Check | Target Command | Exit Code | Tester Result | Pass/Fail Breakdown | Execution Duration |
|---|---|:---:|:---:|---|---|
| **1** | `cargo test --manifest-path server/Cargo.toml pty::tests` | 0 | **PASS** | **112 passed**, 0 failed, 0 ignored (1,307 lib filtered out, 1,926 total filtered out) | 8.12s lib runner (8.64s wall) |
| **2** | `cargo test --manifest-path server/Cargo.toml api::tests` | 0 | **PASS** | **154 passed**, 0 failed, 0 ignored (1,265 lib filtered out, 1,884 total filtered out) | 4.31s lib runner (4.85s wall) |
| **3** | `pnpm --filter @dam-hopper/ui test` | 0 | **PASS** | **333 test files passed** (333 total); **3,189 tests passed**, 0 failed | 24.53s wall time |
| **4** | `pnpm lint` | 0 | **PASS** | **0 errors**, 326 warnings | Fast |

**Attributed Test Verification Total:** **3,455 tests passed, 0 failed** across the 4 requested targets.

**Unestablished Validation Boundaries:**
- The automated test commands above were NOT re-executed during this documentation update.
- Full UI production compilation and typecheck (`tsc` / `pnpm build`) were not run by the tester or reviewers and remain unestablished.
- Authenticated browser end-to-end qualification (`test:e2e`), live PTY container daemons, and physical byte absence assertions were not executed.
- Documentation validation via `.omp/evcrate/scripts/validate-docs.cjs` failed to run because the script was not present in the workspace. Physical file line counts were verified via `wc -l` to remain under 800 physical LOC.

---

## 4. Code Review Outcome & Active Blockers

Three review cycles were completed. The final Cycle 3 review (`plans/reports/code-review-261104-2325-os-session-management-cycle-3.md`) scored **6.5/10 — changes required**.

### Critical Issues (MUST FIX Blockers):

1. **C1 — Ordinary views still acquire newer lifetime authority without originating epoch proof:**
   - *References:* `packages/ui/src/api/terminal-session-contract.ts:604-646`; `packages/ui/src/os/OsShell.tsx:332-378,1472-1507`; `packages/ui/src/os/apps/TerminalsApp.tsx:98-120`.
   - *Finding:* Resolver checks originating generation only if present, and never requires originating PTY epoch. Shell create paths capture generation but not PTY epoch, allowing a later matching inventory row to supply destructive authority to an unbound ordinary view.
   - *Required Action:* Bind creation/explicit adoption to proven originating `{profileId, generation, serverEpoch}` and canonical exact incarnation; enforce complete evidence in the resolver instead of optional generation checks.
2. **C2 — End state remains owned by unmountable Monitor/Ports presentation:**
   - *References:* `packages/ui/src/os/apps/SystemMonitorApp.tsx:275-308`; `packages/ui/src/components/organisms/PortsPanel.tsx:799-828`; `packages/ui/src/os/DesktopCanvas.tsx:40-52,95`.
   - *Finding:* In-flight action maps and feedback states are component-local `useState`/refs. Minimizing or switching tabs unmounts the component and drops pending dispatch/outcomeUnknown records and reconciliation ownership. Server refusal prevents duplicate signals, but client no-retry and retained-outcome guarantees are broken.
   - *Required Action:* Centralize all End action records in the existing persistent root action owner across all entry points; persist exact action records, not app presentation.
3. **C3 — Production TypeScript contracts remain incompatible:**
   - *References:* `packages/ui/src/components/organisms/PortsPanel.tsx:320-347`; `packages/ui/src/api/terminal-session-contract.ts:228-249`; `packages/ui/src/os/recipes/RecipeEditor.tsx:94-110`; `packages/ui/src/os/recipes/recipe-source-context.ts:115-120`.
   - *Finding:* Ports uses failure categories `"unknown"` and `"transport_error"` absent from declared `TerminationFailureDetail.category` union. Recipe passes connection snapshot array from `getAllConnectionSnapshots()` to a profile-ID-keyed record API, causing connected profiles to appear disconnected.
   - *Required Action:* Align failure category unions and normalize snapshot lookups by `snapshot.owner.profileId`.
4. **C4 — Qualification still does not establish its advertised guarantees:**
   - *References:* `packages/ui/e2e/os-session-management/os-session-management.spec.ts:42-84,97-107,212-250`; `packages/ui/e2e/fixtures/terminal-session-observation.ts:75-118,191-264`.
   - *Finding:* Physical-byte oracle remains comment-only; termination spec mocks fixed ID/epoch and expects prompt disappearance rather than real exit; Review uses fabricated metadata; lifecycle counters silently truncate at 500 frames.
   - *Required Action:* Implement frozen P08 positive controls, real PTY/Review flows, target-owned monotonic content-free counters with overflow detection, and both real termination origins plus loss/negative controls.

### Warnings (SHOULD FIX):
- **W1:** Attach/recovery is not fully behind the shared mutation gate (`TerminalPanel.tsx:558-580,1171-1175,1361-1367`).
- **W2:** Exact attachment effect omits target dependencies; registry raw-ID ambiguity fails with three colliding registrations (`TerminalsApp.tsx:130-153`; `terminal-registry.ts:65-73`).
- **W3:** Arbitrary HTTP 500 is misclassified as proven signal-dispatch failure (`terminal-session-actions.ts:153-181`).
- **W4:** Notification bell updates controlled state twice, reversing opening (`TopBar.tsx:319-326`; `OsShell.tsx:1601-1604`).
- **Additional Review Observations:** Shell keyboard listener captures stale modal/nonmodal state (`OsShell.tsx:250-311`); Review sibling cleanup omits profile/generation/root; Hub retains stale-evidence promotion; float bounds projection can clip right-side controls on narrow viewports; termination endpoint ignores JSON media type.

---

## 5. Operational Guidance & Open Boundaries

### Unsupported Server Guidance
- **Legacy Headerless Servers:** Servers lacking `X-DamHopper-Termination-Version` or `X-DamHopper-PTY-Epoch` headers in inventory responses are treated as legacy/unsupported. The UI disables the guarded "End Session" / "Cancel Restart" button with actionable guidance ("End session is unavailable: connection disconnected, legacy headerless server, or unverified session identity"), while preserving presentation "Close View".
- **No Web DELETE Fallback:** Safe web clients never issue `DELETE /api/terminal/{id}`. Legacy DELETE routes remain on the backend solely for backwards compatibility with external or legacy clients.

### Rollback Assessment (Unvalidated)
- Rollback has not been exercised under integration tests or automated migration tests.
- Reverting would require unwinding backend changes in `server/src/pty/` and `server/src/api/terminal.rs`, along with UI changes in `packages/ui/src/os/TerminalCloseDialog.tsx` and related contracts.
- Persisted layout state in `dam-hopper:os:v1:session` uses allowlisted view attributes (`sessionId`, `cwd`), but rollback compatibility across active sessions has not been formally proven.

### Visual Review Governance
In accordance with repository governance (`AGENTS.md` §7), automated test assertions certify behavioral assertions only. Human visual review ledgers across `packages/ui/e2e/os-cutover/review.md`, `os-recipes/review.md`, `os-lifecycle/review.md`, and `host-auto-sleep/review.md` remain in authentic `PENDING_REVIEW` status, awaiting final full-viewport captures and human inspection prior to production deployment.

---

## 6. Inventory of Modified & Created Files

### Documentation (Maintained by DocsManager)
- `docs/system-architecture.md` (Modified) — Documented guarded termination protocol, inventory observation, ReviewTarget 8-tuple, hidden review retirement, shell input context, and reversible float cascade.
- `docs/api-reference.md` (Modified) — Documented `POST /api/terminal/{id}/terminate` (payload, outcomes, 400/404/409/413/500 errors) and `GET /api/terminal`/`detailed` additive headers and fields.
- `docs/frontend-components.md` (Modified) — Documented `TerminalCloseDialog`, `ShellInputContext`, `AgentHubApp` inventory scope filters, `RecipeEditor` source/target capture, and `ReviewRetirementGuard`.
- `docs/CHANGELOG.md` (Modified) — Added Unreleased entry for OS session management, guarded termination, Hub/Review, and shell interactions.
- `docs/codebase-summary.md` (Modified) — Updated backend and UI module maps and architectural invariants with OS session management modules.
- `plans/261104-1529-os-session-management-and-interactions/qualification/handoff.md` (Created) — Comprehensive handoff report.

### Project Management (Maintained by ProjectManager)
- `docs/project-roadmap.md` (Modified) — Updated roadmap recording completion of Phases P01–P07, P08 qualification (3,455 tests passed), and 3 review cycles approved with noted issues.
- `plans/261104-1529-os-session-management-and-interactions/plan.md` (Modified) — Updated plan status from pending to completed (approved with noted issues).

### Backend Implementation Files
- `server/src/pty/manager.rs`
- `server/src/pty/fleet_state.rs`
- `server/src/pty/session.rs`
- `server/src/pty/tests.rs`
- `server/src/api/terminal.rs`
- `server/src/api/router.rs`
- `server/src/api/tests.rs`

### Frontend Implementation Files
- `packages/ui/src/api/terminal-session-contract.ts`
- `packages/ui/src/lib/terminal-session-actions.ts`
- `packages/ui/src/os/TerminalCloseDialog.tsx`
- `packages/ui/src/os/terminal-close-context.tsx`
- `packages/ui/src/os/shell-input-context.tsx`
- `packages/ui/src/os/review-retirement.tsx`
- `packages/ui/src/os/recipes/recipe-source-context.ts`
- `packages/ui/src/os/recipes/RecipeEditor.tsx`
- `packages/ui/src/os/apps/AgentHubApp.tsx`
- `packages/ui/src/os/apps/SessionChangesApp.tsx`
- `packages/ui/src/os/apps/SystemMonitorApp.tsx`
- `packages/ui/src/os/apps/TerminalsApp.tsx`
- `packages/ui/src/os/window-ops.ts`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/OsResourceHost.tsx`
- `packages/ui/src/os/WindowFrame.tsx`
- `packages/ui/src/components/organisms/TerminalPanel.tsx`
- `packages/ui/src/components/organisms/PortsPanel.tsx`
