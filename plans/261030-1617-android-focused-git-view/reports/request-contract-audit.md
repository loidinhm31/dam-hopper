# Phase 07 Request Contract and Wire Operation Audit

Date: 2026-10-30  
Target: `feat/android-native-features`  
Audit Scope: Android Native Focused Git Client Wire Interactions vs Server Operation Inventory  
Authority: [contracts](../contracts.md:146-184), [acceptance-matrix](../acceptance-matrix.md), [phase-07-live-qualification](../phase-07-live-qualification.md)

---

## 1. Wire Operation Inventory Audit

Every client-emitted wire request in `dev.damhopper.nativeapp.features.git` was audited against the frozen wire operation inventory in `contracts.md`:

| Facade / Method | Wire Verb + Route | Request Parameters / Fields | Response Contract | Audit Disposition |
|---|---|---|---|---|
| `query.listRoots` | `GET /api/git/:project/roots` | Query: `worktreePath` (optional). **No root parameter**. | `List<VcsRoot>` with embedded `status: GitStatus?` | **Compliant**. Zero redundant root queries; status parsed from embedded model. |
| `query.listBranches` | `GET /api/git/:project/branches` | Query: `worktreePath`, `root` (optional). | `List<GitBranch>` with `isRemote`, `fullRef`. | **Compliant**. Disambiguated by `fullRef`. |
| `getLog` | `GET /api/git/:project/log` | Query: `limit`, `offset`, `ref`, `messageQuery`, `root`. | `List<GitLogEntry>` (ordered parents). | **Compliant**. Literal search string passed; zero regex syntax injected. |
| `query.getDiffSummary` | `GET /api/git/:project/diff` | Query: `worktreePath`, `root`. | `GitDiffResponse(entries, untrackedTruncated, untrackedTotal)`. | **Compliant**. Correct `DiffResponse` envelope; not split staged/unstaged envelope. |
| `query.getUntracked` | `GET /api/git/:project/untracked` | Query: `offset`, `limit`, `worktreePath`, `root`. | Same `GitDiffResponse` envelope. | **Compliant**. Proper pagination support. |
| `query.getFileDiff` | `GET /api/git/:project/diff/file` | Query: `path`, `worktreePath`, `root`. | `FileDiffContent` (original, modified, hunks, isBinary). | **Compliant**. Read-only diff; zero `fs:stat` traversal. |
| `query.getCommitDetails` | `GET /api/git/:project/commit/:hash/details` | Path: `:hash` (full 40-char OID). Query: `root`. | `GitCommitDetails` (fullMessage, author, committer). | **Compliant**. Full commit message parsed accurately. |
| `query.getCommitFiles` | `GET /api/git/:project/commit/:hash/files` | Path: `:hash`. Query: `root`. | `List<DiffFileEntry>` (not `DiffResponse`). | **Compliant**. Direct file entry list decoded. |
| `query.getCommitFileDiff`| `GET /api/git/:project/commit/:hash/diff` | Path: `:hash`. Query: `path`, `root`. | `FileDiffContent` (read-only). | **Compliant**. Historical diff strictly read-only. |
| `query.getCommitMessage` | `GET /api/git/:project/commit/:hash/message` | Path: `:hash`. Query: `branch` (full ref), `root`. | `CommitMessageSnapshot(message, branch, headOid)`. | **Compliant**. Preserves full message snapshot for CAS. |
| `stage` / `unstage` | `POST /api/git/:project/stage`, `/unstage` | Body: `{ paths, worktreePath?, root? }`. | `{ ok: Boolean }`. | **Compliant**. Multiple paths supported without shell escaping. |
| `discard` | `POST /api/git/:project/discard` | Body: `{ path, worktreePath?, root? }`. | `{ ok: Boolean }`. | **Compliant**. Fenced by `withMutationGuard` for dirty editor buffers. |
| `commit` | `POST /api/git/:project/commit` | Body: `{ message, amend, worktreePath?, root? }`. | `CommitResponse(ok, hash?, error?)`. | **Compliant**. Amend flag honored. |
| `createBranch` | `POST /api/git/:project/branches` | Body: `{ name, startPoint?, checkout, root? }`. | `GitActionResult`. | **Compliant**. Clean checkout strategy verified. |
| `checkout` | `POST /api/git/:project/branches/checkout` | Body: `{ branch, startPoint?, create, strategy, root? }`. | `GitActionResult`. | **Compliant**. Rejects dirty/conflict without silent overwrite. |
| `deleteBranch` | `DELETE /api/git/:project/branches` | Body: `{ name, root? }`. | `GitActionResult`. | **Compliant**. Inactive branches only. |
| `updateBranch` | `POST /api/git/:project/branches/update` | Body: `{ branch?, root? }`. | `BranchUpdateResult(branch, success, reason?)`. | **Compliant**. Fast-forward only. |
| `fetch` / `pull` | `POST /api/git/fetch`, `/pull` | Body: `{ targets: [{ project, worktreePath? }] }`. | `List<GitOpResult>`. **No root supported**. | **Compliant**. Focused UI sends single target; secondary root disabled. |
| `ordinary push` | `POST /api/git/push` | Body: `{ project, worktreePath?, root? }`. | `GitOpResult`. Fast-forward only. | **Compliant**. Zero force fallback; explicit lease required for rewrites. |
| `worktrees` | `GET /api/git/:project/worktrees` | None (configured project). | `List<ProjectWorktree>`. | **Compliant**. Projected `path` parsed, distinct from `repositoryPath`. |
| `addWorktree` | `POST /api/git/:project/worktrees` | Body: `{ branch, path?, createBranch?, baseBranch? }`. | `ProjectWorktree`. | **Compliant**. No `worktreePath`/`root` selector sent. |
| `removeWorktree` | `DELETE /api/git/:project/worktrees` | Body: `{ path, force? }`. | `{ ok: Boolean }`. | **Compliant**. Path is projected target path; force does not bypass client dirty checks. |
| `pruneWorktrees` | `POST /api/git/:project/worktrees/prune` | Body: `{}`. | `{ ok: Boolean }`. | **Compliant**. Empty body dispatched. |
| `editMessage` | `POST /api/git/:project/commit/:hash/message` | Body: `{ message, expectedBranch, expectedHeadOid, allowSignatureRemoval, root? }`. | `GitActionResult`. | **Compliant**. CAS fields verified; signature consent flag handled. |
| `squash` | `POST /api/git/:project/squash` | Body: `{ hashes, message, expectedBranch, expectedHeadOid, allowSignatureRemoval, root? }`. | `GitActionResult`. | **Compliant**. Hashes ordered oldest-first full 40-char OIDs. |
| `prepareLease` | `POST /api/git/:project/push/prepare` | Body: `{ branch?, root? }`. | `PublishPreview`. | **Compliant**. Separate preparation step before publish. |
| `publishLease` | `POST /api/git/:project/push/publish` | Body: `{ snapshot, root? }`. | `PublishResult`. | **Compliant**. Exact frozen snapshot sent; unknown status reconciles without resend. |
| `conflicts` | `GET /api/git/:project/conflicts` | Query: `worktreePath?`, `root?`, `cursor?`. | `GitConflictSummary`. | **Compliant**. Read-only decoder; blocks mutations on unmerged entries. |
| `operation` | `GET /api/git/:project/operation` | Query: `worktreePath?`, `root?`. | `GitOperationStatus`. | **Compliant**. Read-only decoder; terminal handoff required when stopped. |
| `terminalPreflight` | `GET /api/terminal/detailed` | Query: none. | `List<TerminalSessionDetailed>`. | **Compliant**. Exact logical owner transport used; never kills PTYs. |

