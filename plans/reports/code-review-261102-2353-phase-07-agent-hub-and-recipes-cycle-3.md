# Phase 07 Code Review — Cycle 3

## Code Review Summary

**Score: 5/10. Recommendation: block recipe execution acceptance.** Remediation improves several narrow paths, but cross-tab run selection, action-time epoch authority and durable storage safety remain critical. AC7/AC8 implementation and qualification remain incomplete.

Scope: re-review Phase 07 and Cycle 2 findings, especially eight claimed remediations. Applied published `code-review` skill and repository ownership/safety standards. Source-derived race consequences below are **[INFERENCE]**, not runtime reproductions; underlying code omissions are directly inspected. High confidence in findings. Approximately 3,500 scoped source/test lines inspected, plus requirements and prior/current reports. No source, tests, plan or task state changed; this report is the only write. Plan intentionally remains pending.

## Remediation disposition

| Claimed fix | Cycle 3 disposition / evidence |
|---|---|
| Locked reconcile/dismiss/retry reread durable state inside lock | **Narrow fix present.** `launch-records.ts:504-559` loads by launchId inside each callback and persists before release. Broader storage/startup authority still unsafe; C3. |
| Authoritative epoch requires connected + ready + matching generation | **Render-time check present.** `LaunchReview.tsx:46-57`. No action-time/after-await fence; C2. |
| Launch rejects client/profile mismatch | **Present for typed owner-bearing clients.** `recipe-engine.ts:440-453`; new test at `recipe-engine.test.ts:467-495`. Existing record selection also filters profile (`LaunchReview.tsx:62-73`). Same-profile frozen snapshot review remains inconsistent; W2. |
| New Run unknown check under lock | **Not implemented as claimed.** `LaunchReview.tsx:141-174` checks React `hasUnknown` outside any lock, allocates/persists a new record, then calls the engine. Imported `withRecipeLaunchLock` is unused here; C1. |
| Failed retry button | **Rendered and wired.** `LaunchReview.tsx:379-392` supplies the requested test ID and handler. Not browser-regression-tested. |
| agent:focus incarnation fence | **Partial.** `OsShell.tsx:947-962` rejects an observed mismatch, but permits missing/stale proof; Hub Jump bypasses this handler; W3. |
| RecipeEditor initialMode | **Present.** `RecipeEditor.tsx:29-51`; `RecipesApp.tsx:224-269` passes save-subset/import/export. No unrendered manual mode remains. Presentation caveat W8. |
| Deterministic node IDs | **Only canonical binary path.** `recipe-engine.ts:188-204` still generates random IDs for compatibility splits; W6. |

## Critical issues

### C1. Cross-tab unresolved-run blocking is still a stale React check

**Evidence:** `packages/ui/src/os/recipes/LaunchReview.tsx:62-86,141-174,425-445`; `launch-records.ts:30-33`.

`activeRecord` loads once, scoped to the current desktop. `hasUnknown` only checks that local record and only `outcomeUnknown`, not `dispatched`. Neither first Execute nor New Run rereads/selects the durable run atomically. New records get distinct per-launch locks, so engine locking does not serialize the decision to create a run.

**Failure / impact [INFERENCE]:** two tabs mounted before launch both see no record and each create a separate run. A stale tab can start New Run after another tab becomes unknown, or another desktop can hide the blocked record and offer ordinary Execute. Additional PTYs may be created while the original request can still succeed. This directly violates Phase 07 requirements 15/18/19 and AC8/F1.

**Correction:** atomic durable run-selection/start authority covering all tabs and relevant recipe runs, independent of desktop-local React state. Reread and block unresolved/dispatched attempts at the transition boundary; serialize selection/reservation before acquiring/using per-record execution ownership. UI refresh alone is not sufficient.

### C2. Epoch authority is checked at render, not at the effect/resolution boundary

**Evidence:** `LaunchReview.tsx:46-57,89-107,145-174`; `apps/RecipesApp.tsx:51-57`; `recipe-engine.ts:426-501`; `launch-records.ts:504-527,383-427`. Supporting authority: `api/connections.ts:646-684`; `api/ws-transport.ts:2277-2286,2964-3039`.

