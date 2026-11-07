# Documentation Summary Report: Agent Hub Terminal-First Workspace

- **Date:** 2026-11-06
- **Agent:** DocsManager
- **Target Plan:** `plans/261106-0334-agent-hub-terminal-first-workspace/plan.md`
- **Scope:** Review and finalize core developer documentation for the shipped Agent Hub terminal-first workspace, floating OS file panels, global B2 stacking, presentation input ownership, and editor endpoint save fence.

---

## 1. Current State Assessment

Existing documentation across `docs/` reflected earlier prototypes and historical card roster designs from Nov 3. During Phase 07 qualification of the Agent Hub terminal-first workspace, the following key systems were implemented and verified across 3,537 unit tests and 58 Chromium browser tests:
1. **Agent Hub Terminal-First Workspace:** Card roster, filter pills, Jump, and Open Beside removed; replaced with `TraditionalTerminalProjectsDisplay` containing project sidebar, worktree selection, file tree navigation, observed agents roster, and Hub-mounted terminal panes on Desktop 1 "Hub".
2. **Top-Level Keep-Alive Mounting & Attach Gate (B1):** `OsResourceHost` merges standalone `terminals` with active Hub mounts (`useHubTerminalMountsStore`); single-visible-slot attach gate (`useHubTerminalAttachGate`) renders `HubTerminalClaimPlaceholder` with atomic "Go to window" (`revealWindow`).
3. **Presentation Input Ownership (F2):** WeakMap-backed token-scoped input arbitration (`packages/ui/src/lib/terminal-presentation-input.ts`) permanently marking terminals as `managed: true` with strictly monotonic epochs.
4. **Global Float-Over-Maximized Stacking (B2):** Focused floating windows elevate floating layer container to `zIndex: 60` above maximized plane (`zIndex: 40`, focused slot `50`); focusing maximized window drops floating layer container to `zIndex: 20`.
5. **Float File Open Mode (AC1, AC2):** `file:open` intent supports explicit `mode: "float"` with tree owner badges; reuses generation-equal or live-owner windows across desktops; fails closed to reveal-only on defined generation mismatch.
6. **Editor Endpoint Save Fence (V1, F1, V6):** Document identity bound to `EndpointIdentity` (`{ profileId, serverUrl }` normalized) on baseline read; profile URL re-pointing blocks saves fail-closed (`saveBlockedReason`) with buffer and undo intact; `discardAndReload` rebinds; dirty tab endpoint identity persisted.
7. **Shared Terminal Launch Lifecycle (B3, V3, V5):** Unified PTY launch lifecycle (`terminal-launch-lifecycle.ts`, `action-executor.ts`) with manual "Clear stuck launch" strictly fenced on fresh owner-qualified inventory confirmation (`definitely-absent`).

All 5 core files and supporting roadmap documentation have been audited, synchronized, and verified against actual codebase declarations.

---

## 2. Changes Made

### 2.1 `docs/frontend-components.md` (114 LOC)
- Updated `OsShell` to document `file:open` intent with explicit `mode: "float"` support and generation-fenced window reuse.
- Updated `DesktopCanvas` to document B2 global float-over-maximized stacking (`zIndex: 60` vs `40`/`50`, lowering to `20` when maximized is focused) and noted `BrowserApp` iframe overlay limitation outside B2 (V4).
- Updated `EditorApp` to document `EndpointIdentity` save fence (`stores/editor.ts`), dirty buffer preservation, `discardAndReload` rebinding, and persisted dirty tab endpoint metadata.
- Added `TerminalPresentationInput` (`packages/ui/src/lib/terminal-presentation-input.ts`) under OS Session Management & Interaction Components: WeakMap-backed token-scoped input arbitration, `managed: true` permanent flag, monotonic epochs, and stale release isolation on quiet PTYs.
- Verified `AgentHubApp` adapter and internal hooks (`useAgentHubWorkspaces`, `useHubTerminalAttachGate`, `HubTerminalClaimPlaceholder`, `useHubTerminalLaunch`, `HubStuckLaunchNotice`, `useHubTerminalTabActions`, `agent-hub-review.ts`).

### 2.2 `docs/codebase-summary.md` (380 LOC)
- Added `Agent Hub Terminal-First Workspace Checkpoint (2026-11-06)` table mapping subsystems, source paths, and architectural invariants.
- Documented Presentation Input Ownership (`packages/ui/src/lib/terminal-presentation-input.ts`), Global Float Stacking (`DesktopCanvas.tsx`), Float File Open Mode (`OsShell.tsx`, `intents.ts`), Editor Endpoint Save Fence (`stores/editor.ts`, `EditorApp.tsx`), and Shared Launch Lifecycle (`terminal-launch-lifecycle.ts`).
- Recorded all 4 decided limitations: uncapped renderers (V2), BrowserApp iframe stacking (V4), cross-tab in-flight launch (V5), and legacy dirty tabs without endpoint identity (V6).

