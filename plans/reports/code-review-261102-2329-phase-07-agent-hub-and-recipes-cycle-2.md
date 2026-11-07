# Phase 07 Code Review — Cycle 2

## Assessment

**Score: 4/10. Block recipe execution acceptance.** Several narrow Cycle 1 defects were corrected; durability/ownership and AC8 integration remain incomplete. Source inspection is high-confidence; race scenarios below are source-derived, not runtime reproductions.

Scope: Phase 07 plan, prior review, recipe engine/records/schema/UI, Hub navigation/read model, registration/intents/startup/persistence, relevant tests and supporting owner/resource contracts. Read-only review except this report. No source, tests, plan or task state changed.

## Cycle 1 remediation disposition

| Area | Cycle 2 finding |
| --- | --- |
| Interrupted dispatch | Engine now sends only `pending`; startup recovery has a production caller. Narrow duplicate-dispatch defect corrected. Recovery remains unlocked; other mutations can restore stale pending state. |
| Server epoch | Generation fallback removed; missing epoch blocks preflight. Store epoch is now real, but can be retained/unavailable from a previous connection. No action-time epoch/generation fence. |
| Exact adoption | Now requires matching non-null epoch, exact live ID and safe-integer observed incarnation; known original incarnation is compared. Profile/generation provenance and coherent epoch/list observation still absent. |
| Launch lifecycle | Existing records load on review mount; explicit New Run exists; locally known unknown disables both launch buttons. Cross-tab/remount/target selection remains unsafe; apps/layout/captured resume still absent. |
| Step/terminal IDs | Full window IDs and full terminal UUIDs replace truncation. Ordinary production terminal-window collision fixed. Sanitization remains non-injective for arbitrary imported window IDs. |
| Command confirmation | Per-terminal checkbox gates Save. Handler/builder do not enforce confirmation; confirmation is not bound to reviewed command value. |
| Preflight targets | Unresolved: no project/worktree/command/target availability lookup; only two instancing modes inspected. |
| Hub jump | Raw backend ID fixed. Production still passes ID-only sets; `agent:focus` does not compare incarnation. |
| Import/export | Catalog Export button exists, warning/preview can be reached through an additional internal tab. Import entry still opens subset mode; Export initially opens unrendered `manual` mode. |
| Deterministic topology | Pane/root split IDs deterministic for canonical binary source trees. Nonbinary compatibility branch still calls `generateUUID()`. |

## Critical issues

### C1. Locks still protect stale snapshots, not durable transitions

**Evidence:** `packages/ui/src/os/recipes/LaunchReview.tsx:95-97,108-122`; `launch-records.ts:312-334,467-498,505-533`; shared storage update `launch-records.ts:40-58,88-91`.

Reconciliation, dismissal and retry acquire the lock but pass the pre-lock React `activeRecord`; none re-read durable state. Startup recovery writes all records without any lock. Different record locks also protect updates to the same storage blob, permitting cross-tab lost updates.

**Impact:** a stale unknown-step dismissal can overwrite another tab's newly confirmed sibling with the old `pending` state. After reconciling the remaining unknown, Resume dispatches that sibling again with its original terminal ID. Thus the pending-only guard can still reach destructive duplicate create. Stale retry can likewise replace newer evidence. Corrupt/unreadable storage becomes `{}`, permitting a later upsert to erase unresolved records rather than visibly blocking.

**Correction:** one locked read-validate-transition-write authority for every entrant; read inside the lock, not before it. Use independently keyed durable records or a storage-wide transaction/lock for the shared blob; preserve corrupt evidence and fail closed. Recover through the same authority. Include held-create plus stale dismiss/reconcile/retry and independent-record races in acceptance.

### C2. Epoch proof is not current-owner proof; adoption can combine observations from different runtimes

**Evidence:** `LaunchReview.tsx:47-53,84-97,136-158`; `apps/RecipesApp.tsx:51-57`; `recipe-engine.ts:426-488`; `launch-records.ts:345-355,383-426`. Supporting store behavior: `packages/ui/src/stores/agent-status.ts:47-71` retains old epoch/rows as unavailable across reconnect.

LaunchReview accepts any non-null store epoch without checking `availability` or matching its owner generation to the connection. RecipesApp freezes connection snapshots for its mount. Execution uses a client/preflight captured before waiting for a Web Lock, checks neither current owner nor epoch inside the lock or after create, then persists success. Reconciliation fetches sessions before acquiring the lock and pairs them with the render-time epoch; it supplies no profile/generation identity and performs no post-await revalidation.