Connected/ready/generation checks now reject stale status at render. However connections are frozen for the RecipesApp mount. The engine receives precomputed preflight and an API client before waiting for its lock; inside it checks only profile, not current generation/epoch. It never rechecks after `terminal.create`. Reconciliation fetches list outside the lock, swallows list errors into `[]`, and passes a render-time epoch with no owner tuple or post-await fence. The locked helper rereads the record, **not the observations**.

`getApi` checks current ownership only at lookup. Destroying a WebSocket transport aborts existing requests, but its REST `invoke` has no closed-state guard before issuing a later fetch; therefore a retained client is not an action-time owner fence.

**Failure / impact [INFERENCE]:** an action queued under epoch E1 can later create against a restarted process E2 through its retained HTTP client, still persisting E1. On response loss, observing E2 then incorrectly proves that the E2 creation cannot succeed and enables replacement retry. Delayed list/epoch observations can also be adopted after owner retirement. The current render guard does not close Cycle 2 C2.

**Correction:** under lock, obtain/check current owner and ready authoritative epoch before every effect; recheck after awaits and before publishing evidence. Bind reconciliation list plus epoch to one owner and observation interval; retirement or changed/incoherent evidence must retain unknown. Preserve list failure explicitly, not as successful observation.

### C3. Shared launch storage and startup recovery remain outside one transaction authority

**Evidence:** `launch-records.ts:40-58,64-91,566-595`; `OsShell.tsx:87-91`; locked wrappers at `launch-records.ts:504-559`.

Per-record wrappers now reread correctly, but every record lives in one read-modify-write localStorage blob under different lock names. Startup recovery reads and rewrites that entire blob with no lock. Corrupt JSON, unreadable storage and invalid entries become an empty/partial record collection, permitting a subsequent upsert to overwrite unresolved evidence. Entry validation checks only `version === 1`.

**Failure / impact [INFERENCE]:** another tab's storage update can be lost between whole-blob read/write operations; startup recovery can restore a stale sibling's pending state over newly dispatched/confirmed state. Later Resume can repost its original ID, which is destructive replacement on the server. Corrupt storage can erase unknown tombstones and expose a fresh launch path.

**Correction:** independently keyed records or storage-wide transactional protection for the shared blob, including startup recovery and every write. Preserve unreadable/corrupt bytes and visibly block dispatch until resolved; validate durable identity/state shape. Do not silently reinterpret evidence loss as no prior run.

## Warnings

### High priority

1. **AC8 launch/resume integration remains absent.** `recipe-engine.ts:454-504` only dispatches terminals; `LaunchReview.tsx:169-176` only stores the result. No app creation, topology restoration, consented window move or confirmed-live revalidation. `capturedPtyMap` has no production caller (source search); Save only persists portable JSON (`RecipeEditor.tsx:126-139`). App-only recipes perform no launch work; saving a live desktop does not seed captured resume. Implement the planned record-to-WM adoption through existing claim-aware paths, without rollback kills or duplicate placement.

2. **Reviewed recipe can differ from executed frozen recipe.** `LaunchReview.tsx:62-81,297-338` selects by recipe ID/profile/desktop and reviews current catalog data; `recipe-engine.ts:455-475` executes `record.recipeSnapshot`. Updating/importing the same recipe ID on the same profile with another project/command leaves an old pending run eligible. **[INFERENCE]** Resume can execute old commands/targets while showing new ones. Review/preflight/execute the explicitly selected frozen launch snapshot; catalog edits cannot retarget or obscure existing runs. The profile mismatch fix closes wrong-profile execution, not this mismatch.

3. **Incarnation enforcement still fails open and is not on Hub Jump's path.** `OsShell.tsx:947-962` accepts a missing row and does not verify row availability, owner generation or server epoch; retained unavailable rows are documented by `stores/agent-status.ts:47-71`. `AgentHubApp.tsx:166-229` still supplies ID-only Sets and directly focuses/opens windows; `agent-hub.ts:318-325` bypasses incarnation validation for Sets. Require current exact alive/incarnation proof and one shared claim-aware focus authority; missing proof must block, not pass. Recipe Focus also emits an ID-only `terminal:focus` (`LaunchReview.tsx:184-191`).

