# Scope and design decisions

Date: 2026-10-11. Planning only. Priority P2. Branch `refactor/remove-advisor`.
Worktree `/home/loidinh/WS/dam-hopper-ws/remove-advisor`, fast-forwarded from local main `538da1d3` to fetched `origin/main` `abba947c`.
Plan directory `plans/261011-1640-remove-advisor`.

## User acceptance items
1. Completely remove Advisor setting from Settings page.
2. Completely remove Advisor panel from Workspace, all layouts/modes and navigation/shortcuts.
3. Remove all documentation for this DamHopper feature. No replacement pages, deprecation messages or 'Advisor removed' changelog entries.
4. Create another worktree with branch based on main; completed.
5. Pull latest origin/main into that worktree; completed, fast-forward.
6. Plan only; ask review and offer optional validation interview before any implementation.

## Research gate
Two evc-researcher agents ran in parallel, each reported exactly five tool calls and research-only validation.
- [UI research](../research/researcher-01-ui-removal-report.md)
- [Backend/config/docs research](../research/researcher-02-backend-docs-report.md)
- [Scout plus parent supplement](../scout/scout-01-advisor-removal-report.md)
Conditional scout invoked using published evc-cmd-scout workflow/native read-only scout. Summary mtime was recent, but inventory snapshot 2026-10-05 was older than three days.
Required docs read: codebase-summary.md, code-standards.md, system-architecture.md, project-overview-pdr.md; root README read before planning. Updated architecture/summary re-read after fast-forward.

## Proposed architecture
Clean vertical-slice deletion: React UI and surface metadata; native client DTOs/REST invoke mappings; Rust domain/API/routes/state/config; feature-only tests/fixtures/scripts; feature docs.
Surviving architecture unchanged: profile/generation ownership, authentication, workflow, Plan dashboard, agent status, PTY/Browser keep-alive, host resources and new idle-suspend client-presence/consent paths.
No new schema, database migration, replacement service or compatibility API. Remove only dependencies proved exclusive.
Architecture gate recorded here as proposed design; do not edit current product architecture docs during planning. Implementation doc owner excises Advisor nodes/passages without adding retirement commentary.

## Resolved choices
- Mixed docs/api/advisor-and-workflow.md contains real workflow contracts at lines 43-72; rename to docs/api/workflow.md, retain workflow content, migrate all links.
- Remove DamHopper feature passages/entries from docs/CHANGELOG.md too. Preserve unrelated release facts and references to external advisor mentoring. User 'all docs' takes precedence over scout's default history-retention recommendation for ordinary feature docs.
- Preserve sealed historical plans/reports and OMP/Evcrate tooling; they are audit/operational records, not feature documentation.
- Never delete or mutate user/server-owned ~/.evcrate files; remove only repository-owned synthetic fixtures.
- ServerConfig and DamHopperConfigRaw have ordinary Serde unknown-key handling (no deny_unknown_fields on these structs). Remove Advisor field without introducing a shim. Implementation smoke must verify legacy TOML still loads and does not emit Advisor config on normal serialization.
- Existing generic valid-ID fallbacks should resolve stale panel selections; verify persisted shortcut/panel paths rather than adding Advisor-specific migrations.
- Shared application-readiness safety checks currently depend on /api/advisor/status. Replace their actual isolation probe with an existing surviving bounded API/filesystem path; never delete the safety guarantee.

## Parallel boundaries
A: UI presentation/hooks/layout/shortcuts; B: client/transport/public exports/browser/E2E fixtures; C: Rust backend/config; D: docs/guidance. A-D may edit concurrently with exclusive files, checks deferred until batch settles. E: final integration verification/reporting only, depends on A-D and owns no source/doc files.
A deletes Advisor DTO directory while B removes its imports: transient non-compiling shared checkout is expected, not a runtime dependency; run no mid-flight builds/tests. Same rule for fixtures vs consumers.
Planner must create exact mutually exclusive ownership lists and dependency matrix; integration fixes route back to file owner, never second ownership.

## Workflow notes
Planning/research/Mermaid skills loaded directly from published native SKILL.md files. Local skill resources absent.
Active-plan helper executed, but warned EVCRATE_SESSION_ID absent; explicit plan path is passed to every agent. Do not claim session persistence.
No implementation, production documentation edits, build/lint/test/browser smoke performed or claimed.

## Unresolved questions
None blocking plan creation. Validate optional substantive tradeoffs with user after plan delivery.

## Scope Amendment (2026-10-11): File Plans progress.md Deprecation

User requested extending scope to remove `progress.md` in plan view at "File plans" because it will be deprecated as tooling removes "advice" mode.

### Advisory Consultation & Refinements:
1. **Explicit Basis Recorded:** Recorded as an explicit dated amendment linked to advice mode tooling deprecation.
2. **Preserve Plan-Only Semantics:** Status, dates, phases, and completion fractions derive strictly from `plan.md`. Frontmatter conflict detection and date-range validation (`validate_date_range`) remain active. `lastDocumentUpdate` uses `plan_doc.modified_at` alone.
3. **Generic Markdown Navigation Maintained:** The server stops probing or treating `progress.md` as an authoritative status document, but general Markdown link navigation to relative files (including legacy `progress.md` or other notes) remains possible via `isCustomLocalDoc` without altering plan status. User progress files are never deleted.
4. **Regression Coverage:** Server scanner tests verify that presence of legacy `progress.md` (even with conflicting status or newer timestamp) does not affect plan status or emit diagnostics.
5. **Group F Boundary:** Group F owns the 18 files across server plans parser/scanner/DTOs, UI viewer/tabs, E2E fixtures/specs, and documentation.
