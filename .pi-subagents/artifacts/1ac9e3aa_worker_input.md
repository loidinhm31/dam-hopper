# Task for worker

You are reviving a previous subagent conversation.

Original run: 399c4811
Original agent: worker
Original session file: C:\Users\loidi\.pi\agent\sessions\--G--ws-sharing-dam-hopper--\2026-08-12T16-55-56-548Z_019ff6e6-eb84-7391-8451-fbceb064ab2c\399c4811\run-0\session.jsonl

Use the stored session context as background. Answer the orchestrator's follow-up below. Do not assume the original child process is still alive.

Follow-up:
Apply review remediation to your Phase 05 implementation. Environment: Windows 11, CWD G:/ws/sharing/dam-hopper, branch features/ssh-port-forwarding-control. Preserve Phase 04/unrelated changes. Must fix: strict allowlisted redacted IPC error parser; exact context/token/scope/scope-generation validation for command/snapshot/activation responses; BigInt numeric hint freshness with one in-flight + one trailing refetch; MANAGER_SESSION_MISMATCH one-time reopen+reactivate with no mutation replay; deletion waits latest replacement/null activation before purge; factory returns null for non-Windows until native capability exists; complete Rust error table parity; add required context/hook/server-config/adapter tests; resolve Phase 05 lint issue. Run focused tests, UI/native builds, lint, diff check. Do not alter plan docs. Concise final report changed files/commands/results/residual risks/unresolved questions last.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope
- criterion-2: Return evidence sufficient for an independent acceptance review

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files

Review gate: required by reviewer.

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```