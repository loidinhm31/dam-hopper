# Phase 01 — Gate G8: Web Navigation & Monaco Provider Coexistence

**Artifact:** `plans/260901-1000-lsp-server-integration/reports/phase-01-web-navigation.md`  
**Phase:** 01 — Protocol, Dependency, and Real-Process Spike  
**Gate:** G8 — Web Navigation & Provider Coexistence  
**Status:** **STOP / PENDING WEB BROWSER QUALIFICATION (Phases 07 & 10)**  
**Date:** 2026-10-23 (Updated following Code Review Cycle 1)  

---

## 1. Executive Summary & Gate Status

In strict accordance with the Phase 01 success criteria and the Code Review findings:
> *"Halt if model-scoped coexistence or navigation freshness cannot be proven; no global feature disabling, built-in result contamination... If Monaco's available controls cannot achieve that without global collateral effects, G8 is STOP pending explicit replan."*

Gate G8 is formally assigned **STOP (Pending Web Browser Qualification)**. No false "GO" is claimed in Phase 01 because:
1. Monaco Editor's built-in TypeScript worker is configured globally (`monaco.languages.typescript.typescriptDefaults.setModeConfiguration`). Disabling definitions globally degrades non-semantic editor tabs (such as read-only diff views and unmanaged files).
2. True verification of model-scoped provider coexistence requires execution within a live browser DOM environment with Monaco workers active, which belongs to **Phase 07 (Shared Monaco Semantic Client)** and **Phase 10 (Linux Web Application Qualification)**.

---

## 2. Identified Architectural Conflict in Monaco

When both Monaco's built-in TypeScript service and DamHopper's LSP definition provider are active:
- Monaco executes **all** registered providers for language `"typescript"`.
- If the built-in worker returns results and DamHopper returns results, Monaco displays a disambiguation peek UI with duplicate entries.
- If built-in definitions are turned off via `typescriptDefaults.setModeConfiguration({ definitions: false })`, models that are NOT backed by DamHopper's backend (such as git commit diffs, scratchpads, or when semantic mode is toggled OFF) lose definition support entirely.

---

## 3. Candidate Architectural Directions for Phase 07

Two architectural patterns are candidates for Phase 07 implementation and qualification:

### Candidate A: Authoritative Delegating Provider
Register a single custom definition provider for `"typescript"` and `"javascript"`. Disable built-in definitions via mode configuration. When invoked:
- For models matching `dam-hopper://semantic/<target-id>/...`: Route query to `/ws/semantic/v1` over WebSocket.
- For all other models: Delegate directly to `monaco.languages.typescript.getTypeScriptWorker()` to retrieve the local worker's definition result.
- **Risk**: Requires maintaining the mapping from TypeScript worker AST positions to Monaco Locations, and must cover both `typescriptDefaults` and `javascriptDefaults`.

### Candidate B: Custom Semantic Language Mode
Register a specialized language mode (e.g. `dam-hopper-typescript`) for semantic tabs, inheriting syntax tokens from TypeScript while registering semantic providers exclusively on that mode.
- **Risk**: Custom language modes in Monaco may disrupt syntax highlighting, themes, and bracket matching unless thoroughly wired.

---

## 4. Phase 07 / Phase 10 Qualification Handoff

Gate G8 cannot be satisfied by static analysis or Node CLI scripts. The transition from STOP to GO requires:
1. Implementation of the selected provider architecture in `packages/ui` during **Phase 07**.
2. Automated Vitest browser-mode component tests demonstrating:
   - Simultaneous open semantic tab and non-semantic diff tab.
   - Zero duplicate definition entries on semantic models.
   - Uncompromised local definition resolution on non-semantic models.
   - Clean restoration of native Monaco behavior when semantic mode is disabled.
3. Fresh visual capture evidence and human review under **Phase 10**.
