# Phase 06: File Plans progress.md Deprecation and Removal

## 1. Context links

- Plan Root: [plan.md](./plan.md)
- Scope and Architecture Decisions: [reports/00-scope-and-design.md](./reports/00-scope-and-design.md)
- Ownership Manifest: [reports/01-ownership-manifest.json](./reports/01-ownership-manifest.json)
- Integration Verification: [phase-05-integration-verification.md](./phase-05-integration-verification.md)

## 2. Parallelization Info

- **Group:** Group F (File plans progress.md deprecation across Server, UI, E2E, and Documentation)
- **Pre-requisites:** Phases 01–04 complete (Group A–D native advisor excised).
- **Validation:** Runs Rust plan tests, UI unit/browser suites, E2E fixtures, and workspace typecheck.
- **Unblocks:** Final release sign-off in Phase 05.

## 3. Overview

- **Date:** 2026-10-11 (Scope Amendment)
- **Description:** Deprecate and remove `progress.md` parsing, scanning, status/date reconciliation, and dedicated document presentation tabs in the Project Plans Dashboard ("File plans"). Status, dates, phases, and completion fractions derive strictly from `plan.md`.
- **Priority:** P2
- **Status:** done (2026-10-11)

## 4. Key Insights & Design Rules

1. **Explicit Scope Basis:**
   - The tooling that generated `progress.md` was coupled to "advice" mode. With Advisor removed, `progress.md` is deprecated and removed from DamHopper's authoritative plan parser and viewer.
2. **Preserve Plan-Only Semantics:**
   - `plan.md` is the sole authority for plan status, metadata, phases, and dates.
   - Frontmatter status vs declared phase status conflict rules are preserved.
   - Date range validation (`validate_date_range`) is preserved on `plan_dates`.
   - `lastDocumentUpdate` is derived exclusively from `plan_doc.modified_at`.
   - Completion fraction derives strictly from declared phases in `plan.md`.
3. **Preserve Sandboxed Markdown Link Navigation:**
   - The server stops probing or interpreting `progress.md` as an authoritative status document.
   - User-owned `progress.md` files on disk are never deleted or modified.
   - If `plan.md` contains a relative Markdown link to `./progress.md` (or any other `.md` file), generic filesystem read and subdocument navigation continue to work via `isCustomLocalDoc` ("Viewing: plans/.../progress.md [Return to plan]"), without influencing plan status or phases.
4. **Behavioral Regression Protection:**
   - Server scanner tests verify that presence of a legacy `progress.md` (even with conflicting status, bad formatting, or newer mtime) does not influence plan status or emit progress diagnostics.
5. **Clean DTO and Wire Contract:**
   - `PlanDocuments`: contains `pub plan: PlanDocument`. The `progress` field is removed.
   - `PlanAuthority`: `Plan` is the sole authority (serialized as `"plan"`).
   - Obsolete diagnostics excised: `DIAG_PROGRESS_MISSING`, `DIAG_PROGRESS_UNREADABLE`, `DIAG_PHASE_UNREPORTED`, `DIAG_PHASE_UNMATCHED`.
6. **UI Presentation:**
   - `ProjectPlanDocument.tsx`: Remove the secondary "Progress (progress.md)" tab. Render "Plan (plan.md)" and subdocument viewer. Preserve absent/unreadable banners for general document errors.

## 5. Requirements