4. **Preflight is incomplete.** `recipe-engine.ts:351-409` checks connection/epoch and only single-instance/project-instance modes. It never checks project/worktree availability, all other instancing modes or central resource claims. `app-registry.ts:186-244` already supports profile/worktree/tuple modes. Consent is an unversioned boolean (`LaunchReview.tsx:59,264-269,173`) not tied to the exact move set. Complete the required target/resource preflight and invalidate consent when its reviewed set changes, before any POST.

5. **Portable state/schema boundary remains too permissive.** Desktop capture copies arbitrary appState (`recipe-engine.ts:283-288`), import retains it (`schema.ts:289-296`), and export emits it (`schema.ts:423-427`), unlike OS persistence's per-app projection (`os/persistence.ts:38-124`). **[INFERENCE]** dirty/runtime/sensitive fields can leak into portable JSON. Topology validation still permits duplicate/missing placement, duplicate node IDs, active items outside their pane, nonbinary splits and unnormalized/zero weights; float dimensions need only be finite (`schema.ts:62-100,306-365`). Use explicit portable projections and complete topology/bounds validation. No direct new XSS/SQL-injection sink identified in inspected paths; this is not a full security audit.

### Medium priority

6. **Determinism claim remains partial.** `recipe-engine.ts:188-204` still calls `generateUUID()` when folding more than two children. Such input violates the canonical binary TileNode type, but the recipe schema accepts nonbinary trees (`schema.ts:88-100`). Reject noncanonical input consistently or deterministically derive every compatibility node ID. Existing pruning test (`recipe-engine.test.ts:167-231`) checks only canonical binary shape, not repeated output equality. Step-key sanitization at `recipe-engine.ts:103` also aliases distinct arbitrary window IDs such as `a.b` and `a_b`; use an injective mapping if imported arbitrary IDs remain supported.

7. **Command confirmation remains a UI-only boolean, not a saved-value invariant.** `RecipeEditor.tsx:110-139,346-367,425-433`; `recipe-engine.ts:270-279`. Changing a command does not invalidate confirmation; Save/builder do not enforce the reviewed value. Bind confirmation to command text and validate at Save/build, rather than relying only on button disabled state and fallback appState/default commands.

8. **Remaining UI/Hub completeness gaps persist.** `RecipesApp.tsx:260-269` renders export as another full-height editor below the flex content, not a dedicated content view/overlay; **[INFERENCE]** constrained windows can clip/shrink it. Existing singleton recipe intents update appState (`OsShell.tsx:1042-1051`), while RecipesApp reads it only in initial state (`:27-36`). Hub template has no production caller (`desktop-templates.ts:144-179`); default startup remains empty Main (`window-ops.ts:108-124`). Hub has no workflow-overview fan-in/affordance or session-change metadata count in inspected code, and disconnected terminal rows disappear via the aggregate hook's disconnected empty query key (`use-aggregated-terminal-sessions.ts:54-83`). Complete these plan requirements before AC7/AC8 signoff.

9. **Passing tests do not establish the safety contract.** Locked helper functions are not imported by `launch-records.test.ts:1-17`; lock doubles immediately invoke callbacks (`:86-98`). Browser tests cover subset Save and happy-path launch (`browser-tests/os-recipes.browser.tsx:99-242,244-362`), not stale-tab New Run, epoch retirement, incarnation denial, initial editor modes or failed retry. E2E assertions are now unconditional—an improvement—but `e2e/os-recipes/os-recipes.spec.ts:43-54` only opens the Import tab; it never imports JSON despite its title. No held-create/reload/two-real-tab/zero-additional-create, exact late adoption, captured topology or live retry qualification is supplied.

## Suggestions