**Impact:** an old epoch may label a creation on a restarted server; a later legitimate epoch snapshot is then treated as proof that this creation cannot succeed even though it belongs to that new process. Similarly, an old list response may be adopted after retirement/restart. Current numeric incarnation checks do not make those observations authoritative together.

**Correction:** capture a ready owner-matching authoritative epoch; validate profile/generation/epoch under the lock before each effect and after every await. Reconciliation must bind list plus epoch to one current owner and reread the durable step. Keep unknown on retirement/incoherent evidence. `getApi` checks ownership at lookup, not after lock waits/network completion.

### C3. Resume may execute a frozen record on the wrong profile

**Evidence:** `LaunchReview.tsx:58-73,136-156`; `recipe-engine.ts:440-467`; recipe upsert/import `recipes/persistence.ts:55-71`, `RecipeEditor.tsx:143-153`.

Record selection compares only recipe ID and desktop ID. The UI chooses connection and preflight from the current catalog recipe, but execution runs the durable record's older `recipeSnapshot`; no comparison with `apiClient.owner.profileId` exists.

**Impact:** import/update a recipe using the same ID with a different profile or project, then resume a pending old record: old commands/project and reserved IDs are sent through the newly selected profile's API. Review shows the new recipe, not the executed frozen commands. This violates owner isolation and explicit command review.

**Correction:** select runs explicitly by launch identity, display/preflight/execute their frozen snapshot, and reject client/profile/epoch mismatch inside the lock. Recipe updates cannot retarget existing records.

### C4. Unknown blocking can still be bypassed by stale or missing local run state

**Evidence:** `LaunchReview.tsx:58-64,75-77,141-149,394-421`.

Active record is read once, only for the current desktop. No storage subscription or action-time durable run selection exists. Both first Execute and New Run allocate outside a recipe/run-selection lock. New Run only checks locally known `outcomeUnknown`, not `dispatched` or other durable unresolved runs.

**Impact:** two tabs opened before the first run each execute a separate record under different locks. A stale tab can create New Run after another tab becomes unknown; opening review on another desktop hides that blocked record and normal Execute silently starts another run. A mounted review that loaded `dispatched` can enable New Run. The normal recovery path therefore still authorizes duplicate processes while original requests may complete.

**Correction:** durable run selection/resume must be atomic across tabs, refresh before action, and surface unresolved runs independently of current desktop. Explicit independent New Run must not become an unknown-recovery shortcut; block unresolved/dispatched attempts at the transition boundary, not only via React button state.

## Warnings

### High priority

1. **AC8 launch cutover remains missing.** `recipe-engine.ts:446-497` processes only terminal POSTs; `LaunchReview.tsx:152-160` only stores the returned record. No app creation, layout placement, consented window move or confirmed-live revalidation occurs. `capturedPtyMap` has no production caller; `RecipeEditor.tsx:124-137` saves only portable JSON. Saving an existing live desktop therefore does not seed a captured resume; app-only recipes do nothing; confirmed terminals are not restored into topology. Implement record-to-WM adoption through existing claim-aware paths, preserving failed/unknown placeholders and exact live refs. Do not mark AC8 complete based on remote POST success.

2. **Preflight remains incomplete.** `recipe-engine.ts:351-409` checks connection/epoch plus only `single-instance` and `project-instance`. It does not verify project/worktree existence, command/target review, `worktree-instance`, `profile-instance`, `tuple-instance`, or central resource claims. Reuse `findExistingWindowForApp` for all applicable modes (`app-registry.ts:171-245`) and existing target authorities before any POST. Consent is a boolean and is not invalidated when the reviewed move set changes.

3. **Portable state remains an unsafe export boundary; topology validation incomplete.** `recipe-engine.ts:283-288`, `schema.ts:289-296,423-427` preserve arbitrary `appState`, unlike the per-app projection in OS persistence (`persistence.ts:38-124`). Dirty/credential/runtime fields can be saved/exported; identity-bound state is not portable adoption authority. `schema.ts:62-100,339-357` still permits duplicate/missing placement, active items outside their pane, duplicate node IDs, nonbinary splits, non-normalized weights, and invalid-size bounds. Reuse a canonical safe projection; enforce topology membership/uniqueness, binary shape, normalized ratios and meaningful numeric bounds. No direct XSS/SQL-injection sink found in the reviewed additions; that does not establish safe portable data handling.

