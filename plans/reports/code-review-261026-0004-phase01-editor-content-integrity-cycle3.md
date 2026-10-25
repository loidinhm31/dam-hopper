# Phase 01 — Editor content integrity: Cycle 3 re-review

**Score: 7/10 — changes requested; Phase 01 acceptance remains open.**

## Scope

Reviewed all 16 modified files, supporting attachment/replay/queue/proof consumers, Phase 01 requirements, Cycle 2 findings and Cycle 3 tester evidence. Approximately 1,242 changed lines (+1164/-78), plus relevant surrounding code. Published `code-review/SKILL.md` and review/verification references read directly. No product edits, verification reruns or plan/task-state updates; coordinator owns tracking under this assignment.

## C1 / W1–W7 disposition

| Finding | Disposition | Evidence |
|---|---|---|
| C1 — stale clean-model attachment | **Addressed statically.** Tab-keyed host, fresh store lookup, URI/dirty guards and attachment-triggered reconciliation close the previously identified cross-tab clean-overwrite path. Real-wrapper save acceptance still missing. | `EditorTabs.tsx:764-766`; `MonacoHost.tsx:343-397,590-595`. |
| W1 — retained V2 not synchronized on remount | **Partially resolved.** Reconciliation now sends the actual projected model, but the mount callback still captures stale semantic enablement. | Warning 1. |
| W2 — raw/materialized representation mismatch | **Unresolved.** Open/reconciliation snapshots improve, but replay/resync/proof still strip a leading literal model BOM a second time. | Warning 2. |
| W3 — rejection/query invalidation | **Partially resolved.** Normal queued completion checks invalidation generation; post-request fence checks unsynchronized. Failed-send fallback bypasses that guarantee and can break FIFO version order. | Warning 3. |
| W4 — pending reservation accounting | **Addressed statically for the reported paths.** Rejection preserves runnable reservations; fallback retains its reservation through send, accounts successful bytes, and releases in finally. Discriminating failure-path regression absent. | `semantic-client.ts:1039-1052,1109-1136`. |
| W5 — browser error→close recovery | **Addressed statically.** Error records lastError without retiring; close consumes it and schedules retryable recovery. Exact error→close/repeated-failure regression absent. | `semantic-client.ts:640-662,1378-1392`. |
| W6 — representation/F1 acceptance evidence | **Incomplete.** Improved assertions are meaningful, not full named acceptance. | Warning 4. |
| W7 — projected rangeLength | **Addressed statically.** Host omits raw rangeLength; flush/EOL-only events select full replacement. | `MonacoHost.tsx:695-713`. |

## Critical issues

**None newly established in the inspected Cycle 3 implementation.** Prior C1 source defect is addressed; this is not a claim that the mandatory original-symptom acceptance journey passed.

## Warnings

### 1. W1 — Latest-callback ref still contains a stale handleMount callback (High)

