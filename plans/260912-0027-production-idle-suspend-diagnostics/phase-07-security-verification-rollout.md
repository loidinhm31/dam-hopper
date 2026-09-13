# Phase 07 — Cross-layer security/fault verification, architecture check, docs and rollout

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md) · [Phase 06](phase-06-linux-cli-integration.md)
- [Approved brainstorm acceptance](../reports/brainstorm-260911-2355-production-idle-suspend-diagnostics.md#acceptance-and-validation)
- [Live architecture](../../docs/system-architecture.md) · [Linux operations](../../docs/linux-systemd.md) · [Security guide](../../docs/terminal-idle-suspend-security.md)
- [Code standards](../../docs/code-standards.md) · [Project overview](../../docs/project-overview-pdr.md)

## Overview

- Date: 2026-09-12
- Description: prove cross-layer incident reconstruction and security/fault behavior, reconcile implementation against architecture before final docs, execute one read-only Linux smoke, and gate staged rollout/rollback.
- Priority: P1
- Implementation status: DONE (2026-09-14)
- Review status: QA passed (223/223 executions; 0 failures), Code Review approved (Cycle 2; 10.0/10)
- Effort: 10h
- Ownership: integration owner runs deterministic gates; architecture owner performs contract diff before docs owner edits live guides; operations owner alone runs target-host smoke.
- Dependency: Phases 01–06 complete and focused reviews approved.

## Key Insights

- Tests are proof only when they observe chains, source truth, privacy, filesystem/CLI behavior, and forbidden side effects—not field forwarding/source text.
- Architecture verification must precede final documentation/rollout so docs describe proven behavior, not aspiration.
- Live smoke is read-only except creating its diagnostic output; it must snapshot RTC/service/audit metadata before/after and never trigger suspend.
- Mixed versions and evidence loss are normal rollout states; they must yield partial bundles, never optimistic success.

## Requirements

- Add/retain permanent tests only for plausible behavioral regressions: cross-layer chain/rejection, durability ordering, corruption/gaps, redaction, role/privilege, fixed commands/API, bounds, atomic output/exits, no mutation.
- Automated execution uses temp paths, fake commands/clocks/EUID/API/probes/helper backends. Never manipulate real RTC, suspend, service state, or production audits.
- Validate every brainstorm acceptance: automatic success chain; all named rejection classes; manual correlation; restart/rotation/malformed/drop/orphan discontinuities; root/non-root output; read-only collector; caps; redaction; attachable incident reconstruction; no new process/unit.
- Run architecture-to-code review before final doc edits: versions, fields, taxonomy, paths, requiredness, privacy, durability, correlation, output, exits, rollback. Intended drift updates contract/live architecture with approval; unintended drift fixes code.
- Add one ignored/read-only Linux smoke using production read adapters plus injected temp output. Run only after deterministic gates on approved server-role target.
- Smoke captures before/after hashes/metadata for fixed audits/config, RTC wakealarm content, and unit active/substate/MainPID; asserts unchanged.
- Update operator/security/API/configuration/architecture/project/changelog docs only after verification. State latest/non-historical limits, explicit root, partial exit `2`, local-file AI handoff, privacy review, no upload.
- Rollout: additive helper/server producers first, collector last; canary partial/mixed-version expected until all producers current. Stop on privacy leak, source mutation, false complete, stdout contamination, mode/path failure, or suspend behavior regression.
- Rollback leaves evidence files, restores previous binaries/assets, and verifies older server/helper compatibility; no unit removal because none added.
- Non-goals: real automatic/manual suspend in automated/smoke gates, UI, telemetry, upload, AI analysis/classifier.

## Architecture

- Verification ladder: deterministic module tests → cross-layer fake-backed CLI scenarios → security boundary inspection → architecture diff/gate → read-only Linux smoke → docs → canary rollout.
- Cross-layer fixtures feed real serialized server/helper records into real readers/correlation/bundle/output, while executor/host mutations remain fake.
- Smoke calls library collector with real read-only adapters and temp output adapter; public CLI path/mode/stdout is separately covered in deterministic process tests.
- Rollout compatibility matrix: new collector+old producers=`partial`; new server+old helper=protocol works/partial helper milestones; old server+new helper=established action records readable; rollback ignores retained new stream safely.

## Related code files with modify/create/delete and dependency

| Action | Path/symbol | Planned change | Dependency |
| --- | --- | --- | --- |
| Modify | `server/tests/idle_suspend.rs` | Cross-layer automatic/manual/rejection/restart observable chains with fake executor | Producer phases |
| Create | `server/tests/idle_suspend_diagnostics.rs` | Real serializers/readers/correlation/CLI-output fault matrix | Phases 03–06 |
| Create | `server/tests/idle_suspend_diagnostics_linux_smoke.rs` | Ignored read-only Linux adapter smoke with temp output and before/after invariants | Deterministic gates |
| Modify | `docs/system-architecture.md` | Mark Phase 01 design implemented; reconcile exact code/dataflow/invariants | Architecture diff passed |
| Modify | `docs/linux-systemd.md` | Invocation, root/non-root, exits, fixed sources, output, smoke/runbook, rollback | Runtime proof |
| Modify | `docs/terminal-idle-suspend-security.md` | Threat/privacy/durability/completeness/AI handoff limits | Security proof |
| Modify | `docs/api-reference.md` | Clarify protected status latest-only/best-effort and no historical diagnosis API | Contract |
| Modify | `docs/configuration-guide.md` | State fixed v1 bounds/no tuning/default-policy unchanged | Contract |
| Modify | `docs/project-overview-pdr.md`, `docs/codebase-summary.md`, `CHANGELOG.md` | Record delivered scope and operational limitations without inflated test claims | All gates |
| Inspect | `deploy/systemd/*`, release manifest/inventory output | Prove no new unit/process and required binaries/assets only | Packaging gate |
| Delete | Temporary fixture/scripts only | Remove throwaway artifacts after smoke; keep valuable regression tests | Proof complete |

## Implementation Steps

1. Build cross-layer fixtures for automatic quiet success and rejection by recent input/output/network, unavailable measurement, stale generation, active fleet, inhibitor, capability failure; assert typed terminal evidence and zero private text.
2. Cover manual accepted/rejected/confirmation/audit failure and exact UUID across API response, server stream/audit, helper v2, outcome, reconciliation.
3. Inject API/helper restart, audit rotation/coverage loss, malformed middle/tail, unknown version, producer drop/sequence gap, orphan intent/completion, legacy `epoch-N`; assert partial/source statuses, never “no activity.”
4. Run redaction corpus and adversarial oversized/deep/malformed source cases. Assert forbidden values absent from final bytes and all caps/truncation metadata exact.
5. Exercise root/non-root/web/unknown role, API auth/down, command timeout/output overflow, unsafe output path, disk/write/rename/sync faults; assert stdout/exits/mode/atomicity and zero mutation calls.
6. Run focused then crate/workspace gates selected by repository convention. No real host side effects; retain only high-value behavior tests.
7. Diff implementation against design contract and Phase 01 live architecture. Resolve every field/path/order/requiredness/privacy/rollback difference; obtain architecture/security approval before docs.
8. Run ignored read-only Linux smoke on approved host: snapshot fixed source hashes/metadata, RTC content, unit properties; collect to temp; validate JSON/path/mode/status; compare snapshots; remove temp output.
9. Update named live docs/changelog with exact verified commands/results, root/non-root procedure, exit handling (`0` and `2` both print usable path), AI attachment/privacy warning, and rollback.
10. Stage helper/server producers before collector; canary one root and one non-root collection without suspend. Exercise rollback to prior binaries and mixed-version partial behavior. Obtain release-owner sign-off.

## Todo list — 100% complete (6/6)

- [x] Prove all success/rejection/corruption/privacy/bounds/output scenarios.
- [x] Prove no forbidden host/source mutation.
- [x] Complete architecture-to-code diff before docs.
- [x] Run one approved read-only Linux smoke.
- [x] Update live docs/changelog from observed results.
- [x] Complete staged rollout and rollback rehearsal/sign-off.

## Completion record

- **Completed:** 2026-09-14.
- **Status:** DONE (100%; 6/6 todo items).
- **Review:** Cycle 2 approved **10.0/10** with no critical, high, or medium findings.
- **Validation:** **223/223 executions passed; 0 failures**, including the ignored read-only Linux smoke with zero-mutation invariants.
- **Evidence:** [Cycle 2 test report](../reports/tester-260914-0106-phase07-cycle2-verification.md) · [Cycle 2 code review](../reports/code-review-260914-0109-phase-07-production-idle-suspend-diagnostics-cycle2.md).

## Success Criteria

- One final bundle reconstructs where each successful/rejected automatic/manual attempt stopped, using exact producer/helper evidence and explicit missing evidence—not hidden state or heuristic diagnosis.
- All named discontinuities produce partial/source-incomplete output; no malformed/rotated/dropped/unknown evidence appears complete.
- Root output is valid mode `0600` with path-only stdout; non-root never escalates and yields valid helper-denied partial; fatal output failure prints no path.
- Final bytes contain none of the forbidden redaction corpus. Commands/API are fixed and local; no terminal content.
- Before/after mutation assertions and Linux smoke prove unchanged RTC, suspend, services, audits, config, socket/PID enrollment; packaging contains no new long-running process/unit.
- Architecture review precedes docs and records no unresolved drift. Docs show exact observed commands/results and safe AI handoff.
- Rollout/rollback mixed-version scenarios behave as documented; release owner signs off.

## Risk Assessment

- Full suite hides focused failure: preserve ordered focused evidence before broader gates.
- Smoke accidentally mutates host: expose only read adapters and temp output; compare before/after, abort on any unexpected path/command.
- Docs overclaim completeness: copy only observed results and distinguish latest/current from historical.
- Mixed rollout falsely exits 0: canary explicitly requires partial until both producer schemas/coverage are present.

## Security Considerations

- Security review inspects root file handling, subprocess allowlist, token lifetime, redirect/egress prohibition, parser bounds, redaction-before-size, stdout/stderr separation, and rollback readers.
- Test secrets include token/cookie/password forms, argv/env, terminal control bytes, socket/IP addresses, inhibitor identities, raw IPC/helper/systemd/journal detail, and prompt-like text.
- Diagnostic bundle is sensitive mode-`0600` local evidence; operator reviews before explicit attachment. Product never uploads it.

## Next steps

Phase 07 verification, architecture reconciliation, documentation, and zero-mutation Linux smoke are complete. Production idle-suspend diagnostics are ready for canary deployment.

## Unresolved questions

None. Any failed architecture, mutation, privacy, completeness, smoke, or rollback gate blocks rollout.
