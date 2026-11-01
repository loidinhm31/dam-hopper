# Phase 01 — Producer Repair and Deterministic Regressions

## Context and Overview

- Canonical authority: [plan.md](plan.md); priority P2; status pending; estimate 3.5h.
- Owner: one producer integration implementer; coordinator owns final command execution and independent code review. No concurrent writers of this phase's files.
- Existing source: [`omp-session-changes.ts`](../../server/src/agent_status/assets/omp-session-changes.ts); tests: [`omp-session-changes.test.ts`](../../server/tests/omp-session-changes.test.ts).
- Standards: [`docs/code-standards.md`](../../docs/code-standards.md), ownership checks after awaits and Session Changes unknown/read-only invariants; architecture: [`Read-Only Session Changes Review`](../../docs/system-architecture.md#read-only-session-changes-review).
- Supplied PR #82 re-review and accepted Advisor recommendations settle the two repair strategies. Current source confirms the named failure sites. No external research or new dependencies needed.

## Requirements and Scope

1. A uniquely verified A descriptor remains valid through ordinary activation of B, including all result-only chunks; requests retain A's entire identity tuple.
2. The result chain stops before its next request after original-root removal/replacement, tuple mutation, registry reset, tracking disablement or deadline exhaustion. Equal wire tuples do not make replacement objects equivalent.
3. Outstanding ambiguity is always derived from actual pending descriptors, independently of bounded recent history. Recent ambiguity still blocks an agentless duplicate from consuming a surviving descriptor.
4. Pending descriptors, consumed tombstones and recent ambiguity history each remain at or below `MAX_PENDING_CALLS`; reset clears all three and existing root/lineage state.
5. Reset invalidates async work from the old registry lifecycle even if session IDs, wire tuples and ordinary generation values are reused. Module-shared producers see the same epoch and bounds.
6. Preserve matching/rebasing, unsupported-tool behavior, pre-edit capture semantics, original attempt IDs, fail-open error handling, request-size/path limits, private loopback transport and Agent Status separation.

Non-goals: no Rust/backend protocol changes, new reporter connections, generalized lifecycle framework, capture retries, remote reads/scans, eager comparison, UI or deployment refactor. Keep changes in existing files despite their current size; file splitting is not necessary to remediate either finding.

## Key Insights and Design Decisions

### Verified result ownership

- `pendingCalls` already stores the authoritative root tuple; `handleToolResult` consumes a unique matching descriptor synchronously before its first await. Preserve that ordering and duplicate behavior.
- `globalGeneration` describes active registration/switch activity, not the lifetime of retained roots. Continuing to compare it would still fail the paused-chunk switch test even after removing only `activeSessionId`.
- After the initial descriptor/root validation, bind `const originalRoot = root` and copy tuple values from the validated descriptor/registration into immutable locals. Do not compare an object field with itself after it may have mutated.
- Use a small method-local validity predicate or equally simple inline checks. It must compare map object identity plus all captured tuple values, including OMP session ID, reset epoch and disabled flags. Avoid a new general helper/service unless the identical reset guard genuinely needs reuse.
- At each iteration, re-evaluate validity and remaining total budget immediately before invoking `postJson`. After that await, repeat validity and budget checks before handling response state or continuing. Use the same `resultStartTime`; never reset the deadline per chunk or after a switch.
- Keep payload identity immutable throughout the loop. Never re-resolve from context/active root between requests. Root removal, eviction by `MAX_RETAINED_ROOTS`, replacement with identical strings and in-place tuple mutation all invalidate this chain.
- Preserve existing `unproven` mode and request construction. Result-only discoveries never obtain pre-edit originals. A post-await deadline expiry stops further requests but does not retract an already-dispatched chunk.

### Two ambiguity scopes

- Remove `sharedAmbiguousCalls`, its producer getter, references and lifetime wording completely; no alias/re-export/deprecation shim. Replace with registry-owned `ambiguousCallHistory` and matching producer access only where needed.
- Detect collision when admitting a new distinct authoritative descriptor whose `toolCallId` already exists in another pending descriptor. Keep the existing duplicate-authoritative-key early return. Record the collision before capacity eviction can erase evidence of the overlap.
- Refresh history recency by deleting an existing ID and re-adding it; before adding a new ID at capacity, remove the oldest set entry. No second unbounded index, timer, reference-count table or background pruning.
- Agentless lookup scans the bounded `pendingCalls` map, keeps one match and a count, and can stop at the second match. Reject zero or two-plus matches regardless of history. Exactly one match additionally requires absence from `ambiguousCallHistory`.
- Explicit-agent lookup continues requiring exactly one matching `(agentId, toolCallId)` across sessions. Do not allow bounded history to reject otherwise unambiguous explicit-agent results.
- Keep history after explicit consumption so a recent agentless duplicate cannot take the remaining descriptor. Only bounded eviction or `clear()` retires history; individual result consumption must not silently delete it.
- Lookup is O(`MAX_PENDING_CALLS`) with constant auxiliary storage for the agentless path; each retained set/map has an explicit 128-entry cap. Do not use match arrays or copies just to derive live ambiguity.
- Historical eviction is deliberately finite: with one descriptor and an evicted collision marker, agentless lookup may again qualify. Do not claim permanent collision memory; do not confuse this with the unconditional rejection while two descriptors remain outstanding.

### Reset epoch and ABA

- Add an instance-owned monotonic `registryEpoch` (readable by producers, advanced only by `clear()`), distinct from active-session `globalGeneration`. Increment it before clearing state; never assign it zero again during reset. It is local lifecycle state, not a wire field.
- Extend `clear()` to empty `consumedCallKeys` and `ambiguousCallHistory`; preserve existing map clearing and initial active/disabled defaults. Keeping ordinary generation reset is safe only because reset epoch is also checked at every relevant async publication site.
- Capture the epoch at `registerSession` entry and require equality after awaiting `/register`, in addition to its existing registration-generation/active-session guards. This prevents a pre-clear registration from returning after a new same-ID registration recreates equal ordinary generation values.
- Capture the epoch for verified result delivery and include it in both sides of every result-chunk await. Object identity also prevents removal/replacement ABA without a full reset.
- Audit existing async state writers **within this producer only**: `postJson`'s 503 global latch, pre-edit response handling, invalidation flushing, and settled handling. Add the narrow epoch fence wherever a pre-clear await could otherwise mutate shared new-lifecycle state or issue follow-on requests. In particular, stale `postJson` responses must not set the new lifecycle's permanent-disable flag, and caller-level 503 handling must not set it again after an epoch mismatch.
- Preserve existing active-switch behavior outside verified results; adding reset checks is not authority to remove pre-edit/flush switch fencing. Stop stale chains at epoch mismatch; release only their original reservation object, never clean up a newly registered replacement root.
- Do not claim to cancel a request already in flight, to identify an arbitrary newly delivered external event with no epoch information, or to retain unbounded call-ID reuse history. Epoch protects local async continuations; exact descriptor keys and existing event identity remain the ingress contract.

## Related Code Files and Ordered Changes

Project root for all paths: `/home/loidinh/WS/dam-hopper`.

| Action | Project-relative file | Change |
| --- | --- | --- |
| Modify | `server/src/agent_status/assets/omp-session-changes.ts` | Registry history/cleanup/reset epoch; migrate collision writers/readers/getter; original-root result fences; narrow reset fences in existing async state writers. |
| Modify | `server/tests/omp-session-changes.test.ts` | Permanent deterministic regression fixtures and all cases below; reuse Bun HTTP and isolated-registry conventions. |
| None | `server/src/agent_status/assets/omp-agent-status.ts` | Compile/test compatibility only; do not edit. |
| None | `server/tests/omp-agent-status.test.ts` | Existing regression suite only; do not edit. |

### Task `repair-producer-lifecycle`

1. Review the captured contracts against current source before editing, especially registry `clear`, `registerSession`, `handleToolCall`, `handleToolResult`, `postJson`, flush/settled and shutdown. Escalate if another writable file is genuinely required.
2. Add monotonic reset epoch and cleanup; apply required narrow reset fences to async continuations, retaining unrelated switch behavior.
3. Replace lifetime ambiguity with bounded history plus dynamic outstanding lookup. Migrate every reference and stale comment; preserve structured-key consumption and consumed-set bounds.
4. Replace result-loop ambient generation/active-session guards with captured original-root object/tuple/epoch/disabled/deadline checks, before each request and after each await.
5. Add deterministic tests below in the existing suite; no temporary product hooks or new public testing API. Reuse a small test-local deferred gate and request recorder if it reduces duplication.
6. After source/tests are coherent, hand them to coordinator for the single build/test/smoke/review lane below. Repair only scoped failures under implementation authority; record first failures and new evidence rather than hiding retries.

## Deterministic Verification Matrix

All new cases exercise real `SessionChangesProducer`/registry logic. Use isolated registry instances and a local `Bun.serve({ hostname: "127.0.0.1", port: 0 })` peer or an injected fetch collaborator for deterministic non-network boundaries. Boundary peers do not claim actual Rust service or installed OMP qualification.

| ID | Scenario and fixture | Independent observable oracle / wrong fix rejected |
| --- | --- | --- |
| R1 | Register A, begin an AST edit with glob-only input (no pre-edit captures), switch to B through `handleSessionSwitch`, then deliver A's concrete result list. Use unique, valid long nested paths (each under existing path length/depth limits), fewer than 500 paths, whose combined UTF-8 JSON exceeds 12 KiB and forces at least two chunks. | Record unproven `/capture` bodies; assert request count >=2, flattened posted paths equal the independently constructed complete path set exactly once, every tuple names A, modes remain unproven, and B receives no discovered path. This rejects first-chunk-only delivery and weak local-set-only assertions. |
| R2 | Start A's multi-chunk result while A is active. Await a signal that the peer received chunk 1 and pause its response; switch/register B, release response, await result completion. | Chunk 2 and any later chunks still post every expected path to A with unchanged tuple. This rejects leaving `globalGeneration` in the loop after deleting only `activeSessionId`. |
| R3 | Pause chunk 1 as in R2; call session A shutdown/removal, release response. | Exactly the already-dispatched first request; no chunk 2, no B/replacement path mutation. Exercise direct registry removal or retained-root eviction as an equivalent invalidation boundary where practical. |
| R4 | Pause chunk 1; replace the registry map entry with a **new object** having exactly A's original tuple, then release. | No chunk 2 and replacement sets remain untouched. This rejects tuple-only revalidation and proves strict object identity. |
| R5 | Parameterize pause then mutate server epoch, terminal incarnation, root ID or baseline ID **on the same original object**; release. Also cover OMP identity mutation. | No chunk 2 and no request using the changed tuple. This rejects identity-only fences that miss in-place invalidation. |
| R6 | Pause chunk 1, `clear()`, reinsert the very same original object with equal tuple/ordinary generation, release. | Reset epoch strictly advanced; no chunk 2. This isolates epoch protection rather than passing solely because object identity changed. |
| R7 | Pause chunk 1; set `root.disabled` or permanent tracking disablement, then release. Separately return current-lifecycle HTTP 503 from chunk 1. | No chunk 2; current-lifecycle 503 keeps tracking disabled and hooks return normally. Also start with disabled root to prove zero requests. |
| R8 | Control `performance.now` through test-local spying/restoration, no sleeps: first case starts exhausted; second case advances beyond the original budget while chunk 1 is paused. | Zero requests when already expired; only chunk 1 when it consumes the budget; no new per-chunk budget, no extra request after deadline. Restore any clock replacement in `finally` and avoid concurrent clock-mutating tests. |
| R9 | Hold two distinct authoritative descriptors for target call ID X. Generate more than 128 other collision IDs sequentially using two fixed explicit agents; consume each churn pair explicitly before the next iteration so X's descriptors stay pending and the pending cap is not crossed. Use glob-only calls and empty concrete results to avoid irrelevant network traffic. | Confirm X's history entry really was evicted and both X descriptors still exist; agentless X result posts nothing, mutates neither root, and consumes neither key. This rejects a bounded-history-only implementation and avoids a vacuous test that accidentally evicts X's descriptors. |
| R10 | Collision ID Y within retained history: consume one descriptor explicitly; deliver an agentless duplicate; finally consume the other explicitly. Include a unique agentless control and unknown/missing ID controls. | History rejects duplicate with one pending survivor; explicit second agent still succeeds; unique never-ambiguous call routes correctly; unknown/missing IDs never post. Preserve same-agent/same-call-ID cross-session rejection and duplicate-consumed behavior from existing tests. |
| R11 | At 128 entries then overflow: exercise pending FIFO eviction, consumed tombstone eviction, distinct ambiguity-history insertion and repeat collision recency refresh. Run several history-capacity multiples. | After every relevant admission, each structure is <=128; exact oldest entry is evicted per chosen order; refreshing existing history ID does not enlarge the set. Verify keys retained/removed, not only aggregate size. |
| R12 | Populate roots/lineage/pending/history/consumed state, call `clear()` twice, re-register a session and reuse a formerly consumed key and formerly ambiguous ID. | All maps/sets empty after each clear, active session null and disabled defaults restored, epoch increases each time, new valid key/agentless result is not poisoned by old history/tombstone. New valid operations work, so rejection-only bugs cannot pass. |
| R13 | Pause old `/register`; clear registry and complete a new registration for the same session/agent with repeated ordinary generation and equal wire tuple; release old response. Include old-epoch 503 response while new lifecycle is healthy. | Old registration returns no authoritative replacement; exact new root object remains registered; old 503 cannot permanently disable new lifecycle. Current-epoch registration/503 controls still function. |

For R1–R8, assert actual posted request bodies after awaiting the producer, not just `root.unprovenPaths` (all paths are added there before the first request). Signal request arrival explicitly; do not use arbitrary sleeps or elapsed wall-clock guesses to establish switch/remove ordering. Release deferred responses and stop only owned HTTP servers in `finally` to avoid hanging tests.

## Compile, Tests, Smoke and Review

Future execution, **not run by this plan author**. Coordinator resolves installed test policy first, uses one verification lane after all Phase 01 edits land, records exact commands/results and any failed attempt. No dependency installation or broad unrelated suite is implied.

```bash
build_dir=$(mktemp -d /tmp/dam-hopper-pr82-build.XXXXXX)
bun build --target bun server/src/agent_status/assets/omp-agent-status.ts server/src/agent_status/assets/omp-session-changes.ts --outdir "$build_dir"
bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts
```

- Bun build is the existing producer compilation/bundling gate, not a claim of standalone TypeScript typechecking. Run any additional project-required applicable typecheck only if its configured target actually includes these assets.
- The real loopback tests, including R1/R2 and negative R3/R4, provide scoped producer HTTP smoke: record endpoint/session/path/chunk observations without auth headers, real private paths or tool content. Expected paths are synthetic fixture data.
- Coordinator removes only the generated `build_dir` after evidence capture, records cleanup, and collects independent code review focused on all await fences, ABA, collision history, capacity/order and existing fail-open semantics.
- No real-host, Windows, Tauri, UI or installed OMP claim follows from this suite. Existing unrelated release gates remain open. Do not run full Rust/UI suites for unchanged contracts unless source inspection or project policy requires them.

## Failure Handling, Security and Rollback

- Preserve 1500 ms total budget, loopback URL validation, redirect refusal, token transport and no-store requests. No new logs containing paths, details or credentials.
- Fail open to tool execution on network/parse/timeout errors; do not silently retry undispatched chunks or mark post-edit data as original. Invalidated chains must not mutate the replacement registration or new lifecycle's disabled state.
- If required compilation/tests/review fail, phase is not accepted; repair within owned files or return the exact scope blocker. Do not suppress assertions or increase timing allowances to mask a race.
- Rollback is existing tracking disablement plus an authorized narrow source revert if needed; no destructive Git action, unrelated changes or permanent restoration of unbounded history.

## Durable Task Contract

```evcrate-tasks
[
  {
    "id": "repair-producer-lifecycle",
    "title": "Repair late result chunk ownership, bounded ambiguity and reset ABA safety",
    "blocked_by": [],
    "allowed_files": ["server/src/agent_status/assets/omp-session-changes.ts", "server/tests/omp-session-changes.test.ts"],
    "constraints": [
      "One integration owner modifies both findings and tests; preserve unrelated user edits and serialize overlapping refactor work.",
      "Capture originalRoot, immutable identity tuple and registry reset epoch; check map object identity, tuple, epoch, disabled flags and remaining deadline before and after each result request await. Remove active-session and switch-generation rejection only for verified result delivery.",
      "Replace every sharedAmbiguousCalls reference with bounded recent history plus dynamic outstanding matching; cap history and consumed keys at MAX_PENDING_CALLS, clear both on reset, and never use history eviction to admit a two-descriptor agentless collision.",
      "Registry epoch advances monotonically on clear; guard old registration responses and other existing shared-state writers against post-reset publication, including stale HTTP 503 latches. Do not redesign unrelated switch policies.",
      "Reuse existing chunks, private HTTP protocol, original single deadline, fail-open unknown semantics and structured descriptor consumption; no retries, dependencies, scans, UI or Agent Status edits.",
      "Implementation workers do not run mid-flight checks; coordinator owns one coherent final compile/test/smoke/review lane after this phase's source and test edits land."
    ],
    "acceptance": [
      "R1 and R2 post the independently expected complete multi-chunk path set to retained A despite B activation; no path is attributed to B.",
      "R3 through R8 stop undispatched chunks for removal, equal-tuple replacement, in-place tuple change, reset, disablement and deadline exhaustion, without mutating replacement state.",
      "R9 proves target history eviction while two target descriptors remain pending and agentless lookup still rejects without consumption; R10 preserves recent-history duplicate rejection, explicit-agent routing and unique-call controls.",
      "R11 and R12 verify exact capacity/eviction behavior, recency, complete clear cleanup, strictly increasing epochs and successful new-lifecycle key reuse.",
      "R13 rejects ABA registration replacement and stale reset-era 503 publication while permitting valid current-lifecycle operations; existing producer and Agent Status tests remain intact."
    ],
    "verification": [
      "Coordinator compiles both existing extension assets using bun build --target bun into a uniquely owned temporary output directory; record exact result and clean only that directory.",
      "Coordinator runs bun test server/tests/omp-agent-status.test.ts server/tests/omp-session-changes.test.ts once on the coherent implementation; preserve failures and report exact totals, skips and environment limits.",
      "Use real Bun loopback HTTP request recording and deferred response gates for multi-chunk switch/removal/replacement smoke; verify complete expected paths and exact origin tuples, not only local root sets.",
      "Collect independent code review of object/tuple/epoch fences before and after await, bounded dynamic/history ambiguity, reset cleanup and fail-open compatibility before accepting this task."
    ]
  }
]
```

- [ ] <!-- evcrate-task:repair-producer-lifecycle --> Repair producer lifecycle and verify all deterministic regressions.

## Success Criteria and Next Step

All named behavior assertions, coherent compile/test/loopback smoke and independent review are satisfied with scoped evidence. Then [Phase 02](phase-02-documentation-and-handoff.md) reconciles architecture/changelog and reports only exercised qualification. No task state is created or hydrated by authoring this phase.
