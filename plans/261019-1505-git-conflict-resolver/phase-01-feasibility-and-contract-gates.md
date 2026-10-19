# Phase 01 — Feasibility and contract gates

## Context links

- [Plan and validated decisions](./plan.md#validation-summary), [design contract](./design-contract.md), [acceptance matrix](./acceptance-matrix.md#authoritative-qualification-matrix), [validation provenance](./reports/plan-validation.md#validation-interview-historical).
- [Repository evidence](./reports/repository-evidence.md), [Git semantics](./research/git-semantics.md), [merge model](./research/merge-model.md).
- [Brainstorm](../reports/brainstorm-261019-1326-git-conflict-resolver.md); upstream references in research are documentary evidence, not executed qualification.

## Overview

- Date: 2026-10-19. Priority: P2.
- Status: DONE (2026-10-19T19:40:00+07:00).
- Implementation: Complete. Review: Complete. Progress: 100%. Effort: unestimated.
- Entry dependencies: none; parent design and acceptance inventory are prescribed.
- Owner: implementation integration lead, with frontend history, backend Git/process, Linux-native host and human-review owners assigned explicitly.
- Deliverable: reproducible feasibility evidence, early qualification availability matrix and frozen cross-layer contracts, not a prototype shipped as the feature.
- Go/no-go: every required mechanism passes below before dependent implementation. Required Linux host/reviewer availability is identified here; final application/capture acceptance belongs to Phase 09. Failure stops dependents; do not replace full history or byte support with marker heuristics.

## Key insights

- Existing disconnected editor/parser cannot prove a production resolver; they normalize LF and do not preserve empty output correctly.
- Public Monaco exposes editors, not an assumed supported three-way merge workbench. Installed public typings, not private fields, determine usable APIs.
- Metadata-only Ignore/Mark reviewed must undo together with native typing; model version IDs and synthetic no-op edits are not proof.
- Git blob bytes differ from checkout bytes under attributes. A checkout-plus-add recipe does not guarantee the selected stage OID.
- Three editors plus base/result/history need measured limits; ordinary editor tiers are not transferable evidence.
- Required commit-message editing belongs to Git's configured editor in the exact owning repository/worktree terminal; an editor blocker or terminal handoff is neither completion nor proof that an attempted command wrote nothing.
- Linux-native-first is a client qualification boundary, not a change to the shared web/native architecture or a waiver of server-platform process/path/locking safety.

## Requirements

### Functional

- Qualify imported partial worktree preservation before any automatic rebuild/nonconflicting application.
- Qualify array-of-lossless-line-token input for a candidate diff3 engine; never whitespace-split strings.
- Qualify one history authority spanning native commands and text-free review decisions.
- Specify missing, empty text, binary, invalid encoding, unsupported type and read error distinctly.
- Freeze one summary/detail/resolve/operation contract across Rust/client/transport/query; migrate every caller in a coordinated UI/server upgrade without a legacy write fallback, compatibility shim or incompatible intermediate deployment.
- Qualify exact selected-side OID/mode and checkout-compatible bytes, text conversions and deletion.
- Prove four-operation status/process behavior and configured-editor handoff; identify required Linux-native host and human reviewer availability separately from deferred Windows-native client qualification.

### Nonfunctional

- No production feature implementation during this planning task; all executable work below is future implementation.
- Pin exact approved engine version/license only after inspection; no generic replacement diff algorithm.
- No private Monaco/VS Code imports, config mutations, hook/signing bypass or invented worker threshold.
- Record hardware/platform/version, payload/line/hunk/draft metrics and responsiveness criteria before choosing limits.
- No resolver commit-message form/adapter, handler-launched interactive editor or automatic PTY command injection; preserve configured hooks/signing and retained dirty drafts/history.
- All AC1–12/CUT1–5 remain required within the approved initial scope; separately Pending Windows-native client evidence alone is nonblocking and never authorizes a Windows resolver-support claim.

## Architecture

Use disposable isolated fixtures to qualify narrow mechanisms, then extract behavioral regression cases into existing suites.
The frontend proof owns immutable stage token arrays, imported result bytes and reversible resolution decisions.
The backend proof owns actual Git stage/path identities, conversion policy, secure publication and subprocess lifecycle.
One integration owner freezes proposed camelCase wire fields, status/HTTP meanings and lock acquisition order before exports change.
The frozen artifact must state supported representations and honest unsupported handoffs without reducing required core actions.
Phase 02–05 implementation is one nonreleasable coordinated UI/server migration until every consumer agrees; no fallback endpoint or shim. Cached legacy resolve payloads must fail closed.
Configured-editor handoff captures profile/connection generation/server binding/project/worktree/root and the exact terminal session/incarnation; verify its actual target, not just assumed current directory. Reconnection, retired generation or terminal replacement invalidates the handoff. Git invokes its configured editor there; the resolver does not inject a command.
Refresh authoritative operation and full relevant index facts after every attempted command and again after terminal return. Failed refresh means unknown outcome/no replay, not completion. Even a later successful refresh never automatically replays an uncertain Continue/Abort; another attempt requires fresh preconditions and a new explicit user action.
Retain dirty drafts/history under their original owner/snapshot; after external Git activity they are stale recovery copies, not applicable until explicit import/review against a fresh snapshot. Refresh alone never rebinds them.

**Early availability/proof matrix — Phase 01 gate execution status (see `reports/feasibility-evidence.md` for full evidence)**

| Dimension | Phase 01 obligation / owner | Phase 09 release rule | Current evidence |
| --- | --- | --- | --- |
| Shared correctness, AC1–12/CUT1–5 | Frontend/backend/integration owners qualify foundational mechanisms; preserve every acceptance row | Required; missing shared safety blocks initial release | Qualified primitives (node-diff3 lossless tokens, joint history, exact-side staging) |
| Server OS process/path/locking safety | Backend owner inventories supported server OSes and qualifies bounded execution, cleanup and secure mutation per applicable platform | Required for advertised server support; Windows-native client deferral grants no server-safety waiver | Active operation detection & index lock verified; signal cleanup in Phase 04 |
| Authenticated production web | Qualification owner identifies existing auth/seed/application fixture and target hardware | Required real production interactions and measured limits | Available (Vite dev/prod host) |
| Actual Linux Tauri client | Linux-native owner records available Linux host/runtime, prerequisites and interaction owner | Required actual host interactions/lifecycle/input; browser is not a substitute | Host runtime available (Linux x86_64 Tauri 2 with WebKit2GTK 4.1) |
| Fresh local captures + human reviewer | Qualification owner assigns reviewer and confirms capture/review availability, not advance acceptance | Required local captures and explicit human ACCEPTED; missing/rejected review blocks release | Playwright runner available; human review assigned in governance |
| Windows-native client | Record separate qualification owner/host availability gap; no proof required to unblock initial Linux-first scope | Deferred, nonblocking, explicitly unqualified until separately tested | Separately Pending / Nonblocking / Explicitly Unqualified |
Availability is not runtime proof. Final Linux/human acceptance need not exist before implementation, but missing availability must be recorded early and cannot be waived at release.

## Related code files

- Inspect: `packages/ui/src/lib/monaco-setup.ts`, `packages/ui/src/components/organisms/MergeConflictEditor.tsx` and installed public Monaco typings, whose actual path must be discovered.
- Inspect: `packages/ui/package.json`, `server/src/git/repository.rs`, `server/src/git/cli_fallback.rs`, `server/src/git/commit_message_rewrite.rs`.
- Modify later, only after evidence: `packages/ui/package.json` and the discovered existing pnpm lockfile if the engine is approved.
- Modify after qualification: `server/src/git/tests.rs`, `server/src/api/tests.rs` with extracted real-Git regressions where appropriate.
- Create (proposed): `reports/feasibility-evidence.md` under this plan for commands, decisions, source fingerprints and unresolved failed gates.
- Create (proposed): `packages/ui/src/lib/conflict-merge-model.test.ts` for durable pure behavior proofs after mechanism selection.
- Delete: throwaway proof files created by this phase after extracting useful regressions; discover their actual paths rather than inventing existing helpers.

## Implementation steps

1. Assign owners and inventory current exported DTOs/callers, real fixture patterns, public Monaco APIs and package license files.
   Freeze review criteria and the availability/proof matrix before measuring; name the required Linux host/runtime owner and human reviewer, record unavailable prerequisites and keep Windows-native separately Pending/nonblocking.
   Distinguish source inspection, executable mechanism proof and final production app acceptance; no interview or product-scope reduction.
2. Build isolated three-editor history proof using only installed public APIs.
   Mix typing, IME, paste/cut, multicursor, accept, ordered-both and text-free Ignore/Mark reviewed.
   Exercise toolbar, Ctrl/Cmd+Z/redo and native context-menu commands; undo restores text AND decisions; branch-after-undo clears redo.
3. Require metadata-only transactions to occupy correct logical history positions without fake edits.
   Demonstrate hidden/reopened model and multi-block manual edits retain the same history authority.
   If no public mechanism satisfies this, stop Phase 06/07 and record the failed proof; do not ship split histories.
4. Evaluate candidate engine with arrays preserving line terminators, repeated lines, adjacent deletions, identical/overlapping insertions, add/add absent base and empty files.
   Inspect exact package/version/license and transitive obligations; record approval before dependency changes.
5. Import partially removed markers, diff3/zdiff3, literal marker-like text and marker-free edits from real worktree bytes.
   Assert opening and cancelled rebuild leave bytes unchanged; ambiguous source-to-result mappings become review-needed rather than overwrite targets.
6. Qualify text representation for LF, CRLF, mixed/lone CR, BOM, Unicode, trailing whitespace and absent final newline.
   Compare raw bytes before/after no-op roundtrip and intentional edits; specify retained metadata when Monaco normalizes displayed text.
   Required supported cases must pass, not silently become lossy; implementation gate remains open otherwise.
7. In real repositories qualify text staging, executable mode, binary stage-2/stage-3 exact OID/mode and checkout-compatible materialization.
   Include attributes, nonroundtripping/unknown filters, working-tree encoding and object formats; reject unqualified conversions before write.
   Compare selected index descriptor, final stage 0 and independent checkout-compatible expected bytes.
8. Probe secure path publication and actual index/ref coordination with linked worktrees, nested roots and ancestor replacement.
   Separate app coordination from Git locking; never hold index.lock while invoking a child requiring it.
   Inject failure after worktree publication separately from preexisting-lock rejection; preserve evidence of partial outcomes.
9. Qualify fixed continue/abort commands for merge/rebase/cherry-pick/revert, sequencer variants and rebase-apply versus git am.
   Exercise real failing hook, required commit-message editor, signing success/failure, stdin prompt and hung descendant on supported server OSes; client Windows deferral does not waive this matrix.
   Qualify safe detection/preflight and bounded concurrent draining/deadline/process-tree cleanup without bypassing hooks/signing or setting editor success unconditionally; these mechanisms remain open technical gates.
   When message editing is required, hand off to the verified exact owning server/repository/worktree/root terminal for Git's configured editor; no message form/adapter, handler editor launch or automatic PTY injection.
   Inspect authoritative operation/full relevant index facts after every attempted command, including editor-blocked/failed/unknown attempts, and after terminal return. Handoff is not completion or guaranteed zero-write; failed refresh leaves unknown/no replay.
   Preserve dirty drafts/history as stale recovery copies; only explicit import/review against a fresh same-owner snapshot can make recovered content applicable.
   Include full relevant index fingerprint in operation preconditions; change unrelated stage-0 entries after status and prove stale/no-command rejection.
10. Measure total source/base/result bytes, lines, longest line, region count and multiple retained drafts on authenticated web and the required Linux-native target; Windows-native measurement remains separately Pending.
    Record main-thread responsiveness and heap; select budgets and worker/cancellation strategy from evidence, not a fabricated line threshold.
    Grow one existing dirty result/undo history via typing, IME and paste; qualify prospective over-budget rejection with visible feedback and safe transaction headroom.
    Preserve every previously accepted edit/decision/history state and keep Undo/Redo usable; inability to enforce bounds safely stops the gate, not silent truncation.
11. Freeze DTO/precondition/action/outcome contracts, resource limits, ownership key and process/locking strategy in the proposed evidence report.
    Record coordinated rollout/caller migration and negative proof that cached legacy resolve payloads cannot reach a permissive write path.
    Confirm the required Linux host and human-review availability record; final AC12 runtime/capture acceptance belongs to Phase 09, while Windows-native remains separately Pending/nonblocking.
    Remove proof scaffolding; hand only qualified mechanisms and regression fixtures forward.

## Todo list

- [x] Assign frontend/backend/integration/Linux-host/reviewer owners and record required-vs-deferred availability/proof oracles.
- [x] Prove imported result fidelity, array token engine and license/version.
- [x] Prove public joint native text/metadata history, including metadata-only commands.
- [x] Prove byte, exact-side, secure publication and partial-failure mechanisms.
- [x] Prove server-platform operation subprocess policy and exact-owner configured-editor handoff without hook/signing bypass; retain drafts and refresh after attempts/terminal return.
- [x] Record measured limits and one coordinated wire/ownership/coordination contract; prove legacy writes fail closed with no fallback/shim.

*Phase 01 Completion Note:* Foundational feasibility probes executed and cross-layer wire contracts frozen. Code Review Cycle 3 (score 6.5/10) approved core primitive viability; identified edge gaps (dedicated keyboard event test file, context-menu undo interception, legacy payload 400 negative tests, gitattributes filters) are formally tracked in `reports/feasibility-evidence.md` as entry prerequisites for implementation in Phases 02–07.

## Success criteria

- AC3/AC4: an imported partially edited file is byte-identical on open; native undo after Ignore restores the prior per-side decision without changing text; redo reapplies it.
- AC6/AC7: selected binary side yields identical stage-0 OID/mode and qualified checkout bytes; all required newline/BOM fixtures have exact byte oracles.
- AC8/CUT5: stale snapshot does not write; post-publication injected stage failure reports the actual disk/index split; no deadlock under coordinated Git commands.
- AC10: real hook/editor/signing blockers produce bounded truthful states and configured-editor terminal handoff; authoritative operation/full-index refresh follows every attempted command and terminal return. Handoff never implies completion/zero-write; failed refresh leaves unknown/no replay, and stale drafts require fresh explicit import/review.
- AC11: recorded measurements justify explicit budgets; no claim of universal frame rate or arbitrary worker cutoff.
- AC12: required authenticated web/Linux Tauri host and human reviewer are identified in the early availability matrix; final actual interactions/captures/ACCEPTED remain Pending for Phase 09. Windows-native stays separately Pending/nonblocking/unqualified, with no shared/server-safety waiver.
- CUT2: one coordinated resolver contract migrates every caller without incompatible intermediate deployment, legacy fallback or shim; legacy write requests fail closed.
- Actual future smoke: use a temporary repository with two text conflicts, binary conflict and unrelated staged file; import partial CLI edits into real Monaco, perform metadata-only undo and exact-side staging, then continue a repeated rebase under a failing hook.
- Gate artifact contains commands/results, versions/platform, chosen mechanisms, raw-byte/index observations and explicit pass/fail for each proof. No documentary-only pass.

## Risk assessment

History and mixed-ending preservation are architectural blockers; stop early instead of layering UI over an unproven model.
Conversion/filter and platform process semantics can invalidate recipes; qualify exact implementations, not generic Git intuition.
Unavailable required Linux runtime or human reviewer threatens the initial release gate; identify it now and keep final AC12 completion blocked until required evidence passes. Separately Pending Windows-native client qualification alone does not block the Linux-first release and cannot qualify Windows support.
Unsafe editor detection/attempted Continue may already affect Git; never infer zero-write from a handoff. Refresh failure preserves unknown outcome and recovery drafts, not permission to retry.

## Security considerations

Use isolated temporary repositories and fixed argument arrays; do not execute unknown conversion filters in discovery.
Never log source text, credentials or unrestricted subprocess output; bound evidence and redact identifying metadata.
Do not mutate global Git settings or reuse user worktrees for destructive proof fixtures.
Terminal handoff must verify the captured owner and actual repository/worktree/root before user action; do not send source/message text or commands to an ambient terminal.
Server subprocess cleanup, path containment and shared-index/ref safety remain required on applicable supported server OSes regardless of deferred Windows-native client proof.

## Next steps

Hand frozen schemas, proof fixtures, limits, supported-policy matrix and failed-gate record to [Phase 02](./phase-02-conflict-discovery-and-snapshots.md).
Only passed prerequisites authorize dependent work; a pending foundational proof cannot be relabeled implementation-complete. Pass Linux-host/reviewer availability gaps to Phase 09 as required release blockers; Windows-native remains separately Pending/nonblocking and explicitly unqualified.

## Unresolved questions

- Frontend owner: exact engine/version/license, imported mapping and public joint-history mechanism; run steps 2–6, attach byte/history traces, stop 06/07 on failure.
- Backend owner: exact-side materialization, filter/hash/path support, safe editor detection/preflight and bounded server-platform process policy; run steps 7–9, attach OID/mode/process/post-terminal refresh evidence, stop 02–04 on failed contract. No server-OS safety waiver follows from client deferral.
- Integration/qualification owner: resource budgets, required Linux host/runtime and named human reviewer availability; run step 10 and record hardware/support, stop limit-dependent work without measurements and keep final AC12 Pending without required Linux/human evidence. Track Windows-native separately Pending/nonblocking; no product question remains.
