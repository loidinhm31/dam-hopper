# Phase 07 Code Review — Agent Hub and Recipes

## Assessment

**Score: 3/10. Recommendation: block acceptance/merge of recipe execution.** Catalog and presentation foundations are useful; core F1 safety and AC8 end-to-end behavior are not implemented correctly. Passing scoped tests do not establish held-create/reload/second-tab safety.

Review: read-only source assessment plus this report; no implementation or plan/task-state edits. High confidence in findings below from direct call-path inspection; runtime reproductions were not executed by this reviewer.

## Critical issues

1. **Dispatched steps can be POSTed again using the same terminal ID.** `packages/ui/src/os/recipes/recipe-engine.ts:446-483` skips only `confirmed` and `outcomeUnknown`; persisted `dispatched` and all `failed` steps fall through to another create with the original ID. `canRetryStep` is never consulted. Startup recovery exists at `launch-records.ts:459-488` but has no production caller. Therefore a new entrant after interrupted dispatch can reissue the destructive create. Existing server replacement semantics are explicit at `server/src/pty/manager.rs:1733-1737`. **Correction:** enforce legal transitions inside the lock; orphaned dispatch stays unknown, genuine proof-backed retry requires explicit action and a fresh full UUID. Wire startup recovery under the same serialization contract, not as an unguarded reset.

2. **Connection generation is fabricated into server restart evidence; ownership is not rechecked.** `recipe-engine.ts:367-370` substitutes `conn.owner.generation` for missing authoritative `serverEpoch`; `LaunchReview.tsx:49-54` never supplies a real epoch. A reconnect is not a server restart. `executeRecipeLaunch` accepts a previously captured client/preflight and checks neither owner/profile nor current generation/epoch after waiting for the lock or after create (`recipe-engine.ts:440-483`). `RecipesApp.tsx:50-56` freezes connection snapshots for the entire mount. **Impact:** launch proceeds without required epoch proof; retirement/reconnect can publish invalid confirmation, and false epoch differences can authorize failure/replacement. **Correction:** obtain an authoritative epoch from the existing bound snapshot service, block if absent, capture current owner per action, and fence pre/post-await observations. Never persist runtime generation as server epoch.

3. **“Exact late adoption” does not require exact identity.** `launch-records.ts:383-403` adopts by alive bare ID and optional incarnation; undefined original incarnation is a wildcard. It does not check current epoch equality before adoption, and its host context carries no profile/generation identity. A matching ID on a different/null epoch is confirmed before restart handling. Missing observed incarnation is invented as `1`; normal dispatch also invents it (`recipe-engine.ts:480-483`). **Correction:** require authoritative profile + original server epoch + reserved ID + proven incarnation, with connection/epoch fencing; no wildcard/default identity. Validate successful create response identity before persisting confirmation. Add negative tests for different profile/epoch/incarnation and missing proof.

4. **Unknown outcome is bypassed by the ordinary Execute Launch button.** `LaunchReview.tsx:90-105` creates a new record/UUID set on every click; `:341-352` re-enables the same action after completion/unknown. Records are not loaded on remount (`activeRecord` starts null, line 46). Closing/reopening or clicking again after lost response creates a second run while the original can still succeed, under a different lock name. **Correction:** distinguish durable resume/recovery from intentional independent New run; retain and display the blocked record across reload/tabs. Do not let the normal recovery entry point silently allocate replacement identities for unknown steps.

## Warnings

### High priority

- **Record mutations outside locks can overwrite newer durable evidence.** Only execution uses `withRecipeLaunchLock`. Reconciliation/dismissal use stale React records directly (`LaunchReview.tsx:57-76`); transitions persist those records without rereading (`launch-records.ts:312-334,345-425`). Startup recovery is also unlocked. Another tab can revert newer statuses/identities while execution holds its lock. All records additionally share a single read-modify-write storage blob (`launch-records.ts:88-91`) despite per-record locks. Reads swallow storage/parse errors into `{}` and validate only `version` (`:40-58`). Centralize locked read/validate/transition/write for every entrant; protect shared-key updates or use independently keyed records, preserve corrupt/unavailable evidence and block visibly rather than overwriting it.