4. **Hub incarnation enforcement remains unwired.** `AgentHubApp.tsx:166-190` still passes `Set<string>`; `agent-hub.ts:318-325` intentionally skips the new incarnation branch for that shape. `OsShell.tsx:928-977` checks only an xterm registry entry and never reads `intent.payload.incarnation`. Registry presence is not remote process-liveness proof. Raw ID correction at `AgentHubApp.tsx:221-224` is valid, but stale jumps can still target a replacement incarnation. Supply current owner-qualified alive/incarnation snapshots, reject missing proof and route all focus through one claim-aware authority.

5. **Proof-backed failed retry has no UI control.** `LaunchReview.tsx:116-128` defines `handleRetryFailed` but no rendered button invokes it; step actions at `:325-378` only handle unknown/confirmed. All create errors also become unknown (`recipe-engine.ts:489-493`) without an attributable definitive-error classifier. Conservative unknown is safe, but AC8 explicit retry is unreachable. Render an eligible failed retry action through the corrected transition authority; never classify generic transport/proxy errors as definitive failure.

### Medium priority

6. **Import/export routes still misinitialize editor mode.** `RecipesApp.tsx:233-240` mounts RecipeEditor with no import mode; it starts `save-subset` (`RecipeEditor.tsx:47-49`). Catalog Export mounts `initialRecipe` (`RecipesApp.tsx:258-266`), which initializes `manual`; there is no rendered manual body. Export warning/preview appear only after clicking the nested Export JSON tab. Make explicit controlled/import/export modes, avoid the second full-height editor under the catalog. Mounted singleton launch intents also remain ineffective: shell updates `window.appState` (`OsShell.tsx:1031-1034`), but RecipesApp only reads those fields in `useState` initializers (`:27-36`).

7. **Command confirmation is not an invariant at the save boundary.** Checkbox gating now works (`RecipeEditor.tsx:356-371,425-430`); however `handleSaveSubset` and the builder never check it (`:112-137`; `recipe-engine.ts:270-279`). Untouched appState/default commands remain fallback executable data, and changing a command/default does not invalidate existing confirmation. Require authored/confirmed command values at the build boundary, bind confirmation to the current value, and recheck on Save.

8. **Hub home/read-model acceptance remains partial.** `createAgentHubDesktopTemplate` has no production caller; default startup still loads Main with no windows (`window-ops.ts:108-124`; `OsShell.tsx:85-90`). Hub has no workflow-overview affordance/subscription or session-change metadata count. Disconnected rows disappear because the aggregated session hook switches to an empty disconnected query key (`use-aggregated-terminal-sessions.ts:54-83`). These Cycle 1 scope gaps were not remediated.

9. **Tests do not establish F1/AC7/AC8 safety.** The E2E test conditionally omits product assertions when Recipes/Save is missing (`e2e/os-recipes/os-recipes.spec.ts:26-52`) and performs no import despite its title. Recipe browser tests cover subset Save and happy-path confirmation only (`browser-tests/os-recipes.browser.tsx:99-242,244-362`). Hub browser tests do not click Jump or use equal IDs across profiles. Unit lock doubles immediately invoke callbacks; there is no held-create/reload/two-real-tab safety proof or negative owner/epoch/adoption coverage. Make core assertions unconditional and add acceptance against isolated real PTYs after the state authority is corrected.

## Suggestions — architecture / KISS / DRY / performance

- Prefer one record transition service and one terminal focus/adoption authority over permissive exported transition helpers plus component-level locks. Avoid introducing another scheduler or generic orchestration framework.
- Keep full UUID terminal IDs. If imported window IDs are supported, use an injective deterministic step mapping: replacing every unsupported character with `_` can still alias `a.b` and `a_b` (`recipe-engine.ts:103`).
- Canonical binary topology now prunes deterministically. Remove or deliberately support the remaining random-ID nonbinary branch (`recipe-engine.ts:188-205`); avoid declaring full determinism while it remains reachable for noncanonical inputs accepted by schema.
- Remove unused imports/state, unrendered `manual` mode and duplicated reconciliation comments. The unused retry handler is missing functionality, not merely cleanup.
- Hub filtering is linear plus sorting and no eager session-change diff/file scans were introduced. No extra caching needed. Durable updates currently parse/stringify every historical frozen recipe on every step; per-record storage addresses both correctness and growth cost.
- Update product docs/changelog only to describe implemented/qualified behavior. Phase plan remains pending; no completion/task-state changes made by this reviewer.

