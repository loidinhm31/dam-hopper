# Git Operation Lifecycle API

Authoritative detection, state fingerprinting, and preconditioned continuation/abort execution for active Git sequencer operations (`merge`, `rebase`, `cherry-pick`, `revert`).

This document details the backend lifecycle state machine, bounded runner guarantees, and domain outcome contracts introduced in Phase 04.

## Overview & Architecture

When merge conflicts occur during Git operations (such as interactive rebase, merge, cherry-pick, or revert), Git halts and enters a sequencer state. The operation lifecycle subsystem (`server/src/git/operation.rs`) provides:

1. **Authoritative sequencer detection:** Distinguishes active operations, sequencer todos, and unsupported/ambiguous states (`git am`, `bisect`, contradictory metadata).
2. **Deterministic fingerprinting:** SHA-256 digests binding HEAD OID, symbolic ref, and exact on-disk sequencer metadata to protect against concurrent or external mutations.
3. **Truthful stage role semantics:** Explicit labels mapping base, ours, and theirs stages according to the active operation's semantics.
4. **Preconditioned execution:** Continues or aborts operations under process-local `GitMutationCoordinator` mutual exclusion.
5. **Bounded non-interactive execution:** Bounded subprocess execution (15-second deadline, `kill_on_drop(true)`, `GIT_TERMINAL_PROMPT=0`, process-group termination) with non-interactive editor interception.
6. **Truthful domain outcomes:** Rich `OperationOutcome` tagged union replacing ambiguous boolean flags.

---

## Authoritative Operation Detection

Active operation state is resolved authoritatively in `active_operation_kind` by inspecting `.git` metadata and sequencer markers:

| Operation Kind (`OperationKind`) | Metadata Markers Checked | Description |
| --- | --- | --- |
| `merge` | `MERGE_HEAD` exists | Active Git merge halted with conflicts or awaiting commit message review. |
| `rebase` | `rebase-merge/` or `rebase-apply/` (with `rebasing`) | Interactive or apply rebase in progress. |
| `cherry-pick` | `CHERRY_PICK_HEAD` or `sequencer/todo` starting with `pick` | Active cherry-pick sequence. |
| `revert` | `REVERT_HEAD` or `sequencer/todo` starting with `revert` | Active revert sequence. |
| `unsupported` | `BISECT_LOG`, `rebase-apply/applying` (`git am`), or $>1$ active marker | Ambiguous, contradictory, or unsupported operation; automated recovery disabled. |
| `none` | Clean repository state | No active sequencer operation. |
| `unknown` | Fallback when repository state cannot be reliably determined | Unrecognized state. |

> **Contrast with Legacy Helper:** The legacy `active_git_operation` helper (`server/src/git/cli_fallback.rs`) returns a coarse `GitRecoveryState` where `canContinue` is derived purely from `!index.has_conflicts()`. In contrast, the authoritative lifecycle API verifies sequencer state, commit-message editor requirements, and index fingerprints.

---

## Fingerprinting & State Preconditions

To guarantee that mutations only execute against the exact repository state inspected by the operator, two fingerprints must be captured and submitted:

