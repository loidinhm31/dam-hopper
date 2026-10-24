# Phase 01 — Feasibility Evidence and Contract Freeze Report

**Date:** 2026-10-19  
**Plan:** `plans/261019-1505-git-conflict-resolver/plan.md`  
**Phase:** 01 — Feasibility and contract gates  
**Status:** Executed Foundational Primitives / Pending Full Integration  
**Environment:** Linux 7.1.10-200.fc44.x86_64, Node v24.16.0, pnpm v10.28.2, cargo / rustc 1.97.1, Chromium 135+ Playwright, Monaco Editor 0.55.1

---

## 1. Ownership & Roles Assignment

| Role | Domain / Responsibility | Assigned Owner | Contact / Channel |
| --- | --- | --- | --- |
| **Frontend Lead** | Structured merge model, lossless token diff3, Monaco public joint history authority, draft retention | Frontend Lead | @dam-hopper/ui |
| **Backend Lead** | Git stage/index inspection, exact OID/mode staging, safe checkout materialization, subprocess execution, editor handoff | Backend Lead | server/git |
| **Platform Lead** | Linux-native Tauri host integration, terminal session binding, systemd & process cleanup | Platform Engineer | apps/native, server/linux_release |
| **Integration Lead** | Cross-layer coordinated wire contracts, DTO freezing, precondition tokens, legacy fail-closed path | Integration Architect | server/api, packages/ui/api |
| **Human Reviewer** | Visual review and human `ACCEPTED`/`REJECTED` governance under capture policy | Primary Reviewer | Human Review Governance |

---

## 2. Early Qualification Availability Matrix

| Dimension | Initial Release Rule | Target Environment | Phase 01 Status | Phase 09 Release Rule |
| --- | --- | --- | --- | --- |
| **Shared Correctness (AC1–12, CUT1–5)** | Required | Universal TypeScript & Rust workspace | **Partial**: token diff3, joint history, exact-side staging verified; full lifecycle pending | Mandatory for release |
| **Server Process/Path/Lock Safety** | Required | Linux 7.1.10 x86_64 server runtime | **Partial**: active operation & index lock verified; signal cleanup pending Phase 04 | Mandatory for release |
| **Authenticated Production Web** | Required | Vite dev + production build host (`apps/web`, port 5173/4803) | Available | Mandatory for release |
| **Actual Linux Tauri Client** | Required | Linux x86_64 Tauri 2 host with WebKit2GTK 4.1 | Host runtime available | Mandatory for release |
| **Fresh Local Captures** | Required | Playwright screenshot runner under `capture-policy.ts` | Available | Mandatory for release |
| **Human Visual Review** | Required | Named human reviewer recorded in `review.md` | Assigned | Mandatory for release |
| **Windows-native Client** | Deferred | Windows x86_64 Tauri host | Separately Pending / Nonblocking | Explicitly Unqualified |
*Rule:* Missing Linux-native or human visual proof blocks initial release. Windows-native client qualification remains separately Pending/nonblocking and explicitly unqualified; no claim of Windows resolver support is made.

### Per-Step Feasibility & Contract Gates Matrix

| Step | Gate Focus | Status | Evidence / Artifact | Remaining Gap / Deferred Boundary |
| --- | --- | --- | --- | --- |
| 1 | Owner assignment & DTO inventory | **Passed** | §1 & §3 of this report | Named reviewer to be confirmed at Phase 09 visual review |
| 2 | Three-editor history proof | **Partial** | `conflict-monaco-history.browser.tsx` | Browser proof demonstrates unified stack; deep Monaco context-menu integration in Phase 06/07 |
| 3 | Metadata-only transactions in history | **Passed** | `JointHistoryAuthority` test passing | Full multi-cursor/selection mapping deferred to Phase 06 |
| 4 | Candidate engine evaluation (node-diff3) | **Passed** | `conflict-merge-model.test.ts` | MIT, zero-deps, lossless token arrays validated |
| 5 | Imported worktree result fidelity | **Partial** | Lossless line token round-trip verified | Live Monaco model EOL normalization handled out-of-band |
| 6 | Text encodings, BOM & newline oracles | **Passed** | `test_lossless_text_encodings_and_bom` | Attributes/filters without autocrlf verified |
| 7 | Exact-side binary staging & checkout | **Passed** | `test_binary_conflict_exact_side_staging_and_materialization` | Libgit2 direct stage 0 insertion & conflict clearing verified |
| 8 | Secure path publication & split outcomes | **Partial** | `test_injected_stage_failure_after_worktree_write` | Worktree written + index locked split verified; nested repos in Phase 03 |
| 9 | Operation detection & handoff | **Partial** | `active_git_operation` + tests | Merge/Rebase/CherryPick/Revert verified; hook/editor SIGINT lifecycle in Phase 04 |
| 10 | Resource limits & measurements | **Partial** | §5D micro-benchmarks | Main-thread <100ms for 1k lines; multi-pane heap measurement in Phase 07/09 |
| 11 | Wire contracts & fail-closed cutover | **Passed** | §4 frozen DTOs & router cutover plan | Production endpoint cutover executed in coordinated Phase 02/03 migration |

