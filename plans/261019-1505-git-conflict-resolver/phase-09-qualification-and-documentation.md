# Phase 09 — Qualification and documentation

## Context links

- [Plan and validated decisions](./plan.md#validation-summary), [Phase 08](./phase-08-workspace-integration-and-cutover.md), [authoritative acceptance/qualification matrix](./acceptance-matrix.md#authoritative-qualification-matrix), [validation provenance](./reports/plan-validation.md#validation-interview-historical).
- [Design contract](./design-contract.md#verification-boundary), [repository evidence](./reports/repository-evidence.md#verification-and-documentation-surfaces).
- [Git semantics](./research/git-semantics.md), [merge model](./research/merge-model.md), [brainstorm AC](../reports/brainstorm-261019-1326-git-conflict-resolver.md#acceptance-criteria-and-planned-validation).

## Overview

- Date: 2026-10-19. Priority: P2.
- Implementation: Pending. Review: Pending. Progress: 0%. Effort: unestimated.
- Owner: qualification lead with backend/server-platform fixture, production web, required Linux-native host and human visual reviewers explicitly assigned.
- Entry: all Phase 01–08 mechanisms and coordinated production cutover passed; feasibility is not deferred to this phase. Required Linux-host/reviewer availability comes from Phase 01, not browser inference.
- Handoff: exact AC1–12/CUT1–5 evidence within the approved initial scope, actual supported platform/resource matrix and implementation documentation; no acceptance row is deferred or dropped.
- Go/no-go: all shared safety, authenticated production web, actual Linux Tauri interactions, fresh local captures and explicit human ACCEPTED are required. Missing/failed required evidence blocks initial release and Phase 09 completion. Windows-native client qualification remains separately Pending/nonblocking and explicitly unqualified.

## Key insights

- Temporary Git fixtures prove exact stage/byte behavior; mocked DTO echoes and source-text wiring tests cannot.
- Real production SPA/server/auth fixture proves entry/routing/write path; isolated component pages are insufficient.
- Chromium cannot certify Tauri host lifecycle/input; launch and interact with the actual Linux Tauri host for initial qualification. Windows-native client qualification is separate, deferred and nonblocking, not inferred from Linux/browser proof.
- Fresh local full-viewport captures need explicit human ACCEPTED/REJECTED; CI or planner cannot synthesize acceptance.
- Measurements qualify real limits/platforms, not universal frame-rate/memory claims.
- Continue requiring commit-message editing hands off to the verified exact owning repository/worktree terminal for Git's configured editor. A handoff is neither completion nor a guaranteed zero-write outcome.
- Deferred Windows-native client evidence does not waive shared correctness or subprocess/path/locking safety on supported server OSes; the shared web/native architecture is unchanged.

## Requirements

### Functional

- Cover every acceptance row and additional cutover invariant with concrete scenario, actual observed oracle and artifact.
- Use real isolated temporary repositories and actual production application fixture with existing authenticated seed/setup.
- Exercise all four operation continue/abort flows, repeated stops, exact text/binary/delete bytes and recovery failures, including exact-owner configured-editor terminal handoff with hooks/signing unchanged.
- Cover owner/server/generation/root isolation, manual/native history, floating focus/geometry and retained dirty drafts/history across terminal handoff.
- Prove one coordinated UI/server contract with every caller migrated; no legacy write fallback, compatibility shim or incompatible intermediate deployment. Update API, architecture, frontend, roadmap and changelog only to implemented observed behavior.

### Nonfunctional

- No planning-time tests/builds/prototypes are performed; every command below is future implementation qualification.
- No permanent default-prop/wiring/source-text/mock-echo tests; preserve meaningful Android input-policy coverage.
- Record commands/results, source fingerprint, tool/OS/browser/native versions, fixture and artifact locations for every run.
- All AC1–12/CUT1–5 remain in approved initial scope. Missing/failing shared safety, authenticated web, Linux-native or human acceptance blocks completion; no fabricated screenshots/review or silent waiver. Separately Pending Windows-native client evidence alone does not block.
- No resolver message form/adapter, handler-launched interactive editor or automatic PTY command injection; configured hooks/signing remain unchanged.
- Refresh authoritative operation/full relevant index facts after every attempted command and terminal return. Failed refresh leaves outcome unknown/no replay; retained stale drafts require explicit import/review against a fresh same-owner snapshot before applicability, never refresh-only rebinding.

## Architecture

Layered evidence: pure merge/history behavioral cases -> real Git/backend route and supported-server-OS cases -> actual Monaco browser cases -> authenticated production web scenario -> actual Linux Tauri host -> fresh captures and human visual review.
The acceptance matrix remains the authoritative AC1–12/CUT1–5 inventory; qualification reports link every ID to its evidence and failure boundary. No row becomes optional through Windows-native client deferral.
Use current application-fixture/capture policy rather than new permanent seed/auth infrastructure.
Resource report records total sources/base/result/history/draft load and response measurements at/beyond selected limits on required web/Linux-native targets; Windows-native bounds remain unqualified until separately measured.
The configured-editor handoff captures profile/connection generation/server binding/project/worktree/root and exact terminal session/incarnation; verify the actual target, not just current directory. Reconnection, retired generation or terminal replacement invalidates the handoff. Git invokes its configured editor there; no resolver message/editor adapter or command injection.
Authoritative post-attempt/post-terminal operation and full-index observations are the oracle, not a handoff toast, return to panel or zero-conflict count. Preserve dirty drafts/history with their original binding; stale recovery content is not applicable without fresh explicit import/review. Failed refresh leaves unknown/no replay; even a later successful refresh cannot automatically replay uncertain Continue/Abort, which requires a new explicit user action and fresh preconditions.
Only after evidence matches implementation do documentation and roadmap describe actual support, unsupported handoffs and durability limitations.

**Required-vs-deferred qualification matrix — future evidence only; every entry currently Pending**

| Qualification dimension | Initial release rule / required oracle | Current evidence |
| --- | --- | --- |
| Shared correctness and safety: AC1–12/CUT1–5 | Required; all rows retain real behavior/byte/history/race/process oracles within approved initial scope; missing/failing safety blocks | Pending |
| Applicable supported-server process/path/locking safety | Required for advertised server support; bounded execution/cleanup, containment and index/ref coordination are not waived by Windows-native client deferral, which creates no new server-platform support promise | Pending |
| Authenticated production web | Required actual production SPA/server/auth fixture interactions, write path, ownership and measured bounds; isolated components/--no-auth do not qualify | Pending |
| Actual Linux Tauri client | Required actual launch and resolver/input/lifetime/focus/terminal-return interactions with recorded Linux runtime/hardware/versions; Chromium is not native proof | Pending |
| Fresh local captures | Required full-viewport artifacts/evidence metadata under current capture policy; unavailable/stale artifacts block | Pending |
| Explicit human visual review | Required recorded ACCEPTED; missing or REJECTED blocks until corrected and recaptured/reviewed | Pending |
| Windows-native client | Deferred, nonblocking, explicitly unqualified; track separately Pending until actual Windows host interactions/resources/captures are qualified, never claim Windows resolver support meanwhile | Pending |

Phase 09 may eventually complete with Windows-native client qualification separately Pending only after every required row passes. Missing Linux, human or shared/server-safety proof never qualifies for that exception.

## Related code files

- Modify: `server/src/git/tests.rs`, `server/src/api/tests.rs` and proposed focused conflict/operation module tests created by prior phases for real temporary Git cases.
- Modify: actual model/draft/history/browser tests from prior phases; discover final paths rather than claim proposed test names exist.
- Create (proposed): `packages/ui/e2e/git-conflict-resolver/git-conflict-resolver.spec.ts` for production fixture smoke and capture flow.
- Reuse: `packages/ui/e2e/fixtures/application-fixture.ts`, `capture-policy.ts`, `capture-evidence.ts`; discover exact existing seed/auth hooks before use.
- Modify: `docs/api/git.md`, `docs/api/rest-endpoints.md` for actual routes/DTOs/status/outcome semantics.
- Modify: `docs/architecture/workbench-files-editor-and-git.md`, `docs/frontend-components/terminal-and-ide.md`, `docs/system-architecture.md` for actual lifetime/stacking/safety boundaries.
- Modify: `docs/project-roadmap.md`, `docs/CHANGELOG.md` after evidence supports delivered behavior; replace proposed-only architecture note accurately.
- Create (proposed): `reports/qualification-evidence.md` and `reports/resource-qualification.md` under this plan; capture evidence artifacts follow existing policy paths.
- Delete: remaining throwaway proof scaffolds and obsolete incidental tests created/replaced during implementation; do not remove meaningful Android policy tests.

## Implementation steps

1. Freeze source fingerprint and final test/module paths; map every AC1–12/CUT1–5 ID to owning scenario, exact oracle and evidence artifact.
   Reuse existing real-Git test helpers and authenticated production seed; set local fixture identity deterministically without treating disabled hooks/signing fixture defaults as policy proof.
   Confirm Phase 01's required Linux host/runtime owner and human reviewer; record server-OS obligations separately from deferred Windows-native client qualification.
2. Build isolated fixtures with two conflicted files, unrelated staged/unstaged files, four operations and repeated/multi-commit stops.
   Add binary/delete/modify, modes, unsupported paths/types/encoding/filter, linked worktrees, nested roots and two same-name server targets.
   Parse paths with NUL-safe commands; assert raw filesystem bytes and stage OID/mode/path tuples, not response text alone.
3. Inject changes/failures at actual boundaries: mid-read coherence, stale precondition, ancestor/type/attributes/operation change, after successful worktree write, and lost command response.
   Preexisting lock is a separate busy scenario; assert no rollback/replay over a later external writer.
   Change an unrelated staged stage-0 entry after operation status display and before Continue; require stale rejection with no command execution.
   Exercise configured-editor-required Continue for every applicable operation: verify handoff to captured profile/generation/server/project/worktree/root and exact terminal session/incarnation, Git's configured editor, hooks/signing and retained dirty history, with no message form/adapter, handler editor launch or automatic PTY injection. Reconnection/generation retirement/terminal replacement invalidates the handoff.
   After every attempted continue/abort (success, blocked, failed or unknown) and again after terminal return, inspect actual operation and full relevant index; handoff is not completion/zero-write. Refresh failure stays unknown/no replay; later successful refresh must not auto-replay, and another attempt needs new explicit user action/fresh preconditions.
   Keep stale drafts under the original owner/snapshot and verify Apply remains disabled until explicit import/review against a fresh same-owner snapshot; refresh alone must not rebind or overwrite accepted edits.
   Include supported server OS bounded draining/deadline/process-tree cleanup and fixed command safety; Windows-native client deferral cannot waive these obligations.
4. Exercise real Monaco native history and input, not mocked onChange echoes.
   Include metadata-only Ignore/Mark reviewed, context-menu undo, branch-after-undo, imported partial text, empty result and source immutability.
5. Run focused settled checks using commands below, adapting proposed filters to actual created modules/tests.
   Then run affected integration/build checks once changes settle; record failures honestly and fix before collecting final evidence.
6. Use actual production application fixture/server/auth existing seed to launch row and operation entries, edit/review/apply/stage and separately continue/abort.
   Exercise narrow/wide, shells, stacking/widgets/Escape, owner retirement, newer typing after submit, unsupported list and capacity boundary.
   No --no-auth claim qualifies authenticated E2E; isolated loopback manual smoke must be labeled separately.
7. Launch the actual Linux Tauri native host and repeat core resolver/input/lifetime/focus/terminal-handoff/return workflow.
   Record Linux OS/runtime/hardware and host-close behavior separately; unavailable Linux host leaves required evidence Pending and blocks initial release, never inferred from browser. Keep Windows-native client separately Pending/nonblocking/unqualified.
8. Measure resource limits on recorded authenticated web and Linux-native hardware/version: bytes, lines, longest line, regions, drafts, CPU/main-thread stall and heap.
   Exercise boundary/over-bound inventory/detail/model loads and cancellation; adjust measured limits with regression cases, not arbitrary worker thresholds.
   Grow one already-open dirty result via typing/paste/history past its boundary; verify visible prospective refusal and preservation of all accepted bytes/decisions/Undo/Redo, not merely refusal to open another file.
9. Produce fresh local full-viewport PNGs with capture evidence metadata through existing policy.
   Inspect captures and request explicit human ACCEPTED/REJECTED in review.md; missing review or rejection blocks release until correction, fresh captures and ACCEPTED. No fabricated approval.
10. Update implementation docs listed above with actual APIs/outcomes, configured-editor exact-owner handoff, mandatory post-attempt/post-terminal refresh, stale-draft import/review, supported bytes/conversions/types/operations, no-retry recovery and memory-only durability.
    Record coordinated breaking DTO cutover, every migrated caller and removed unchecked staging path; prove cached legacy resolve payloads fail closed without fallback/shim. Do not deploy an intermediate incompatible contract.
    Publish required Linux/web/human/server-safety evidence separately from Windows-native client Pending/unqualified status. Roadmap/changelog cannot claim completion while any required proof is missing, nor Windows resolver support while its client proof remains Pending.
11. Remove disposable proofs after durable behavioral regressions are extracted; confirm one production path and no obsolete parser/export/unchecked contract remains.
    Publish exact ID-to-evidence report, remaining failed gates and final source fingerprint for maintainer review.

### Future commands — not executed by this plan

```sh
cargo test --manifest-path server/Cargo.toml git::conflict
cargo test --manifest-path server/Cargo.toml git::operation
pnpm --filter @dam-hopper/ui test -- <actual-changed-test-paths>
pnpm --filter @dam-hopper/ui test:browser -- <actual-resolver-browser-test-path>
pnpm --filter @dam-hopper/ui build
pnpm --filter @dam-hopper/ui test:e2e:typecheck
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- git-conflict-resolver/git-conflict-resolver.spec.ts
pnpm dev:native
```

The Rust module filters and resolver spec are proposed until implementation creates them; zero selected tests is not passing evidence.
Native command starts a host, not an automated proof; record actual Linux Tauri interactions/results and platform prerequisites. Windows-native client qualification remains a separate Pending/nonblocking track, not evidence produced by these commands.

## Todo list

- [ ] Attach real behavior/byte evidence for AC1–12 and CUT1–5 with no omitted rows.
- [ ] Run settled backend/model/Monaco/authenticated production web checks and actual Linux Tauri scenario; retain separate Pending/nonblocking Windows-native qualification.
- [ ] Record policy/failure/race/resource and applicable server-OS boundaries, including exact-owner configured-editor handoff and post-attempt/post-terminal refresh with stale drafts retained.
- [ ] Capture fresh local viewport artifacts and explicit human ACCEPTED; missing/rejected proof blocks initial release.
- [ ] Update actual implementation docs/changelog/roadmap with coordinated no-fallback contract and honest Linux-first/Windows-unqualified scope; remove throwaway proofs.

## Success criteria

- AC1: four CLI-started operations open from both entries into floating panel; tab inventory unchanged. Failure boundary: any ordinary conflict tab routing.
- AC2: drag/resize/maximize/hide/shell switch retains history; narrow panes reachable; Monaco consumes widget Escape first. Failure: terminal leakage, close cascade or lost model.
- AC3: all accepts/ignores/both orders/whole-file/base/nonconflicting/manual commands restore text AND decisions through native undo/redo. Failure: split/metadata-only history gap.
- AC4: partial/marker-free imported work survives open/switch/cancelled rebuild/capacity refusal byte-for-byte. Failure: automatic overwrite/dirty eviction.
- AC5: intended file/deletion alone stages, Continue stays separate and repeated rebase reveals next stop. Failure: unrelated stage changes or auto-continue.
- AC6: binary selected stage-0 OID/mode and checkout bytes match; delete stays absent; unsupported cases visible. Failure: lossy re-encoding/unsafe action.
- AC7: LF/CRLF/mixed/lone-CR/BOM/Unicode/final-newline/mode fixtures meet raw-byte and blob oracles. Failure: unsupported conversion executes or silent normalization.
- AC8: stale rejects zero-write, post-write stage failure reports partial, lost response preserves draft/no replay. Failure: rollback over newer writer or false untouched/success claim.
- AC9: exact server/generation/project/worktree/nested-root request isolation with delayed responses and unavailable roots. Failure: old draft reaches replacement target.
- AC10: actual four-operation continue/abort, sequencer/git-am/interactive/hook/signing/process states match fresh metadata after every attempted command and terminal return. Required editor uses Git's configured editor in the verified exact-owner terminal, without resolver message form/adapter, handler editor or PTY injection. Retain stale drafts/history; fresh explicit import/review precedes recovered application. Failure: bypass/skip, false completion/zero-write handoff, refresh-only rebind, replay after unknown or zero-conflict completion inference.
- AC11: recorded measured web/Linux-native budgets bound summary/detail/editor/drafts and over-limit remains responsive/visible. Failure: eager all-blob summary or unmeasured universal/Windows support claims.
- AC12: authenticated production web AND actual Linux Tauri interactions plus fresh local captures/human ACCEPTED. Missing/rejected Linux/capture/human proof blocks initial release/Phase 09 completion; separately Pending Windows-native client alone is nonblocking and remains unqualified.
- CUT1: direct mixed generic-stage batch rejects before any path stages; clean-only still works. CUT2: one coordinated DTO/renderer, every caller migrated, cached legacy writes fail closed without fallback/shim, obsolete parser/exports retired, Android policy preserved; no incompatible intermediate deployment.
- CUT3: delayed successful response retains post-submit edits/new conflict panel. CUT4: oversize and unsafe path/ancestor checks reject before materialization/write. CUT5: actual index/shared-ref commands coordinate without self-deadlock.
- Actual future smoke: authenticated production app fixture registers temporary multi-conflict repo; row-open, import CLI partial edits, ignore/undo/accept, Apply & stage one file, reopen via operation status, Continue separately into next stop and Abort with consent. Exercise configured-editor handoff to verified owning terminal, retain dirty drafts/history and refresh authoritative operation/full-index after each attempt and terminal return; inspect unknown/stale outcomes rather than infer success.
- Repeat core workflow in the actual Linux Tauri host; inspect raw disk/index state, tabs, owner/revision/history, full-viewport captures and explicit human ACCEPTED artifacts. Passing smaller tests cannot substitute; deferred Windows-native client proof does not replace or waive required Linux/shared/server-safety gates.

## Risk assessment

Auth/fixture shortcuts can accidentally bypass production routing; use existing seeded authenticated fixture and actual API mutations.
Linux-native availability and human review are required evidence prerequisites identified in Phase 01; missing proof blocks initial completion. Windows-native client remains separately Pending/nonblocking and cannot be advertised as qualified.
Resource/process measurements vary by client and server platform; publish actual qualified targets/observed bounds, not extrapolated guarantees or a server-safety waiver from client deferral.
An editor-blocked Continue may already have changed Git; only authoritative post-attempt/post-terminal refresh supports outcome claims. Failed refresh leaves unknown/no replay; retained stale drafts need explicit fresh import/review.

## Security considerations

Use synthetic isolated repositories and existing authenticated local fixture; never expose --no-auth server beyond isolated loopback.
Keep credentials/source out of capture/log artifacts and record only necessary bounded diagnostics.
Hook/signing scenarios are explicit per fixture; do not weaken production policy to make tests pass.
Verify terminal server/project/worktree/root before handoff; no ambient current-directory assumption, message-content adapter, handler interactive editor or automatic PTY injection.
Qualify fixed commands, bounded output/deadline/process-tree cleanup, path containment and index/ref coordination on applicable supported server OSes; deferred Windows-native client testing does not defer shared/backend safety.

## Next steps

Hand evidence and actual support docs to maintainer review; only passed required evidence authorizes marking implementation phases completed within the approved initial scope.
If any required gate fails or is unavailable, fix owning phase/recollect evidence; no initial release or Phase 09 completion while shared/server safety, authenticated web, Linux-native, captures or human ACCEPTED is missing. Phase 09 may complete with Windows-native client separately Pending/nonblocking and explicitly unqualified, never as a support claim.

## Unresolved questions

- Qualification/backend leads: exact final web/Linux resource matrix and applicable server-OS process/path/locking matrix; execute steps 3/7–8, publish versions/hardware/metrics and post-attempt/post-terminal oracles, stop completion for missing required evidence. Windows-native client deferral does not waive server safety.
- Human reviewer/Linux-native owner: actual Linux-host availability/interactions and fresh local capture acceptance; execute steps 7/9, retain interaction record and explicit ACCEPTED/REJECTED, keep AC12 and initial release Pending on required absence/rejection. Track Windows-native client separately Pending/nonblocking/unqualified.
- No product clarification requested; technical gates must be closed by executable evidence, not reduced AC1–12/CUT1–5 scope. This documentation continuation supplies no runtime evidence.
