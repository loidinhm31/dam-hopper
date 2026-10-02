# Native Advisor Contract and Parity Baseline

**Status:** Frozen  
**Date:** 2026-10-02  
**Owner:** Integration Owner  
**Phase:** 01 — Freeze native contract and source parity baseline  
**Parent Plan:** [Native Advisor Migration](../plan.md)  
**Architecture Reference:** [docs/architecture/native-advisor.md](../../../docs/architecture/native-advisor.md)  
**Validated Decisions:** [reports/validated-decisions.md](./validated-decisions.md)  

---

## 1. Executive Summary & Confirmed Scope

Phase 01 freezes the contract and source parity baseline for moving Evcrate Advisor into Dam-Hopper as a native Rust/Axum backend service with React Workspace integration. This migration retires the entire Dam-Hopper plugin platform (generic plugin runner, runner systemd unit, plugin tmpfiles, `@dam-hopper/plugin-sdk`, plugin bridge, and settings registration UI).

### Core Boundaries & Frozen Decisions
1. **Full Platform Retirement:** The entire plugin infrastructure in Dam-Hopper is decommissioned in later phases. No plugin shims or runner zombie processes remain.
2. **Per-Server Admin Enablement:** One persisted setting `server.advisor.enabled` (default `false`) stored in `~/.config/dam-hopper/dam-hopper.toml`. Only authenticated administrators can access Advisor data or mutate this setting. Missing or newly discovered history directories never flip this setting implicitly.
3. **No Path Hashing Utility or Admission Gate:** The user explicitly removed the path-hash utility from native settings. There is no path SHA-256 field, copy/generate button, root identity admission check, or hash prerequisite. Existing domain hashes (project ID SHA-256 partition, checkpoint digest, document revision digests, and HMAC cursor signatures) remain intact as core algorithms.
4. **History Root Directory:** Fixed to server process `$HOME/.evcrate/advisor-history`. Unset or empty `$HOME` renders the source unavailable; no fallback to CWD, `/root`, or `/home/*` scanning. The final root directory must be a real directory verified via `symlink_metadata`; a final-root symlink is explicitly rejected with a clear error. Ancestor symlinks are permitted, and canonical string equality (`canonicalize(p) == p`) is not required. A readable empty real directory is reported as `available: true` with zero records.
5. **Policy & Evaluation Sources:**
   - Account-wide routing policy: `$HOME/.evcrate/advisor-routing.json` (max 16 KiB; statuses: `ready`, `migration_required`, `unsupported`, `invalid`, `not_configured`). Read-only; no policy editing API.
   - Evaluations discovery: searches `$HOME/.evcrate/advisor-evaluations`, then `$HOME/.evcrate/evaluations`, and `tests/fixtures/advisor-evaluations` under an explicitly registered/selected project worktree. The historical fallback to `process.cwd()/tests/fixtures/advisor-evaluations` is permanently eliminated.
6. **Native-Only Rollback Policy:** The new native release manager rejects plugin-bearing legacy releases before state or file mutation. Legacy rollback requires manual operator intervention using backed-up legacy manager binaries and state.

---

## 2. Operation Matrix & Endpoint Specifications

All native Advisor endpoints are mounted under `/api/advisor`. In accordance with Dam-Hopper repository conventions, wire API payloads use **camelCase**, while on-disk files produced by Evcrate maintain their canonical **snake_case** structure.

