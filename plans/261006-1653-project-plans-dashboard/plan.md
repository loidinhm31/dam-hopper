---
title: "Project Plans Dashboard with Progress Opt-In"
description: "Expand Plan with folder-first selection, read-only reported phase progress and a selected-plan timeline."
status: pending
priority: P2
effort: 40h
branch: feat/project-plans-dashboard
tags: [feature, frontend, backend, api]
created: 2026-10-06
---

# Project Plans Dashboard

## Preflight contract
- Output: native immediate-folder/selected-plan APIs; owner-bound refresh; expanded Plan surface with folders, one selected plan's Overview/Timeline and read-only documents; preserved separate manual workflow.
- Current overview: [progress.md](./progress.md). This plan/phase status is an initial planning snapshot. Only parent publishes current administrative progress; no implementation authorization or advisor/controller activation implied.
- Approved design: [brainstorm](../reports/brainstorm-261006-1653-project-plans-dashboard.md); exact [contracts and acceptance](./contracts.md); [architecture proposal](../../docs/system-architecture.md#proposed-project-plans-dashboard).
- Source rule: plan.md defines metadata/phases; progress.md presence opts into reported current status; absent progress uses labelled plan fallback. Invalid progress stays unknown/conflict.
- Target: selected configured project or registered worktree's fixed plans/ folder. Profile/generation/target-qualified reads and watchers; no ambient fallback.
- Timeline: selected plan's explicit planned/actual ranges, creation milestones and Undated state. No mtime completion, effort duration or inferred phase scheduling.
- In scope: immediate-folder navigation/name filter; selected metadata/phase progress/documents/evidence; filesystem invalidation; desktop/mobile/narrow layouts.
- Out: automatic load-all, project-wide Board/Timeline comparison, app status writes, migrations/DB import, new agent/controller lifecycle, Node/iframe, heatmap, full reader/media integration, external Evcrate edits, commits/deployment.
- Constraints: Rust/React/Query/auth/filesystem patterns; cross-platform safe Unix/Windows code/builds with Linux runtime proof and Windows runtime explicitly unqualified; Markdown/Mermaid with local-image notices. Estimates remain planning estimates.

## Phases — Initial Snapshot

| # | Phase | Status | Progress | Effort | Detail |
|---|---|---|---|---|---|
| 01 | File parsing, source/date semantics | Pending | 0% | 8h | [Parser contract](./phase-01-source-parser-and-date-semantics.md) |
| 02 | Native read API and containment | Pending | 0% | 8h | [Read API](./phase-02-native-read-api.md) |
| 03 | Owner-bound client and filesystem refresh | Pending | 0% | 6h | [Client lifecycle](./phase-03-owner-bound-client-and-refresh.md) |
| 04 | Responsive folders/selected Timeline and documents | Pending | 0% | 10h | [Dashboard](./phase-04-dashboard-and-document-details.md) |
| 05 | Full-app qualification and documentation | Pending | 0% | 8h | [Qualification](./phase-05-qualification-and-documentation.md) |

## Dependencies and integration ownership
- 01 -> 02. 03 uses frozen DTOs and existing FS capabilities; implement after 02 contracts land. 04 uses 03. 05 qualifies integrated changes.
- One backend integration owner for router/domain/error/export seams; one frontend integration owner for ApiClient/WsTransport/Surface/Deck/Sheet seams. Independent parser and pure presentation work may proceed only against frozen contracts.
- Current SQLite workflow service/DTOs/mutations remain unchanged unless a narrowly required presentation callback changes; never masquerade file plans as database ItemDto.
- Filesystem and manual workflow availability remain independent. No new database migration, persisted plan cache or Tauri-specific feature.
- Read-only contract research: [backend](./research/backend-contract.md), [frontend](./research/frontend-contract.md).

## Qualification gate
- Exercise frozen pending + five complete progress, ordinary fallback, invalid/partial/conflicting progress, all date states and absent folder.
- Prove folders-first/no sibling-content reads; selected atomic replacement -> watcher -> Overview update; same-target plan/profile/reconnect isolation; source bytes/mtime/ctime unchanged; manual CRUD/notes/sessions and terminal/editor preserved.
- Auth/containment/limits; actual desktop/mobile app evidence/human review; capture-disabled CI parity. Linux runtime proof, no implied Windows runtime pass. Phase 05 lists future commands; no current feature/test-pass claims.

## Validation Summary — 2026-10-06
- Installed `/cmd-plan__validate` invoked; four questions including selection clarification answered. No implementation started.
- User replaced automatic collection loading with “display plan folder to select” then confirmed “Open one plan at a time.” Cross-plan Board/Timeline comparison removed; selected phase progress/timeline retained.
- Cross-platform code; Linux runtime proof. Windows runtime stays explicitly unqualified until exercised there.
- Markdown/Mermaid previews; accessible local-image notices, no image ticket/media integration.
- Reconciled overview, contracts, all five phases, research, brainstorm and proposed architecture. Details/checks: [validation report](./reports/planning-validation.md).

## Next action
Plan validated and remains pending. Implementation requires a separate explicit request; interview approval does not start implementation.

## Unresolved questions
None requiring a product decision. Platform/runtime prerequisites must be reported when exercised; unsupported formats remain diagnostic rather than silently migrated.
