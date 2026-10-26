# Phase 08 — Lifecycle Invalidation and Recovery: Cycle 2 Review

## Score: 6/10 — Changes required

Canonical client/model keys and immediate invalidation error mapping are corrected. Timer ownership and callback guards improve cleanup. Immediate authority cutoff, handshake ownership, and exact-target opening remain incomplete; passing existing suites does not establish Phase 08 acceptance.

**Evidence boundary:** Static review of the settled working tree; failure scenarios marked **[INFERENCE]** were not reproduced here. Main reports the stable tree passes 174 tests. This reviewer executed no builds, tests, linters, formatters, browser runs, or temporary probes. Only this report was authored; source, tests, plans and task state intentionally unchanged. Plan acceptance remains with Main.

## Resolution audit

| Item | Disposition | Current evidence |
|---|---|---|
| **C1 — Canonical target key** | **Resolved in the inspected matching paths** | `EditorTabs.tsx:182-199` uses `projectTargetCacheKey(targetRef)`; real tabs use the same discriminator (`editor.ts:625-630`), and `MonacoHost.tsx:195-205` registers it. Root/worktree key formats now agree with lookup/replay equality checks. `EditorTabs.semantic.test.tsx:197-203` asserts `root`, but acquisition and MonacoHost are mocked; no real store/model integration proof. Worktree attachment itself still has a separate defect below. |
| **C2 — Phase-one actor invalidation** | **Partial; acceptance blocker** | `prepare_invalidate_all/project/target` calls `invalidate()` before return (`supervisor.rs:543-602`). Actor processing clears overlays and fails pending replies (`session.rs:395-404`), but the handle awaits enqueue only (`225-227`), not revocation. Successful gateway completions remain unfenced. |
| **W1 — Immediate submission error** | **Resolved narrowly** | `gateway.rs:962-973` maps immediate `SessionError::Invalidated` to `RPC_ERR_AUTH_INVALIDATED` / `-32005`, clearing both ID maps. The existing asynchronous invalidated-response branch also uses `-32005` (`1066-1074`). Successful reconnect/replay/query remains unproven. |
| **W2 — Socket callback identity** | **Partial** | All four installed callbacks compare exact socket identity (`semantic-client.ts:149-186`), including checks after the outer handshake await. Internal handshake continuations/catch still use mutable client-wide resources (`195-250`); see W2 below. |
| **W3 — Monaco opener ownership** | **Partial** | Reset ignores a different scope owner (`semantic-monaco.ts:151-156`), but `EditorTabs.tsx:216` supplies a shared scope key rather than a registration token. Existing opener routing still captures its registering target, takes precedence over the fallback, and the fallback does not reconstruct the full target. |
| **W-C2a — Reconnect timer** | **Resolved in code; timer regression assertion not established** | Timer is `ReturnType<typeof setTimeout> | undefined`, cleared in `connect`, `disconnect`, and before scheduling invalidation recovery (`semantic-client.ts:100,123-125,560-580,784-798`). Invalidation now calls `handleClose()` immediately. The inspected `semantic-client.test.ts:593-651` checks disconnected then calls disconnect; it does not advance the timer or assert no replacement socket. Do not describe timer cancellation or completed recovery as runtime-verified by that test. |

## Critical issues / acceptance blockers

No independently reproduced critical exploit. The following **High-priority authority/security-contract blockers** prevent approval.

### C2 — Enqueued invalidation is not a phase-one authority/result fence

**Confidence: High.** `supervisor.rs:551-555,562-575,587-600` retains the session registry write guard while awaiting bounded actor mailbox sends. `SemanticSessionHandle::invalidate()` only sends a command (`session.rs:225-227`). The actor's command loop cannot process it during `do_initialize()`'s startup wait or crash-restart backoff (`332-362,475-540,902-914`). Later, gateway workers publish successful responses without checking current authority (`gateway.rs:1006-1032`).

**Failure/impact [INFERENCE]:** Prepare can return while the actor still has old overlays/work; an already-resolved success can be emitted after replacement publication regardless of eventual actor invalidation. A full mailbox can also delay phase one while workspace/config mutation authority and the registry write lock are held. This is not a claim of an unbounded deadlock or arbitrary filesystem access; it violates Phase 08's cutoff-before-publication contract (`phase-08...md:31-35,39`).