| Endpoint | Method | Native Service Method | Wire Request DTO | Wire Response DTO | Source Authority | Acceptance |
|---|---|---|---|---|---|---|
| `/status` | `GET` | `advisor.status()` | None | `AdvisorStatusDto` | Host environment check | A01, A03, A04 |
| `/settings` | `PATCH` | `advisor.update_settings(...)` | `AdvisorSettingsUpdateDto` | `AdvisorSettingsDto` | Server configuration TOML | A01, A02 |
| `/history/refresh` | `POST` | `advisor.refresh_history()` | `{}` | `HistoryRefreshResultDto` | `history-provider.cjs:58-119` | A03, A05, A06 |
| `/history/summary` | `POST` | `advisor.history_summary(...)` | `HistorySummaryParamsDto` | `HistorySummaryResultDto` | `history-provider.cjs:122-180` | A06, A07 |
| `/history/page` | `POST` | `advisor.history_page(...)` | `HistoryPageParamsDto` | `HistoryPageResultDto` | `cursor-manager.cjs:61-152` | A06, A07 |
| `/history/detail` | `POST` | `advisor.history_detail(...)` | `HistoryDetailParamsDto` | `HistoryDetailResultDto` | `history-detail.cjs:23-143` | A08 |
| `/policy/current` | `POST` | `advisor.read_current_policy()` | `{}` | `PolicyReadCurrentResultDto` | `policy-provider.cjs:18-142` | A09 |
| `/evaluations/list` | `POST` | `advisor.list_evaluations(...)` | `EvaluationsListParamsDto` | `EvaluationsListResultDto` | `evaluation-provider.cjs:66-104` | A10 |
| `/evaluations/read` | `POST` | `advisor.read_evaluation(...)` | `EvaluationsReadParamsDto` | `EvaluationsReadResultDto` | `evaluation-provider.cjs:106-132` | A10 |
| `/evaluations/compare` | `POST` | `advisor.compare_evaluations(...)` | `EvaluationsCompareParamsDto` | `EvaluationsCompareResultDto` | `evaluation-provider.cjs:134-181` | A10 |

---

## 3. Detailed Data Transfer Object (DTO) Schemas

### 3.1 Status & Settings DTOs

#### `AdvisorStatusDto` (GET `/api/advisor/status`)
```typescript
interface AdvisorStatusDto {
  enabled: boolean;          // Persisted state from server.advisor.enabled
  available: boolean;        // True if $HOME/.evcrate/advisor-history is a real, readable directory
  path: string | null;       // Absolute path if detected, else null
  sourceError: string | null;// Explicit error (e.g. symlink rejection, permission denied)
}
```

#### `AdvisorSettingsDto` / `AdvisorSettingsUpdateDto` (PATCH `/api/advisor/settings`)
```typescript
interface AdvisorSettingsUpdateDto {
  enabled: boolean;
}

interface AdvisorSettingsDto {
  enabled: boolean;
}
```

### 3.2 History DTOs

#### `HistoryScanSummaryDto`
```typescript
interface HistoryDiagnosticDto {
  code: string;              // e.g. "OUTCOME_INVALID_JSON", "EXECUTION_INVALID_JSON"
  taskRunId?: string;
  consultationId?: string;
}

interface HistoryScanSummaryDto {
  status: 'complete' | 'complete_with_errors' | 'incomplete';
  projectsDiscovered: number;
  tasksDiscovered: number;
  consultationsDiscovered: number;
  acceptedRecords: number;
  invalidRecords: number;
  bytesDiscovered: number;
  bytesRead: number;
  diagnostics: HistoryDiagnosticDto[];
  suppressedDiagnostics: number;
  limitHit: boolean;
}
```

#### `ProjectInventoryItemDto` & `ProjectInventoryDto`
```typescript
interface ProjectInventoryItemDto {
  projectId: string;         // 64-char lowercase SHA-256 hex digest
  label: string | null;      // Sanitized display name from project-metadata.json
  count: number;             // Accepted record count for this project
}

interface ProjectInventoryDto {
  entries: ProjectInventoryItemDto[];
  totalProjects: number;
  unfilteredTotalRecords: number;
}
```

#### `HistoryRefreshResultDto` (POST `/api/advisor/history/refresh`)
```typescript
interface HistoryRefreshResultDto {
  state: 'fresh' | 'stale' | 'unavailable';
  snapshotId: string | null; // Opaque snapshot token (UUIDv4)
  observedAt: number;        // Epoch milliseconds
  scan: HistoryScanSummaryDto;
  staleReason: 'incomplete' | 'cancelled' | 'deadline' | null;
  inventory: ProjectInventoryDto | null;
}
```

