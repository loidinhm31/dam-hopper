## Code Review Summary

**Score: 4/10 — not ready for Phase 05 attestation.**

### Critical Issues
- None found.

### Warnings
- **High — mutation replay after manager restart:** `apps/native/src/native-ssh-forward-host.ts:127-135` reopens, re-activates, then recursively retries *every* failed command. Phase 05 explicitly forbids automatic mutation replay. A create/update/delete/start/stop/restart may execute after runtime replacement. Reopen + snapshot; require user retry.
- **High — duplicate hint snapshots:** `native-ssh-forward-host.ts:162-168` emits a change **and** starts `requestHintSnapshot()`. `packages/ui/src/hooks/use-ssh-forward.ts:35` responds to that event with another `host.snapshot()`. Each valid hint can cause two concurrent snapshot requests, violating single-flight/trailing-refresh bound.
- **High — response DTO acceptance is too permissive:** `native-ssh-forward-host.ts:143-149` validates only identity fields; it accepts malformed snapshots/key inventories (missing/invalid revisions, profile/runtime DTOs, keys) and caches them. Strict-parse each returned DTO before cache/publish; reject as fixed `IPC_UNAVAILABLE`.
- **Medium — error contract not exact:** `packages/ui/src/lib/ssh-forward-host.ts:32-43` excludes Rust compatibility codes (`INVALID_COUNTER`, `INVALID_TIMESTAMP`, `INVALID_PROFILE`, `IDENTITY_CORRUPT`, `STALE_CLIENT`, `STORAGE_UNAVAILABLE`) from `apps/native/src-tauri/src/ssh_forward/error.rs`. This violates full error-table parity and maps valid native responses to `IPC_UNAVAILABLE`.
- **Medium — required behavioral tests absent:** no `SshForwardHostContext.test.tsx` or `use-ssh-forward.test.tsx`; adapter tests lack A/B/C late responses, manager reopen/no replay, valid/invalid hint ordering and single-flight, deletion sequencing/unavailable reads, reload, and Windows factory runtime cases.
- **Low — plan completion tracking:** `plans/260808-1310-ssh-port-forwarding-control/phase-05-host-context-native-adapter.md` remains `Pending` with all todo items unchecked; not updated (review was explicitly no-edit).

### Next action
Fix automatic mutation replay and duplicate hint refetch first; add strict response parsers and focused race/deletion tests; then rerun Phase 05 test matrix.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings include severity and exact file paths/lines."
    }
  ],
  "changedFiles": [
    "apps/native/src/native-ssh-forward-host.ts",
    "apps/native/src/native-ssh-forward-host.test.ts",
    "packages/ui/src/lib/ssh-forward-host.ts",
    "packages/ui/src/lib/ssh-forward-host.test.ts",
    "packages/ui/src/contexts/SshForwardHostContext.tsx",
    "packages/ui/src/hooks/use-ssh-forward.ts",
    "packages/ui/src/api/server-config.ts",
    "apps/native/src/main.tsx"
  ],
  "testsAddedOrUpdated": [
    "apps/native/src/native-ssh-forward-host.test.ts",
    "packages/ui/src/lib/ssh-forward-host.test.ts"
  ],
  "commandsRun": [
    {
      "command": "pnpm --filter @dam-hopper/native test",
      "result": "passed",
      "summary": "13 tests passed."
    },
    {
      "command": "pnpm --filter @dam-hopper/ui exec vitest run src/lib/ssh-forward-host.test.ts src/api/server-config.test.ts",
      "result": "passed",
      "summary": "17 focused tests passed."
    },
    {
      "command": "pnpm --filter @dam-hopper/ui test -- src/lib/ssh-forward-host.test.ts src/contexts/SshForwardHostContext.test.tsx src/hooks/use-ssh-forward.test.tsx src/api/server-config.test.ts",
      "result": "failed",
      "summary": "Runs full suite; unrelated transport-utils assertion failed (974/975 passed)."
    },
    {
      "command": "pnpm --filter @dam-hopper/ui build",
      "result": "passed",
      "summary": "TypeScript build passed."
    },
    {
      "command": "pnpm --filter @dam-hopper/native build",
      "result": "passed",
      "summary": "Native TypeScript/Vite build passed."
    }
  ],
  "validationOutput": [
    "No staged files.",
    "git diff --check passed."
  ],
  "residualRisks": [
    "Automatic mutation replay after manager restart.",
    "Hint events issue duplicate snapshots.",
    "Malformed native response DTOs can enter cached state.",
    "Required adapter/context/hook race and deletion coverage is absent."
  ],
  "noStagedFiles": true,
  "diffSummary": "Phase 05 host/context/adapter scaffolding added; profile events and native composition modified.",
  "reviewFindings": [
    "high: apps/native/src/native-ssh-forward-host.ts:127-135 automatically replays mutations after manager reopen.",
    "high: apps/native/src/native-ssh-forward-host.ts:162-168 plus packages/ui/src/hooks/use-ssh-forward.ts:35 double-fetches valid hints.",
    "high: apps/native/src/native-ssh-forward-host.ts:143-149 accepts insufficiently validated response DTOs.",
    "medium: packages/ui/src/lib/ssh-forward-host.ts:32-43 does not mirror all Rust error codes.",
    "medium: required context/hook and ordering/deletion test coverage is missing."
  ],
  "manualNotes": "Windows-only factory correctly produces zero calls for unsupported platforms in existing unit tests; all Phase 05 plan todos remain unchecked."
}
```

Unresolved questions: none.