---

## 2. Negative Contract Invariant Audit (Forbidden Routes & Actions)

The wire audit strictly audited codebase callsites and proxy audit logs for negative contract rules:

1. **Zero Calls to `POST /api/git/:project/resolve`**:
   - *Requirement*: Focused Git does not mount or dispatch native conflict resolution requests. Conflicted states direct the user to terminal handoff.
   - *Audit Evidence*: Source scan across `native/android-app` confirms zero calls to `/resolve`. Proxy audit log filter `auditLogs.filter(p => p.path.contains("/resolve"))` verified empty (`size == 0`).
2. **Zero Calls to `POST /api/git/:project/operation`**:
   - *Requirement*: `GET /api/git/:project/operation` is supported for read-only conflict/operation inspection; the mutation counterpart `POST /operation` is unmounted.
   - *Audit Evidence*: Proxy audit log filter `auditLogs.filter(p => p.path.contains("/operation") && p.method == "POST")` verified empty (`size == 0`).
3. **Zero Calls to `discard-hunk`**:
   - *Requirement*: Diff review is strictly read-only; no partial hunk discard or draft mutations exist on wire.
   - *Audit Evidence*: Confirmed in `DiffReviewController`. Zero hunk discard methods exist or emit network requests.
4. **Zero Secondary-Root `POST /api/git/fetch` or `POST /api/git/pull`**:
   - *Requirement*: Focused Git sends fetch/pull exclusively for the active target; secondary roots are visibly disabled and dispatch zero wire requests.
   - *Audit Evidence*: Proxy audit logs confirm zero fetch/pull requests referencing `secondaryProject`.
5. **No Force Push Fallback**:
   - *Requirement*: Ordinary push is fast-forward only (`POST /api/git/push`). Rewritten history must use explicit leased push (`/push/prepare` + `/push/publish`). Zero `--force` or `--force-with-lease` parameters are ever added to ordinary push.
   - *Audit Evidence*: `GitSyncController` and `GitPublishRepository` dispatches verified.

---

## 3. Drop-Ack Exactly-Once Forwarding Audit

In accordance with AC08 requirements, the transparent proxy tested the drop-ack scenario on mutating requests:

1. **Proxy Fault Injection**:
   - Proxy configures `dropNextAck = true`.
   - Client sends mutating request (`POST /api/git/primary/commit`).
   - Proxy forwards request to server.
   - Server processes mutation, creates commit object, updates `refs/heads/main`, and responds with HTTP 200.
   - Proxy intentionally drops the connection without returning HTTP 200 to client.
2. **Audit Verification**:
   - **Forwarded Dispatch Count**: Exactly **1** request was dispatched to upstream server.
   - **Retry Loops**: Client did NOT enter an automatic retry loop or dispatch duplicate `POST /commit` requests.
   - **Offline Queue**: Zero offline pending writes were queued for silent replay.
   - **Authoritative Reconciliation**: Client receives network disconnect, retains outcome ambiguity (`GitOutcomeKind.UNKNOWN`), invalidates authority, and schedules `GitRefreshReason.RECONCILE` to sync state against the server's authoritative Git state.
3. **Security & Redaction**:
   - All audit logs in `TransparentGitProxy` redact authentication secrets.
   - Request headers log `hasAuth: Boolean` without capturing bearer tokens.
   - Request payloads log `bodyKeys: List<String>` without leaking passwords, MFA secrets, or sensitive file contents into audit logs or qualification reports.