- Consolidate durable run selection, transition and recovery in one small authority; avoid spreading policy between permissive exported mutation helpers, UI callbacks and lock wrappers. Existing wrapped helpers perform redundant second persistence after underlying helpers already write (`launch-records.ts:524-525,540-541,556-557`).
- Keep full UUID terminal reservations and conservative unknown outcomes. Never classify generic transport/proxy errors as definitive failure just to make Retry available; attributable error classification remains separate from rendering the new button (`recipe-engine.ts:497-500`).
- Use existing typed ownership/resource/window-reuse services; do not add another scheduler or an exactly-once server claim. Per-record persistence also avoids parsing/stringifying every historical frozen recipe for every step.
- Add focused regressions for the failures above, then real isolated-PTY F1/AC7/AC8 qualification. Update product docs/changelog only for behavior actually implemented and qualified.

## Positive observations

- Three locked mutation wrappers now consume latest durable record, fixing the narrow stale-record transition defect.
- Ready/current-generation epoch gating and client-profile rejection improve fail-closed boundaries.
- Failed retry control exists with the requested selector; explicit editor modes remove blank manual initialization.
- Confirmed creation validates returned ID/incarnation; unknown remains nonretryable and dismissal preserves identity.
- Hub retains qualified status reducer and Idle-not-success semantics; catalog remains exactly 17 by supplied test evidence.
- Portable export retains explicit commands-and-paths warning and excludes top-level launch-record authority.

## Reviewed files

Primary source / relevant sections:

- `packages/ui/src/os/recipes/launch-records.ts`
- `packages/ui/src/os/recipes/recipe-engine.ts`
- `packages/ui/src/os/recipes/LaunchReview.tsx`
- `packages/ui/src/os/recipes/RecipeEditor.tsx`
- `packages/ui/src/os/recipes/schema.ts`
- `packages/ui/src/os/recipes/persistence.ts`
- `packages/ui/src/os/recipes/types.ts`
- `packages/ui/src/os/apps/RecipesApp.tsx`
- `packages/ui/src/os/apps/AgentHubApp.tsx`
- `packages/ui/src/os/agent-hub.ts`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/app-registry.ts`
- `packages/ui/src/os/desktop-templates.ts`
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/window-ops.ts`

Tests: `recipes/launch-records.test.ts`, `recipes/recipe-engine.test.ts`, `browser-tests/os-recipes.browser.tsx`, `e2e/os-recipes/os-recipes.spec.ts` (all under `packages/ui`). Supporting excerpts/searches: `stores/agent-status.ts`, `hooks/use-aggregated-terminal-sessions.ts`, `api/connections.ts`, `api/client.ts`, `api/ws-transport.ts`, `types/tile-tree.ts`. Requirements/evidence: README, docs PDR/code standards, Phase 07 plan/source-evidence, Cycle 2 review, Cycle 3 tester report.

## Validation commands/results

Reviewer executed `git diff --stat` for initial scope, plus static source/read/search inspection. No reviewer build/test/lint runs; tester owns execution, avoiding duplicate runs. No source/test/plan edits.

Fresh **tester-reported** evidence from `plans/reports/tester-261102-2354-phase-07-agent-hub-and-recipes-cycle-3.md:15-34,38-148`:

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/os/agent-hub.test.ts src/lib/traditional-terminal-agents.test.ts src/os/recipes src/os/app-registry.test.ts` | Exit 0; 126 tests / 6 files; 0 failed/skipped; 246 ms |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-agent-hub.browser.tsx browser-tests/agent-status-bridge.browser.tsx browser-tests/os-recipes.browser.tsx` | Exit 0; 6 tests / 3 files; 0 failed/skipped; 1.81 s; React act/environment warnings |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | Exit 0; 0 diagnostics; 8.49 s |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0; 0 diagnostics; 1.44 s; typecheck only |

The tester also records diagnostic verbose reruns (126 unit / 6 browser, no failures); these are not additional unique tests. No reviewer claim of independently executed passing checks. Package build, lint, runtime E2E and real-PTY cross-tab acceptance were not exercised in this evidence. Type/test coverage percentages unavailable; lint issue count unknown. Green scoped checks do not discharge the source-evidenced critical findings.

## Unresolved questions

- No missing repository information blocks these findings. The advertised under-lock New Run protection and fully deterministic compatibility-node fix are absent from the inspected source.
- Runtime acceptance remains unresolved: isolated real-PTY held-create/lost-response/reload/two-tab zero-additional-create, exact late adoption, authoritative retry and complete AC7/AC8 evidence are still required.
