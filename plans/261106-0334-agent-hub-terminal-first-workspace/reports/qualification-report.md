# Qualification Report — Agent Hub Terminal-First Workspace

- **Date:** 2026-11-06
- **Feature:** Agent Hub Terminal-First Workspace & Floating OS File Panels
- **Plan:** `plans/261106-0334-agent-hub-terminal-first-workspace/`
- **Status:** Implementation and documentation delivered; reported automated checks passing; live container qualification and human visual review pending.

---

## 1. Executive Summary

This report establishes qualification for the terminal-first Agent Hub transformation, floating OS file panels, global B2 float-over-maximized window stacking, singleton terminal renderer mounting with claim-fenced attach gates, and endpoint-identity save fencing.

All automated test suites pass across unit, browser, and integration suites:
- **Unit Suite:** 370 test files, 3,537 tests passing (`vitest run`).
- **Hub Browser Suite:** 5 browser test files, 58 tests passing in Chromium (`vitest.browser.config.ts`).
- **R5 Renderer Measurement:** Complete 6-stage lifecycle measurement executed across 2 profiles using fixture counting transports (evidence class: browser, mocked transport), confirming no retained tracked resources (`M2 active subscriptions = 0` on Hub close) and zero xterm remounts across project switch, sidebar toggles, and split. Uncapped fleet cost remains a decided limitation (V2).
- **E2E Playwright Suite:** Playwright test `packages/ui/e2e/os-agent-hub-workspace/os-agent-hub-workspace.spec.ts` executed and PASSED cleanly under `E2E_SKIP_BUILD=1`. Typecheck verified clean (`tsc -p tsconfig.e2e.json`). Live containerized streaming PTY daemon verification remains tracked as an open qualification gate.
- **UI & Web Production Build:** Succeeded cleanly with zero errors (`pnpm build`).
- **Visual Capture Gate:** Captured checkpoints recorded in `packages/ui/e2e/os-agent-hub-workspace/review.md` retained under `PENDING_HUMAN_REVIEW` per `docs/code-standards.md:214`.

---

## 2. Verification Suites & Commands

### 2.1 UI Unit Test Suite
- **Command:** `pnpm --filter @dam-hopper/ui test`
- **Result:** PASSED (370 test files passed, 3,537 tests passed, duration: 26.41s)
- **Key Modules Verified:**
  - `lib/terminal-claim-key.test.ts`: Claim key formatting, target-qualified key generation, strict parsing.
  - `lib/terminal-runtime-identity.test.ts`: Runtime candidate indexing, collision handling, epoch resolution.
  - `os/agent-hub/hub-terminal-mounts-store.test.ts`: Per-hub mount publication, structural equality memoization, lifecycle pruning.
  - `lib/agent-hub-open-workspaces.test.ts`: Workspace union, canonical serialization, dismissibility guards.
  - `lib/terminal-presentation-input.test.ts`: Token-scoped presentation input arbitration, successor handoff safety.
  - `os/intents.test.ts`: Mode-qualified `file:open` intent creation and dispatch.
  - `os/window-ops.test.ts` & `os/window-store.test.ts`: Atomic `revealWindow` (desktop switch + restore + focus), float-mode placement, mode transitions.
  - `os/DesktopCanvas.test.tsx` & `os/maximized-presentation.test.tsx`: Structural z-index assignments for B2 global stacking.
  - `stores/editor.test.ts`: Endpoint-identity save fence, dirty-buffer rebind denial, discard-and-reload authorization, persisted dirty tab identity.
  - `os/terminal-launch-lifecycle.test.ts`: Reservation, settlement, owner generation check, uncertain status handling.
  - `os/action-executor.test.ts`: Shared launch lifecycle integration for new terminals.
  - `components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`: Project workspace rows, disclosure chevrons, zero-terminal empty state.
  - `os/agent-hub.test.ts`: Summary aggregation, attention/work counters, agent status joins.
  - `os/persistence.test.ts`: Persisted `selectedWorkspace` in `agent-hub` projection, dirty tab endpoint identity serialization.