- **Evidence:** `MonacoHost.tsx:343-385,388-397,551-557,590-595,718`; `EditorTabs.tsx:211-225`; `semantic-client.ts:962-964`.
- `handleMount` calls `reconcileModelWithStore` but omits it from its dependency list. When semantic enablement changes, reconciliation gets a new callback, but handleMount retains the old one. Assigning handleMount to handleMountRef does not refresh that captured callback.
- **Failure trace [INFERENCE; not executed]:** start delayed same-tab attachment with semantics OFF, retained V1, clean accepted V2. Enable semantics before attachment; ready replay reads retained V1 and binds it. Mount executes the stale OFF reconciliation callback: local model becomes V2, no didChange is sent, and reconciledRevisionRef advances. The attachment effect invokes the latest reconciliation callback but skips the already-recorded revision. notifyDidOpen cannot repair the existing binding because it is a no-op when already bound. Model and wire can remain different until another edit.
- **Impact:** F1's local correction is preserved, but semantic-provider eligibility can still refer to stale V1. **Confidence: high** for callback/dependency gap; full interleaving not executed.
- **Correction:** include reconcileModelWithStore in handleMount dependencies or dispatch reconciliation through its own current ref. Ensure actual attachment's accepted model snapshot enters the existing document queue even if already bound. Regress OFF→ON during delayed same-key mount with ready V1 replay and accepted V2.
- Published exact-version [wrapper 4.7.0 source](https://github.com/suren-atoyan/monaco-react/blob/v4.7.0/src/Editor/Editor.tsx) confirms initial onMount ref retention. The added forwarding ref handles that wrapper behavior, but not the inner stale useCallback closure.

### 2. W2 — Replay, resync and destination validation still rematerialize model text (High)

- **Evidence:** `EditorTabs.tsx:211-225`; `semantic-client.ts:884-890,1216,1430-1432`; `semantic-monaco.ts:199-213`; `semantic-model-uri.ts:146-167`.
- getModelText now returns projected actual model text, or projected materialized raw-store fallback. replayMatchingModels and resyncDocument apply projectMaterializedText again. validateDestination receives destinationModel.getValue(), yet also applies projectMaterializedText.
- **Concrete counterexample [INFERENCE from direct transformation]:** insert literal leading U+FEFF into an existing model. Ordinary onChange sends P(model), retaining U+FEFF. Reconnect/resync removes it; an existing-destination proof hashes text without it. For three disk BOMs, the decoder and Monaco consume two; getter preserves the remaining literal BOM, then replay wrongly consumes the third. Pinned model construction is not permission to rematerialize model reads.
- **Impact:** wire/digest/first-line UTF-16 coordinates diverge from the visible model; valid destinations are rejected or the overlay represents different text. **Confidence: high.**
- **Correction:** document getModelText as already projected/materialized semantic text; do not strip BOM again in replay/resync. validateDestination needs P(content), not raw-store materialization. Keep projectMaterializedText only at genuinely raw accepted-store fallback boundaries. Add literal inserted leading BOM across replay/resync/proof, two-BOM initial/reload, and remaining-literal-BOM controls.

### 3. W3 — Failed-send fallback can erase newer invalidation and send versions out of order (High)

- **Evidence:** `semantic-client.ts:1039-1055,1093-1136`; registry version allocation `semantic-model-uri.ts:487-492`.
- Normal completion checks taskInvalidationGen, but catch unconditionally advances binding.invalidationGen, allocates a fresh version and clears unsynchronized based only on lastQueuedVersion. It does not preserve the captured generation fence or check that model.wireBinding is still binding.
- **Rejection trace [INFERENCE; not executed]:** admit T1; reject a newer over-cap model before T1's queued send executes; T1 send throws once; fallback sends T1's older admissible snapshot. Catch overwrites the rejection generation and clears unsynchronized. Queries become eligible although the current model remains the rejected newer text.
- **FIFO trace [INFERENCE; not executed]:** queue T1=v2 and T2=v3. T1 send throws; fallback bumps the shared binding to v4 and sends T1 at v4. T2 then sends its captured v3. Fallback already set unsynchronized=false; T2's conditional completion does not set it back to true. Server can retain T1/v4 while the client's current model contains T2 and its binding also reports v4. Query version fencing no longer proves matching content.
- **Impact:** F6 stale-navigation and monotonic-version guarantees remain broken on the required send-failure path. **Confidence: high** for conditional control flow; browser transport failure injection not executed.
- **Correction:** keep fallback under the same binding/currentness/invalidation ownership as normal queued work; older work cannot clear a later rejection. Make fallback and later queued sends use monotonically ordered versions, rebasing or retiring already-queued work as needed. Prefer the existing single document-queue owner rather than another resync abstraction. Regress both traces with a send-throws-once transport and assert final overlay text, ordered versions and query eligibility.

### 4. W6 — Green scoped commands do not discharge mandatory acceptance (High)

- **Evidence:** Phase 01 `:35-45,63-75,155-170,232-239`; `semantic-model-uri.test.ts:406-440,442-635`; `semantic-navigation.browser.tsx:244-320`; `MonacoHost.semantic.test.tsx:34-36,67-94,195-223`; `editor.test.ts:1256-1310`; Cycle 3 tester report `:96-102`.
- Unit proof now compares independently applied model/wire results exactly; browser proof applies actual captured descending multi-edits sequentially; host setValue mock triggers onChange so suppression is actually checked. These improvements deserve credit.
- Still absent: verified baseline b031e6a failing-before overwrite receipt; identical repaired real pinned wrapper/client reload→edit→save with independent visible V2/store/saved V2+edit/wire P(V2) assertions; semantic ON/OFF and BOM/EOL save controls; complete real-event fixture matrix and live-TSLS navigation/reveal evidence.
- The unit case named “Undo/redo commutation cycle” applies one ordinary replacement, not undo or redo. “EOL delimiter change” is a text replacement, not a Monaco EOL-only event. Browser additions cover one BOM construction and CRLF two-edit application, not the complete matrix. Store tests create no model/undo stack and save nothing.
- Client additions await edits sequentially. They do not exercise adjacent admitted→rejected work, rejection during an in-flight query, retained pending reservations, send-error fallback or exact error→close recovery. Re-entry text is below its 128-byte threshold, so full replacement would happen without the unsynchronized branch; the required above-threshold 70 KiB recovery is not discriminated.
- **Impact:** original F1 symptom and named F5/F6/F7 failure paths remain unqualified. **Confidence: high** for inspected coverage/report gaps.
- **Correction:** retain acceptance hold and collect the plan's specified receipts plus discriminating regressions. Broader unrelated testing or a new framework is not required.

## Suggestions

1. **Avoidable Rust allocation remains:** uri.rs now returns Cow and borrows LF-only input, but `gateway.rs:1743-1749` immediately calls into_owned on borrowed input although the original disk String is already owned. This copies it before the additional pin/provenance ownership clone. Reuse the original String when projection is unchanged; allocate only for transformation or genuinely independent ownership.
2. **Retire dead bookkeeping/imports:** `lastQueuedVersion` keeps tab keys after notifyDidClose and attempt retirement (`semantic-client.ts:352,472-545,1147-1172`). Retire entries with their binding, or keep the scalar on the binding. projectSemanticText in semantic-client.ts and buildLocalModelUri in editor.ts are unused imports. lastError is now consumed and the typed reconnect getter is an improvement.
3. **Documentation precision:** `semantic-websocket-gateway.md:410` / `semantic-lsp-protocol-guide.md:464` say reservations release on rejection/error. Distinguish the rejected operation's nonexistent/new reservation from older runnable reservations, which must survive, and retain a fallback's reservation until its own send completes. Current proposed wording can recreate W4.
4. **KISS/DRY:** keep one reconciliation owner and one per-document queue. Repair stale callback, snapshot input and failure/version boundaries directly; no generic normalization, retry or lifecycle framework. The existing full-resync path and catch fallback should not implement contradictory synchronization rules.

## Security / performance / architecture

- No new dependency, executable lookup, auth relaxation, credential persistence or content logging observed in this delta. Existing provenance/attempt isolation and terminal 1008/4401/4403 handling remain. Store release/disable guards cancel recovery authority.
- Principal remaining risks: semantic content integrity and stale-navigation eligibility, not a newly established authentication exploit. Client admission/freshness must hold independently of server defense in depth.
- Tab-local accepted revision, dirty guard, semantic-only EOL projection and unchanged generic hashes fit the architecture. Keyed attachment and synchronous fresh-store reconciliation improve core editor safety without making local editing depend on socket availability.
- Reservation maximum accounting is conservative across queued snapshots. Cow improves the helper API but does not yet remove the production LF allocation. No performance measurements were supplied for these changes.
- Proposed-contract labeling remains honest; documentation now states Node 24.16.0 correctly. A complete phase claim would not be justified.

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

Supporting: README, PDR, code standards, Phase 01/overview, Cycle 2 review, Cycle 3 tester report, UI manifest/lockfile, monaco-setup.ts, Monaco patch, published review/development guidance and exact-version published wrapper source. No plan updated under the delegated no-tracking constraint.

## Validation commands / results

Reviewer executed source-inspection commands only: `git diff --stat`, scoped `git diff`, read/grep/glob and exact-version source retrieval. No builds/tests/lint rerun; dedicated tester owns execution.

**Dedicated tester-reported; not independently rerun** — `plans/reports/tester-261026-0002-phase01-editor-content-integrity-cycle3.md:40-79`:

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/stores/editor.test.ts src/api/semantic-client.test.ts src/lib/semantic-model-uri.test.ts src/lib/semantic-monaco.test.ts src/stores/semantic-navigation.test.ts src/components/organisms/MonacoHost.semantic.test.tsx src/components/organisms/EditorTabs.semantic.test.tsx` | Exit 0; 7 files, 103 passed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/semantic-navigation.browser.tsx` | Exit 0; 10 Chromium tests passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; TypeScript compilation |
| `cargo test --manifest-path server/Cargo.toml test_project_disk_text_for_pin` | Exit 0; 1 passed |
| `cargo test --manifest-path server/Cargo.toml --test semantic_websocket` | Exit 0; 11 passed |

125 selected tests reported passed. Type/test-coverage percentages unavailable. Lint not executed/reported. Scoped passes do not establish full-app reload/save, baseline overwrite or complete live-TSLS representation acceptance.

## Recommended disposition

Retain acceptance/release hold. Close W1/W2/W3 source gaps, then exercise discriminating failure/interleaving regressions and the required original-symptom/real-wrapper/integration receipts. C1, W4, W5 and W7 source improvements are substantive but not complete Phase 01 qualification.

## Unresolved questions

- Where are the required baseline b031e6a failing-before and identical repaired real-wrapper reload/edit/save artifacts? None supplied in inspected Cycle 3 evidence.
- Complete real-event BOM/EOL/Unicode/undo/flush matrix, live-TSLS navigation/reveal, semantic ON/OFF save controls and above-threshold re-entry remain unmeasured by the supplied command set.
- Installed pinned-source inspection is blocked by configured node_modules access policy. Lockfile, repository patch and exact-version published wrapper source were inspected; installed-source integrity is not claimed. No unresolved user design decision identified.