- **Launch does not apply apps, layout, consented moves, or captured resume.** `recipe-engine.ts:446-493` processes terminal POSTs only; no WM/layout/app execution follows. `LaunchReview.tsx:107` only stores the result in component state. `capturedPtyMap` has no production caller, no captured-run record is seeded during save (`RecipeEditor.tsx:113-126`), and existing records are never selected for resume. Check Status supplies a literal empty session list (`LaunchReview.tsx:59-65`). There is no explicit proof-gated retry path or definitive server-error classifier. AC8 is not complete: successful remote PTYs are not placed/mounted, app-only recipes launch nothing, and move consent does not cause a move. Implement the frozen-record-to-window/topology cutover, exact live-ref resume and real fenced reconciliation before claiming launch support.

- **Common multi-terminal Save Subset generates duplicate step keys.** `recipe-engine.ts:103` uses `win.id.slice(0,8)`. Production IDs are `terminals-<suffix>` (`desktop-templates.ts:23`, `OsShell.tsx:746`, `AgentHubApp.tsx:213`), so every terminal gets `step-terminals-terminal`. Two terminal windows therefore collide and `saveRecipe` rejects the recipe; topology/command maps also alias before validation. Use the full stable window identity or collision-free deterministic mapping. Reserved PTY IDs also truncate UUIDs to eight hex characters (`launch-records.ts:134`); use full validated UUIDs because collisions have destructive server semantics.

- **Commands are neither required to be authored nor individually confirmed.** `RecipeEditor.tsx:336-346` displays app-state command/default `bash`; `recipe-engine.ts:271-279` saves that fallback even when the user never touched a command. Only the global save confirmation is required. No terminal-buffer extraction was found, but silent app-state/default promotion still violates the explicit command contract. Require explicit input or per-step confirmation and enforce that at the build boundary, not only with helper text.

- **Portable schema is not a complete integrity/security boundary.** `schema.ts:62-100` accepts duplicate placements, pane active keys outside that pane, duplicate node IDs, one/many-child splits, and weights not summing to 100. Floating bounds accept negative/zero/extreme dimensions (`:339-357`); missing bounds silently disappear. `appState` is copied wholesale at save/import/export (`recipe-engine.ts:287`; `schema.ts:293-296,427`), unlike the existing per-app allowlist in `os/persistence.ts:38-124`. Arbitrary dirty/credential/runtime fields can persist/export; unsupported identity-dependent app states can be rebound later. Reuse a canonical safe per-app projection and topology/numeric validators; enforce exactly one valid placement per represented step, binary splits, pane-local active membership, bounded floats and unique IDs. Validate launch records structurally as well, not via a `version === 1` cast.

- **Preflight does not validate project/worktree availability or all instance/resource ownership.** `recipe-engine.ts:351-409` checks connected status plus only single/project instance categories; it omits `worktree-instance`, `profile-instance`, `tuple-instance` and resource claims. No project/worktree/command/target lookup occurs before POST. Reuse the existing centralized resolver for every instancing mode and preflight all declared targets before remote side effects; fence consent to the exact reviewed move set.

- **Hub Jump uses a qualified UI key as the backend ID and does not verify incarnation.** `AgentHubApp.tsx:221-223` sets `sessionId` to `item.sessionId`, built with `terminalKey` (`:91-93`, a JSON tuple), although `TerminalsApp.tsx:18-25` and `OsResourceHost.tsx:193-204` interpret it as a raw ID. The newly opened surface therefore attaches to the tuple string, not the target PTY. Jump validation checks an ID-only set, not incarnation (`agent-hub.ts:282-340`); the new `agent:focus` handler ignores the supplied incarnation (`OsShell.tsx:925-974`). Use the raw `terminalRef.id` consistently, compare current exact incarnation and current connection at action time, and route through the existing claim-aware focus authority. Add a real Jump test with equal IDs across two profiles and same-ID reincarnation.