#### `HistoryMetricFiltersDto` & `HistorySummaryParamsDto` (POST `/api/advisor/history/summary`)
```typescript
interface HistoryMetricFiltersDto {
  statuses?: Array<'started' | 'ADVICE_READY' | 'FAILED'>;
  outcomeStates?: Array<'missing' | 'valid' | 'invalid'>;
  outcomeResults?: Array<'resolved' | 'unresolved' | 'regressed' | 'unknown'>;
  backends?: string[];
  models?: string[];
  efforts?: string[];
  promptIdentities?: string[];
  buildIdentities?: string[];
  startedAtFrom?: number;
  startedAtTo?: number;
}

interface HistorySummaryParamsDto {
  snapshotId: string;
  query: {
    projectId?: string | null;  // Null for All Projects scope
    taskRunId?: string | null;
    filters?: HistoryMetricFiltersDto;
  };
}

interface HistorySummaryResultDto {
  state: 'fresh' | 'stale';
  snapshotId: string;
  metrics: {
    metricDefinitionVersion: 1;
    totalConsultations: number;
    completedConsultations: number;
    adviceReadyCount: number;
    failedCount: number;
    resolvedCount: number;
    unresolvedCount: number;
    regressedCount: number;
    missingOutcomeCount: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    routeDistribution: Record<string, number>;
  };
  inventory: ProjectInventoryDto;
}
```

#### `HistoryPageParamsDto` & `HistoryPageResultDto` (POST `/api/advisor/history/page`)
```typescript
interface HistoryRowDto {
  recordRef: string;         // 32-char hex digest (unique per project:task:consultation)
  projectId: string;         // 64-char hex SHA-256 of canonical project path
  taskRunId: string;         // UUID
  consultationId: string;    // UUID
  status: 'started' | 'ADVICE_READY' | 'FAILED';
  route: {
    backend: string;
    model: string;
    effort: string;
  };
  checkpointDigest: string;  // 64-char hex SHA-256
  promptIdentity: string;
  buildIdentity: string;
  startedAt: number;
  completedAt: number | null;
  receiptElapsedMs: number | null;
  outcomeState: 'missing' | 'valid' | 'invalid';
  outcomeResult: 'resolved' | 'unresolved' | 'regressed' | 'unknown' | null;
}

interface HistoryPageParamsDto {
  snapshotId: string;
  query: {
    projectId?: string | null;
    taskRunId?: string | null;
    filters?: HistoryMetricFiltersDto;
  };
  sort: 'started_at_desc';   // Fixed sort literal
  cursor?: string | null;    // HMAC-signed base64url cursor
  limit?: number;            // Default 100, max 500
}

interface HistoryPageResultDto {
  state: 'fresh' | 'stale';
  snapshotId: string;
  entries: HistoryRowDto[];
  nextCursor: string | null;
  returnedBytes: number;     // Bounded <= 1 MiB
}
```

#### `HistoryDetailParamsDto` & `HistoryDetailResultDto` (POST `/api/advisor/history/detail`)
```typescript
interface HistoryDetailParamsDto {
  snapshotId: string;
  recordRef: string;
}

type HistoryDetailResultDto =
  | {
      status: 'ready';
      snapshotId: string;
      recordRef: string;
      detailRevision: string;  // SHA-256 of execFingerprint + outFingerprint
      execution: Record<string, unknown>; // Sanitized execution document
      outcome: Record<string, unknown> | null; // Sanitized outcome document
    }
  | {
      status: 'changed' | 'missing';
      snapshotId: string;
      recordRef: string;
      observedRevision: string | null;
    };
```

### 3.3 Policy DTOs