### 2.3 `docs/system-architecture.md` (788 LOC)
- Updated `1. Agent Hub Terminal-First Workspace (2026-11-06 Superseding Transformation)` to document terminal-first workspace, single-visible-slot attach gate (B1), atomic `revealWindow`, Presentation Input Ownership (F2), B2 global float-over-maximized stacking (`zIndex: 60` vs `40`/`50`), float file open (AC1, AC2), editor endpoint save fence (V1, F1), shared launch lifecycle (B3, V3), and all 4 decided limitations (V2, V4, V5, V6).
- Tightened whitespace and redundant lines to enforce strict compliance with the 800 LOC ceiling, bringing file to 788 LOC (12-line safety margin).

### 2.4 `docs/CHANGELOG.md` (699 LOC)
- Updated unreleased section under `feat(agent-hub-workspace)` to explicitly list Presentation Input Ownership (`terminal-presentation-input.ts`), Terminal-First Workspace, Top-Level Keep-Alive Host Mounts, Single-Visible-Slot Attach Gate & Reveal Window, Global Float-Over-Maximized Stacking (z-index 60 vs 40/50), Float File Open Mode, Editor Endpoint Save Fence (`EndpointIdentity`), and Shared Terminal Launch Lifecycle.

### 2.5 `docs/code-standards.md` (223 LOC)
- Added normative standards for:
  - **Global Float-Over-Maximized Stacking (B2):** Stacking mechanics (`zIndex: 60` vs `40`/`50`, lowering to `20`), plus BrowserApp iframe limitation.
  - **Float File Open Mode:** `mode: "float"` semantics, owner badges, generation-equal or live-owner window reuse, and fail-closed reveal-only on generation mismatch.
  - **Presentation Input Ownership:** Owner-scoped tokens governing interactive presentation, WeakMap-backed `managed: true` terminal state, monotonic epochs, and stale predecessor release no-op safety.
  - **Editor Endpoint Save Fence:** `EndpointIdentity` binding to content baseline, save denial on profile URL re-pointing, `discardAndReload` rebinding, and persisted dirty tab endpoint metadata.

### 2.6 `docs/project-roadmap.md` (108 LOC)
- Synchronized B2 stacking description to match actual code and architectural documentation.

### 2.7 Codebase Compaction (`repomix-output.xml`)
- Re-ran `repomix` post-edits, packing 4,166 repository files (10,425,038 tokens) into `./repomix-output.xml`.

---

## 3. Gaps Identified

1. **E2E Live Container Qualification Gate:** Live Playwright container execution timed out during nested podman image build on the development workstation; automated unit (3,537 tests) and browser component (58 tests) suites pass cleanly, but live container qualification remains an open gate.
2. **Visual Review Ledger:** Viewport captures under `packages/ui/e2e/os-agent-hub-workspace/review.md` remain `PENDING_HUMAN_REVIEW` per `docs/code-standards.md:214`.
3. **Decided Architectural Limitations:** Documented as known limitations rather than defects:
   - V2: Uncapped renderer fleet (memory scales linearly with active sessions, measured in R5 with zero subscription leaks).
   - V4: `BrowserApp` iframe hosting (fixed z-index 20) resides outside DesktopCanvas B2 float-over-maximized stacking plane.
   - V5: In-flight terminal launch registry is page-scoped; cross-tab pending creations are recognized once PTY appears in server inventory.
   - V6: Restoring legacy dirty tabs lacking endpoint metadata fails closed once on save until reload.

---

## 4. Recommendations

1. **Operator Visual Review:** An operator should visually inspect viewport screenshots in `packages/ui/e2e/os-agent-hub-workspace/` to promote `review.md` from `PENDING_HUMAN_REVIEW` to approved.
2. **Modularization of Large Doc Files:** `docs/system-architecture.md` (788 LOC), `docs/CHANGELOG.md` (699 LOC), `docs/configuration-guide.md` (705 LOC), and `docs/android-native-acceptance.md` (788 LOC) approach the 800 LOC ceiling. When future major features land, proactively split them into topic directories (`docs/architecture/`, etc.).
3. **Automated Link & Reference Checks in CI:** Run `validate-docs.cjs` with appropriate `--src` parameters during CI to detect stale references early.

---

## 5. Metrics & Verification Summary

| Metric | Target | Current Value | Status |
| --- | --- | --- | --- |
| Max LOC per doc file | <= 800 LOC | `system-architecture.md`: 788 LOC<br>`CHANGELOG.md`: 699 LOC<br>`codebase-summary.md`: 380 LOC<br>`code-standards.md`: 223 LOC<br>`frontend-components.md`: 114 LOC<br>`project-roadmap.md`: 108 LOC | **PASS** |
| Repository ESLint | 0 errors | 0 errors (379 pre-existing non-blocking warnings) | **PASS** |
| Codebase Compaction | Up to date | Packed 4,166 files into `./repomix-output.xml` (10.4M tokens) | **PASS** |
| Automated Test Coverage | Passing | 3,537 unit tests passing; 58 Hub browser tests passing in Chromium | **PASS** |
| Web Production Build | Clean | Clean compilation across all workspaces | **PASS** |

---

## 6. Unresolved Questions

- None. (All binding decisions B1–B4, invariants C1–C7, review findings F1–F10, and validation decisions V1–V7 are documented and aligned with shipped codebase).
