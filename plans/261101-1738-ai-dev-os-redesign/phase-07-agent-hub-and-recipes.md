# Phase 07: P4 — Agent Hub home and Launch Recipes

Estimate: 64h; implementation status: **administratively closed per user approval (2026-11-03 00:05:00 +07:00); technical acceptance blocked per Cycle 3 review (score 5/10 with 3 Critical findings C1–C3 and 9 warnings W1–W9)**. [Overview](plan.md) · [Ownership](ownership.md) · [Acceptance](acceptance.md).

## Context / objective
Priority P1; status administratively closed per user approval (2026-11-03 00:05:00 +07:00) with technical acceptance carryovers tracked into Phase 08 & Phase 09. AI-centered fleet home plus client-only declarative launch. [Hub/recipe decisions](../reports/brainstorm-261101-1738-ai-dev-os-redesign.md#43-recipes-v1-client-json-dam-hopperosv1recipes-exportimport) override illustrative designer fields. [Terminal create finding](source-evidence.md#terminal-create-is-not-idempotent).

## Architecture / requirements
- Hub singleton/none/maximized Desktop1 “Hub”; recipe manager singleton/none/float. Static catalog totals exactly17. Existing qualified roster builder + useAgentStatusStore + provenance/status reducers, not a second interpreter of PTY lifecycle. Needs attention -> Working -> Idle -> Unknown/Unavailable; preserve Platform unqualified/Unsupported descriptions. Idle is NOT success; Codex status-only, Claude attention-only, expired hook lease Unknown. No raw tool commands, prompts, env or invented reason/timing fields from wireframe.
- Hub fans in connected profile terminal lists/workflow overview and metadata-only session-change status, bounded/lazy counts. No eager diffs/file scans per agent. Jump restores/switches/focuses exact terminal/window; review and workflow/recipe intents retain owner identity.
- RecipeV1 exactly approved single profileId + project, terminal steps {key,name,worktreePath?,command,agent?}, app steps {key,appId,worktreePath?}, step-key tile/float layout. Designer multi-profile/per-step profile and automatic worktree creation are not v1. `agent` is descriptive; don't infer executable availability without existing supported evidence.
- V3 Save subset: user chooses server/profile+project. BEFORE save, show matching windows/steps AND explicitly list each excluded nonmatching window with name/context/reason; require subset confirmation. Do NOT reject the whole mixed desktop or omit silently. Same-project worktrees included; prune excluded leaves/empty branches deterministically and renormalize ratios without changing source windows. Contextless/fleet windows not representable in selected target appear excluded, never rebound; supported app steps can be explicitly authored.
- Preflight existing singleton/perContext app instances and centrally claimed resources before any POST. If layout needs an instance already on another desktop, show the exact move/reuse and obtain explicit consent; cancel leaves both desktops unchanged. Layout application moves the same window ID once, never duplicates placement or steals a visible PTY slot; ordinary activation still focuses the existing owner.
- `dam-hopper:os:v1:recipes` persists recipes; `:recipe-launches` persists local launch records with launchId, frozen recipe snapshot, desktopId and per-step UUID, original profileId/serverEpoch, incarnation when observed, durable state and authoritative resolution evidence. Runtime connection generation is captured/rechecked per action, not persisted; launch records are evidence to revalidate, never live ownership. Capture the original serverEpoch from existing authoritative snapshots before dispatch; unavailable epoch proof blocks launch/reconciliation rather than inventing identity.
- Launch record is sole adoption authority. Saving a desktop can seed an explicit local capture/resume record for selected exact PTYs (profileId+serverEpoch+id+incarnation); no ambient/name/command matching. “Launch/Resume captured run” revalidates exact refs and restores topology without recreating alive terminals. An intentional independent “New run” has a new launchId/UUIDs; it cannot clear, clone/reset or relaunch a blocked unknown step as a recovery shortcut.
- Preflight connected profile/project/worktrees/app availability/commands/targets; missing target -> prompt/stop, never auto-create. Commands must be explicitly authored or individually confirmed, never derived from terminal content or silently copied into executable recipes. No env field, credentials, terminal output or dirty text. Commands themselves may contain secrets: export explicitly warns that commands AND paths are included and shows a review preview; no promise of automatic secret detection.
- Persisted step state machine: `pending -> dispatched -> {confirmed | failed | outcomeUnknown}`. `pending` reserves a fresh validated UUID; persist `dispatched` and original profile/epoch BEFORE the network effect. Only an authoritative successful creation identity makes `confirmed`; only an attributable definitive server-side rejection/failure proving the create cannot still succeed makes `failed` (not a generic proxy/transport status). Interrupted dispatch, timeout, response loss, profile retirement or reload of a nonterminal pending/dispatched state becomes `outcomeUnknown`; never optimistically reset to pending.
- Serialize launch/retry/reconciliation per record, including same-origin tabs via Web Locks. Every entrant re-reads durable step state UNDER the lock before deciding or sending, rather than trusting stale in-memory state. Persist resolution atomically before releasing the lock. Unsupported lock service or failed durable write blocks dispatch/retry visibly. **POST with an existing ID kills/replaces that session**; disable automatic mutation retries. No extra scheduler/API or exactly-once-server claim.
- `outcomeUnknown` is BLOCKED. Timeout, an absent entry in list/listDetailed, elapsed time or user acknowledgement NEVER clears it and NEVER authorizes another UUID: the server reserves incarnation before slow spawn and publishes the live entry later. The original request can still succeed after an empty list response. Manual controls are “Open terminal list” and “Dismiss step (no relaunch)”; dismissal retains the unresolved durable identity/tombstone, not a reusable fresh step.
- Only authoritative reconciliation clears unknown: observe the original completed create as exact profileId+original serverEpoch+id+incarnation, then persist `confirmed` and adopt that identity without POST; OR prove the original can no longer succeed, e.g. authoritative changed serverEpoch proves that server process restarted and its in-flight creation died, then persist `failed` with that evidence. Fence epoch/list observations against connection retirement and epoch changes; absence of epoch/incarnation proof remains unknown. Changed incarnation or an equal ID on a different epoch is not adoption proof. An attributable definitive late server error may likewise prove failure.
- Retry may allocate a NEW UUID only for a genuinely unstarted step or a `failed` step whose authoritative evidence proves the original cannot still succeed, after explicit user retry. Confirmed alive steps are reused/focused, never reposted; confirmed exited steps require an explicit new-run action, never an unknown-outcome retry. Partial failure retains desktop, successful PTYs/windows and errors; no rollback kill. Closing/deleting recipe/window or dismissing a step never kills a process or erases unresolved execution evidence.
- Imported recipes are inert until schema, appIds, full topology/reference integrity and numeric bounds validate and commands/targets/worktrees are reviewed; launch requires explicit action. Imported/exported launch records cannot authorize adoption and are excluded from portable recipe export. Session JSON import cannot trigger launch; appState fields are allowlisted.

## Ordered implementation by task ID
### implement-agent-hub
1. Build a Hub read model over existing qualified roster builder and bridge/store subscriptions; include connected profiles and honest disconnected unavailable rows, same-named resources separated by owner/concrete identity.
2. Add urgency groups/filters/summary, jump/review/workflow/recipe affordances and attention routing; register singleton home/default desktop. Fenced focus must never create a terminal to satisfy a stale jump.
### implement-launch-recipes
1. Add Save subset server+project chooser and matching/excluded-window preview BEFORE confirmation. Capture only confirmed matching steps with deterministically pruned topology; empty subset explains/no write, cancel changes nothing. Validate keys/refs/appIds/bounds; no execution during parse/render; instance move consent remains a separate launch preflight.
2. Implement preflight and isolated recipe engine over existing bound terminal.create/list plus authoritative epoch snapshots and WM/intents. Persist pending/dispatched state before remote effects; re-read durable state inside each cross-tab lock; apply layout by stable step keys without removing failed/unknown placeholders. Store exact authoritative completion/failure proof before resolving state.
3. Add Resume captured/New run/retry affordances and blocked unknown controls above. Save-current commands require explicit authoring/individual confirmation, not automatic executable extraction from terminal content; export warns commands and paths included. Import validates schema/appIds/topology/bounds before inert review.
4. Test mixed-context selected server/project subset, named/contextual exclusion preview BEFORE save, confirm/cancel/empty subset, same-project worktree inclusion, deterministic topology and unchanged source desktop. Retain F1 held-create/reload/lost-response/second-tab ZERO-additional-create/exact late-adoption, authoritative failure/epoch proofs, inert imports, authored commands and singleton move/cancel.

## Success / checks
AC7: >=2-profile urgency/jump proof with same terminal IDs; no lifecycle-derived states. AC8: save/reload/captured resume recreates topology and reuses verified alive refs; authoritative failed steps flag and explicit retry never duplicates success. A pending creation held through lost response/reload/second-tab retry yields ZERO additional create requests; late success is adopted only by exact profile+original serverEpoch+id+incarnation. Empty lists/time/user acknowledgement cannot release unknown. Commands explicitly authored/confirmed; imports validated and inert; export warns commands+paths. Main runs planned checks on isolated real PTYs; server create semantics unchanged.

## Risks / security / rollback
Biggest risk is destructive or duplicate creation. Unknown state stays durably blocked across reload/tabs/dismissal; only exact original completion or proof the original cannot still succeed resolves it. Never convert user acknowledgement/absent lists into replacement permission. Cross-tab lock/durable write/epoch proof failures fail closed. Local records/imports confer no live ownership. Commands can contain user-authored secrets; explicit confirmation/export warning includes paths. Roll back AI registrations/engine/UI while retaining unresolved launch evidence and recipe JSON; no mass process cleanup, erased unknown tombstones or automatic relaunch on startup. Next: gated cutover.

## Literal file actions and ownership

Paths below are project-root-relative (`/home/loidinh/WS/dam-hopper/`). Directory entries own all descendants; no glob expansion, no implicit adjacent-test ownership. All unlisted source/docs/other plans read-only. Existing files are re-read before editing; discoveries requiring additional writable paths return to coordinator for a reviewed contract revision.

### `implement-agent-hub` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/src/os/apps/AgentHubApp.tsx` |
| Create | `packages/ui/src/os/agent-hub.ts` |
| Create | `packages/ui/src/os/agent-hub.test.ts` |
| Modify | `packages/ui/src/os/app-registry.ts` |
| Modify | `packages/ui/src/os/desktop-templates.ts` |
| Modify | `packages/ui/src/os/intents.ts` |
| Modify | `packages/ui/src/os/notifications.ts` |
| Create | `packages/ui/browser-tests/os-agent-hub.browser.tsx` |

### `implement-launch-recipes` file actions

| Action | Literal writable path |
|---|---|
| Create | `packages/ui/src/os/recipes/types.ts` |
| Create | `packages/ui/src/os/recipes/schema.ts` |
| Create | `packages/ui/src/os/recipes/schema.test.ts` |
| Create | `packages/ui/src/os/recipes/recipe-engine.ts` |
| Create | `packages/ui/src/os/recipes/recipe-engine.test.ts` |
| Create | `packages/ui/src/os/recipes/launch-records.ts` |
| Create | `packages/ui/src/os/recipes/launch-records.test.ts` |
| Create | `packages/ui/src/os/recipes/persistence.ts` |
| Create | `packages/ui/src/os/apps/RecipesApp.tsx` |
| Create | `packages/ui/src/os/recipes/RecipeEditor.tsx` |
| Create | `packages/ui/src/os/recipes/LaunchReview.tsx` |
| Modify | `packages/ui/src/os/app-registry.ts` |
| Modify | `packages/ui/src/os/app-registry.test.ts` |
| Modify | `packages/ui/src/os/desktop-templates.ts` |
| Modify | `packages/ui/src/os/CommandPalette.tsx` |
| Modify | `packages/ui/src/os/DesktopCanvas.tsx` |
| Modify | `packages/ui/src/os/apps/AgentHubApp.tsx` |
| Create | `packages/ui/browser-tests/os-recipes.browser.tsx` |
| Create | `packages/ui/e2e/os-recipes` |

## Durable task contracts

Exactly one authored fence; no execution state/hydration, completion or test receipts implied. Dependency IDs are plan-wide.

```evcrate-tasks
[
  {
    "id": "implement-agent-hub",
    "title": "Implement qualified multi-profile Agent Hub home",
    "blocked_by": [
      "implement-system-monitor"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/AgentHubApp.tsx",
      "packages/ui/src/os/agent-hub.ts",
      "packages/ui/src/os/agent-hub.test.ts",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/desktop-templates.ts",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/notifications.ts",
      "packages/ui/browser-tests/os-agent-hub.browser.tsx"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Hub uses qualified roster/status reducer with approved urgency order and no fabricated command/provenance/state fields.",
      "Jump from any row restores correct desktop/window and terminal incarnation across two profiles without duplicate attach."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os/agent-hub.test.ts src/lib/traditional-terminal-agents.test.ts",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-agent-hub.browser.tsx browser-tests/agent-status-bridge.browser.tsx"
    ]
  },
  {
    "id": "implement-launch-recipes",
    "title": "Implement safe client recipes with resumable concrete launch records",
    "blocked_by": [
      "implement-agent-hub"
    ],
    "allowed_files": [
      "packages/ui/src/os/recipes/types.ts",
      "packages/ui/src/os/recipes/schema.ts",
      "packages/ui/src/os/recipes/schema.test.ts",
      "packages/ui/src/os/recipes/recipe-engine.ts",
      "packages/ui/src/os/recipes/recipe-engine.test.ts",
      "packages/ui/src/os/recipes/launch-records.ts",
      "packages/ui/src/os/recipes/launch-records.test.ts",
      "packages/ui/src/os/recipes/persistence.ts",
      "packages/ui/src/os/apps/RecipesApp.tsx",
      "packages/ui/src/os/recipes/RecipeEditor.tsx",
      "packages/ui/src/os/recipes/LaunchReview.tsx",
      "packages/ui/src/os/app-registry.ts",
      "packages/ui/src/os/app-registry.test.ts",
      "packages/ui/src/os/desktop-templates.ts",
      "packages/ui/src/os/CommandPalette.tsx",
      "packages/ui/src/os/DesktopCanvas.tsx",
      "packages/ui/src/os/apps/AgentHubApp.tsx",
      "packages/ui/browser-tests/os-recipes.browser.tsx",
      "packages/ui/e2e/os-recipes"
    ],
    "constraints": [
      "Only listed paths writable; escalate additions to coordinator before editing.",
      "No mid-flight build/test/formatter runs while other writers are active; main integration owner verifies after the group joins."
    ],
    "acceptance": [
      "Save/reload/captured resume retains layout and exact alive PTYs; new run uses fresh IDs.",
      "Imported recipes validate schema/appIds/topology/bounds and remain inert; commands are explicitly authored/confirmed, and export warns commands plus paths are included.",
      "Durable pending -> dispatched -> confirmed/failed/outcomeUnknown state is re-read under the cross-tab lock; interrupted dispatch, timeout, response loss and reload never reset an unresolved step to pending.",
      "Unknown held across reload/absent lists/second-tab retry produces ZERO additional create requests; late success is adopted only as exact profile+original serverEpoch+id+incarnation.",
      "Timeout, elapsed time, absent list entries and user acknowledgement/dismissal never authorize another UUID; only authoritative failure/no-longer-can-succeed proof permits explicit replacement retry; no rollback kills.",
      "Exactly17 manifests match catalog; mixed-context Save subset captures chosen server/project only after matching/excluded-window preview and confirmation, with deterministic pruned topology and unchanged source; singleton moves need separate consent."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os/recipes src/os/app-registry.test.ts",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-recipes.browser.tsx",
      "E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- os-recipes",
      "pnpm --filter @dam-hopper/ui build",
      "Under os-recipes commands verify subset choice/excluded preview/confirm/cancel/empty/topology/no source changes; retain held-create/reload/second-tab zero-additional-create/exact late-adoption and authoritative proof-gated retry cases."
    ]
  }
]
```

- [x] <!-- evcrate-task:implement-agent-hub --> Implement qualified multi-profile Agent Hub home
- [x] <!-- evcrate-task:implement-launch-recipes --> Implement safe client recipes with resumable concrete launch records

## Administrative Closure & Carried Technical Findings (2026-11-03 00:05:00 +07:00)

Phase 07 is administratively closed per recorded user approval with noted issues carried forward to Phase 08 & Phase 09. Technical acceptance remains blocked per Cycle 3 review ([plans/reports/code-review-261102-2353-phase-07-agent-hub-and-recipes-cycle-3.md](../reports/code-review-261102-2353-phase-07-agent-hub-and-recipes-cycle-3.md); score 5/10 with 3 Critical findings C1–C3 and 9 warnings W1–W9).

Tester-reported verification records 126 unit tests across 6 files, 6 browser component tests across 3 files, and 2 clean TypeScript typechecks (`tsc --noEmit`, `test:e2e:typecheck`); user-reported context notes Vite production web build passes. Exactly 17 application manifests are registered in `app-registry.ts`.

Task checkboxes above are marked checked for administrative phase closure; technical acceptance and execution safety remain open release qualification gates.

### Carried Implementation Defects & Qualification Gates to Phase 08 & Phase 09:
1. **C1 (Critical) — Cross-Tab Durable Run Selection & Reservation Authority:**
   `LaunchReview.tsx` checks React `hasUnknown` scoped only to the current desktop outside any lock. New records get distinct per-launch locks, so engine locking does not serialize the decision to create a run. Two tabs mounted before launch or different desktops can concurrently initiate separate runs, risking duplicate PTY creation while an original request can still succeed (violating requirements 15/18/19 and AC8/F1). Requires atomic durable run-selection/start authority covering all tabs and virtual desktops.
2. **C2 (Critical) — Action-Time & Post-Await Epoch Authority Fencing:**
   `LaunchReview.tsx` checks epoch authority at render time, but not at the effect/resolution boundary under lock. The engine checks profile only, not current generation/epoch; it never rechecks after `terminal.create` awaits. Reconciliation fetches lists outside the lock, swallows list errors into `[]`, and passes render-time epoch without an owner tuple. Retained HTTP clients lack closed-state guards. Requires action-time/post-await epoch checks under lock and truthful preservation of list failures before live container qualification.
3. **C3 (Critical) — Shared Launch Storage Blob & Un-Locked Startup Recovery:**
   All launch records reside in a single `localStorage` blob under `dam-hopper:os:v1:recipe-launches`. Per-record locks do not protect whole-blob read-modify-write operations or startup recovery, risking evidence loss between concurrent tabs. Corrupt JSON or unreadable storage fails open to an empty collection, which can erase unknown tombstones and permit destructive replacement. Requires storage-wide transactional protection under Web Locks and fail-closed corrupt-storage preservation.
4. **AC8 / W1 (High) — Window Manager Layout Restoration & Live PTY Adoption:**
   `recipe-engine.ts` dispatches terminals but does not restore window topology into the Zustand window store (`TileTree<T>`), instantiate apps, or adopt verified alive PTYs; `capturedPtyMap` has no production caller and Save does not seed captured resume.
5. **Warnings W2–W9 Carryover:**
   - **W2:** Reviewed recipe vs executed frozen launch snapshot mismatch.
   - **W3:** Incarnation enforcement fails open and is missing on Hub Jump path.
   - **W4:** Incomplete preflight (instancing modes, project/worktree availability, central resource claims).
   - **W5:** Permissive portable schema/state boundary (appState leakage, non-binary splits, unconstrained dimensions).
   - **W6:** Determinism claim partial (canonical binary path only; compatibility splits generate random UUIDs).
   - **W7:** Command confirmation is a UI-only boolean, not a saved-value invariant.
   - **W8:** UI/Hub completeness gaps (RecipesApp export view clipping, Hub template not wired to default startup, missing workflow overview fan-in).
   - **W9:** Test suite depth deficiencies (locked helpers not imported by unit tests, browser tests cover happy paths only, E2E spec does not import JSON, live PTY held-create / two-tab F1 checks unexercised).