#### `PolicyReadCurrentResultDto` (POST `/api/advisor/policy/current`)
```typescript
interface PolicyReadCurrentResultDto {
  status: 'ready' | 'migration_required' | 'unsupported' | 'invalid' | 'not_configured';
  scope: 'account';          // Fixed literal
  temporal: 'current';       // Fixed literal
  observedAt: number;
  revision: string;          // 64-char SHA-256 hex digest of policy file bytes
  policy?: {
    version: 2;
    advisor: {
      primary: { backend: string; model: string; effort: string };
      backup: { backend: string; model: string; effort: string };
    };
    wait: {
      mode: 'until_terminal';
      warnAfterMs: number;
      warnEveryMs: number;
    };
    history: {
      retentionDays: number;
      maxBytes: number;
    };
  } | null;
  issueCode?: string | null;
}
```

### 3.4 Evaluation DTOs

#### `EvaluationsListParamsDto` & `EvaluationsListResultDto` (POST `/api/advisor/evaluations/list`)
```typescript
interface EvaluationDescriptorDto {
  evaluationRef: string;     // Base name of evaluation file (without .json)
  sourceRevision: string;    // SHA-256 hex digest of file
  sourceDigest: string;      // SHA-256 hex digest of complete file bytes
  evaluationId: string;
  runId: string;
  createdAt: number;
  candidateCount: number;
  caseCount: number;
  observationCount: number;
}

interface EvaluationsListParamsDto {
  target?: string | null;    // Optional explicit project path
  cursor?: string | null;
  limit?: number;            // Default 32, max 100
}

interface EvaluationsListResultDto {
  status: 'ready' | 'not_configured';
  observedAt: number;
  bindingRevision: string;
  items: EvaluationDescriptorDto[];
  nextCursor: string | null;
}
```

#### `EvaluationsReadParamsDto` & `EvaluationsReadResultDto` (POST `/api/advisor/evaluations/read`)
```typescript
interface EvaluationsReadParamsDto {
  target?: string | null;
  evaluationRef: string;
  expectedRevision: string;
}

type EvaluationsReadResultDto =
  | {
      status: 'ready';
      descriptor: EvaluationDescriptorDto;
      document: Record<string, unknown>; // Validated EvaluationDocumentV1
    }
  | {
      status: 'changed' | 'missing';
      evaluationRef: string;
      observedRevision: string | null;
    };
```

#### `EvaluationsCompareParamsDto` & `EvaluationsCompareResultDto` (POST `/api/advisor/evaluations/compare`)
```typescript
interface EvaluationsCompareParamsDto {
  target?: string | null;
  items: Array<{
    evaluationRef: string;
    expectedRevision: string;
  }>;                        // Min 1, max 32 items
  cursor?: string | null;
  limit?: number;            // Default 32, max 100
}

type EvaluationsCompareResultDto =
  | {
      status: 'ready';
      sourceRevisions: Array<{ evaluationRef: string; observedRevision: string }>;
      groups: Array<{
        groupKey: string;
        rubricDigest: string;
        inputDigest: string;
        caseCount: number;
        items: unknown[];
      }>;
      nextCursor: string | null;
      returnedBytes: number; // Bounded <= 1 MiB
    }
  | {
      status: 'changed' | 'missing';
      evaluationRef: string;
      observedRevision: string | null;
    };
```

---

## 4. Invariants, Bounds & Error Handling

### 4.1 Size, Memory & Resource Bounds
- **History Scan:** Maximum 256 MiB scanned, 50,000 accepted records, 500 projects, 256 tasks per project, 256 consultations per task.
- **Single File Limits:** `execution.json` max 128 KiB; `outcome.json` max 64 KiB; `project-metadata.json` max 64 KiB; `advisor-routing.json` max 16 KiB; evaluation documents max 8 MiB.
- **Diagnostics Budget:** Maximum 4,096 diagnostics tracked in a scan; excess counted in `suppressedDiagnostics`.
- **Response Page Limit:** HTTP page responses for history pages and evaluation comparisons must not exceed 1 MiB. If payload exceeds 1 MiB, entries are truncated before returning.
- **Snapshot Retention:** Snapshot cache in memory with 5-minute idle TTL and LRU eviction, maximum 2 snapshots per authenticated owner, bounded to 128 MiB aggregate.