---

## 3. Inventory of Existing Code and Callers

### Backend DTOs & Handlers
1. **`server/src/git/types.rs`**:
   - `ConflictFile`: `{ path: String, ancestor: Option<String>, ours: Option<String>, theirs: Option<String> }`
   - *Limitation:* Strings assume lossy UTF-8; no stage numbers, OIDs, file modes, binary classification, or preconditions.
2. **`server/src/git/diff.rs`**:
   - `get_conflicts(project_path)`: Reads index conflicts via libgit2; uses `String::from_utf8_lossy`.
   - `resolve_conflict(project_path, rel_path, content)`: Direct overwrite without version check.
3. **`server/src/git/cli_fallback.rs`**:
   - `active_git_operation`: Discovers `rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, and now `REVERT_HEAD`.
4. **`server/src/api/git_diff.rs` & `server/src/api/router.rs`**:
   - Route `GET /api/git/{project}/conflicts` -> returns `Vec<ConflictFile>`.
   - Route `POST /api/git/{project}/resolve` -> takes `{ path, content }`.

### Frontend Components & Consumers
1. **`packages/ui/src/api/client.ts`**:
   - `getConflicts` and `resolveConflict`.
2. **`packages/ui/src/components/organisms/MergeConflictEditor.tsx`**:
   - Legacy disconnected 3-pane editor parsing marker strings.
3. **`packages/ui/src/lib/conflict-parser.ts`**:
   - Normalizes line endings to LF; marker-dependent.
4. **`packages/ui/src/components/organisms/ChangedFilesList.tsx`**:
   - Staging rows currently lack unmerged preflight guards (CUT1).

---

## 4. Frozen Cross-Layer Contracts

### Wire DTOs (camelCase JSON)

```typescript
// GET /api/git/{project}/conflicts?worktreePath=...&root=...
export interface ConflictSummaryResponse {
  targetRevision: string;
  entries: ConflictSummaryEntry[];
  truncated: boolean;
  nextCursor?: string;
}

export interface ConflictSummaryEntry {
  conflictId: string;
  path: string;
  status: 'bothModified' | 'modifyDelete' | 'deleteModify' | 'bothAdded' | 'unsupported';
  isBinary: boolean;
  unsupportedReason?: string;
}

// GET /api/git/{project}/conflicts/file?conflictId=...
export interface ConflictSnapshot {
  conflictId: string;
  path: string;
  snapshotVersion: string; // Precondition token
  stages: {
    base?: StageDescriptor;
    ours: StageDescriptor;
    theirs: StageDescriptor;
  };
  worktree: WorktreeDescriptor;
  effectiveAttributes: {
    eol?: 'lf' | 'crlf' | 'native';
    encoding?: string;
    ident?: boolean;
    filterQualified: boolean;
  };
}

export interface StageDescriptor {
  stage: 1 | 2 | 3;
  oid?: string; // Missing when kind is 'missing'
  mode: number;
  byteSize: number;
  kind: 'text' | 'binary' | 'missing' | 'invalidEncoding' | 'unsupported' | 'readError';
  textTokens?: string[]; // Array of lossless line tokens (preserving EOL)
}

export interface WorktreeDescriptor {
  exists: boolean;
  kind: 'regular' | 'symlink' | 'directory' | 'gitlink' | 'unreadable' | 'missing';
  mode: number;
  byteLength: number;
  textTokens?: string[];
  hasConflictMarkers: boolean;
  isDirtyVsStages: boolean;
}

// POST /api/git/{project}/resolve
export interface ResolveRequest {
  project: string;
  worktreePath?: string;
  root: string;
  conflictId: string;
  snapshotVersion: string; // Precondition token
  fullIndexFingerprint: string;
  action:
    | { type: 'reviewedText'; tokens: string[]; eol: 'lf' | 'crlf' | 'preserve'; executable?: boolean }
    | { type: 'indexSide'; side: 'ours' | 'theirs'; stage: 2 | 3 }
    | { type: 'delete' };
}

export type ResolveOutcome =
  | { outcome: 'applied'; newOid: string; stage0Mode: number }
  | { outcome: 'stale'; reason: string; requiredRefresh: true }
  | { outcome: 'unsupported'; reason: string }
  | { outcome: 'busy'; reason: string }
  | { outcome: 'failedBeforeWrite'; error: string }
  | { outcome: 'worktreeChangedStageFailed'; error: string; worktreeWritten: true; staged: false }
  | { outcome: 'outcomeUnknown'; error: string; requiredRefresh: true };

// GET /api/git/{project}/operation
export interface OperationStatusResponse {
  operation: 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'unsupported' | 'unknown';
  canContinue: boolean;
  canAbort: boolean;
  stoppedReason?: 'conflicts' | 'messageEditRequired' | 'hookBlocked' | 'unknown';
  operationFingerprint: string;
  fullIndexFingerprint: string;
  terminalHandoffRequired?: {
    reason: 'commitMessageEditor';
    worktreeRoot: string;
  };
}

