# Phase 02 code review

**Score: 3/10 — changes required.** Static review; no runtime/build/test pass claimed. Small modules and explicit projection modes are good, but privacy exclusion, durable unknown outcomes and native-target lifecycle contracts are incomplete. Neither Phase 02 task meets all named acceptance criteria. Plan/task state intentionally unchanged; review-only ownership.

## Critical issues

1. **Recovery read errors fail open for address privacy.** `packages/ui/src/os/persistence.ts:692-699,740-750` catches every recovery read/parse/size error and proceeds with empty suppression. Missing recovery already returns an empty document; these catches therefore hide actual failures. A malformed/blocked recovery read can publish cleared addresses during hydration and write stale addresses back while reporting success. **Correction:** propagate continuity failure, withhold Browser addresses, block durable Browser writes and report notice; preserve corrupt bytes. Confidence: high.

2. **Multi-target window close erases unresolved outcomes.** `browser-window-close-coordinator.ts:57-67,99-102` uses the same operation ID for the window and every target. `browser-close-lifecycle.ts:100-108,145` overwrites and then settles that record; `browser-recovery-store.ts:89-99,105-112` identifies records only by operation ID. First DELETE unknown, second DELETE successful => first unknown marker erased, group association lost, although shell remains unknown. In-flight creates also never join the close group. **Correction:** distinct exact-operation records per target/create, preserve parent group linkage, settle parent only after every child is proven settled; associate pending creates under the locked fresh read. Confidence: high.

3. **Runtime mismatch can authorize destructive DELETE of a retained target.** `browser-close-lifecycle.ts:61-65,110-145` treats incompatible retained runtime as an absent reference, then deletes solely by session ID. `params.runtime` never validates the actual deletion target; coordinator/inventory callers omit it entirely. A retained replacement-runtime target with matching native key can therefore be deleted. **Correction:** validate initiating runtime against fresh exact-session evidence before destructive I/O; mismatches deny I/O, missing reference evidence remains conservative; recheck after awaits. Confidence: high.

## Warnings

1. **Automatic-restore eligibility missing; cleared groups can return.** `browser-recovery-store.ts:92-99,120-130` stages groups even for suppressed owners and consumes without checking suppression or pending/unknown operations. Clear followed by closing a stale live window reinstates saved addresses; a failed close's group is immediately consumable. `browser-recovery-store.test.ts:98-104` explicitly expects consumption while a pending close exists. Enforce suppression at locked group projection/staging and check affected-group blockers during locked consumption; unrelated explicit intents remain allowed. High confidence.

2. **Coordinator reports/removes failure as completion; async callbacks unfenced.** `browser-window-close-coordinator.ts:55-91,99-128,134-138`: initial durable-stage failure swallowed; later exceptions escape the detached async function; only `unknown`, not `rejected`, prevents removal; legacy `.finally` removes even when staging/deletion fails. State callbacks match only window ID/app type, allowing late completion to mutate/remove replacement state. Repeated close before first lock completes also launches duplicate coordinators. Reserve one root-owned close per captured window incarnation, fail before state mutation when staging fails, retain/report rejected or unsettled outcomes, and fence every post-await update. High confidence.

3. **Late-create ownership is optional, not implemented reconciliation.** `browser-create-lifecycle.ts:35-49,58-61,82-97,129-130`: actionSequence unused; in-flight key excludes owner/action; caller params/viewport retained by reference; `onLateCleanup` optional and immediately invoked even after owner changes, then exact promise/session ownership discarded. No durable/root-owned cleanup queue waits for original scope, checks native references/runtime, or joins a staged close group. Settlement errors are swallowed before returning success. Capture immutable intent, retain exact outcomes until adoption/reference-safe cleanup and durable settlement; withhold cleanup on owner mismatch. High confidence.

4. **Inventory attachment races final close; no atomic native-key admission.** `browser-session-inventory.ts:55-65` checks gate before GET only; DELETE can start during GET and returned target is still admitted. List also lacks post-await scope verification; no service performs gated attach/reveal commit. `browser-close-lifecycle.ts:110-126` has an in-flight DELETE map, not the required shared reference-release/attachment critical section; a follower's newly staged operation is not settled when returning another operation's promise. Use one native-key gate for admission commit and reference release/census, fence owner/runtime after waits, settle each follower's exact marker. High confidence.

5. **Malformed Browser data silently dropped or accepted.** `persistence.ts:69-84` discards parser errors, so unsupported/oversized Browser metadata can be overwritten without notice. `browser-persistence.ts:111-152` skips malformed entries and invents blanks instead of rejecting malformed arrays; local session hints survive absent/invalid owner scope (`122-127,162-179`). `browser-recovery-store.ts:44-65` validates only version: missing/non-array collections silently become empty; nested owners/groups/operations/URLs/IDs remain unvalidated. Full-document corruption can erase blockers/suppression or crash later updates. Also the public projector has no output-size check. Add strict shared schema/size validation and visible failure propagation; preserve valid ordinary pages and reject corruption without resetting recovery. High confidence.