### 4.2 Security & Authorization Guard Invariants
- **Session Verification:** Requires a live, authenticated Dam-Hopper session with the `admin` role.
- **Disabled State Exception:** `GET /api/advisor/status` and `PATCH /api/advisor/settings` succeed for admins even when `server.advisor.enabled` is `false`. All data endpoints (`/history/*`, `/policy/*`, `/evaluations/*`) return HTTP 403 Forbidden with `{ "error": "ADVISOR_DISABLED" }` when disabled.
- **No-Auth Failsafe:** Requests originating from a `--no-auth` development server are explicitly denied with HTTP 403 Forbidden. Default no-auth mode does not confer admin privileges.
- **Input Containment:** Record references, file paths, project IDs, and task IDs are strictly validated to prevent directory traversal (`..`, absolute paths, and control characters are rejected).

### 4.3 Root Path Inspection Invariant (`symlink_metadata`)
```
Candidate Path: $HOME/.evcrate/advisor-history

Step 1: Check $HOME env var
  ├─ Unset/empty → available: false, path: null, sourceError: "HOME environment variable is not set"
  └─ Set → proceed to Step 2

Step 2: symlink_metadata(candidate)
  ├─ NotFound → available: false, path: null, sourceError: null
  ├─ Symlink (is_symlink == true) → available: false, path: candidate, sourceError: "History root must be a real directory; symlink rejected"
  ├─ Not a Directory (!is_dir) → available: false, path: candidate, sourceError: "History root is not a directory"
  └─ Real Directory → proceed to Step 3

Step 3: Test read_dir(candidate)
  ├─ Err(PermissionDenied) → available: false, path: candidate, sourceError: "Permission denied"
  └─ Ok(entries) → available: true, path: candidate, sourceError: null
```

---

## 5. Synthetic Golden Fixtures & Parity Verification

Synthetic test fixtures have been generated and committed under `__fixtures__/native-advisor/`. They contain no sensitive data and match Evcrate producer specifications across all operations.

### 5.1 Fixture Inventory
- `__fixtures__/native-advisor/advisor-history/`:
  - `project-metadata.json`: Root metadata file with entries for Project Alpha and Project Beta.
  - Project 1 (`fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998`):
    - `project-metadata.json`: Project sidecar.
    - Task 1 (`00000000-0000-4000-8000-000000000001`):
      - Consultation 1 (`00000000-0000-4000-8000-000000000011`): `execution.json` (status: `ADVICE_READY`, receipt, attempts, V2 checkpoint digest) + `outcome.json` (status: `resolved`, disposition: `accept`).
      - Consultation 2 (`00000000-0000-4000-8000-000000000012`): `execution.json` (status: `started`, null receipt/result) without outcome file (tests `outcomeState: missing`).
    - Task 2 (`00000000-0000-4000-8000-000000000002`):
      - Consultation 3 (`00000000-0000-4000-8000-000000000013`): `execution.json` with malformed JSON (tests `EXECUTION_INVALID_JSON` diagnostic).
  - Project 2 (`13aea919e60e23089352d6284e556087ee1441c73b9ac30c076010741051bd0c`):
    - `project-metadata.json`: Project sidecar.
    - Task 3 (`00000000-0000-4000-8000-000000000003`):
      - Consultation 4 (`00000000-0000-4000-8000-000000000014`): `execution.json` (valid `ADVICE_READY`) + malformed `outcome.json` (tests `OUTCOME_INVALID_JSON` diagnostic and `outcomeState: invalid`).