### 2.2 Chromium Browser Test Suite
- **Command:** `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-agent-hub.browser.tsx browser-tests/os-hub-terminal-mounts.browser.tsx browser-tests/os-file-open-float.browser.tsx browser-tests/terminal-traditional-projects.browser.tsx browser-tests/os-agent-hub-renderer-measurement.browser.tsx`
- **Result:** PASSED (5 test files passed, 58 tests passed in Chromium, duration: 22.11s)
- **Coverage Areas:**
  - `os-agent-hub.browser.tsx`: Terminal-first Agent Hub rendering without card roster/filters, traditional projects display, sidebar toggle, stuck-launch notice and manual clearance.
  - `os-hub-terminal-mounts.browser.tsx`: Host-mounted terminals in `OsResourceHost`, xterm instance token identity stability across desktop switches, project switches, and standalone window handoff.
  - `os-file-open-float.browser.tsx`: Global B2 float-over-maximized hit-testing in real Chromium geometry, `file:open` float placement, reuse of generation-equal/live-owner windows, fail-closed reveal-only on generation mismatch.
  - `terminal-traditional-projects.browser.tsx`: Traditional terminal projects navigation, worktree selector, split layout, tab close/pin semantics.
  - `os-agent-hub-renderer-measurement.browser.tsx`: 6-stage lifecycle telemetry, subscription leak verification.

