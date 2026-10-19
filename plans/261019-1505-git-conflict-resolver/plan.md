---
title: "Git conflict resolver implementation plan"
description: "Deliver a safe shared floating Git resolver with lossless drafts and qualified operation recovery."
status: in-progress
priority: P2
effort: null
branch: main
tags: [feature, frontend, backend, api]
created: 2026-10-19
---

# Git conflict resolver

## Overview and authority

Phase 01 (Feasibility and contract gates) complete. Phase 02 (Conflict discovery and snapshots) administratively closed with accepted deferrals (2026-10-19): bounded conflict inventory (`GET /api/git/{project}/conflicts`) and snapshot read API (`GET /api/git/{project}/conflicts/file`) with non-UTF-8 path protection, custom filter gating, and baseline fingerprinting delivered. Safety gates (coherent snapshot AC8, conversion policy gate, and inventory completeness) remain open pending remediation of accepted deferred items (W1–W4, W6, W7, W12) in Phases 03/05. Writable integration remains blocked pending their qualification. Phases 03–09 remain.

Build one workspace-owned floating resolver for terminal-started merge/rebase/cherry-pick/revert and index conflicts. Immutable sources/base, editable retained result, full reviewed decisions, explicit Apply & stage, separate Continue/Abort, truthful unsupported/partial/unknown outcomes. Initial release qualification requires web and actual Linux-native runtime evidence; Windows-native remains explicitly unqualified until separately tested.