**Correction:** Revoke an exact shared session/target authority token independently of actor progress before detachment/publication. Check it at retained-handle admission and result delivery, including stale queued output at the writer boundary. Keep actor cancellation and physical reaping outside registry/config critical sections. An acknowledgment alone does not retract a result already delivered to a completion worker.

**Missing oracle:** Retain the original gateway/handle; delay actor work and phase-two reap; assert new commands and delayed/queued successful results cannot survive prepare. `semantic_supervisor.rs:807-849` tests registry detachment/new admission and post-reap state, not those boundaries.

### R1 — C1 exposes the still-open foreign-binding dirty replay risk

**Confidence: High for missing checks in inspected paths; disclosure scenario inferred.** `semantic-client.ts:254-290` selects replay models only by profile/project/target labels. Stable identity has no endpoint/root/actor provenance (`semantic-model-uri.ts:15-34`). `EditorTabs.tsx:201-204` returns tab content without checking `targetAvailable` or its existing `resourceBinding.serverUrl`. `MonacoHost.tsx:185-207` likewise has no availability/resource-binding gate before document open. Editor resource bindings exist (`editor.ts:182-183,616-642`); `reconcileProfileTabs` deliberately excludes dirty tabs (`1616-1635`).

**Failure/impact [INFERENCE]:** A retained dirty model with equal labels can be replayed when the profile points at a different endpoint/root or authenticated actor. Fresh authorization to the new server does not establish permission to upload the old draft. Correcting key equality does not resolve this prior-cycle warning.

**Correction:** Require the captured model's endpoint/root/actor resource identity to match the newly authorized binding before replay/open/change. Keep mismatched drafts local and unavailable until explicit rebind. Add positive same-binding recovery and negative same-label endpoint/root/actor replacement cases. No arbitrary disclosure was exercised in this review.

## Warnings

### W2 — Handshake internals can affect a replacement socket and strand connect callers

**Priority: High. Confidence: High.** `performHandshake()` does not capture a socket/attempt; after awaits it writes `targetId`, status and sends using `this.ws` (`semantic-client.ts:195-238`). Its catch closes whichever socket is current, sets `this.ws = null`, calls `handleClose`, then throws (`239-250`). The outer catch returns when `this.ws !== ws` (`156-157`).

**Failure/impact [INFERENCE]:** With normal asynchronous browser close delivery, an attach/initialize error clears `this.ws` before the outer catch, so the original connect promise is never rejected; the subsequent old close callback is also ignored. If disconnect/reconnect happens before an old handshake rejection continuation executes, its cleanup can close the new socket and publish stale status. The synchronous mock close (`semantic-client.test.ts:39-42`) obscures browser ordering.

**Correction:** Pass an exact attempt/socket through every handshake stage and check it after awaits. Cleanup only that attempt; settle its promise even when retired. Also fence store status publication by exact registered client (`semantic-navigation.ts:213-223`). Test rejected handshake settlement and delayed A cleanup after B reaches ready.

### W3 — Opener ownership/fallback still routes with incomplete or wrong target identity

**Priority: High. Confidence: High for routing; same-scope cleanup requires overlapping/replacement registrations.**

- `ownerId = scopeKey` (`EditorTabs.tsx:216`) is not unique to a pane/effect registration. A later registration of the same scope can still be cleared by the earlier asynchronous reset (`279-282`). Different-scope protection is useful but narrower than the claimed guarantee.
- The primary callback activates an existing destination using captured `targetRef`, not `existingTab.target` (`222-238`); unopened destinations also use captured target and composite `targetScopeKey` for reveal (`241-267`). It returns true before the fallback runs (`semantic-monaco.ts:377-380`).
- The fallback reads `parsedKey[0]` as project when the destination is unregistered (`388-396`), but actual keys begin with `"file"` (`editor.ts:61-84`). Such destinations are normal for unopened files. It also omits worktree even when a registered target key is available (`393-420`).