1. **`operationFingerprint` (`compute_operation_fingerprint`):**
   - SHA-256 digest covering:
     - `operationKind.as_str()` + NUL
     - HEAD target OID + NUL
     - HEAD reference name + NUL
     - Per-operation metadata files:
       - `merge`: Contents of `MERGE_HEAD`, `MERGE_MSG`
       - `rebase`: Contents of `rebase-merge/stopped-sha`, `rebase-merge/onto`, `rebase-merge/head-name`, `rebase-merge/done`, `rebase-merge/git-rebase-todo`, `rebase-apply/next`, `REBASE_HEAD`
       - `cherry-pick` / `revert`: Contents of `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `sequencer/todo`, `sequencer/head`, `sequencer/abort-safety`
2. **`fullIndexFingerprint` (`compute_full_index_fingerprint`):**
   - SHA-256 digest over sorted index entries (path, stage, mode, OID, file size).

If either fingerprint drifts between status inspection and mutation execution, the mutation is aborted without touching disk, returning `outcome: "stale"`.

---

## Stage Role Semantics

Different Git operations reverse or alter the conventional "ours" vs. "theirs" relationship. The `GET` status endpoint provides truthful `stageRoleLabels`:

| Operation Kind | Base Stage (1) | Ours Stage (2) | Theirs Stage (3) |
| --- | --- | --- | --- |
| `merge` | `Base (merge base)` | `Current branch (HEAD)` | `Incoming change (MERGE_HEAD)` |
| `rebase` | `Base` | `Current (onto/rebased state)` | `Incoming (replayed commit)` |
| `cherry-pick` | `Parent of cherry-picked commit` | `Current branch (HEAD)` | `Cherry-picked change` |
| `revert` | `Commit being reverted` | `Current branch (HEAD)` | `Parent (reverting to)` |
| `none` / fallback | `None` | `Current (ours)` | `Incoming (theirs)` |

---

## REST Endpoints

### 1. Inspect Operation Status

**GET /api/git/{project}/operation**

Inspect authoritative active Git operation status, sequencer state, blockers, and fingerprints.

#### Query Parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `worktreePath` | string | No | Absolute path to registered worktree. Defaults to project root. |
| `root` | string | No | VCS root identifier for multi-root projects. |

#### Response (`OperationStatusResponse`, HTTP 200)

```json
{
  "operation": "merge",
  "canContinue": false,
  "canAbort": true,
  "stoppedReason": "conflicts",
  "operationFingerprint": "4a7f29e1...",
  "fullIndexFingerprint": "8b9c1d2e...",
  "stageRoleLabels": {
    "base": "Base (merge base)",
    "ours": "Current branch (HEAD)",
    "theirs": "Incoming change (MERGE_HEAD)"
  },
  "terminalHandoffRequired": null,
  "blockers": [
    "Unresolved merge conflicts remain in index"
  ]
}
```

#### Fields

- `operation` (`OperationKind`): `"none"`, `"merge"`, `"rebase"`, `"cherry-pick"`, `"revert"`, `"unsupported"`, or `"unknown"`.
- `canContinue` (boolean): Server-computed continuation eligibility: `true` when a supported operation is active and no unresolved conflicts remain in the index; `false` if unmerged conflicts remain or operation is `none`, `unsupported`, or `unknown`.
- `canAbort` (boolean): `true` for supported operations (`merge`, `rebase`, `cherry-pick`, `revert`); `false` for `none`, `unsupported`, or `unknown`.
- `stoppedReason` (optional enum):
  - `"conflicts"`: Unresolved conflict entries exist in the index.
  - `"messageEditRequired"`: All conflicts resolved, but Git requires interactive commit message review (e.g. clean merge).
  - `"hookBlocked"`: Pre-commit or commit-msg hook failed.
  - `"unsupported"`: Active operation is unsupported or ambiguous (e.g. git am or bisect).
  - `"unknown"`: Ambiguous or unreadable metadata state.
- `operationFingerprint` (string): Deterministic SHA-256 of active operation metadata.
- `fullIndexFingerprint` (string): Deterministic SHA-256 of all index entries.
- `stageRoleLabels` (optional object): Semantic labels for stages 1, 2, and 3.
- `terminalHandoffRequired` (optional object, `TerminalHandoffRequired`): Structured handoff descriptor returned on GET when the operator must transition to terminal (omitted when not required):
  - `reason` (string): e.g. `"commitMessageEditor"`.
  - `worktreeRoot` (string): Absolute path to repository worktree.
- `blockers` (array of strings): Human-readable blocker explanations. Omitted when empty.

> **Merge Continuation & Terminal Handoff:** In a merge where all conflicts are resolved, Git requires reviewing and committing `MERGE_MSG`. Status returns `canContinue: true` alongside `stoppedReason: "messageEditRequired"` and `terminalHandoffRequired: { reason: "commitMessageEditor", worktreeRoot }`. If a client calls `action: "continue"` via POST, the non-interactive editor sentinel intercepts the prompt and returns `outcome: "blocked"` with `reason: "messageEditRequired"` and `terminalHandoffRequired: true`. The UI must direct the operator to a terminal session to complete the commit rather than expecting an in-band automated commit.

---

### 2. Execute Operation Action

**POST /api/git/{project}/operation**

Execute preconditioned continue or abort action under process-local mutation coordination.

#### Request Body (`OperationActionRequest`, strict `deny_unknown_fields`)

```json
{
  "operationPrecondition": "4a7f29e1...",
  "fullIndexFingerprint": "8b9c1d2e...",
  "action": "continue",
  "abortConfirmed": false,
  "worktreePath": "/path/to/worktree",
  "root": "optional-root"
}
```

#### Request Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `operationPrecondition` | string | Yes | Must match current `operationFingerprint`. |
| `fullIndexFingerprint` | string | Yes | Must match current `fullIndexFingerprint`. |
| `action` | string | Yes | Action to perform: `"continue"` or `"abort"`. |
| `abortConfirmed` | boolean | No | Default `false`. Required `true` when `action == "abort"`. |
| `worktreePath` | string | No | Target registered worktree path. |
| `root` | string | No | Target VCS root. |

#### HTTP Error Semantics

- **HTTP 400 (`LEGACY_PAYLOAD_REJECTED`):** Returned when `operationPrecondition`, `fullIndexFingerprint`, or `action` is absent or not a string. Legacy or un-fingerprinted requests are rejected before mutation locking.
- **HTTP 400 (`INVALID_INPUT`):** Returned when payload contains unknown fields (`deny_unknown_fields`) or invalid enum values.
- **HTTP 409 (`CONFLICT`):** Returned when `GitMutationCoordinator` lock cannot be acquired because another mutation is active on the repository.

---

## Domain Outcomes (`OperationOutcome`)

On valid requests, the endpoint returns HTTP 200 with an `OperationOutcome` object discriminated by the `outcome` field:

| Outcome (`outcome`) | Additional Fields | Description & Client Action |
| --- | --- | --- |
| `continued` | `newStatus: OperationStatusResponse` | Git continue succeeded or advanced to the next stopped state (e.g. next conflict in an interactive rebase sequence). UI updates status with `newStatus`. |
| `aborted` | `worktreeCleaned: boolean` | Git abort succeeded. `worktreeCleaned` is `true` if index has no conflicts and operation kind is `none`. |
| `blocked` | `reason: OperationStoppedReason`, `terminalHandoffRequired?: boolean` | Operation stopped by conflicts (`reason: "conflicts"`), required commit message editing (`reason: "messageEditRequired"`), or failing Git hooks (`reason: "hookBlocked"`). Note: in this POST outcome, `terminalHandoffRequired` is a boolean flag (omitted when `false`), distinct from the structured object returned by the GET status endpoint. When `true`, UI directs operator to terminal. |
| `stale` | `reason: string`, `requiredRefresh: boolean` | Precondition mismatch: index drifted or operation state changed externally. Zero writes occurred; client must refresh status before retrying. |
| `failed` | `error: string` | Git command returned non-zero error, or abort was submitted without `abortConfirmed: true`. |
| `outcomeUnknown` | `error: string`, `requiredRefresh: boolean` | Process timeout exceeded, child process killed, worker panicked, or post-mutation status query failed. Automated replay is prohibited; client must refresh state. |

---

## Subprocess Execution & Safety Guarantees

All Git mutation commands (`git merge --continue`, `git rebase --abort`, etc.) run through `run_bounded_git_command`:

1. **Process-Local Coordination & HTTP Request Decoupling:**
   - Exclusive lock acquired via `GLOBAL_MUTATION_COORDINATOR.try_acquire_for_repo(&repo, worktree_root)` covering common gitdir (`commondir`) and worktree.
   - *HTTP Request Decoupling:* In `server/src/api/git_diff.rs`, `execute_operation` spawns the mutation into an owned background task (`tokio::spawn`). Client disconnections or HTTP transport cancellations do not drop the running mutation future mid-execution or release the coordinator lock prematurely while Git subprocesses run. Note: Decoupling protects against client disconnects; it does not provide crash or shutdown durability.
   - *Limitation:* Protects only against concurrent mutations within the same DamHopper server instance; external CLI processes running outside DamHopper are not coordinated.
2. **Subprocess Deadline & Process-Group Termination (`ProcessGroupGuard`):**
   - Hard execution deadline: 15 seconds (`SUBPROCESS_TIMEOUT`).
   - Subprocess lifecycle is guarded by RAII `ProcessGroupGuard`. On Unix, commands run in a dedicated process group (`cmd.process_group(0)`); on timeout or abnormal drop, `SIGKILL` is sent to both `-pgid` (the process group) and `pgid`. On Windows, the guard executes best-effort tree termination via `taskkill /F /T /PID <pid>`.
   - Subprocess timeout or failure to complete returns `outcome: "outcomeUnknown"` with `requiredRefresh: true`.
   - *Limitation:* External grandchild processes that detach from the process group or stubborn processes on Windows may not be terminated.
3. **Non-Interactive Environment:**
   - Stdin is set to `Stdio::null()`.
   - `GIT_TERMINAL_PROMPT=0` prevents Git from waiting for terminal credentials.
   - `kill_on_drop(true)` ensures process cleanup if async future is dropped before completion.
4. **Streaming Editor Sentinel Detection (`RollingSentinelScanner`):**
   - `GIT_EDITOR` is set to an inline script emitting the internal sentinel token `DAM_HOPPER_EDITOR_REQUIRED` (constant `EDITOR_SENTINEL_TOKEN`) to stderr and exiting with code 42.
   - *Note:* `DAM_HOPPER_EDITOR_REQUIRED` is an internal stderr string token, not a user-configurable environment variable.
   - `drain_bounded_with_sentinel` streams stderr through `RollingSentinelScanner`. The scanner maintains a trailing window across chunk boundaries (`sentinel.len() - 1` bytes), detecting the sentinel token across arbitrary chunk splits and streaming data volumes independently of retained diagnostic buffer limits.
   - When detected, the runner flags `editor_invoked: true`, and the action returns `outcome: "blocked"` with `reason: "messageEditRequired"` and `terminalHandoffRequired: true`.
5. **Bounded Diagnostic Buffering & Sanitization:**
   - Stdout and stderr draining is capped at 64 KiB (`MAX_OUTPUT_DRAIN_BYTES`) to avoid unbounded memory buffering on noisy output.
   - Exposed diagnostics are processed by `sanitize_git_diagnostic`: occurrences of the known worktree path are replaced with `[WORKTREE_ROOT]`, sensitive bearer tokens and secrets are redacted via `redact_diagnostic_text`, and message length is bounded to 4,096 bytes of trimmed text (truncated cleanly at a UTF-8 character boundary with `... [truncated]`).
