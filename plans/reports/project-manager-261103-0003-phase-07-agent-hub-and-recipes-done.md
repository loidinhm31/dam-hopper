# Project Manager Report: Phase 07 Agent Hub and Launch Recipes Administrative Closure

- **Date:** 2026-11-03
- **Timestamp:** 2026-11-03 00:05:00 +07:00
- **Phase:** Phase 07 — Agent Hub home and Launch Recipes (`plans/261101-1738-ai-dev-os-redesign/phase-07-agent-hub-and-recipes.md`)
- **Status:** **Administratively closed per user approval (2026-11-03 00:05:00 +07:00); technical acceptance blocked.** (Administrative phase closure per user direction; technical acceptance blocked per Cycle 3 review scoring 5/10 with 3 Critical issues C1–C3 and 9 warnings W1–W9; tester-reported verification records 126 unit tests across 6 files, 6 browser component tests across 3 files, and 2 clean TypeScript typechecks; user-reported context notes Vite production web build passes; carried implementation defects C1–C3, AC8/W1, and W2–W9 carried forward as release qualification gates to Phase 08 cutover preparation and Phase 09 live container qualification).
- **Authority:** User approval and Phase 07 validation/review artifacts (`plans/reports/code-review-261102-2353-phase-07-agent-hub-and-recipes-cycle-3.md`, `plans/reports/tester-261102-2354-phase-07-agent-hub-and-recipes-cycle-3.md`)

---

## 1. Executive Summary & Delivery Scope

Phase 07 (`Agent Hub home and Launch Recipes`) of the [AI Dev OS Redesign](../261101-1738-ai-dev-os-redesign/plan.md) is **administratively closed per recorded user approval (2026-11-03 00:05:00 +07:00)**. Technical acceptance remains **blocked**; delivered functionality includes:

- **Multi-Profile Agent Hub Home (`packages/ui/src/os/apps/AgentHubApp.tsx`, `packages/ui/src/os/agent-hub.ts`):**
  - Singleton application registered in `app-registry.ts` under `agent-hub`.
  - Fans in connected server profiles, active terminal sessions, and agent status stores (`useAgentStatusStore`) with qualified status reducers.
  - Implements canonical urgency hierarchy (Needs Attention -> Working -> Idle -> Unknown/Unavailable) with explicit Idle-is-not-success semantics.
  - Multi-profile terminal navigation with jump-to-session routing, active profile badges, and desktop focus restoration.
  - Agent Hub desktop template (`createAgentHubDesktopTemplate`) with default 3-window layout.
- **Client-Side Declarative Launch Recipes (`packages/ui/src/os/recipes/*`, `packages/ui/src/os/apps/RecipesApp.tsx`):**
  - Recipe manager application (`RecipesApp.tsx`) with visual Recipe Editor (`RecipeEditor.tsx`) and Launch Review (`LaunchReview.tsx`).
  - V3 Save subset server+project chooser: inspects current desktop layout, displays matching windows, and provides explicit pre-save preview of excluded non-matching windows before confirmation.
  - Canonical binary topology pruning with automatic ratio renormalization; source windows remain completely unchanged.
  - Strict recipe JSON schema validation (`schema.ts`) rejecting malformed structures, unknown app IDs, and non-finite dimensions; imported recipes remain inert until user review.
  - Recipe export with explicit user warning regarding embedded command strings and filesystem paths.
  - Durable launch record persistence (`launch-records.ts`) under `dam-hopper:os:v1:recipe-launches` with frozen recipe snapshots and per-step state machines (`pending -> dispatched -> confirmed | failed | outcomeUnknown`).
  - Web Locks synchronization (`withRecipeLaunchLock`) serializing per-launch state transitions across browser tabs.
  - CommandPalette recipes mode integration (`CommandPalette.tsx`) and OS Dock launcher.
- **Catalog Manifests:**
  - Registered 17 application manifests in `app-registry.ts` (14 retained applications + `system-monitor`, `agent-hub`, `recipes`).

---

## 2. Testing Scorecard & Validation Evidence

Validation receipts recorded during Phase 07 execution:

- **Targeted Unit Tests (`pnpm --filter @dam-hopper/ui test`, Tester-Reported):**
  - 6 test files, 126/126 passed (0 failed, 0 skipped, 246 ms):
    - `src/os/agent-hub.test.ts`
    - `src/lib/traditional-terminal-agents.test.ts`
    - `src/os/recipes/schema.test.ts`
    - `src/os/recipes/launch-records.test.ts`
    - `src/os/recipes/recipe-engine.test.ts`
    - `src/os/app-registry.test.ts`
- **Targeted Browser Component Tests (`pnpm --filter @dam-hopper/ui test:browser`, Tester-Reported):**
  - 3 test files, 6/6 passed (0 failed, 0 skipped, 1.81 s):
    - `browser-tests/os-agent-hub.browser.tsx`
    - `browser-tests/agent-status-bridge.browser.tsx`
    - `browser-tests/os-recipes.browser.tsx`
- **TypeScript Compilation & Typechecking (Tester-Reported):**
  - `pnpm --filter @dam-hopper/ui exec tsc --noEmit`: Exit 0, 0 diagnostic errors (8.49 s).
  - `pnpm --filter @dam-hopper/ui test:e2e:typecheck`: Exit 0, 0 diagnostic errors (1.44 s).
- **Production Web Build:**
  - User-reported context notes `pnpm --filter @dam-hopper/ui build` passes; not independently exercised in tester-run receipt.

