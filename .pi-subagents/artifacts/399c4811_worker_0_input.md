# Task for worker

Environment: Windows 11, CWD G:/ws/sharing/dam-hopper, branch features/ssh-port-forwarding-control. User says keep going; Phase 04 runtime validation remains deferred. Implement the core of Phase 05 per plans/260808-1310-ssh-port-forwarding-control/phase-05-host-context-native-adapter.md. You own all Phase 05 files only: create shared UI SSH-forward host contract/parser, nullable context/bridge, hook, native SSH adapter/tests, and modify server-config/UI app exports/native main/package test setup as necessary. Preserve existing uncommitted Phase 04 changes and unrelated files. Keep packages/ui free of Tauri imports; exact 12 map; strict BigInt decimal parsing; desktop only/no mobile calls; dispose only unlistens; no fake host. Add focused tests. Run appropriate pnpm tests/typecheck/build. Do not modify plan docs. Concise final report with changed files, commands/results, residual risks, unresolved questions last.

## Acceptance Contract
Acceptance level: checked
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope

Required evidence: changed-files, tests-added, commands-run, residual-risks, no-staged-files, validation-output

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