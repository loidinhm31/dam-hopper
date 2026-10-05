# Stable Feature Documentation Refactoring Report

**Date:** 2026-10-05  
**Owner:** `StableFeatureDocs`  
**Target:** `docs/frontend-components/**/*.md`, `docs/linux-systemd/**/*.md`, `docs/workflow-api.md`, `docs/workflow-client-state.md`, `docs/workflow-context-surface.md`

---

## 1. Scope & File Status

All 10 assigned documentation files refactored, free of development `phase`/`plan` narrative labels and `plans/` links, and verified within size limits ($\le 800$ LOC):

| File | LOC | Status |
| :--- | :--- | :--- |
| `docs/frontend-components/workbench.md` | 272 | Cleaned; headings & links updated |
| `docs/frontend-components/terminal-and-ide.md` | 736 | Cleaned; stable anchors `#portspanel`, `#panecontainer` preserved |
| `docs/frontend-components/platform-integrations.md` | 85 | Cleaned; browser host references updated |
| `docs/frontend-components/host-and-usage.md` | 291 | Cleaned; operational qualification gates preserved |
| `docs/frontend-components/notifications-and-privacy.md` | 138 | Cleaned; runtime qualification boundaries preserved |
| `docs/frontend-components/files-and-media.md` | 119 | Verified clean |
| `docs/linux-systemd/idle-suspend-runbook.md` | 377 | Cleaned; RTC/helper runbook and observer metrics preserved |
| `docs/workflow-context-surface.md` | 278 | Cleaned; domain entities and dated verification preserved |
| `docs/workflow-api.md` | 597 | Cleaned; event vs note retention clarified; domain entities preserved |
| `docs/workflow-client-state.md` | 185 | Cleaned; domain helpers and types preserved |

---

## 2. Changed Map (Headings & Outgoing Links)

### Heading Refactors & Anchors
- **`docs/frontend-components/workbench.md`**:
  - `## Unified shell and profile navigation (Phase 02)` $\rightarrow$ `## Unified shell and profile navigation`
  - `## Profile-owned enrollment and MFA UI (Phase 04)` $\rightarrow$ `## Profile-owned enrollment and MFA UI` (Anchor: `#profile-owned-enrollment-and-mfa-ui`)
  - `## Shared Git-history view (search plan Phase 04)` $\rightarrow$ `## Shared Git-history view`
  - `## Unified-profile Settings, Usage, and Host ownership (Phase 06)` $\rightarrow$ `## Unified-profile Settings, Usage, and Host ownership`
  - `## Native Advisor Workspace host and provider (Phases 04 and 05)` $\rightarrow$ `## Native Advisor Workspace host and provider`
- **`docs/frontend-components/host-and-usage.md`**:
  - `## Unified-profile integration and qualification (Phase 09)` $\rightarrow$ `## Unified-profile integration and qualification`
  - `## Host-resource fleet deck and cards (Phase 02)` $\rightarrow$ `## Host-resource fleet deck and cards` (Anchor: `#host-resource-fleet-deck-and-cards`)
  - `## Terminal idle-suspend status (Phases 06–07)` $\rightarrow$ `## Terminal idle-suspend status`
  - `### Explorer-local transport errors (Phase 01 follow-up)` $\rightarrow$ `### Explorer-local transport errors`
- **`docs/frontend-components/notifications-and-privacy.md`**:
  - `## Cognito Privacy Mode (Phases 02–04)` $\rightarrow$ `## Cognito Privacy Mode`
- **`docs/frontend-components/terminal-and-ide.md`**:
  - `### Native SSH forwarding host (Phase 08)` $\rightarrow$ `### Native SSH forwarding host`
  - `#### Inline terminal suggestions (Phase 04)` $\rightarrow$ `#### Inline terminal suggestions`
  - `### Phase 03 files/editor/search ownership` $\rightarrow$ `### Files, editor, and search ownership`
  - Preserved stable anchors: `### PortsPanel` (`#portspanel`) and `### PaneContainer` (`#panecontainer`).
- **`docs/linux-systemd/idle-suspend-runbook.md`**:
  - `#### Phase 01 RTC and wake semantics` $\rightarrow$ `#### RTC and wakealarm semantics`
  - `#### Phase 04 helper audit v2` $\rightarrow$ `#### Helper audit v2 specification`
- **`docs/workflow-context-surface.md`**:
  - `## Workflow Context Surface (Phases 05–06)` $\rightarrow$ `## Workflow context surface components`
  - `### WorkspacePage and shell integration (Phase 06)` $\rightarrow$ `### WorkspacePage and shell integration`