## Positive observations

- Pending-only engine dispatch and wired startup recovery close the narrow direct re-POST defect.
- Real server epoch source replaces fabricated generation fallback; absent epoch fails closed.
- Create response validates returned ID and safe-integer incarnation; reconciliation requires live ID, observed incarnation and matching epoch; no invented incarnation `1` in persisted success.
- Full UUID terminal reservations remove the previous eight-hex collision risk.
- Individual terminal command confirmation is visible and browser-tested.
- Hub uses the qualified roster/reducer, keeps Idle distinct from success, and now uses raw backend terminal ID.
- Catalog remains exactly 17 manifests; recipes remain client-only and imports do not directly invoke execution.
- Portable export warns explicitly about commands and paths and excludes launch-record top-level data.

## Reviewed files

Primary source (relevant sections, not a whole-codebase audit):

- `packages/ui/src/os/recipes/recipe-engine.ts`
- `packages/ui/src/os/recipes/launch-records.ts`
- `packages/ui/src/os/recipes/schema.ts`
- `packages/ui/src/os/recipes/persistence.ts`
- `packages/ui/src/os/recipes/types.ts`
- `packages/ui/src/os/recipes/LaunchReview.tsx`
- `packages/ui/src/os/recipes/RecipeEditor.tsx`
- `packages/ui/src/os/apps/RecipesApp.tsx`
- `packages/ui/src/os/apps/AgentHubApp.tsx`
- `packages/ui/src/os/agent-hub.ts`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/app-registry.ts`
- `packages/ui/src/os/desktop-templates.ts`
- `packages/ui/src/os/intents.ts`
- `packages/ui/src/os/notifications.ts`
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/CommandPalette.tsx`
- `packages/ui/src/os/Dock.tsx` (targeted registration search)

Tests:

- `packages/ui/src/os/recipes/recipe-engine.test.ts`
- `packages/ui/src/os/recipes/launch-records.test.ts`
- `packages/ui/src/os/recipes/schema.test.ts`
- `packages/ui/src/os/app-registry.test.ts`
- `packages/ui/browser-tests/os-agent-hub.browser.tsx`
- `packages/ui/browser-tests/os-recipes.browser.tsx`
- `packages/ui/e2e/os-recipes/os-recipes.spec.ts`

Supporting excerpts/searches: `packages/ui/src/stores/agent-status.ts`, `packages/ui/src/api/connections.ts`, `packages/ui/src/api/client.ts`, `packages/ui/src/os/OsResourceHost.tsx`, `packages/ui/src/os/window-ops.ts`, `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts`, terminal registry/incarnation state, server agent-status epoch provenance. Requirements: README, docs PDR/code standards, Phase 07 plan and Cycle 1 report. Approximately 5,000 scoped source/test lines considered.

## Validation commands/results

Reviewer executed `git diff --stat` and static source/search inspection only. No reviewer build/lint/test runs or implementation edits; tester owns execution.

Fresh terminal evidence supplied by `Phase07TesterCycle2`:

| Command | Supplied result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test src/os/agent-hub.test.ts src/lib/traditional-terminal-agents.test.ts src/os/recipes src/os/app-registry.test.ts` | PASS: 125 tests / 6 files; 0 failed/skipped; Vitest 250 ms |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-agent-hub.browser.tsx browser-tests/agent-status-bridge.browser.tsx browser-tests/os-recipes.browser.tsx` | PASS: 6 tests / 3 files; 0 failed/skipped; non-fatal React act/testing-environment warnings |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | PASS: 0 diagnostics |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | PASS: 0 diagnostics; typecheck only |

Not exercised here: package build, lint, runtime E2E, real cross-tab held-create/reload/lost-response acceptance, live exact-adoption/retry/captured-topology qualification. No coverage percentages available. Passing scoped suites do not override source-evidenced gaps.

## Unresolved questions

- No missing repository information prevents identifying the findings above.
- Required runtime qualification remains open: isolated real-PTY F1 and full AC7/AC8 evidence are not supplied by the passing component/unit/typecheck commands.
