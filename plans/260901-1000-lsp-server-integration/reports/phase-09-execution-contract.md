# Phase 09 execution contract

Status: implementation in progress; qualification not yet passed. Observed evidence and retained failures: [Phase 09 observations](./phase-09-observations.md).

## Authority and evidence

Selected parent: ../plan.md; only Phase 09 selected. All eleven phase files read. Preserve default OFF, admin-only mutations, ordinary authenticated navigation, trusted-workspace restrictions, bundled-only execution, exact Origin policy. Native/Windows/Android remain unqualified. Step 4 explicit user approval precedes finalization or commit.

Phase 01 disposition ledger records G5 simulated/unqualified, G8 STOP, G6 bounded. Historical administrative approvals do not replace observations. Current production launch incompatibility reproduced before changes: pinned Node 24.16.0 invoking TSLS 6.0.2 with production `--tsserver-path=<bundled tsserver>` exits 1: unknown option. Current process fixture uses system Node through a shell wrapper and mock tsserver; it cannot qualify pinned tuple semantics.

## Integration contracts

- Backend lifecycle owner: session/supervisor/child/reaper. Shared immediately observable revocation token; expose token/currentness to gateway owner. Detach under registry lock, no actor-mailbox wait. Revoked startup/backoff/results must terminate. Shutdown success means observed complete-tree cleanup; retain failed/retiring ownership/accounting.
- Gateway owner: semantic gateway/URI/protocol and semantic WS API. Consume exact revocation token at admission, asynchronous completion, queued writer boundary. Fix cancellation/request IDs and writer death. Own G5 server association strategy; disk hash after reply alone insufficient. Coordinate session needs with lifecycle owner before edits to that owner's files. No expanded commands.
- Client owner: semantic-client, semantic-model-uri, semantic-navigation store, their tests. Exact socket attempt identity and settled promises. Own provenance type/API and communicate to editor owner before changing exports. Endpoint/root/actor mismatches cannot read/replay/open/change retained draft source. Same authorized binding reconnect remains supported. Align wire attachment to worktreePath; consume negotiated threshold rather than independent client constant.
- Editor owner: semantic-monaco, MonacoHost, EditorTabs, editor store, browser tests and corresponding unit tests. Per-registration tokens, exact destination target/worktree, no positional key guessing, owned/nonowned/OFF provider coexistence. Integrate client provenance contract; preserve local model/text/undo/view state. G5 reveal requires exact associated destination content, not fresh read alone.
- Packaged qualification owner: release semantic engine inputs/provisioning, tool_profile, new real TSLS/resource suites, deterministic fixtures/generator and scripts/qualify-semantic-navigation.mjs. Verify entire executable tuple payload and licenses/lock/provenance; no runtime package manager/PATH fallback. Build-time pinned retrieval permitted by plan. Test fixture provisioning must not silently substitute tools. Communicate production launch incompatibility to lifecycle owner.
- Main integration: semantic settings/API/current-admin/persistence failure safety and exact git worktree invalidation; real auth matrix; fixed measurement policy and final evidence; compile/runtime validation after parallel implementation settles.

All workers: exclusive file ownership, no build/lint/tests/formatters mid-flight; terminal report with edited files, behavioral changes, validation NOT RUN, open gates/questions. Concise reports; unresolved questions last. Do not mark plan done or claim qualification from static analysis. No commits. Linux x64, pnpm monorepo; shared worktree, bounded process/memory use. Agent terminal result is required before dependent integration.

## Qualification sequencing

First repair prerequisites and reproduce consumer-visible failures. Then regression checks and actual packaged process/browser/auth smoke. Then candidate exploration, freeze measured policy and predeclare final numerical budgets, then fresh repeated final comparisons. No final-run budget changes after failure. Preserve failed aggregates. Absent delegated cgroups means hard mode unavailable/unqualified, not portable failure. Real SQLite and Mongo auth required; no-auth cannot replace authenticated qualification.

## Risk-to-evidence map

| Risk | Existing evidence | Required oracle |
|---|---|---|
| Launch incompatible | actual pinned CLI exit 1 | production owner initializes exact tuple and navigates four extensions |
| Old authority survives prepare | queued actor invalidation only | retained handle, delayed completion, queued output rejected immediately |
| Reap acknowledges early | invalidated shutdown replies before cleanup | actual descendant PIDs absent before acknowledgment |
| Draft disclosed to replacement | labels-only replay | same-label endpoint/root/actor negative cases; same-binding positive replay |
| Handshake A closes B | mutable socket in awaited internals | delayed A failure cannot change B; both connect promises settle |
| Wrong worktree/destination | target.worktree vs worktreePath | distinct root/worktree content and exact destination/open/reveal |
| G5 stale destination | open-version-only snapshot | coordinates associated with exact TSLS destination content/incarnation |
| Duplicate provider | component-only evidence | actual Monaco action owned/nonowned/OFF, no collateral suppression |
| Hook execution | earlier bounded canary | tuple-specific positive controls and no project marker execution |
| Auth/backpressure | incomplete harness | real stores, cutoff/cancel/reap independently of socket delivery |
| Performance overclaim | provisional 64 KiB policy | fixed workloads/budgets, baseline/load, repeated final measurements |

G5 implemented as destination capture/pin/requery with exact content digest, document incarnation/version and source fencing; gateway regressions and authenticated unopened-tab smoke passed. G8 technical coexistence passed real Monaco commands and shipped-web smoke; Phase 10 human visual acceptance remains separate. Hard cgroup mode unavailable/unqualified because the production child adapter is unwired. Owned loopback Mongo is available; complete real-store auth matrices and fixed-method candidate/final comparisons remain open gates.