### Outgoing Link Corrections
- **`docs/workflow-api.md`**:
  - `./system-architecture.md#workflow-phases-0103-service-rest-and-lifecycle-correlation` $\rightarrow$ `./system-architecture.md#workflow-tracking-engine`
  - `./project-overview-pdr.md#pr-013-terminal-lifecycle-correlation-and-agent-adapter-phase-03` $\rightarrow$ `./project-overview-pdr.md#workflow-persistence-service-correlation`
- **`docs/workflow-context-surface.md`**:
  - `./system-architecture.md#workflow-context-surface-ui-phase-05` $\rightarrow$ `./system-architecture.md#workflow-tracking-engine`

## 3. Plan & Report References Removed

All 8 links pointing into `plans/` were removed across owned files:
1. `docs/workflow-api.md`: Removed link to `../plans/reports/code-reviewer-260902-0420-phase-03-terminal-lifecycle-correlation.md`.
2. `docs/workflow-client-state.md`: Removed source-of-truth claim and link to `../plans/260901-0919-workflow-tracking-notes/phase-04-client-types-transport-and-query-state.md`.
3. `docs/frontend-components/workbench.md`:
   - Removed link to `../../plans/260926-2157-token-rotation-mfa/phase-04-profile-mfa-flow.md`.
   - Removed link to `../../plans/261001-2003-git-history-search-persistence/phase-04-shared-history-view.md`.
   - Removed link to `../../plans/261001-2003-git-history-search-persistence/phase-07-qualification-documentation.md`.
   - Removed link to `../../plans/260929-1522-host-resources-sse/phase-04-resource-query-and-ui-cutover.md`.
4. `docs/frontend-components/host-and-usage.md`:
   - Removed link to `../../plans/260916-2137-unified-profile/verification-matrix.md`.
   - Removed link to `../../plans/reports/qa-260911-1107-phase07-integrated-qualification.md`.

---

## 4. Runtime-Term Exceptions (Preserved Domain Identifiers)

Genuine runtime entity types and source identifiers preserved precisely:
- **Workflow Domain Entities:** `Plan`, `Phase`, `Task` entity kinds.
- **DTOs & Types:** `ItemKind: plan | phase | task`, `allowedChildKinds(null)`, `allowedChildKinds(plan)`, `allowedChildKinds(phase)`.
- **Domain Hierarchy:** Three-level `Plan -> Phase -> Task` hierarchy; `parentId` field examples (`"parentId": "phase-uuid"`).
- **DTO Fields & Payloads:** `plans` array in `OverviewDto`, `ItemOverviewNode`, `standaloneTasks`, `Plan-rooted trees`, `totalTrackedTasks`/`completedTrackedTasks` progress semantics.
- **UI Domain Headings & Elements:** `New Plan`, `Plans & Work`, active Plan selectors.
- **Source Filename Substring:** Kept real script path reference `scripts/qualify-phase09-workbench.mjs`.
- **W3C DOM Event Concept:** Capture listener registration in terminal touch handling (`capturing, passive` listeners).

---

## 5. Factual & Architectural Corrections

- **Workflow Retention Invariants:** Preserved distinction between:
  - `DEFAULT_EVENT_RETENTION_DAYS = 90`: Hardcoded at event insertion; `server.workflow_event_retention_days` is currently schema-only.
  - `server.workflow_deleted_note_retention_days` (default 7 days): Actively consumed by `WorkflowService` and 24-hour purge batches of 500 items.
- **Historical Evidence vs. Operational Gates:** Retained exact dated verification counts (e.g. 2026-09-02 UI/server test counts; 3,504 passed web tests; 0.74s Linux observer check) while stripping development phase labels ("Phase 01–09").
- **Physical Gates:** Preserved requirement that Windows native runtime (S13 / SSH / DPAPI / WebView2), Linux browser debug WebKitGTK runtime, and RTC wake canaries are operational operator gates, not assumed verified from unit tests.

---

## 6. Peer Coordination

- Notified `DocsReorganizer` of heading updates affecting `docs/frontend-components.md`:
  - `#profile-owned-enrollment-and-mfa-ui` (in `workbench.md`)
  - `#host-resource-fleet-deck-and-cards` (in `host-and-usage.md`)
  - Confirmed preservation of `#portspanel` and `#panecontainer` in `terminal-and-ide.md`.

---

## 7. Unresolved Questions

None.
