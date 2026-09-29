---
title: "Object-only commit message editing and leased publication"
description: "Replace Git panel rebase-based message editing with a tree-preserving DAG rewrite for unpushed and pushed commits."
status: in-progress
priority: P2
effort: unestimated
branch: main
tags: [git, backend, frontend, api, refactor]
created: 2026-09-29
---

# Object-only commit message editing

## Verdict

**Yes.** Object plumbing satisfies local message editing for both unpushed and pushed commits, including old/root/merge ancestry, without checking out files or rewriting the index. A pushed commit's remote message changes only when the rewritten branch is explicitly published. Remote policy can still reject publication; no local algorithm bypasses that.

Replace the current message-edit implementation fully. Keep local editing and publication separate. Use existing git2 raw object storage plus locked single-branch publication; reuse existing authenticated push transport with an exact remote-OID lease. No rebase fallback or automatic push.

## Detailed execution phases

| Phase | Work packages | Status | Progress |
| --- | --- | --- | --- |
| [1. Object rewrite](./phase-01-object-rewrite.md) | Local request/result contract; raw commit DAG engine; locked ref publication; real-filesystem regression coverage | DONE (2026-09-30 00:44:16 +07:00) | 100% |
| [2. Panel and publication](./phase-02-panel-and-publication.md) | Backend preview/leased push; typed transports/hooks; all Git panel/dialog callers; ownership and outcome handling | Pending | 0% |
| [3. Qualification and docs](./phase-03-qualification-and-docs.md) | Integrated API/browser/remote scenarios; full gates; architecture/API/user docs and changelog cutover | Pending | 0% |

**Plan status: IN PROGRESS (1/3 phases; ~33%; updated 2026-09-30 00:44:16 +07:00).** Phase 01's implementation and targeted backend/API gate are complete; Phases 02–03 remain pending.

Use documented file ownership and dependencies for remaining phases. Never give two agents the same file concurrently. Lower-rank agents must follow exact algorithms, DTOs, fixtures and stop gates in the phase files; do not invent fallback behavior.

## Design decisions

- Local edit is offline and permits staged/unstaged/untracked changes. Existing active-operation, branch/reachability, malformed/incomplete graph protections remain.
- Rewrite target plus its affected descendants in captured branch DAG, preserving trees, parent order, author/committer metadata and other messages. Other refs remain unchanged.
- Normalize only a missing terminal LF in submitted message. No-op before signature removal.
- Explicit consent required to remove invalidated signatures. Reject non-UTF-8 target encoding rather than silently corrupting text; preserve unchanged descendant bytes.
- Capture branch/tip, then lock HEAD and branch and recheck before writing only the branch ref. No `reset --soft`, checkout, amend or rebase.
- Enable pushed targets in menu and handler. Cached `isPushed` is informational, not authorization or a publication lease.
- Ordinary Push remains ordinary. Existing forced-publication UI becomes an explicit, snapshot-bound lease workflow; no hidden unconditional force path or unrelated Git-operation policy changes.
- Separate local success from published/stale/rejected/unknown remote outcomes; no automatic local rollback or refreshed-lease retry.

## Source of truth and evidence

- [Proposed architecture and invariants](./architecture.md).
- [Object rewrite research](./research/object-rewrite.md).
- [Git panel/publication research](./research/published-workflow.md).
- [Exercised Git and git2 smoke](./reports/plumbing-smoke.md).
- [Current Git architecture](../../docs/system-architecture.md) and [API](../../docs/api-reference.md).

- Feasibility evidence remains in [the disposable Git/git2 smoke](./reports/plumbing-smoke.md): it covered local object/ref mechanics and a local bare-remote lease, not product authenticated transport.
- **Phase 01 implementation and scoped validation (2026-09-30):** Added the local object-only rewrite engine and paired GET/POST contract. Targeted validation passed **17/17** (16 engine scenarios and one in-process API integration test); `cargo check` and focused rustfmt passed. Cycle 2 review approved **9.8/10**. See the [tester report](../reports/tester-260930-0030-phase-01-object-rewrite-revalidation.md) and [Cycle 2 review](../reports/code-review-260930-0034-phase-01-object-rewrite-cycle-2.md).
- **Evidence boundary:** This is implementation/scoped-test completion, not full qualification. The started-server smoke with registered project and selected `worktreePath`/`root`, browser and authenticated remote scenarios, and several detailed raw-object/signature/CAS failure cases remain unverified; Phase 03 owns integrated qualification. Do not claim the full acceptance matrix passed from the 17 targeted tests.

## Execution constraints

- Phase 01 implementation and targeted backend/API validation are complete; Phase 02 consumes its paired GET snapshot and POST stale-fencing contract.
- Preserve pre-existing changes in `docs/system-architecture.md` and host-resource-sse docs/plan.
- Phase 02 owns Git-panel callers and explicit remote publication; Phase 03 owns integrated qualification and docs after executable proof.
- Follow Rust snake_case and existing TS ownership/transport patterns. No new generic rewrite framework.

## Planning Validation Summary

**Validated:** 2026-09-29. **Questions asked:** 4.

### Confirmed Decisions
- Edit locally; publish separately.
- Preserve original author and committer metadata.
- Require explicit confirmation before removing invalidated signatures.
- Unify all existing Force Push controls under the exact-OID lease workflow.

### Action Items
None: all four choices match the detailed phase contracts; no phase revision needed.

## Unresolved questions

No unresolved product questions. Phase 01 is implemented and has passed its targeted engine/API gate. Actual-server selected-project/worktree/root smoke, browser and authenticated leased-publish scenarios, and remaining raw-object/signature/CAS failure qualification are still required in Phases 02–03; this status is not a full release-qualification claim.
