# Resource Qualification & Measured Bounds Report — Git Conflict Resolver

Date: 2026-10-21
Plan: `plans/261019-1505-git-conflict-resolver/plan.md`
Phase: 09 — Qualification and documentation

---

## 1. Authoritative Backend Limits

These limits are enforced server-side in `server/src/git/conflict.rs` and `server/src/git/operation.rs` before full blob materialization or subprocess execution:

| Resource Metric | Enforced Boundary | Source Definition | Observable Behavior on Limit Exceeded |
| --- | --- | --- | --- |
| **Max Conflict Lines** | 50,000 lines | `server/src/git/conflict.rs:MAX_LINES` | Enforced during line tokenization; stage descriptor returns `StageKind::Unsupported` and withholds tokens |
| **Max Line Length** | 100,000 bytes | `server/src/git/conflict.rs:MAX_LINE_LENGTH` | Enforced during line tokenization; stage descriptor returns `StageKind::Unsupported` and withholds tokens |
| **Max Blob Stage Bytes** | 5,242,880 bytes (5 MB) | `server/src/git/conflict.rs:MAX_STAGE_BYTES` | Stage reader returns `StageKind::Unsupported` and withholds tokens before full buffer allocation |
| **Max Total Stage Bytes** | 15,728,640 bytes (15 MB) | `server/src/git/conflict.rs:MAX_TOTAL_STAGE_BYTES` | Cumulative limit across stages 1..3; returns `StageKind::Unsupported` and withholds tokens |
| **Max Worktree File Bytes** | 5,242,880 bytes (5 MB) | `server/src/git/conflict.rs:MAX_WORKTREE_BYTES` | Worktree descriptor retains its detected kind (e.g. `Regular`) but withholds `text_tokens: None` |
| **Default Summary Limit** | 100 entries | `server/src/git/conflict.rs:DEFAULT_SUMMARY_LIMIT` | Default pagination page size for `GET /api/git/{project}/conflicts` |
| **Max Summary Limit** | 500 entries | `server/src/git/conflict.rs:MAX_SUMMARY_LIMIT` | Maximum allowed pagination limit for conflict discovery |
| **Binary Sniff Length** | 8,000 bytes | `server/src/git/conflict.rs:BINARY_SNIFF_LEN` | Bounded prefix inspected for NUL bytes to detect binary files |
| **Max Diagnostic Drain** | 65,536 bytes (64 KB) | `server/src/git/operation.rs:MAX_OUTPUT_DRAIN_BYTES` | Streaming drainer scans sentinel across all chunks, caps retained diagnostic text to 64 KB |
| **Max Exposed Diagnostic** | 4,096 bytes (4 KB) + suffix | `server/src/git/operation.rs:MAX_DIAGNOSTIC_MESSAGE_BYTES` | Subprocess errors are redacted, worktree paths stripped, and trimmed text is bounded to 4,096 bytes plus `... [truncated]` |
| **Subprocess Execution Deadline** | 15.0 seconds | `server/src/git/operation.rs:SUBPROCESS_TIMEOUT` | Tokio timeout; `ProcessGroupGuard` terminates process group via `SIGKILL` to `-pgid` and `pgid` on Unix, or best-effort `taskkill /F /T` on Windows |

---

## 2. Authoritative Frontend Limits

These limits are enforced client-side in `@dam-hopper/ui` (`conflict-draft-capacity.ts`, `conflict-draft-store.ts`):

| Resource Metric | Enforced Boundary | Source Definition | Observable Behavior on Limit Exceeded |
| --- | --- | --- | --- |
| **Max Draft Bytes** | 2,097,152 bytes (2 MB) | `packages/ui/src/lib/conflict-draft-capacity.ts:DEFAULT_MAX_DRAFT_BYTES` | Prospective edit refused with toast warning; existing draft and undo history preserved |
| **Max Total Draft Store Bytes** | 10,485,760 bytes (10 MB) | `packages/ui/src/lib/conflict-draft-capacity.ts:DEFAULT_MAX_TOTAL_BYTES` | Further draft modifications refused when aggregate store exceeds 10 MB |
| **Max Concurrent Dirty Drafts** | 10 drafts | `packages/ui/src/lib/conflict-draft-capacity.ts:DEFAULT_MAX_DIRTY_DRAFTS` | Opening 11th dirty draft prompts user to save/discard existing drafts |
| **Max History Undo Depth** | 100 entries | `packages/ui/src/lib/conflict-draft-store.ts:415` | Ring buffer drops oldest clean history entries while retaining dirty baseline |
| **History Coalesce Window** | 500 ms | `packages/ui/src/lib/conflict-draft-transitions.ts:126` | Typing bursts within 500 ms coalesce into single undoable text step |

---

## 3. Verified Verification Evidence

- Backend limits verified by unit tests in `server/src/git/conflict.rs` (`split_lossless_line_tokens_bounded`) and `server/src/git/operation.rs:tests` (scanner, diagnostics sanitization).
- Frontend capacity limits verified by unit tests in `packages/ui/src/lib/conflict-draft-capacity.test.ts`.
- Subprocess timeout and process group termination are implemented via `SUBPROCESS_TIMEOUT` and `ProcessGroupGuard` RAII cleanup; diagnostic path sanitization and secret redaction are verified by unit tests in `server/src/git/operation.rs:tests`.
- Live-daemon loopback smoke test (`node scripts/qualify-git-conflict-resolver.mjs`) verified real-world functional lifecycle across 54/54 assertions (operation status, conflict inventory, snapshots, CUT1 staging preflight rejection, CUT2 legacy rejection, stale preconditions, text resolution, guarded continue, commit-message editor sentinel handoff, nested repository target isolation, and confirmed abort). Linked-worktree isolation is independently verified by integration tests in `server/tests/git_conflict_operation_lifecycle.rs`.