- **R06.1 (Server DTO):** Remove `progress` from `PlanDocuments`. Remove `PlanAuthority::Progress`. Remove obsolete diagnostic constants.
- **R06.2 (Server Scanner):** In `server/src/plans/scan.rs`, remove probing and reading of `progress.md`. Pass only `plan_doc` to `parse_plan`.
- **R06.3 (Server Parser):** In `server/src/plans/parser.rs`, remove `parse_progress_document`, `parse_reconciliation_table`, progress status/date reconciliation, and progress authority branches. Preserve plan-only status derivation, phase inventory, and date-range validation.
- **R06.4 (Server Tests):** Update `server/src/plans/tests.rs` to remove progress reconciliation tests, replace with tests verifying legacy `progress.md` is ignored, and verify plan-only derivation.
- **R06.5 (UI Types & Client):** Update `packages/ui/src/api/project-plans-types.ts` to remove `progress` from `PlanDocuments` and update `PlanAuthority`.
- **R06.6 (UI Document Component):** Update `packages/ui/src/components/organisms/ProjectPlanDocument.tsx` to remove the progress tab while keeping custom local doc viewing and state banners. Update `ProjectPlanDocument.test.tsx`.
- **R06.7 (UI Tests & Fixtures):** Update plan fixtures in `ProjectPlanOverview.test.tsx`, `ProjectPlanTimeline.test.tsx`, `ProjectPlansDashboard.test.tsx`, `project-plans-queries.test.ts`, and `use-project-plans.test.tsx`.
- **R06.8 (E2E & Browser):** Update `packages/ui/browser-tests/plans-dashboard.browser.tsx`, `packages/ui/e2e/fixtures/plan-fixtures.ts`, and `packages/ui/e2e/project-plans-dashboard/project-plans-dashboard.spec.ts`.
- **R06.9 (Documentation):** Update `docs/system-architecture.md`, `docs/workflow-api.md`, and `docs/api/filesystem-and-media.md` to remove references to `progress.md` opt-in and progress authority.

## 6. File Inventory

| Area | File Path | Action |
|---|---|---|
| Server | `server/src/plans/dto.rs` | Update DTOs, enums, diagnostics |
| Server | `server/src/plans/scan.rs` | Remove progress.md probing/reading |
| Server | `server/src/plans/parser.rs` | Simplify parser to plan.md authority |
| Server | `server/src/plans/tests.rs` | Update tests & add legacy ignore tests |
| UI | `packages/ui/src/api/project-plans-types.ts` | Remove progress from types |
| UI | `packages/ui/src/components/organisms/ProjectPlanDocument.tsx` | Remove progress tab |
| UI | `packages/ui/src/components/organisms/ProjectPlanDocument.test.tsx` | Update tests |
| UI | `packages/ui/src/components/organisms/ProjectPlanOverview.test.tsx` | Update test fixtures |
| UI | `packages/ui/src/components/organisms/ProjectPlanTimeline.test.tsx` | Update test fixtures |
| UI | `packages/ui/src/components/organisms/ProjectPlansDashboard.test.tsx` | Update test fixtures |
| UI | `packages/ui/src/api/project-plans-queries.test.ts` | Update test fixtures |
| UI | `packages/ui/src/hooks/use-project-plans.test.tsx` | Update test fixtures/triggers |
| UI | `packages/ui/browser-tests/plans-dashboard.browser.tsx` | Update browser test fixtures |
| E2E | `packages/ui/e2e/fixtures/plan-fixtures.ts` | Remove progress.md generation |
| E2E | `packages/ui/e2e/project-plans-dashboard/project-plans-dashboard.spec.ts` | Update test assertions |
| Docs | `docs/system-architecture.md` | Remove progress.md opt-in text |
| Docs | `docs/workflow-api.md` | Remove progress.md description |
| Docs | `docs/api/filesystem-and-media.md` | Remove progress.md description |

## 7. Verification Steps

1. `cd server && cargo test plans`
2. `pnpm --filter @dam-hopper/ui test`
3. `pnpm --filter @dam-hopper/ui test:browser`
4. `pnpm check`
5. `pnpm --filter @dam-hopper/ui test:e2e:typecheck`

## 8. Verification Results (2026-10-11)

- `cd server && cargo test plans`: 20/20 passed in 1.19s (including legacy ignore regression).
- `cd server && cargo test --test plans_api`: 16/16 passed in 3.61s.
- `pnpm --filter @dam-hopper/ui test`: 2,695 tests passed across 320 test files.
- `pnpm --filter @dam-hopper/ui test:browser`: 287 passed, 4 skipped in 62.47s.
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck`: 0 errors.
- `pnpm check`: Full workspace build, native tauri build, lint, and full Rust test suite passed.
