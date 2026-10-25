# Phase 01 — Editor content integrity: Cycle 1 re-review

**Score: 5/10 — changes requested. Phase 01 remains incomplete.**

Static review of all 16 modified files and supporting lifecycle/tests/plan evidence. Loaded published `code-review/SKILL.md` directly. No product or plan/task-state edits; coordinator owns task tracking. Tests/build not rerun by reviewer; dedicated tester results attributed below.

## C1 / W1–W7 disposition

| Finding | Disposition | Evidence |
|---|---|---|
| C1 — unsafe deferred store reconciliation | Original dynamic-import path removed; attachment fencing still incomplete | `editor.ts:1237-1262`; `MonacoHost.tsx:337-363,518-520`. See C1 below. |
| W1 — retained V2 not synchronized on remount | Direct ready/bound remount path addressed statically | `MonacoHost.tsx:348-363` now issues full didChange. Snapshot/materialization caveat remains W2; real-wrapper/client regression absent. |
| W2 — representation not end-to-end | Partially resolved | CRLF projection now reaches replay/resync/proof consumers, but snapshot source remains raw store rather than materialized model; two-BOM files still diverge. |
| W3 — older work clears rejection / in-flight query survives | **Unresolved** | Rejection does not advance `lastQueuedVersion`; completion still lacks the claimed unsynchronized check. |
| W4 — incorrect pending reservations | Partially resolved | Per-task reservation IDs and per-document maxima improve accounting, but rejection still removes other live tasks' reservations. |
| W5 — error→close disables retry | Addressed statically; targeted regression absent | `semantic-client.ts:638-660` leaves retirement/classification to close. Existing reconnect test still invokes close only. |
| W6 — proof and F1 regression gates | Partially resolved | Real equality assertions added; required matrix and failing-before/real-wrapper save receipts remain absent. |
| W7 — raw projected rangeLength | Addressed | `MonacoHost.tsx:689-707` no longer emits rangeLength. Generic client support is not itself a defect. |

## Critical issues

### C1 — Mount reconciliation still reads stale accepted/dirty state and lacks attachment identity fences

- **Evidence:** `packages/ui/src/components/organisms/MonacoHost.tsx:337-363,518-520`; revision effect `:553-589`.
- The new destructive `setValue` reads closure-captured `effectiveTab` and `semanticEnabled`, but handleMount dependencies contain only input policy, readOnly and tabKey. Content, dirty state, accepted revision and provenance can change without refreshing that closure. Neither reconciliation path validates model URI/incarnation against the current tab before mutation, nor re-reads current accepted/dirty state immediately before applying.
- **Failure/impact:** [INFERENCE] a delayed mount after a same-key clean→dirty/current-content transition can overwrite the current model with the old clean snapshot and clear undo, including with semantics OFF. A revision effect cannot restore a draft once overwritten. Removing the old asynchronous store mutation is a useful improvement, but does not establish the plan's accepted-revision/current-owner/model attachment contract.
- **Confidence:** high for stale closure/missing fences; delayed-mount overwrite not executed in this review.
- **Correction:** one attachment-owned reconciliation routine reading current state, checking accepted revision/content, cleanliness, exact local model URI/incarnation and owner/currentness immediately before mutation. Use current refs/state for delayed mount; retain synthetic suppression. Add delayed-mount clean→dirty and superseded-revision tests with real model changes, not only setValue call assertions.

## Warnings

### W2 — Store projection is still not projection of the materialized model (High)

- **Evidence:** `EditorTabs.tsx:208-214`; `MonacoHost.tsx:199-212,350-362,576-578`; `semantic-client.ts:882-888,1418-1420`; browser materialization check `semantic-navigation.browser.tsx:245-257`; gateway helper `server/src/semantic/uri.rs:458-472`.
- Added EOL projection fixes CRLF consumers, and destination model hashing is now projected. However, `getModelText` still returns `P(currentTab.content)`, while initial open/reconciliation also send store-derived content, not actual `model.getValue()`.
- Concrete two-BOM disk case: TextDecoder leaves one leading U+FEFF in the store; Monaco extracts it, so visible model has no leading U+FEFF. Client open/replay/reconcile sends the remaining store BOM; gateway disk pin strips both. Wire/proof/model therefore disagree in bytes and first-line UTF-16 coordinates. Repeating P cannot fix materialization because P intentionally preserves literal U+FEFF.
- **Confidence:** high; materialization mismatch is demonstrated by the inspected browser test, end-to-end failure not run here.
- **Correction:** use the projected actual materialized model for mounted/retained snapshots; establish an equivalent proven materialization path for genuinely unmaterialized tabs. Preserve literal editor-inserted U+FEFF and unchanged store/save serialization. Explicitly test two-BOM initial open, reload, replay and resync.