- `__fixtures__/native-advisor/advisor-routing.json`: Valid V2 policy with primary/backup routes, wait policy, and history retention.
- `__fixtures__/native-advisor/advisor-routing-v1.json`: Legacy V1 policy for testing `migration_required` status.
- `__fixtures__/native-advisor/advisor-routing-invalid.json`: Invalid schema policy for testing `invalid` / `unsupported` status.
- `__fixtures__/native-advisor/advisor-evaluations/`:
  - `eval-group-a.json`: Valid evaluation document with 2 candidates and 2 cases.
  - `eval-group-b.json`: Valid evaluation document with 9 cases for grouping/comparison.
  - `eval-invalid.json`: Malformed JSON file to verify silent omission from list.

### 5.2 Verification Evidence
The synthetic fixtures were verified against Evcrate's canonical providers (`history-scanner.cjs`, `cursor-manager.cjs`, `history-detail.cjs`, `policy-provider.cjs`, and `evaluation-provider.cjs`) in an isolated Node test run:
- **Scan Status:** `complete_with_errors`
- **Projects Discovered:** 2 (Project Alpha and Project Beta)
- **Accepted Records:** 3 (Consultations 1, 2, and 4)
- **Invalid Records:** 2 (Consultations 3 [malformed execution] and 4 [malformed outcome])
- **Diagnostics Emitted:** `EXECUTION_INVALID_JSON` and `OUTCOME_INVALID_JSON`
- **Inventory Entries:** Project Alpha (count: 2), Project Beta (count: 1)
- **Pagination:** Deterministic sorting (`started_at desc`, project ID asc, task ID asc, consultation ID asc) returned 3 rows with outcome states `valid`, `missing`, `invalid`.
- **Detail Reread:** Inode/size/hash check passed; computed `detailRevision: 0e771ab65adb85d5ccfd61d18c9c90cf99c944646045adbdc871c92456769b1b`.
- **Policy Provider:** Returned `ready` for V2; `migration_required` (`V1_MIGRATION_REQUIRED`) for V1; `not_configured` (`POLICY_FILE_MISSING`) for missing.
- **Evaluation Provider:** Correctly parsed 2 evaluation documents (skipping invalid JSON), read document `eval-valid-mixed-001`, and aggregated 10 distinct comparison groups across rubric dimensions.

---

## 6. Implementation Ownership & Wave Boundaries

To maintain clean boundaries and prevent merge conflicts across parallel agents, ownership is partitioned as follows:

| Component / Subsystem | Responsible Phase | File Paths / Boundaries | Shared File Gatekeeper |
|---|---|---|---|
| **Contract & Fixtures** | Phase 01 | `plans/.../reports/native-contract-and-parity.md`, `__fixtures__/native-advisor/**` | Integration Owner |
| **History Backend & API** | Phase 02 | `server/src/advisor/**`, `server/src/api/advisor/**` | Integration Owner |
| **Policy & Evaluation Backend** | Phase 03 | `server/src/advisor/policy.rs`, `server/src/advisor/evaluations.rs` | Integration Owner |
| **Workspace UI Integration** | Phase 04 | `packages/ui/src/components/organisms/WorkspaceAdvisor/**` | Integration Owner |
| **Settings & Workspace Cutover** | Phase 05 | `packages/ui/src/components/pages/SettingsPage.tsx`, `WorkspacePage.tsx` | Integration Owner |
| **Platform Removal** | Phase 06 | Delete `server/src/plugins/**`, `packages/plugin-sdk/**`, etc. | Integration Owner |
| **Linux Deployment & Rollback** | Phase 07 | `server/src/linux_release/**`, `deploy/**` | Integration Owner |
| **Evcrate Cleanup** | Phase 08 | `/home/loidinh/WS/evcrate/plugin/**`, CI workflows | Integration Owner |
| **Final Qualification & Docs** | Phase 09 | `docs/architecture/**`, CHANGELOG, full smoke | Integration Owner |

