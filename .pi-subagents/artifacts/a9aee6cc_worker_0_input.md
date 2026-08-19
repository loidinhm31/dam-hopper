# Task for worker

Environment: Windows 11, CWD G:/ws/sharing/dam-hopper, pnpm monorepo. Continue uncommitted Phase 05 work; preserve Phase 04 and unrelated changes, do not edit plan docs. Fix review blockers in apps/native/src/native-ssh-forward-host.ts and supporting shared/context/hook files. (1) No automatic mutation replay after MANAGER_SESSION_MISMATCH: only snapshot may one-time reopen client/reactivate; mutations return mismatch after optional state rehydrate. (2) exactly one owner of hint snapshot refresh—adapter or hook—not both; strict BigInt freshness, one in-flight + one trailing, and consumers receive accepted refresh without issuing another snapshot. (3) strict parse native open/activation/snapshot/key inventory DTOs, including nested profile/runtime/challenge/key scalar constraints; malformed maps fixed IPC_UNAVAILABLE. (4) Add all Phase 03 compatibility error codes to union/parser. (5) Add focused adapter A/B/C, no mutation replay, hint reorder/duplicate; context delete ordering/unavailable; hook; server-config event/read failure tests. Fix lint. Run focused commands, native/UI build, lint, diff check. No broad accidental UI full suite. Concise final report changed files, validation, risks, unresolved questions.

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