Authority: [validated decisions](#validation-summary), [design contract](./design-contract.md), [acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md), [Git semantics](./research/git-semantics.md), [merge model](./research/merge-model.md), [validation record](./reports/plan-validation.md). The [brainstorm](../reports/brainstorm-261019-1326-git-conflict-resolver.md) remains historical; these decisions supersede its generic qualification scope and closing refusal to plan.

No editor-tab/DiffViewer integration, operation initiation, auto-continue/skip, AI merge, private workbench code, durable draft store, config/hook/signing bypass, resolver commit-message form/adapter, new service or legacy write fallback/compatibility shim. Binary whole-side and delete/modify are required; complex unsupported entries stay visible with handoff. Shared web/native architecture is unchanged.

## Phases — authoritative status table

| # | Phase | Depends on | Implementation | Review | Progress |
| --- | --- | --- | --- | --- | --- |
| 01 | [Feasibility and contract gates](./phase-01-feasibility-and-contract-gates.md) | None | Complete | Complete | 100% |
| 02 | [Conflict discovery and snapshots](./phase-02-conflict-discovery-and-snapshots.md) | 01 | Complete* | Complete* | 100% |
| 03 | [Safe resolution and staging](./phase-03-safe-resolution-and-staging.md) | 02 | Pending | Pending | 0% |
| 04 | [Operation lifecycle](./phase-04-operation-lifecycle.md) | 03 | Pending | Pending | 0% |
| 05 | [Scoped client and drafts](./phase-05-scoped-client-and-drafts.md) | 02–04 | Pending | Pending | 0% |
| 06 | [Merge model and history](./phase-06-merge-model-and-history.md) | 01, 05 | Pending | Pending | 0% |
| 07 | [Floating Monaco surface](./phase-07-floating-monaco-surface.md) | 05–06 | Pending | Pending | 0% |
| 08 | [Workspace integration and cutover](./phase-08-workspace-integration-and-cutover.md) | 03–07 | Pending | Pending | 0% |
| 09 | [Qualification and documentation](./phase-09-qualification-and-documentation.md) | 01–08 | Pending | Pending | 0% |

### Phase 02 closure with accepted deferrals (2026-10-19)

Phase 02 delivered bounded conflict inventory and snapshot read endpoints (`GET /api/git/{project}/conflicts`, `GET /api/git/{project}/conflicts/file`). Test report `plans/reports/tester-261019-2314-phase-02-conflict-discovery-snapshots.md` recorded 9 backend API integration tests (`tests/git_conflict_discovery_api.rs`), 6 conflict unit tests (`server/src/git/conflict.rs`), and 51 UI tests passing.

Cycle-3 review (`plans/reports/code-reviewer-261019-2332-phase-02-conflict-discovery-snapshots-cycle3.md`) identified 6 gate-relevant warnings. User approved administrative closure with these items formally deferred to Phases 03 and 05. The implemented `StateFingerprint` currently covers HEAD OID, active operation string, full index hash, and worktree mtime/size; mid-read `.gitattributes`/config changes and coarse-mtime same-size filesystem modifications remain undetected until W2 lands. Safety gates remain open:
- **Phase 03 safe resolution and staging:**
  - **W1 (read error status mapping):** Map per-descriptor unreadable worktree (`WorktreeKind::Unreadable`), dangling/escaping symlinks (`WorktreeKind::Symlink`), and blob read errors (`StageKind::ReadError`) to truthful descriptors instead of HTTP 5xx/4xx; handle backslash paths consistently.
  - **W2 (attribute and content coherence):** Expand `StateFingerprint` to include effective attributes and config before/after reading, covering both the discovery/detail snapshot window and mutation revalidation; re-hash worktree content across the window to detect coarse-mtime races.
  - **W3 (conversion policy gating):** Expand conversion policy inspection (`text`, `crlf`, `binary`, `diff`, `merge`, `core.autocrlf`, `core.eol`, `core.safecrlf`); gate `ident=true` and `working-tree-encoding` to unsupported before mutation.
  - **W4 (operation roles/limits):** Provide explicit operation, targetRevision, contextual roles, and limits in snapshot DTO.
- **Phase 05 scoped client and drafts:**
  - **W4 (operation roles/limits):** Consume operation context and stage roles in client drafts and UI model.
  - **W6 (offset pagination cursor stability):** Implement server cursor contract binding to last raw path/hash with stale-cursor rejection/restart semantics, and integrate into client pagination.
  - **W12 (UI query and pane binding):** Pass explicit `root` parameter, handle multi-page inventory lookup, bind result pane to conflict drafts, and replace fail-closed `useGitResolve`.
- **Phase 03/05/08 clean cutover:**
  - **W7 (legacy code retirement):** Remove legacy `get_conflicts`, `read_blob_utf8`, `resolve_conflict`, Rust `ConflictFile`, and UI `ConflictFile` as part of coordinated cutover once mutation callers migrate.

*\*Note: Phase 02 is administratively closed with accepted deferrals; safety gates (AC6/AC7, AC8, inventory completeness) remain open until remediated in Phases 03/05.*
## Execution and dependency rules

Execute numbered order by default. Overlap backend and pure model work only after 01 freezes invariants and one integration owner assigns shared `types.rs`, `client.ts`, transport/query and WorkspacePage edits. Each phase states entry artifacts and go/no-go evidence; a failed prerequisite blocks dependents.

Phases 02–05 are an unreleasable coordinated UI/server contract migration until every caller agrees; never deploy an intermediate incompatible API or retain a legacy write fallback/compatibility shim. Phase 08 completes one production renderer/entry path and proves legacy writes fail closed.

Future implementation evidence belongs with this plan's reports; record source fingerprint, commands, versions/platform, fixture and observed state. Proposed source/test paths in phases are not existing modules. Current repository evidence is authoritative over older scout assumptions; repeat reference discovery before export changes.

## Principal gates

- 01: executable imported-result, joint native text/metadata history, byte/conversion, selected-side OID/mode, process and measured-resource proofs. Research alone cannot pass.
- 02–04: coherent bounded snapshots; secure actual root/index/ref mutation; no generic-stage bypass; explicit applied/stale/unsupported/busy/failed-before-write/partial/unknown facts; four real operation lifecycles, configured-editor terminal handoff and post-attempt/post-terminal authoritative refresh.
- 05–08: exact owner/generation/server/root binding; retained memory-only history; no replay/rebind/dirty eviction; aligned public Monaco surface above shell branching; no obsolete marker authority.
- 09: every [AC1–12 and CUT1–5](./acceptance-matrix.md) has real behavior/byte evidence; authenticated production web fixture and actual Linux-native host separately; fresh local captures and explicit human acceptance. Missing required Linux-native/human proof blocks initial release completion; Windows-native qualification is nonblocking and cannot be claimed.

## Validation Summary

**Validated:** 2026-10-19. **Decision topics:** 3; Git-input options explained before final choice.

### Confirmed Decisions
- **API rollout:** coordinated UI/server upgrade; one new contract across every caller, no legacy resolver write fallback, compatibility shim or incompatible intermediate deployment.
- **Commit-message input:** when Continue requires editing, hand off to Git's configured editor in the exact owning repository/worktree terminal; no resolver message form/adapter, handler-launched interactive editor or automatic PTY injection. Preserve hooks/signing and dirty drafts/history; handoff is not completion or proof of zero writes. Authoritative refresh follows each attempted command and terminal return; stale recovery requires fresh explicit review, never automatic replay.
- **Initial platform gate:** authenticated production web + actual Linux Tauri runtime + fresh local full-viewport captures + explicit human ACCEPTED. Windows-native client qualification remains separately Pending, explicitly unqualified and nonblocking; qualify separately before claiming resolver support. This client deferral does not waive shared correctness or applicable supported-server safety.

### Propagation complete
- Overview/access point, all nine affected phases, design/acceptance contracts, supporting research and proposed architecture note now carry these decisions; Phase 01/09 distinguish required web/Linux/human evidence from separately Pending Windows-native qualification.
- [Document verification and historical validation](./reports/plan-validation.md) distinguish this completed documentation reconciliation from Pending/0% implementation and runtime qualification. No product questions or implementation authorization.

## Unresolved technical questions

No product clarification required. Implementation owners must close gates with executable evidence: Phase 01 selects engine/version/license, public history authority, conservative import mapping, lossless byte representation, conversion/hash/path support and safe bounded process/editor detection; 01/09 set measured web/Linux limits and qualify required Linux/human evidence. Windows-native client qualification remains separately Pending/nonblocking/unqualified, not a shared/server-safety waiver. Failure stops dependent work, not silent scope reduction; each phase names owner, scenario, evidence and stop condition.