### 2.3 Production Build & Typecheck
- **Command:** `pnpm build`
- **Result:** PASSED (Built `@dam-hopper/web`, `@dam-hopper/browser-extension`, staged extension zip, and compiled production assets without error).
- **Command:** `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
- **Result:** PASSED (`tsc -p tsconfig.e2e.json` completed with zero diagnostic errors).

---

## 3. R5 Renderer Cost Measurement (V2, F10)

### 3.1 Measurement Setup
- **Evidence Class:** `browser, mocked transport` (Chromium browser engine running real DOM, real CSS layout, real React reconciler, real `terminalRegistry`, and counting transport mocks).
- **Fleet Scale:** 22 live sessions across 2 distinct server profiles (12 on `profile-alpha`, 10 on `profile-beta`).
- **Harness:** `packages/ui/browser-tests/os-agent-hub-renderer-measurement.browser.tsx`.
- **Policy:** Measurement-only telemetry without artificial thresholds or pass/fail barriers on capacity.

### 3.2 Metrics Recorded
- **M1 Registry Instances:** Distinct `TerminalEntry` object identities in `terminalRegistry` (`new Set(terminalRegistry.values()).size`).
- **M1 DOM Tokens:** Distinct rendered DOM elements with `data-xterm-instance-token`.
- **M2 Active Subscriptions:** Sum of active `onTerminalData`, `onTerminalBuffer`, `onTerminalExit`, and `onTerminalLifecycle` registrations minus their released cleanups.
- **M3 Cumulative Attaches:** Cumulative count of transport `terminalAttach` invocations across the lifecycle.
- **M4 JS Heap:** `performance.memory.usedJSHeapSize` sampled in Chromium per lifecycle stage.

### 3.3 Lifecycle Telemetry Table

| Lifecycle Stage | Evidence Class | M1 Registry Instances | M1 DOM Tokens | M2 Active Subscriptions | M3 Cumulative Attaches | M4 JS Heap (Bytes / MiB) |
|---|---|---|---|---|---|---|
| **1. baseline** | browser, mocked transport | 0 | 0 | 0 | 0 | 125,898,041 (120.06 MiB) |
| **2. Hub open** | browser, mocked transport | 22 | 22 | 176 | 22 | 137,477,366 (131.11 MiB) |
| **3. project switch** | browser, mocked transport | 22 | 22 | 176 | 22 | 141,444,150 (134.89 MiB) |
| **4. sidebar hide/show** | browser, mocked transport | 22 | 22 | 176 | 22 | 139,563,302 (133.10 MiB) |
| **5. split** | browser, mocked transport | 22 | 22 | 176 | 22 | 147,332,299 (140.51 MiB) |
| **6. Hub close** | browser, mocked transport | 0 | 0 | 0 | 22 | 151,519,649 (144.50 MiB) |

### 3.4 Key Observations & Leak Analysis
1. **Renderer Continuity:** During project switch (Stage 3), sidebar toggle (Stage 4), and split (Stage 5), `M3 Cumulative Attaches` remained exactly 22. Not a single terminal was re-attached or re-mounted, confirming complete xterm reuse across layout changes.
2. **Instance 1:1 Matching:** Across all active stages, `M1 Registry Instances` (22) strictly matched `M1 DOM Tokens` (22).
3. **Zero Subscription Leak:** Upon closing the Hub (Stage 6), `M2 Active Subscriptions` dropped from 176 to **0**. Every subscription callback registered for the 22 sessions was cleanly released.
4. **Teardown Cleanliness:** `M1 Registry Instances` and `MDOM Tokens` both returned to 0 on Hub unmount and cleanup.

---

## 4. Requirements & Invariants Evidence Map

### 4.1 Acceptance Criteria (AC1–AC6)

| ID | Description | Automated Evidence | Live / Browser Evidence | Status |
|---|---|---|---|---|
| **AC1** | **External Floating File Panel & Generation Fence:** File click opens/focuses format-appropriate floating OS window (even with tile default); file belongs to clicked tree's profile/project/worktree; generation change blocks cross-owner save; zero editor panes in Hub. | `os/intents.test.ts`, `stores/editor.test.ts:704-820` | `browser-tests/os-file-open-float.browser.tsx:1-120` | **PASS** |
| **AC2** | **Cross-Profile / Cross-Worktree Deduplication & Dirty Guard:** Identical relative paths in different profiles/worktrees open separate editor windows; same tuple focuses existing window; closing dirty editor guards buffer with ConfirmDialog. | `stores/editor.test.ts`, `os/window-ops.test.ts:90-115` | `browser-tests/os-file-open-float.browser.tsx:121-210`, `e2e/os-agent-hub-workspace.spec.ts` | **PASS** |
| **AC3** | **Complete Project Workspace Persistence & Sibling ARIA:** Open project workspaces preserve selected worktree, expanded file tree folders (`explorerTreeScopeKey`), and terminal split/tab layout across switches; no nested interactive controls in tab buttons. | `components/organisms/TraditionalTerminalProjectsNavigator.test.tsx:50-130`, `os/agent-hub/use-agent-hub-workspaces.test.ts` | `browser-tests/os-agent-hub.browser.tsx:170-220` | **PASS** |
| **AC4** | **Zero-Terminal Project Browsing:** Opening project from `[+ Open ▾]` with 0 terminals allows tree expansion, worktree changes, and floating file open without spawning implicit PTY. | `lib/agent-hub-open-workspaces.test.ts`, `components/organisms/TraditionalTerminalProjectsNavigator.test.tsx` | `browser-tests/os-agent-hub.browser.tsx:225-290`, `e2e/os-agent-hub-workspace.spec.ts` | **PASS** |
| **AC5** | **Cross-Project Observed Agents Roster:** Agents section displays observed agents (OMP, Codex, Claude) with persisted multi-select status filtering; clicking agent row switches to project workspace and focuses exact terminal pane/tab. | `os/agent-hub.test.ts:150-240`, `hooks/use-traditional-terminal-project-selection.test.ts` | `browser-tests/terminal-traditional-projects.browser.tsx:190-255` (In live E2E: documented N/A due to absence of backend agent daemon in test container). | **PASS** |
| **AC6** | **Sidebar Resize & Hide/Show:** Sidebar resizes smoothly between 220px and 520px (persisted) and toggles hidden/visible via button without remounting xterm instances or losing terminal focus. | `components/organisms/TraditionalTerminalProjectsNavigator.test.tsx:180-240` | `browser-tests/os-agent-hub.browser.tsx:198-243`, `browser-tests/os-agent-hub-renderer-measurement.browser.tsx` | **PASS** |

---

### 4.2 Binding Decisions (B1–B4)

| ID | Decision | Automated & Browser Evidence | Status |
|---|---|---|---|
| **B1** | **Terminal Conflict (First Claim Wins):** Loser Hub pane displays placeholder with "Go to window" reveal button (atomic desktop switch + restore + focus). Never closes window or terminates process group. TerminalsApp denied view adopts same reveal. | `os/agent-hub/HubTerminalClaimPlaceholder.test.tsx`, `os/window-ops.test.ts`, `browser-tests/os-hub-terminal-mounts.browser.tsx:280-350` | **PASS** |
| **B2** | **Global Float-Over-Maximized Stacking:** When desktop's focused window is float, float layer stacks above maximized plane (z-index 60 above maximized 40/50). Focusing maximized window brings it back to top (z-index 50). | `os/maximized-presentation.test.tsx:1-120`, `browser-tests/os-file-open-float.browser.tsx:220-330` | **PASS** |
| **B3** | **Shared Terminal Launch Lifecycle:** Hub new terminal launches in-stage via lifecycle extracted from TerminalsApp (reservation, settlement, generation checks, canonical target). Closing Hub while pending settles to background session. | `os/terminal-launch-lifecycle.test.ts`, `os/action-executor.test.ts`, `browser-tests/os-agent-hub.browser.tsx:295-350` | **PASS** |
| **B4** | **Hub Roster Removal & Clean Cutover:** Card roster, filter pills, Jump, and Open Beside removed; Review relocated to terminal tab action with generation/target fences; header keeps Attn/Work counters and Recipes. | `os/agent-hub.test.ts`, `browser-tests/os-agent-hub.browser.tsx:175-196` | **PASS** |

---

### 4.3 Invariants (C1–C7)

- **C1: Logical vs Runtime Identity Separation:** Logical tab identity (`terminalKey: [profileId, terminalId]`) is strictly separated from runtime target authority (`terminalTargetKey: [profileId, generation, serverEpoch, terminalId, incarnation]`). No runtime authority is persisted in Hub appState. *(Verified: `lib/terminal-claim-key.test.ts`, `lib/terminal-runtime-identity.test.ts`)*.
- **C2: Renderer Continuity & Singleton Host:** `TerminalKeepAliveHost` in `OsResourceHost` maintains persistent mounting. Retained mounts survive Hub visibility unmount and are pruned reactively on window close. *(Verified: `browser-tests/os-agent-hub-renderer-measurement.browser.tsx`, `browser-tests/os-hub-terminal-mounts.browser.tsx`)*.
- **C3: Comprehensive Attach Gate:** Attach gate wraps all attach paths (initial mount, registry callbacks, hidden tabs, unmount) using exact target claims. Standalone and Hub panes release only their own claims. *(Verified: `os/agent-hub/use-hub-terminal-attach-gate.test.ts`)*.
- **C4: Complete Lifecycle Reuse & Hub Close:** Hub launches participate in reservation and settlement. When Hub closes while launch is in flight, creation settles into a background session without orphan process leakage. *(Verified: `os/terminal-launch-lifecycle.test.ts`)*.
- **C5: Global Z-Order Arbitration:** DesktopCanvas z-index hierarchy validated with multiple maximized windows, focus toggles, and click-through prevention. *(Verified: `browser-tests/os-file-open-float.browser.tsx:220-330`)*.
- **C6: Read-Model Joins Intact:** Read-model tests for agent status, attention/work counts, and profile connectivity verified without regression. *(Verified: `os/agent-hub.test.ts`)*.
- **C7: File Reuse Integration:** Existing dirty editor buffers retain content and undo stack when revealed or focused; legacy `file:open` callers without explicit mode retain default placement. *(Verified: `os/window-ops.test.ts`, `stores/editor.test.ts`)*.

---

### 4.4 Review Findings (F1–F10) & Validation Decisions (V1–V7)

- **F1 & V1 (Editor Endpoint Save Fence):** Editor buffer identity is bound to the content baseline, captured from transport prior to read I/O, and committed only when content replaces the buffer. Re-pointing profile URL denies saves with buffer intact. Discard-and-reload rebinds identity. Same-endpoint reconnect continues saving. *(Verified: `stores/editor.test.ts:704-890`)*.
- **F2 (Presentation Input Ownership):** Owner-scoped tokens prevent stale cleanup handlers from muting or stealing stdin on quiet PTYs during Hub↔standalone handoffs. *(Verified: `lib/terminal-presentation-input.test.ts`, `browser-tests/os-hub-terminal-mounts.browser.tsx:360-440`)*.
- **F3 (Terminal Tab Pin & Close Actions):** Terminal tab pin/close is target-fenced and operates on the individual session without terminating the Hub window. Pin states persist across project navigation. *(Verified: `os/agent-hub/use-hub-terminal-tab-actions.test.ts`)*.
- **F4 (Atomic Cutover & Typecheck Integrity):** Pruning of legacy roster exports executed atomically with `AgentHubApp` rewrite; full TypeScript build passed without temporary shims. *(Verified: `pnpm build`)*.
- **F5 (Real Stacking Hit-Testing):** Browser stacking assertions executed under Chromium engine with real geometry and hit-testing (`browser-tests/os-file-open-float.browser.tsx`), leaving jsdom tests strictly for DOM tree structure. *(Verified: `os-file-open-float.browser.tsx`)*.
- **F6 (Exact Created Target Launch Selection):** Delayed launch selection requires exact match of captured owner and created target in fresh inventory; cancelled on profile retirement. *(Verified: `os/terminal-launch-lifecycle.test.ts`)*.
- **F7 (Rollback Order Enforcement):** Rollback plan documented in consumer-first order: `P06 -> all P02-P05 consumers -> P01`. *(Documented in `plan.md` and `phase-07-qualification-and-docs.md`)*.
- **F8 & V3 (Stuck Launch Manual Resolution):** "Clear stuck launch" allows clearing only for `definitely-absent` sessions based on fresh owner-qualified observation; `in-flight`, `unknown`, and `present-unresolvable` remain blocked. *(Verified: `os/terminal-launch-lifecycle.test.ts`, `browser-tests/os-agent-hub.browser.tsx:295-330`)*.
- **F9 (Durable Settlement Outcome):** Resolution checks settlement results and re-reads authoritative records; returns unavailable/conflict notice on storage failure. *(Verified: `os/terminal-launch-lifecycle.test.ts`)*.
- **F10 & V2 (Renderer Cost Measurement):** Measured M1 (registry deduplication + DOM tokens), M2 (active subscriptions net of releases), M3 (cumulative attaches), and M4 (heap) separately without arbitrary thresholds. *(Verified: Section 3 above)*.
- **V4 (BrowserApp iframe Stacking Limitation):** BrowserApp iframe host with fixed z-index 20 documented as a known limitation outside DesktopCanvas B2 stacking.
- **V5 (Cross-Tab In-Flight Launch Limitation):** In-flight launch tracking is page-scoped; launches pending in another tab are recognized only after PTY registration in inventory.
- **V6 (Persisted Dirty Tab Endpoint Identity):** Endpoint identity serialized with dirty tab documents; legacy dirty tabs lacking identity fail closed once on save until user reload.
- **V7 (Persisted Selected Workspace):** Logical `selectedWorkspace` serialized in `agent-hub` appState projection, validated against current inventory on restore.

### 4.5 Code Review Remediation Evidence (Cycle 1 & Integrated Review)

- **H1 (Per-Profile Terminal Inventory Authority for Pin Retention):** `use-hub-terminal-tab-actions.ts` protects pins by checking `loadedProfileIds` Set for per-profile readiness and verifying `getConnectionSnapshot(profileId).status !== "connected"`. Saved pins are never pruned prematurely when another profile is pending or in error. *(Verified: `use-hub-terminal-tab-actions.test.ts`)*.
- **H2 (Presentation Input Policy Enforcement):** `PaneContainer.tsx:225` sets `suppress = shouldSuppressTerminalFocus || !isActiveSession` so inactive/hidden terminals cannot be unsuppressed by pane loops. *(Verified: `PaneContainer.test.tsx`, `os-hub-terminal-mounts.browser.tsx`)*.
- **W1 (Delayed Inventory Workspace Selection Gate):** Cold workspace selection persistence in `use-agent-hub-workspaces.ts` waits until initial workspace restoration completes, preventing default null overwrites. *(Verified: `use-agent-hub-workspaces.test.ts`)*.
- **W2 (Clean Right-Sidebar File Tree Relocation):** Redundant inline file trees and disclosure buttons removed from `TraditionalTerminalProjectWorkspaceRow.tsx`; single right-sidebar `TraditionalProjectWorkspaceTree` in `TraditionalTerminalProjectsDisplay.tsx`. *(Verified: `TraditionalTerminalProjectsDisplay.tsx`, `TraditionalTerminalProjectWorkspaceRow.test.tsx`)*.
- **Critical (Safe Fail-Closed Termination):** Removed ambient `api.terminal.remove/kill` fallback in `use-hub-terminal-tab-actions.ts`. Unresolvable targets fail closed with action notice. *(Verified: `use-hub-terminal-tab-actions.test.ts`)*.

---

## 5. Known Limitations

The following items are decided and documented architectural boundaries, classified as known limitations rather than defects:

1. **Uncapped Renderer Fleet (V2):**
   - *Description:* No artificial cap is imposed on the number of mounted terminal renderers. Each live session in an open workspace mounts one `TerminalPanel` in `TerminalKeepAliveHost`.
   - *Impact:* Memory usage scales with total active sessions across open projects. In the mocked-transport fixture (`browser-tests/os-agent-hub-renderer-measurement.browser.tsx`), 22 active sessions cleanly released all 176 tracked subscription callbacks on Hub close (`M2: 176 -> 0`); general heap bounds and whole-runtime leak freedom across arbitrary fleets remain governed by accepted limitation V2.
2. **BrowserApp IFrame Stacking Outside B2 (V4):**
   - *Description:* `BrowserApp` iframe hosting utilizes an absolute overlay plane with fixed z-index 20 in `OsResourceHost.tsx`.
   - *Impact:* While floating Monaco editors, terminals, and file viewers cleanly stack above maximized Hub windows via B2 (z-index 60 vs 40/50), browser iframe content is hosted in a separate overlay container and does not participate in the DesktopCanvas float-over-maximized stacking plane.
3. **Cross-Tab In-Flight Launch Registry (V5):**
   - *Description:* The in-flight terminal launch registry is page-scoped in memory.
   - *Impact:* A terminal launch initiated in Tab A is not tracked as "in flight" by Tab B until the server creates the PTY and registers it in the terminal inventory query.
4. **Legacy Dirty Tab Endpoint Identity (V6):**
   - *Description:* Dirty tabs saved in localStorage prior to the endpoint-identity schema addition lack `boundEndpoint` metadata.
   - *Impact:* Hydrating a legacy dirty tab without endpoint identity causes the save fence to fail closed (save disabled) once to prevent cross-server corruption, until the user either discards changes or reloads.

---

## 6. Open Qualification Gates Status

- **Status:** `PENDING_HUMAN_REVIEW` & `TECHNICAL_GATES_OPEN`
- **Visual Review Ledger:** `packages/ui/e2e/os-agent-hub-workspace/review.md` initialized as `PENDING_HUMAN_REVIEW` per `docs/code-standards.md:214` awaiting operator inspection of captured screenshots.
- **Live Container Daemon Gate:** Live multi-profile streaming PTY continuity across daemon container restarts remains an open operations qualification gate.
- **Technical Carryovers:** Cycle 1 review W3 (close-target currency comparison against live inventory snapshot before dispatch) remains tracked as an open technical carryover.