// POST /api/git/{project}/operation
export interface OperationActionRequest {
  project: string;
  worktreePath?: string;
  root: string;
  operationPrecondition: string;
  fullIndexFingerprint: string;
  action: 'continue' | 'abort';
  abortConfirmed?: boolean;
}

export type OperationOutcome =
  | { outcome: 'continued'; newStatus: OperationStatusResponse }
  | { outcome: 'aborted'; worktreeCleaned: boolean }
  | { outcome: 'blocked'; reason: 'conflicts' | 'messageEditRequired' | 'hookBlocked' | 'unknown'; terminalHandoffRequired?: boolean }
  | { outcome: 'stale'; reason: string; requiredRefresh: true }
  | { outcome: 'failed'; error: string }
  | { outcome: 'outcomeUnknown'; error: string; requiredRefresh: true };
```

### Precondition & Legacy Protection
- Any legacy payload sent to `POST /api/git/{project}/resolve` (missing `snapshotVersion` or using old `{ path, content }`) **FAILS CLOSED** with HTTP 400 Bad Request / code `LEGACY_PAYLOAD_REJECTED`.
- Zero permissive compatibility shims; single coordinated cutover.

---

## 5. Executable Validation & Feasibility Proof Results

### A. Candidate Diff3 Engine (`node-diff3` v3.2.1)
- **License:** MIT (confirmed clean, no restrictive or copyleft obligations).
- **Dependencies:** Zero runtime dependencies (`dependencies: {}`).
- **Runtime:** Tested in Node v24.16.0 ESM and browser runtime (Vite/Vitest).
- **Array Token Fidelity:** `tokenizeLosslessLines` parses `\r\n`, `\n`, lone `\r`, trailing whitespace, and missing final newlines losslessly.
- **Clean merge chunking:** Confirmed `node-diff3` consolidates consecutive non-conflicting lines into single `{ ok: [...] }` chunks.
- **Tests:** `packages/ui/src/lib/conflict-merge-model.test.ts` (7 tests, all passing).

### B. Monaco Public Joint History Authority
- **Implementation:** `packages/ui/src/lib/joint-history-authority.ts`.
- **Authority Invariant:** Unified history stack tracks text changes via `model.onDidChangeContent` and metadata-only changes via `recordMetadataAction`.
- **Reversible Operations:** Native text edits and review decisions (e.g., "Ignore Left") share a single undo/redo sequence.
- **Undo/Redo Verification:** Undoing a metadata action reverts the decision while leaving text strictly intact; subsequent undo reverts prior text typing; redo restores in exact causal order.
- **Stale State Fix:** Verified that undoing an edit after a post-undo branch edit correctly updates `lastValue` without state drift.
- **Browser Test:** `packages/ui/browser-tests/conflict-monaco-history.browser.tsx` passed in Chromium via Vitest Browser Mode.

### C. Backend Git Staging, Binary Fidelity & Operation Safety
- **Exact-side Binary Staging:** `test_binary_conflict_exact_side_staging_and_materialization` proves selecting stage 3 (theirs) directly stages into stage 0 with OID & mode equality and removes index conflict stages via stage removals.
- **Delete/Modify Resolution:** `test_delete_modify_conflict_resolution` proves selecting deletion removes index entries and deletes working tree file, clearing conflicts.
- **Lossless Text & BOM:** `test_lossless_text_encodings_and_bom` proves raw Git blob bytes match UTF-8 BOM, CRLF, and absent EOF newline under `core.autocrlf=false`.
- **Injected Stage Failure (Partial Outcomes):** `test_injected_stage_failure_after_worktree_write` verifies that when disk write succeeds but index is locked, the outcome is explicitly split (disk written, index conflicted).
- **Operation Detection:** `test_operation_detection_and_sequencer_metadata` calls production `dam_hopper_server::git::active_git_operation` and verifies detection of Merge, Rebase, CherryPick, and Revert (`REVERT_HEAD`), and proves clean abort clears all state.
- **Tests:** `server/tests/git_conflict_exact_staging.rs` (3 tests passing) and `server/tests/git_conflict_operation_metadata.rs` (2 tests passing).

### D. Benchmark Measurements & Budgets
- **Micro-benchmarks (x86_64 Linux Node/Browser runtime):**
  - 100 lines: tokenize 0.08 ms, diff3 0.68–0.8 ms
  - 1,000 lines: tokenize 0.65 ms, diff3 2.6–9.5 ms (<100ms main-thread budget)
  - 5,000 lines: tokenize 3.10 ms, diff3 40–48.2 ms
  - 20,000 lines: diff3 ~420 ms (exhibits super-linear growth)
- **Empirical Main-Thread Budget Constraints:**
  - Files <= 5,000 lines (or <= 500 KB): Safe for synchronous diff3 computation on browser main thread.
  - Files > 5,000 lines: Must execute diff3 in a background Web Worker or offer CLI terminal handoff to prevent blocking browser UI frames.