**Failure/impact [INFERENCE]:** Navigation can activate the wrong target's active-key entry, open a destination under the registering pane's target, or attempt project `file` when no callback handles an unregistered destination. Reveal intent may not match the actual model.

**Correction:** Prefer one owner-independent opener deriving the exact destination target from the actual tab/source model and validated destination metadata. If callbacks remain, use per-registration ownership and preserve surviving registrations. Never infer project from a positional key without its real schema. Test same-scope stale cleanup, cross-profile destinations, and unopened worktree destinations.

### R2 — Worktree client attachment silently requests the project root

**Priority: High. Confidence: High.** Client attach sends `target.worktree` (`semantic-client.ts:199-203`); gateway reads only `target.worktreePath` (`gateway.rs:239-245,277-282`). Additionally, unopened location mapping constructs `ProjectTargetInput` with only profile/project (`semantic-monaco.ts:331-339`).

**Failure/impact [INFERENCE]:** A client/model labelled `worktree:<path>` can attach server semantics to the root, then open an unopened destination as a root tab. Correct C1 equality can make the client discoverable while the actual server filesystem target is wrong.

**Correction:** Use the gateway's existing `worktreePath` contract end to end and preserve worktree through destination URI/opening. Add distinct root/worktree file contents and assert attached target, result URI, opened tab and reveal all remain on the worktree. No compatibility alias is needed.

### R3 — Invalidated actor shutdown/restart semantics weaken reap completion

**Priority: Medium/High. Confidence: High.** The new invalidated branch replies to `Shutdown` before exiting (`session.rs:371-375`); physical cleanup happens afterward in `run()` (`342-367`). `reap_sessions()` awaits that reply as its shutdown operation (`supervisor.rs:611-623`). Child termination handling excludes only `ShuttingDown`, not `Invalidated`, before entering crash restart (`session.rs:814-815,876-914`).

**Failure/impact [INFERENCE]:** Reap can return before an invalidated child's tree teardown completes. A child-exit event processed between invalidate and shutdown can transition the invalidated actor back to crash/restart. This does not prove an orphan; it invalidates treating the reply as observed cleanup completion and can create needless restart work during retirement.

**Correction:** Treat revocation as terminal in child-event/restart paths; acknowledge shutdown only after the owned tree is cleaned up. Cover child exit during the prepare/reap gap and assert actual process disappearance before reap completion.

## Suggestions / architecture and performance

1. **KISS/DRY:** Keep canonical target discriminator and prepare/reap separation. Replace duplicated pane-specific/fallback openers with one exact-target resolver rather than layering more fallback behavior or compatibility aliases.
2. **Avoid needless allocation:** Actor invalidation currently drains requests into a temporary `Vec` solely to iterate/send errors (`session.rs:399-403`); direct drain iteration, as existing cleanup uses, is simpler and allocation-free. Correctness fixes take priority.
3. **Resource accounting:** Detached sessions disappear from aggregate/concurrency/overlay accounting before reap (`supervisor.rs:551-552,587-602,661-676`; admission examines registered sessions at `378-390`). Preserve retiring-resource accounting until physical release to avoid temporary oversubscription during replacement. No measured memory/CPU regression asserted.
4. **Exact task registration:** `spawn_reap_sessions` spawns a second task to register the first (`supervisor.rs:627-640`); shutdown can take the list before registration (`731-735`). Prefer a short synchronous registration or an existing structured owner, not an extra framework.
5. **Coverage priorities:** Real editor-store/model lookup; timer cancellation after release/OFF; completed `-32005` reconnect/full dirty replay/subsequent query; delayed socket callbacks; prepare-before-reap cutoff; multi-owner/worktree navigation; foreign-binding replay denial. Existing unit assertions must not be labelled real authenticated/built-web qualification.

**Positive observations:** No new engine-command escape hatch, source persistence, or origin exception found in reviewed changes. Typed timeout state is simple. Exact callback identity guards and immediate cleanup during invalidation are sound incremental improvements. Gateway immediate error mapping reuses the existing stable lifecycle error rather than adding another recovery protocol.

## Reviewed files

