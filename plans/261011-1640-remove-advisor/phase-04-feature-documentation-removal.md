# Phase 04: Feature Documentation Removal

## 1. Context links

- Plan Root: [plan.md](./plan.md)
- Scope and Architecture Decisions: [reports/00-scope-and-design.md](./reports/00-scope-and-design.md)
- Backend & Docs Research Report: [research/researcher-02-backend-docs-report.md](./research/researcher-02-backend-docs-report.md)
- Scout Inventory Report: [scout/scout-01-advisor-removal-report.md](./scout/scout-01-advisor-removal-report.md)
- Ownership Manifest: [reports/01-ownership-manifest.json](./reports/01-ownership-manifest.json)
- User Validation: [confirmed decisions](./plan.md#validation-summary).
- Linux Service Evidence: [installed service re-audit](./reports/03-linux-service-audit.md).

## 2. Parallelization Info

- **Group:** Parallel Group D (documentation deletion, renaming, content excision, guidance scrub)
- **Concurrent Siblings:** Group A ([Phase 01](./phase-01-ui-presentation-removal.md)), Group B ([Phase 02](./phase-02-client-and-test-infrastructure-removal.md)), Group C ([Phase 03](./phase-03-native-server-removal.md))
- **Editing Pre-requisites:** None. Can start editing immediately in parallel.
- **Validation Pre-requisites:** All editing groups (A, B, C, D) must complete before link checkers or full project verification execute.
- **Unblocks:** [Phase 05](./phase-05-integration-verification.md) (Group E).

## 3. Overview

- **Date:** 2026-10-11
- **Description:** Complete removal of DamHopper Advisor feature documentation. Deletes dedicated Advisor docs, renames mixed API documentation `docs/api/advisor-and-workflow.md` to `docs/api/workflow.md` while preserving live workflow tracking contracts, updates all inbound links, scrubs feature passages from architecture, summary, configuration, roadmap, systemd, testing, and multi-server guides, excises historical Advisor feature entries from `docs/CHANGELOG.md` while preserving unrelated release history and external advisor mentoring mentions, and scrubs `AGENTS.md`. No new 'Advisor removed', tombstone, or deprecation notices are added.
- **Priority:** P2
- **Status:** completed
- **Review:** User confirmed historical feature-doc scrubbing 2026-10-11; implementation review and link verification remain pending.

## 4. Key Insights

- Dedicated Advisor documentation files `docs/configuration/advisor.md` and `docs/architecture/native-advisor.md` are completely deleted with zero replacement stubs.
- `docs/api/advisor-and-workflow.md` is mixed: Section 1 (lines 4–42) is Advisor REST API, while Section 2 (lines 43–72) is live Workflow Tracking Service and REST API documentation. The file is renamed to `docs/api/workflow.md`, retitled `# Workflow Tracking Service and REST API`, and Section 1 is deleted. All inbound links in `docs/api-reference.md` are migrated to point to `docs/api/workflow.md`.
- In `docs/CHANGELOG.md`, per user requirement to remove all feature documentation, historical entries and passages specifically describing the DamHopper Native Advisor feature (e.g. 2026-10-04 routing editor, 2026-10-02 native advisor migration) are excised. Crucially, unrelated release facts, external advisor mentoring/counsel references, and generic host-resource `Advisory` severity tones must be preserved.
- In `docs/linux-systemd.md` (§ 12) and `docs/archive/retired-plugin-platform.md`, feature claims asserting that Native Advisor is current architecture and instructions to curl `/api/advisor/status` are removed, while real system cleanup safeguards, script allowlists, and protections for external `$HOME/.evcrate` data are preserved.
- In `AGENTS.md`, lines describing the `advisor/` backend module, native advisor endpoints, and routing CAS policies are removed.
- Historical sealed plans/reports and OMP/Evcrate operational tooling (`.omp/evcrate/*`) are preserved and untouched.
- Every edited documentation file must remain under the 800 LOC limit (`docs.maxLoc: 800`).

## 5. Requirements

- R04.1: Delete `docs/configuration/advisor.md` and `docs/architecture/native-advisor.md`.
- R04.2: Rename `docs/api/advisor-and-workflow.md` to `docs/api/workflow.md`, delete Advisor section (lines 4–42), preserve Workflow Tracking section (lines 43–72), and retitle the document.
- R04.3: Migrate inbound links in `docs/api-reference.md` from `advisor-and-workflow.md` to `workflow.md`, and delete the Advisor endpoint paragraph.
- R04.4: Remove Advisor rows, passages, and links from `README.md`, `docs/README.md`, `docs/code-standards.md`, `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/configuration-guide.md`, `docs/configuration/index.md`, `docs/deployment-guide.md`, `docs/frontend-components.md`, `docs/frontend-components/workbench.md`, `docs/project-roadmap.md`, `docs/project-overview-pdr.md`, `docs/testing.md`, and `docs/user-guide-multi-server-profiles.md`.
- R04.5: Update `docs/linux-systemd.md` Section 12 to remove `/api/advisor/status` probe and feature claims while preserving plugin cleanup and external path protections.
- R04.6: Update `docs/archive/retired-plugin-platform.md` to remove claims that Native Advisor supersedes it as current architecture.
- R04.7: Excise Native Advisor feature entries from `docs/CHANGELOG.md` while preserving unrelated release facts, external advisor mentoring references, and host-resource Advisory severity.
- R04.8: Scrub Advisor module descriptions from `AGENTS.md`.
- R04.9: Do NOT create any 'Advisor removed', tombstone, deprecation, or replacement notices.
- R04.10: Ensure all edited markdown files remain strictly under 800 LOC.
- R04.11: User confirmed scrubbing historical feature documentation too. Preserve unrelated release facts, sealed evidence and other-project tooling; no remaining scope decision on changelog retention.
- R04.12: Service audit findings and deployment decisions belong in this plan/evidence only. Remove Advisor feature claims from product docs without adding retirement notices or new service-cleanup documentation.

## 6. Architecture

Clean cutover at the documentation boundary:
```
[Documentation Structure]
       ├── ✕ docs/configuration/advisor.md
       ├── ✕ docs/architecture/native-advisor.md
       ├── docs/api/advisor-and-workflow.md ➔ RENAME ➔ docs/api/workflow.md (Workflow API only)
       └── Cross-references cleaned across 19 files (zero broken links, zero dead feature prose)
```

## 7. Related code files (exclusive)

All paths relative to `ROOT=/home/loidinh/WS/dam-hopper-ws/remove-advisor`:

### Deleted Files (2 files)
- `docs/configuration/advisor.md`
- `docs/architecture/native-advisor.md`

### Renamed Files (source and destination; 2 owned paths)
- `docs/api/advisor-and-workflow.md` (delete rename source)
- `docs/api/workflow.md` (create rename destination with existing workflow-only content)

### Modified Files (19 files)
- `README.md`
- `docs/README.md`
- `docs/api-reference.md`
- `docs/code-standards.md`
- `docs/codebase-summary.md`
- `docs/system-architecture.md`
- `docs/configuration-guide.md`
- `docs/configuration/index.md`
- `docs/deployment-guide.md`
- `docs/frontend-components.md`
- `docs/frontend-components/workbench.md`
- `docs/project-roadmap.md`
- `docs/project-overview-pdr.md`
- `docs/testing.md`
- `docs/linux-systemd.md`
- `docs/archive/retired-plugin-platform.md`
- `docs/CHANGELOG.md`
- `docs/user-guide-multi-server-profiles.md`
- `AGENTS.md`

## 8. File Ownership

Phase 04 exclusively owns all 23 paths listed in Section 7, including both workflow rename paths. No other phase modifies these files.

## 9. Implementation Steps

1. Delete `docs/configuration/advisor.md` and `docs/architecture/native-advisor.md`.
2. Rename `docs/api/advisor-and-workflow.md` to `docs/api/workflow.md`:
   - Delete Section 1: "Native Evcrate Advisor API" (lines 4–42), including endpoint table, filter descriptions, and error codes.
   - Retain Section 2: "Workflow Tracking Service and REST API" (lines 43–72) verbatim.
   - Update title to `# Workflow Tracking Service and REST API`.
3. Edit `docs/api-reference.md`:
   - Change link from `[Advisor and workflow](./api/advisor-and-workflow.md)` to `[Workflow tracking](./api/workflow.md)`.
   - Remove lines 27–30 ("## Native Evcrate Advisor API" section and paragraph).
4. Edit `README.md` and `docs/README.md`:
   - Remove Native Advisor row in documentation index table.
   - Remove paragraph referencing Native Advisor as current in-process implementation.
5. Edit `docs/code-standards.md`:
   - Remove `advisor` from repository structure domain lists (line 10).
   - Remove Section `### Native Advisor` (lines 54–62).
   - In Tier 3 testing description (line 98), remove `/advisor`.
6. Edit `docs/codebase-summary.md`:
   - Remove `advisor/` row from backend domain table (line 37).
   - Remove `Advisor Panel` bullet from Core Library summary (line 60).
   - Remove `Native Advisor` bullet from architectural features (line 79).
7. Edit `docs/system-architecture.md`:
   - Remove `Advisor` from Mermaid domain diagram (line 16) and domain list (line 23).
   - Remove `native advisor` from Settings accordion summary (line 40).
   - Remove advisor state fields from `AppState` summary (line 86).
   - Remove Section `## Native Advisor` (lines 165–176).
   - Remove Native Advisor mention from security policy (line 217).
8. Edit `docs/configuration-guide.md` and `docs/configuration/index.md`:
   - Remove Native Advisor link and references.
9. Edit `docs/deployment-guide.md`:
   - Remove Native Advisor bullet under database guard (line 263).
10. Edit `docs/frontend-components.md` and `docs/frontend-components/workbench.md`:
    - Remove Native Advisor from workbench summary (line 9).
    - In `workbench.md`, remove Section `## Native Advisor Workspace host and provider` (lines 255–271).
11. Edit `docs/project-roadmap.md`:
    - Remove Native Evcrate Advisor completed roadmap row (line 10).
    - Remove sentence stating Native Advisor replaced plugin platform (line 32).
12. Edit `docs/project-overview-pdr.md`:
    - Remove Native Advisor bullet and PR-027 requirement row (line 42).
    - Remove Section `### Native Advisor` (lines 65–72) and security access paragraph (lines 105–108).
13. Edit `docs/testing.md`:
    - Remove specialized advisor routing browser test runner (lines 17, 34).
    - Remove Advisor journeys from E2E user journeys list (lines 97, 137–146, 152).
    - Remove Advisor bounding boxes and advisor routing test from testing gap table (lines 249, 251).
14. Edit `docs/linux-systemd.md`:
    - Retitle Section 12 to `## 12. Operator Runbook: Plugin Platform Retirement`.
    - In Step 2, remove `/api/advisor/status` curl check.
    - In Step 5, keep path protections for `/var/lib/dam-hopper/.evcrate/advisor-history` without treating Advisor as active feature.
    - Preserve existing guarded legacy-runner cleanup instructions and external data/shared IPC protections; do not present the obsolete runner as a current Advisor service.
15. Edit `docs/archive/retired-plugin-platform.md`:
    - Remove claims that Native Advisor supersedes plugin platform as current architecture.
16. Edit `docs/CHANGELOG.md`:
    - Excise feature entries specifically documenting the DamHopper Native Advisor feature (e.g. 2026-10-04 routing editor verification, 2026-10-02 native advisor migration).
    - Preserve unrelated release facts, external advisor mentoring/counsel references, and generic host-resource Advisory severity.
17. Edit `docs/user-guide-multi-server-profiles.md`:
    - Remove bullet referencing Workspace Advisor (line 281).
18. Edit `AGENTS.md`:
    - Remove `advisor/` from backend directories list (line 17) and structure tree (line 157).
    - Remove Native Advisor architecture bullet (lines 204–206).
    - Remove `advisor_service.rs` convention example (line 231).
    - Remove `feat(advisor): add model selector routing` commit example (line 261).

## 10. Todo list

- [x] Delete `docs/configuration/advisor.md` and `docs/architecture/native-advisor.md`
- [x] Rename `docs/api/advisor-and-workflow.md` to `docs/api/workflow.md` and excise Advisor API section
- [x] Update `docs/api-reference.md` links
- [x] Modify `README.md` and `docs/README.md`
- [x] Modify `code-standards.md`, `codebase-summary.md`, and `system-architecture.md`
- [x] Modify `configuration-guide.md`, `configuration/index.md`, and `deployment-guide.md`
- [x] Modify `frontend-components.md` and `frontend-components/workbench.md`
- [x] Modify `project-roadmap.md` and `project-overview-pdr.md`
- [x] Modify `testing.md` and `user-guide-multi-server-profiles.md`
- [x] Modify `linux-systemd.md` and `archive/retired-plugin-platform.md`
- [x] Modify `docs/CHANGELOG.md`
- [x] Modify `AGENTS.md`

## 11. Success Criteria

- Zero dead links to deleted docs (`advisor.md`, `native-advisor.md`, `advisor-and-workflow.md`).
- `docs/api/workflow.md` accurately documents the surviving Workflow Tracking REST API.
- All documentation files remain strictly under 800 LOC.
- Zero 'Advisor removed', tombstone, or deprecation notices added anywhere in documentation.
- Unrelated release history, external advisor mentoring, and host Advisory severity are preserved.

## 12. Conflict Prevention

- Do not edit any files in `packages/ui/` (owned by Phases 01 and 02) or `server/` (owned by Phase 03).
- Do not edit historical sealed plan reports in `plans/`.

## 13. Risk Assessment

- **Risk:** Broken link checkers or documentation anchors.
  - **Mitigation:** Comprehensive audit of all references to `advisor-and-workflow.md` and deleted pages; links migrated to `workflow.md`.
- **Risk:** Accidental deletion of workflow contracts.
  - **Mitigation:** Verified that lines 43–72 of `advisor-and-workflow.md` are preserved verbatim in `workflow.md`.

## 14. Security Considerations

- Surviving docs describe only live contracts; delete feature prose rather than explaining removed endpoints.
- Systemd runbook safeguards preventing deletion of root or system directories are preserved.

## 15. Next steps

- Once Phases 01–04 complete, proceed to [Phase 05](./phase-05-integration-verification.md).