### W3 — Version tracking does not fence rejected content; completion check was not implemented (High)

- **Evidence:** `semantic-client.ts:1035-1055,1101-1103,1334-1345`.
- Admitted change queues version N and records `lastQueuedVersion=N`. An immediately following rejected edit sets unsynchronized but does not change the queued-version marker. The older task still matches N and clears unsynchronized. A subsequent query can use its older text.
- The query post-await fence checks incarnation/session/wireVersion only; **it does not recheck `currentModel.wireBinding.unsynchronized`**, contrary to the supplied remediation summary. A rejection does not change wireVersion, so an already-running direct-client query can still return locations.
- **Impact:** F6 remains fail-open at both queue completion and request completion. Monaco's own model-version fence may contain some UI journeys, but does not repair the client contract.
- **Confidence:** high, direct static control-flow evidence.
- **Correction:** advance an independent content/invalidation epoch on every relevant edit/rejection; only the latest successful matching generation may clear eligibility. Recheck eligibility after awaited navigation. Add synchronous admitted→rejected and response-after-rejection cases for Definition and Implementation.

### W4 — Rejection discards reservations belonging to still-runnable tasks (High)

- **Evidence:** `semantic-client.ts:801-859,1037-1043,1048-1058,1060-1069,1094-1105`.
- Normal completion now releases its unique reservation and per-document max accounting avoids the old double count. But rejection still deletes **all** reservations for that tab without cancelling the queued tasks. Those tasks remain runnable and send their admitted snapshots.
- Counterexample, all calls before queued work drains: server A=100/B=100, session cap=1500, document cap=1024; queue A=1000; reject A=1100 (deletes A's pending reservation); queue B=1000 (sees only server A=100 and admits). FIFO sends can then yield A=1000/B=1000, beyond the session cap. Server-side rejection does not satisfy the client admission guarantee.
- **Confidence:** high, static accounting counterexample; not executed here.
- **Correction:** release only the rejected operation's own reservation (none was created here), or explicitly cancel and fence all removed tasks before freeing their budget. Cover this exact non-awaited interleaving and failed-send cleanup.

### W6 — Strengthened assertions still do not close mandatory acceptance gates (High)

- **Evidence:** `semantic-model-uri.test.ts:442-601`; `semantic-navigation.browser.tsx:244-320`; `MonacoHost.semantic.test.tsx:34-36,67-77,179-203`; `editor.test.ts:1256-1309`; tester report `:99-101`; phase plan `:35-45,63-75,232-238`.
- Unit proof now independently applies model and wire edits and directly compares equality across six fixtures. Browser proof now sequentially applies captured real changes and compares actual projected model text. These repair the previous vacuous assertions.
- Missing blocking coverage remains: actual event/projection commutation for CR/LF adjacency, flush/EOL-only, undo/redo, and the complete BOM/EOL/Unicode matrix; complete pinned-source receipt; baseline b031e6a failing-before overwrite receipt and identical repaired real-wrapper reload/edit/save scenario.
- Host test still mocks the wrapper and uses a no-op `setValue`; its no-onChange assertion cannot prove event suppression. Store test still instantiates no model and saves nothing. Neither test establishes visible V2 + projected wire V2 + saved V2+edit.
- F6 tests await operations sequentially (`semantic-client.test.ts:1452-1478,1542-1565`), missing W3/W4's adjacent queues; small re-entry also does not prove mandatory full re-entry above the adaptive threshold. F5 test closes directly (`:1622-1627`), missing error→close and repeated failed recovery attempts.
- **Correction:** keep Phase 01 incomplete. Add targeted queue/error regressions, full representation proof fixtures, real pinned-wrapper/client reload/save controls ON/OFF, and required baseline/integration receipts. Passing current tests does not discharge these gates.

## Suggestions

1. **KISS/DRY:** consolidate mount and accepted-revision reconciliation into one small attachment routine. Keep local edit readiness independent of wire readiness; do not introduce a second retry/state framework.
2. **Allocation:** `project_semantic_text` correctly returns borrowed Cow for LF input, but its production caller immediately calls `.into_owned()` (`server/src/semantic/uri.rs:472,476-492`), allocating another string even for unchanged LF disk text already owned by the gateway. Consider preserving/reusing the owned disk string in the unchanged path, or borrowing through hash/proof construction until ownership is actually needed. The helper alone is zero-allocation, not the whole pin path.
3. **Dead state:** `SocketAttempt.lastError` is assigned at `semantic-client.ts:638-640` but never read. Either use it in existing bounded diagnostics or remove it; error→close classification does not require unused state.
4. **Lifecycle bookkeeping:** `lastQueuedVersion` has no close/disconnect cleanup (`semantic-client.ts:351,1136-1160,1715-1728`). Prefer binding-owned generation state with explicit retirement rather than retaining historical tab keys in a long-lived client.

## Security / architecture assessment

- No new dependency, executable lookup, authorization relaxation, credential persistence or content logging observed in the inspected diff. Existing provenance and socket-attempt isolation retained.
- Terminal auth/policy close classification and release/disable cancellation remain structurally present. Error no longer prematurely retires a retryable connection. Full runtime recovery qualification remains limited to the tester's scope.
- Primary risks are destructive editor integrity (C1) and freshness/resource-bound violations (W2–W4), not a newly identified auth exploit. Server-side caps remain defense in depth, not justification for unsafe client accounting.
- Semantic-only projection is appropriately small; generic SHA remains byte-exact; projected host events omit deprecated rangeLength. Flush/EOL-only events choose a full update instead of guessed ranges.
- Node tuple documentation corrected to 24.16.0 (`docs/architecture/semantic-websocket-gateway.md:427`). Intended-contract labeling remains honest; it must not be promoted to qualification yet.

## Reviewed files

All 16 modified files:
- `docs/architecture/semantic-websocket-gateway.md`
- `docs/semantic-lsp-protocol-guide.md`
- `packages/ui/browser-tests/semantic-navigation.browser.tsx`
- `packages/ui/src/api/semantic-client.ts`
- `packages/ui/src/api/semantic-client.test.ts`
- `packages/ui/src/components/organisms/EditorTabs.tsx`
- `packages/ui/src/components/organisms/MonacoHost.tsx`
- `packages/ui/src/components/organisms/MonacoHost.semantic.test.tsx`
- `packages/ui/src/lib/semantic-model-uri.ts`
- `packages/ui/src/lib/semantic-model-uri.test.ts`
- `packages/ui/src/lib/semantic-monaco.ts`
- `packages/ui/src/stores/editor.ts`
- `packages/ui/src/stores/editor.test.ts`
- `packages/ui/src/stores/semantic-navigation.ts`
- `server/src/semantic/gateway.rs`
- `server/src/semantic/uri.rs`

Supporting: phase/overview plan, prior review, Cycle 1 tester report, README, PDR, code standards, published development rules and review skill. Approximate scope: 1,120 changed lines (+1055/-65) plus lifecycle context.

## Validation commands / results

Reviewer executed only source-inspection commands: `git diff --stat`, scoped production `git diff`, scoped `git diff -- packages/ui/src/api/semantic-client.test.ts`, and read/search tooling. No tests/build/lint rerun; no application/plan changes.

**Dedicated tester-reported, not independently rerun:** `plans/reports/tester-261025-2319-phase01-editor-content-integrity-cycle1.md:40-79`:

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/stores/editor.test.ts src/api/semantic-client.test.ts src/lib/semantic-model-uri.test.ts src/lib/semantic-monaco.test.ts src/stores/semantic-navigation.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx` | Exit 0; 7 files, 103 tests passed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/semantic-navigation.browser.tsx` | Exit 0; 10 Chromium tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; TypeScript compilation |
| `cargo test --manifest-path server/Cargo.toml test_project_disk_text_for_pin` | Exit 0; 1 passed |
| `cargo test --manifest-path server/Cargo.toml --test semantic_websocket` | Exit 0; 11 passed |

Metrics: tester reports 125 passed tests total. Type/test coverage percentages unavailable; lint not executed/reported. No baseline overwrite, full-app reload/save or live-TSLS matrix acceptance result in this evidence. Pinned node_modules source discovery was blocked by configured tool access policy; no new pinned-source verification claimed.

## Recommended disposition

Retain release/acceptance hold. Resolve C1 and W2–W4, then add the missing targeted regressions and required W6 evidence. W1/W5/W7 source fixes are meaningful, but do not make the complete phase acceptable. Task-state reconciliation intentionally left to coordinator under this assignment's no-TODO-tracking constraint.

## Unresolved questions

- Where are the required baseline b031e6a failing-before overwrite receipt, complete pinned-source/matrix proof receipt and identical real-wrapper repaired reload/edit/save receipt? None found in inspected phase/report evidence; tester explicitly excludes them.
- Full-app ON/OFF reload/save, real-TSLS cap re-entry and projected destination reveal remain unmeasured by the supplied Cycle 1 validation. These are evidence prerequisites, not requests for user design decisions.