### Medium priority

- **Recipe entry points and export are disconnected.** Hub's Open Recipes sends `recipes:launch` with empty IDs (`AgentHubApp.tsx:244-246`), causing a new manager to enter review with no selected recipe and no content. Launch intents updating an already mounted singleton cannot change its local tab/selection because those props are read only by `useState` initializers (`RecipesApp.tsx:26-36`). Import JSON mounts the default subset editor, not import mode (`:223-230`). Export requires `initialRecipe` (`RecipeEditor.tsx:92-95,184-197`), but the manager never supplies it, so the otherwise correct commands-and-paths warning/preview is unreachable. Use distinct open/review/import actions with controlled app state, expose existing-recipe export, and test routes through OsShell rather than mounting children alone.

- **Hub acceptance is partial.** `createAgentHubDesktopTemplate` is only defined/tested; production startup still loads the empty Main session (`OsShell.tsx:84-88`, `window-ops.ts:108-124`). There is no workflow overview subscription/affordance or session-change metadata count. Disconnected profiles lose their raw session rows through `useAggregatedTerminalSessions` (`use-aggregated-terminal-sessions.ts:54-83`) instead of retaining unavailable fleet rows. Hub does not display the reducer's source/coverage descriptions. Wire the home/template and promised read-model surfaces using retained owner-qualified metadata, not a second status interpreter.

- **Acceptance test names overstate coverage.** `e2e/os-recipes/os-recipes.spec.ts:26-52` conditionally skips assertions if Recipes/Save Desktop is absent, so it can pass with neither feature visible; its “inert schema import” scenario performs no import. It does not exercise F1, resume, topology, cancel/empty/same-project-worktree/source-preservation, two-tab serialization or proof-gated retry. Unit locking uses an immediate callback fake (`recipe-engine.test.ts:40-43`); it cannot prove cross-tab exclusion. `launch-records.test.ts:186-210` labels wildcard-incarnation acceptance “exact.” Browser recipe coverage renders two children in isolation. Add deterministic held-create/reload/two-real-tab assertions and unconditional product assertions. A screenshot is not acceptance evidence.

## Suggestions — KISS / DRY / performance

1. Prefer one guarded launch transition service and one WM/intent adoption path. Current exported transition helpers, unused retry/recovery helpers and a second `agent:focus` path create parallel conventions without enforcing the invariants.
2. Remove unused imports/state, unreachable `manual` mode and placeholder comments such as `aliveSessionsOnHost: [], // Checked live`. Do not label missing behavior as implemented.
3. Keep topology pruning pure and deterministic: `recipe-engine.ts:153,200,216` generates new random node IDs for the same source input. Preserve source structural IDs or derive stable recipe node IDs; retain ratio precision rather than unnecessary rounding.
4. Existing roster classification/filtering is linear plus one sort; no eager diff/file scans were found. Avoid additional abstraction/caching unless measurement warrants it. The present durability blob rewrites all historical frozen snapshots for every step; per-record atomic storage also avoids that growth cost.
5. Update Phase 07 product/docs/changelog after fixes and qualification. Plan status remains pending; no task-status changes made by this reviewer.

## Positive observations

- Exactly **17** manifests in `APP_MANIFESTS`, with matching OsAppId/Dock additions and explicit count assertion.
- Hub reuses `buildTraditionalTerminalAgentRows`; urgency keeps Idle separate from success and preserves honest Unknown/unsupported labels.
- Web Locks unavailable path explicitly rejects; execution persists dispatched before create and catches transport errors conservatively as unknown.
- Matching/excluded subset preview exists before save; excluded windows have names/reasons, and pruning constructs new tree objects rather than mutating source.
- No terminal-buffer credential/command extraction found in reviewed paths. Export helper explicitly warns about both commands and paths; Hub title/project Cognito replacements exist. Full export reachability and whole-shell privacy remain distinct from those local checks.