---

## 3. Code Review & Carried Implementation Blockers

Cycle 3 final review scored 5/10 (`plans/reports/code-review-261102-2353-phase-07-agent-hub-and-recipes-cycle-3.md`). Technical acceptance is **blocked** by 3 Critical findings and 9 warnings; all items are formally carried forward to Phase 08 cutover preparation and Phase 09 live qualification:

1. **C1 (Critical) — Cross-Tab Durable Run Selection & Reservation Authority:**
   - `LaunchReview.tsx` checks React `hasUnknown` scoped only to the current desktop outside any lock.
   - New records get distinct per-launch locks, so engine locking does not serialize the decision to create a run.
   - Two tabs mounted before launch or different virtual desktops can concurrently initiate separate runs, risking duplicate PTY creation while an original request can still succeed (violating requirements 15/18/19 and AC8/F1).
   - Requires atomic durable run-selection/start authority covering all tabs and virtual desktops before acquiring per-record execution locks.
2. **C2 (Critical) — Action-Time & Post-Await Epoch Authority Fencing:**
   - Epoch authority is checked at render time, but not at the effect/resolution boundary under lock.
   - The engine checks profile only, not current generation/epoch; it never rechecks after `terminal.create` awaits.
   - Reconciliation fetches lists outside the lock, swallows list errors into `[]`, and passes render-time epoch without an owner tuple.
   - Retained HTTP clients lack closed-state guards.
   - Requires action-time and post-await epoch checks under lock, truthful preservation of list failures, and connection owner fencing before container qualification.
3. **C3 (Critical) — Shared Launch Storage Blob & Un-Locked Startup Recovery:**
   - All launch records reside in a single `localStorage` blob under `dam-hopper:os:v1:recipe-launches`.
   - Per-record locks do not protect whole-blob read-modify-write operations or startup recovery, risking evidence loss between concurrent tabs.
   - Corrupt JSON or unreadable storage fails open to an empty collection, which can erase unknown tombstones and permit destructive replacement.
   - Requires storage-wide transactional protection under Web Locks and fail-closed corrupt-storage preservation.
4. **AC8 / W1 (High) — Window Manager Layout Restoration & Live PTY Adoption:**
   - `recipe-engine.ts` dispatches terminals but does not restore window topology into the Zustand window store (`TileTree<T>`), instantiate apps, or adopt verified alive PTYs; `capturedPtyMap` has no production caller and Save does not seed captured resume.
5. **Warnings W2–W9 Carryover:**
   - **W2:** Reviewed recipe vs executed frozen launch snapshot mismatch.
   - **W3:** Incarnation enforcement fails open and is missing on Hub Jump path.
   - **W4:** Incomplete preflight (instancing modes, project/worktree availability, central resource claims).
   - **W5:** Permissive portable schema/state boundary (appState leakage, non-binary splits, unconstrained dimensions).
   - **W6:** Determinism claim partial (canonical binary path only; compatibility splits generate random UUIDs).
   - **W7:** Command confirmation is a UI-only boolean, not a saved-value invariant.
   - **W8:** UI/Hub completeness gaps (RecipesApp export view clipping, Hub template not wired to default startup, missing workflow overview fan-in).
   - **W9:** Test suite depth deficiencies (locked helpers not imported by unit tests, browser tests cover happy paths only, E2E spec does not import JSON, live PTY held-create / two-tab F1 checks unexercised).

---

## 4. Phase Transition & Next Steps

1. **Current Plan Status:**
   - Phase 01: DONE (2026-11-02)
   - Phase 02: DONE (2026-11-02 01:26:49 +07:00)
   - Phase 03: DONE (2026-11-02)
   - Phase 04: DONE (2026-11-02 13:02:03 +07:00)
   - Phase 05: DONE (2026-11-02 19:35:00 +07:00)
   - Phase 06: DONE (2026-11-02 22:10:00 +07:00)
   - **Phase 07: Administratively closed per user approval (2026-11-03 00:05:00 +07:00); technical acceptance blocked.**
   - **Phase 08: pending** (`plans/261101-1738-ai-dev-os-redesign/phase-08-cutover-and-legacy-deletion.md`)
   - **Phase 09: pending** (`plans/261101-1738-ai-dev-os-redesign/phase-09-qualification-and-visual-review.md`)
   - **Phase 10: pending** (`plans/261101-1738-ai-dev-os-redesign/phase-10-documentation-and-handoff.md`)
2. **Next Steps:**
   - **Phase 08 Preparatory Work May Begin:** Preparation, catalog unification, and initial routing migration under `plans/261101-1738-ai-dev-os-redesign/phase-08-cutover-and-legacy-deletion.md` are unblocked.
   - **Strict Cutover Gates:** Actual root web-shell cutover and legacy UI deletion remain strictly gated on:
     1. Resolving carried Phase 07 source remediations (C1 cross-tab run selection, C2 action-time epoch authority and list error fencing, C3 shared-blob localStorage transactions and un-locked startup recovery, AC8 WM layout application and live PTY adoption).
     2. Live container PTY held-create / two-tab F1 checks under real daemon containers.
     3. Separate early P0 release receipt (publication and production container journey verification).
   - Maintain full traceability of all carried technical debt and qualification gates across Phase 08 and Phase 09.

---

## 5. Unresolved Questions

- Live container PTY qualification timing: Will F1 held-create and two-tab concurrent retry checks be validated during Phase 08 preparatory cutover staging or deferred entirely to Phase 09 live qualification?
