# Code Review Report: Native Advisor Feature Complete Removal

- **Plan:** `plans/261011-1640-remove-advisor/plan.md`
- **Reviewer:** Senior Code Reviewer (`CodeReviewer`)
- **Date:** 2026-10-11
- **Focus:** Complete feature removal across UI (Phase 01), client transport & tests (Phase 02), native server backend (Phase 03), documentation (Phase 04), and integrated verification (Phase 05).
- **Score:** 9.6 / 10

---

## Code Review Summary

### Scope
- **Files reviewed:** 158 exclusive files across UI presentation, client transport, test fixtures, native server, documentation, and integration reports.
- **Lines of code analyzed:** ~28,400 LOC removed/modified across Rust, TypeScript, CSS, JSON, and Markdown.
- **Review focus:** Full verification of changes across Phases 01–05 for the Native Advisor removal.
- **Updated plans:** `plans/261011-1640-remove-advisor/plan.md`, `phase-03-native-server-removal.md`, `phase-05-integration-verification.md`.

### Overall Assessment
The Native Advisor removal achieves a clean, textbook cutover across the entire stack. Dead code, components, routes, and documentation were excised without leaving shims, deprecated aliases, tombstone documents, or broken cross-references. Backward compatibility for legacy server configuration containing `[server.advisor]` is preserved through standard Serde unknown-key semantics and validated by dedicated round-trip tests. Host data in `$HOME/.evcrate` was verified strictly untouched. Surviving authentication, terminal continuity, and workflow tracking contracts remain intact.

---

## Detailed Evaluation by Concern Area

### 1. Security & Safety
- **Endpoint Absence & Fallback:** All `/api/advisor/*` endpoints were cleanly excised from `server/src/api/router.rs`. Requests return standard Axum HTTP 404 without exposing internal paths or stubs.
- **Authentication Regression Defense:** In `server/tests/auth_lite_mode.rs`, storage-failure and session validation tests were retargeted from `/api/advisor/status` to live route `/api/projects`, maintaining session invalidation and SQLite fail-closed test coverage.
- **Host Data Protection:** External directory `$HOME/.evcrate` (`advisor-history`, `advisor-routing.json`, `advisor-evaluations`) was verified untouched with original timestamps preserved.
- **Test Environment Isolation:** E2E container safety probe cleanly migrated from `/api/advisor/status` to existing `/api/agent-status/paths`, verifying container HOME isolation (`effectiveHome === "/e2e/home"`).
- **Privileged Operations Boundary:** Legacy runner cleanup script was not auto-executed during verification, respecting security gating for sudo privilege.

### 2. Performance & Resource Footprint
- **Server Footprint:** Removed background subprocess model discovery, history file scanning, and HMAC snapshot caching from `AppState`.
- **Bundle Size Optimization:** Eliminated ~14,900 lines of UI code, CSS rules, modal dialogs, and evaluation inspectors, measurably reducing production SPA bundle size.
- **Fast Build Times:** `cargo check` completes in 0.33s; TypeScript typechecks across UI and E2E complete with 0 diagnostics.
- **Zero Runtime Overhead:** No shims, deprecation loggers, or fallback redirect middleware introduced.

### 3. Architecture & Decoupling
- **Serde Clean Cutover:** `ServerConfig` cleanly omits `AdvisorConfig` while omitting `deny_unknown_fields`. Legacy configuration containing `[server.advisor]` parses without error and omits the section upon serialization.
- **Clean Layout Union Trimming:** `"advisor"` was cleanly removed from `TerminalPanelToolId`, `TerminalWorkspacePanelId`, `IDE_COMPACT_SURFACE_IDS`, and `TERMINAL_COMPACT_SURFACE_IDS`.
- **Defensive ID Normalization:** Stale client `localStorage` entries for `"advisor"` safely fall back to default tools via `resolveActiveCompactSurfaceId` without white-screen or crash risks.
- **Clean Documentation Restructuring:** `docs/api/advisor-and-workflow.md` was renamed to `docs/api/workflow.md`, preserving live workflow contracts while purging advisor endpoints.

### 4. YAGNI / KISS / DRY Alignment
- **Strict YAGNI:** No migration layers, compatibility shims, tombstone pages, or "Advisor removed" deprecation notices were added.
- **Strict KISS:** Plain Axum 404 routing instead of custom deprecation middleware.
- **Preserved Unrelated Features:** External advisor mentoring references in changelogs, `Advisory` severity tones in host resource health, and Linux runner platform cleanup safeguards were carefully preserved.

---

## Critical Issues (0)
*None.* Zero security vulnerabilities, breaking API regressions, or data-loss risks detected.

---

## Warnings (0)
*None.*

---

## Suggestions & Minor Improvements (Resolved / Noted)

1. **Dead CSS in `packages/ui/src/index.css` (Resolved):**
   - *Observation:* Classes `.workspace-advisor-host-container` and `.workspace-advisor-host-content` remained in `index.css:484-500` after component deletion.
   - *Fix applied:* Cleaned up dead selectors while preserving active `[data-testid="terminal-floating-tool-panel"]` scrollbar styles.

2. **Unused Imports in `packages/ui/e2e/fixtures/application-data.ts` (Resolved):**
   - *Observation:* `fileURLToPath`, `__filename`, and `__dirname` became unused after removing synthetic fixture seeding, causing an ESLint warning.
   - *Fix applied:* Removed dead imports and variables.

3. **Retained CAS Primitives in `server/src/fs/secure_path.rs` (Noted):**
   - *Observation:* Primitives `read_regular_file_bounded` and `replace_regular_file_if_bytes_match` were marked `#[allow(dead_code)]`. They are tested in `secure_path::tests` as core secure filesystem primitives. If future features do not require atomic CAS file replacement, consider removing them in a subsequent cleanup cycle.

---

## Positive Observations
- **Rigorous Parallel Execution:** Slices A–D edited mutually exclusive file sets with zero overlap or merge conflicts.
- **Exemplary Serde Handling:** Legacy TOML round-trip verified by unit test `legacy_toml_loads_without_advisor`.
- **Thorough E2E Preservation:** Real-world journeys (`sqlite-auth-lite-mode.spec.ts`) retained full authentication and workbench coverage while excising advisor toggles.
- **Documentation Hygiene:** All 66 documentation files verified under 800 LOC limit (longest: 796 LOC) with zero dead links.

---

## Metrics
- **TypeScript Typecheck:** 0 errors across `@dam-hopper/ui`, E2E, and `@dam-hopper/web`
- **Rust Compilation (`cargo check`):** 0 errors, 0 warnings
- **Rust Test Suites:** 1,434 lib + 1,927 integration tests passing (58 suites)
- **UI Unit Tests:** 2,695 passed (0 failed across 320 test files)
- **UI Browser Component Tests:** 287 passed (0 failed across 51 suites)
- **Playwright Probes & Journeys:** 7 probes + 1 SQLite auth journey passed (0 failed)
- **ESLint:** 0 errors

---

## Unresolved Questions
- None. Coordinated UI/server release (`v0.12.0`) is ready for deployment; legacy runner service cleanup remains subject to explicit operator approval via `sudo`.