6. **Pre-hydration flush can overwrite the loaded session.** `OsShell.tsx:201-214,231-248` gates debounce only. While initial load waits for the shared lock, visibility/pagehide captures the default/current unhydrated store and queues save behind load; that captured snapshot may overwrite stored windows. Deep-link effects are likewise not hydration-gated. Gate every flush/intent publication until hydration, retire obsolete startup completions and surface save failures. High confidence.

7. **Recovery notifications perform no refresh.** `OsShell.tsx:250-256` reads and discards recovery; no cache/notice/suppression state is updated and failures disappear. Update owner-scoped recovery notices after locked reread, including writer-local commits; never rehydrate unrelated OS state. High confidence.

8. **Exact close-status reconciliation absent.** `browser-close-lifecycle.ts:144-164` maps all DELETE errors, including typed exact 404, to unknown. No exact-ID GET reconciliation/check-close path distinguishes closed/404 from running/initializing/closing. Unknown gates are memory-only and not reconstructed from durable operations after reload. Implement exact status reconciliation and restore durable blockers before admission; never infer settlement from list absence. High confidence.

## Suggestions / architecture / performance

- Preserve focused modules, explicit local/portable/import modes, query/hash retention, popup projection exclusion, original-owner API routing and short storage-only locks. No new dependency, backend API or polling framework is needed.
- Keep the fix boring: typed projection/recovery results, exact per-operation records, one native-key critical section, captured immutable owner/action fences. Avoid caller-supplied correctness callbacks as substitutes for lifecycle ownership.
- Remove obsolete `closeBrowserSession`, snapshot/ConnectionRef imports from `window-store.ts`, unused coordinator `win` argument and unnecessary unsafe casts once typed integration is fixed.
- Add deferred regressions for every finding. Current lock test doubles call callbacks immediately and provide no mutual exclusion; use a queued lock fake for unit interleavings plus the planned real two-document cases. Missing authored cases include blocked get/set/lock settlement, malformed recovery, import authority injection through both public imports/exports, simultaneous hidden cross-profile releases, racing attachment, runtime replacement, close-during-create and hydration flush.

## Reviewed files

Base `packages/ui/src/os/`:
- `browser/browser-url-normalization.ts`
- `browser/browser-group-projection.ts`
- `browser/browser-persistence.ts`, `browser/browser-persistence.test.ts`
- `browser/browser-recovery-store.ts`, `browser/browser-recovery-store.test.ts`
- `persistence.ts` (changed branches/callers), `persistence.test.ts` (delta and Browser cases)
- `OsShell.tsx` (changed hydration/save/notification integration)
- `browser/browser-create-lifecycle.ts`, `browser/browser-create-lifecycle.test.ts`
- `browser/browser-close-lifecycle.ts`, `browser/browser-close-lifecycle.test.ts`
- `browser/browser-session-inventory.ts`, `browser/browser-session-inventory.test.ts`
- `browser/browser-window-close-coordinator.ts`, `browser/browser-window-lifecycle.test.ts`
- `window-store.ts` (close integration)

Supporting evidence: phase overview, Phase 02 and normative `design.md` in `plans/261111-0943-browser-native-tabs-session-ux/`; `browser-tab-types.ts`; relevant `browser-owner-scope.ts` and `api/browser-host-client.ts` methods; UI package scripts; README, PDR, code standards, published development rules and code-review skill. Approximately 2,000 source/test lines plus supporting contracts reviewed; not a repository-wide audit.

## Validation commands / results

- `git diff --stat`: exit 0; five tracked files changed at inspection; new Browser modules inspected directly.
- `git diff -- packages/ui/src/os/OsShell.tsx packages/ui/src/os/persistence.ts packages/ui/src/os/window-store.ts`: exit 0; reviewed integration changes.
- `git diff -- packages/ui/src/os/persistence.test.ts`: exit 0; reviewed async migration and added Browser cases.
- Build/typecheck/tests/lint: **not executed by reviewer**; separate validation ownership / phase verification gate. No test coverage percentage, type coverage percentage or lint count measured.
- Main validation after fixes: `pnpm --filter @dam-hopper/ui build`; targeted Vitest for persistence and six new Browser test files; planned Phase 05 independent-document/browser acceptance. Existing authored tests are insufficient evidence for the race/failure contracts above.

## Unresolved questions

None requiring product input. Behavioral failure scenarios above derive from inspected control flow; not dynamically reproduced in this review. Runtime verification remains outstanding.
