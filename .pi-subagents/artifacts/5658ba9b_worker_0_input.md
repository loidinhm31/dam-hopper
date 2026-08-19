# Task for worker

Environment Windows 11; CWD G:/ws/sharing/dam-hopper. Continue Phase 05 only; preserve all unrelated/Phase04 changes. Fix final review defects comprehensively: stale activation responses must reject as ACTIVATION_SUPERSEDED and never resolve usable stale scope; post-await command results must only update/return if current context/token/scope/generation/operation still match; use one shared strict RFC3339 UTC millisecond calendar validator replacing Date.parse copies; add focused adapter tests for delayed A/B/C and stale command snapshot/new client epoch. Add missing Context bridge test, hook test, and server-config tests for delete sequencing/unavailable read/typed events, using existing test conventions. Keep plan docs unchanged. Run explicit vitest files using exec vitest run, native/UI builds, lint, diff check. Do not run broad UI suite. Report concise evidence.

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