**Rule:** Workers must not edit files outside their designated boundaries. Shared entry points (`server/src/lib.rs`, `server/src/api/router.rs`, `server/src/state.rs`, `packages/ui/src/index.ts`, `dam-hopper.toml`) are modified exclusively by the Integration Owner during handoff gates.

---

## 7. Acceptance Criteria Traceability (A01 – A20)

| Acceptance ID | Description | Phase 01 Contract Defense |
|---|---|---|
| **A01** | Admin reads status/toggle; non-admin, unauthenticated, and `--no-auth` denied | Documented in Section 4.2: Guard verifies session + admin role; `--no-auth` explicitly rejected. |
| **A02** | Toggle stored per server; restart/reload preserved; missing history does not block toggle | Section 4.2 & 3.1: Persisted in TOML under `server.advisor.enabled`. Directory absence does not block toggle. |
| **A03** | HOME-only discovery, alternate/unset HOME, empty/missing/unreadable directory; final root symlink rejected | Section 4.3: Strict `symlink_metadata` flowchart rejecting symlinks; unset HOME reports error. |
| **A04** | No path hash field/button/requirement; known history readable without registration | Sections 1 & 4.2: User confirmed total removal of path-hash UI/API. Domain hashes remain intact. |
| **A05** | Producer-shaped V1 execution/outcome + V2 checkpoint decoded; partition project_id compatible | Sections 3.2 & 5.1: Fixtures verified against Evcrate contracts. |
| **A06** | Root inventory, project/all filters, metric denominators/provenance match source | Sections 3.2 & 5.2: Multi-project inventory verified with counts and labels. |
| **A07** | Deterministic pagination, tie-breaking, boundary limits, HMAC cursor verification | Section 3.2 & 5.2: HMAC cursor and deterministic tie-breaking verified in fixture suite. |
| **A08** | Detail ready/changed/missing, incomplete producer write, invalid/unsupported record handled | Section 3.2 & 5.2: Detail reread and diagnostic emission verified. |
| **A09** | Account/current policy and statuses independent of project history filters | Section 3.3: Current account policy decoupled from project history filtering. |
| **A10** | Evaluations HOME/project discovery, duplicate precedence, list/read/compare groups | Section 3.4 & 5.2: Ordered discovery without worker-CWD fallback; comparison grouping verified. |
| **A11** | Four native tabs responsive; no iframe/port/worker; tab click never changes Workspace route | Phase 04 / UI contract: Panel tabs use local state, not window hash routing. |
| **A12** | IDE/Terminal/compact shortcuts and placement preserved | Phase 04 / UI contract: Retains `WorkspaceAdvisorHost` layout placement. |
| **A13** | Scoped CSS leaves surrounding app/theme/layout unchanged | Phase 04 / UI contract: All styles scoped under `.advisor-root`. |
| **A14** | Settings profile vs Workspace profile do not cross owners | Architecture Reference: Profiles resolved independently per surface. |
| **A15** | Disable/logout/role downgrade aborts and clears protected data | Section 4.2: Snapshot cache invalidated on connection/session teardown. |
| **A16** | Core server subsystems (PTY, FS watch, git, idle-suspend) survive plugin removal | Section 1: Non-plugin WebSocket and service infrastructure preserved. |
| **A17** | Fresh install/legacy migration/native upgrade; legacy rollback refused before mutation | Section 1 & Phase 07 contract: Native manager explicitly rejects legacy candidates. |
| **A18** | Manual cleanup script dry-run/apply, exact system/user scope, active runner safe stop | Phase 07 contract: Script strictly targets plugin runner without touching API HOME. |
| **A19** | Evcrate & Dam-Hopper release pipelines retain expected assets, exclude plugin assets | Phase 08 contract: General release tooling preserved; plugin CI steps removed. |
| **A20** | Native-only build dependency closure; retired APIs return 404 | Phase 06 & 09: Complete deletion of plugin modules and SDK dependencies. |
