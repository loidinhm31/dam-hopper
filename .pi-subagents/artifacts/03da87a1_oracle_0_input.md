# Task for oracle

Environment: Windows 11 Pro build 26200 x64, CWD G:/ws/sharing/dam-hopper, branch features/ssh-port-forwarding-control. Native Rust tests compile/link but the lib test exe fails before test enumeration with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139). App/native code should not be changed speculatively. Evidence: Cargo native dependency includes russh 0.62.5, which brings pageant 0.2.1 -> windows 0.62.2; Tauri/WebView2 uses windows 0.61.x. VC runtime installed; packaged WebView2 app works. PE imports include bcryptprimitives!ProcessPrng, api-ms-win-core-synch WaitOnAddress/Wake*, ntdll, user32, kernel32, etc.; direct dumpbin confirms ProcessPrng, kernel32 APIs and NtFlushBuffersFileEx exist. User asks what we should do to resolve. Give decision-grade, minimal safe plan: evidence collection, likely causes ranked, no-code paths vs narrow code/dependency remedy criteria, commands, rollback/safety. Do not edit. Concise, explain non-codebase tools plainly; unresolved questions last.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

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