## Reviewed files

All 27 requested files; integration files reviewed through changed hunks plus relevant surrounding call paths:

- `packages/ui/src/os/agent-hub.ts`
- `packages/ui/src/os/agent-hub.test.ts`
- `packages/ui/src/os/apps/AgentHubApp.tsx`
- `packages/ui/src/os/recipes/types.ts`
- `packages/ui/src/os/recipes/schema.ts`
- `packages/ui/src/os/recipes/schema.test.ts`
- `packages/ui/src/os/recipes/launch-records.ts`
- `packages/ui/src/os/recipes/launch-records.test.ts`
- `packages/ui/src/os/recipes/persistence.ts`
- `packages/ui/src/os/recipes/recipe-engine.ts`
- `packages/ui/src/os/recipes/recipe-engine.test.ts`
- `packages/ui/src/os/recipes/RecipeEditor.tsx`
- `packages/ui/src/os/recipes/LaunchReview.tsx`
- `packages/ui/src/os/apps/RecipesApp.tsx`
- `packages/ui/src/os/app-registry.ts`
- `packages/ui/src/os/app-registry.test.ts`
- `packages/ui/src/os/desktop-templates.ts`
- `packages/ui/src/os/intents.ts`
- `packages/ui/src/os/notifications.ts`
- `packages/ui/src/os/persistence.ts`
- `packages/ui/src/os/types.ts`
- `packages/ui/src/os/OsShell.tsx`
- `packages/ui/src/os/Dock.tsx`
- `packages/ui/src/os/CommandPalette.tsx`
- `packages/ui/browser-tests/os-agent-hub.browser.tsx`
- `packages/ui/browser-tests/os-recipes.browser.tsx`
- `packages/ui/e2e/os-recipes/os-recipes.spec.ts`

Supporting evidence: Phase 07 plan; README; docs PDR/code standards; canonical tile-tree/ownership contracts; TerminalsApp, OsResourceHost, TerminalKeepAliveHost/TerminalPanel, traditional roster builder, aggregated session hook, API client/connection and agent-status contracts; server replacement semantics. Approximately 6,000 scoped source/test lines plus supporting excerpts considered; not a full-codebase audit.

## Validation commands/results

Reviewer executed static scope/diff inspection only (`git diff --stat && git status --short`, focused `git diff` calls). No reviewer build/lint/test execution or source modifications.

Execution evidence supplied by Phase07Tester and inspected at `plans/reports/tester-261102-2308-phase-07-agent-hub-and-recipes.md:13-125`:

| Command | Reported result |
|---|---|
| `pnpm --filter @dam-hopper/ui test src/os/agent-hub.test.ts src/lib/traditional-terminal-agents.test.ts src/os/recipes src/os/app-registry.test.ts` | 6 files, 125 passed, 0 failed/skipped; exit 0 |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/os-agent-hub.browser.tsx browser-tests/agent-status-bridge.browser.tsx browser-tests/os-recipes.browser.tsx` | 3 files, 6 passed, 0 failed/skipped; exit 0; React act warnings |
| `pnpm --filter @dam-hopper/ui exec tsc --noEmit` | 0 compiler errors; exit 0 |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | 0 compiler errors; exit 0; **not E2E runtime execution** |

Not exercised: package build, lint, live isolated-PTY E2E, real cross-tab held-create/reload/lost-response/late-adoption acceptance, complete OS Cognito interaction/export behavior. Type coverage percentage and test coverage percentage unavailable; do not infer them from passing counts.

## Unresolved questions

- None blocking identification of the defects above. Runtime validation of their corrected behavior remains outstanding; current passing scoped suites do not answer F1/AC8 acceptance.