Production, relevant sections:
- `packages/ui/src/api/semantic-client.ts`
- `packages/ui/src/api/client.ts` (target cache-key definition located)
- `packages/ui/src/components/organisms/EditorTabs.tsx`
- `packages/ui/src/components/organisms/MonacoHost.tsx`
- `packages/ui/src/lib/semantic-monaco.ts`
- `packages/ui/src/lib/semantic-model-uri.ts`
- `packages/ui/src/stores/semantic-navigation.ts`
- `packages/ui/src/stores/editor.ts`
- `server/src/semantic/supervisor.rs`
- `server/src/semantic/session.rs`
- `server/src/semantic/gateway.rs`
- `server/src/api/semantic_ws.rs`
- `server/src/api/workspace.rs` (prepare/publication/reap callers located)
- `packages/ui/src/components/pages/WorkspacePage.tsx` (EditorTabs mount sites located; simultaneous layout reachability not established)

Tests: `server/tests/semantic_supervisor.rs`; `packages/ui/src/api/semantic-client.test.ts`; `packages/ui/src/lib/semantic-monaco.test.ts`; `packages/ui/src/components/organisms/EditorTabs.semantic.test.tsx`. Semantic navigation/MonacoHost regression files searched for supporting coverage.

Context: `README.md`; `docs/project-overview-pdr.md:1-83`; `docs/code-standards.md:19-43,90-112`; `plans/260901-1000-lsp-server-integration/{plan.md:38-56,phase-08-lifecycle-invalidation-and-recovery.md:1-116}`; prior reviews `code-reviewer-261023-{2200-phase-08-lifecycle-cycle-1,2230-phase-08-lifecycle}.md`; tester report below. Published development/primary/documentation workflows and code-review skill/verification reference read.

## Validation commands / results

**Executed by reviewer:** `git diff --stat`; scoped `git diff -- packages/ui/src/components/organisms/EditorTabs.tsx packages/ui/src/components/organisms/MonacoHost.tsx packages/ui/src/lib/semantic-monaco.ts packages/ui/src/api/semantic-client.ts server/src/semantic/supervisor.rs server/src/semantic/session.rs server/src/semantic/gateway.rs`; source/test/plan reads and searches. These are static review evidence, not runtime checks.

**Attributed QA evidence, not independently rerun/certified:** `plans/reports/tester-261023-2245-phase-08-lifecycle.md:49-60` reports:

| Command | Reported result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test 'semantic_*'` | 61 passed |
| `pnpm --filter @dam-hopper/ui test src/stores/semantic-navigation.test.ts src/lib/semantic-monaco.test.ts src/lib/semantic-model-uri.test.ts src/api/semantic-client.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx src/components/organisms/EditorStatusBar.test.tsx src/stores/editor.test.ts` | 73 passed |
| `cargo check --manifest-path server/Cargo.toml` | Exit 0 |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | Exit 0 |
| `cargo check --manifest-path server/Cargo.toml --tests` | Exit 0 |
| `cargo test --manifest-path server/Cargo.toml --lib semantic::` | 38 passed |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/semantic-navigation.browser.tsx` | 2 passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; TypeScript compilation, not built-web runtime qualification |

Total reported: **174 passing tests**. Main separately confirms the settled tree passes all 174. Numeric test/type coverage, lint issue count, real invalidation latency and peak resource use not measured here. No new runtime failure asserted.

## Plan completeness

**Incomplete.** Phase 08 explicitly retains partial live-auth/replacement-resource proof and open G5/G8 browser qualification (`phase-08...md:78-87`); parent ledger remains Pending (`plan.md:49`). Those deferred measurements are not implementation defects by themselves. However, checked exact invalidation/replay/cleanup claims are not established while C2/R1/W2/W3 remain. No TODO/status changes made by this review; no implementation authorized.

## Unresolved questions

1. What accepted evidence, if any, exempts exact old-authority cutoff and endpoint/root/actor replay matching? None found in the inspected Phase 08 requirements; treat them as required rather than optional future qualification.
2. Which artifacts will establish live auth/backend-failure/non-reading-socket teardown and actual built-web G5/G8 freshness/coexistence? These remain unexercised by this reviewer and explicitly deferred in the plan.
