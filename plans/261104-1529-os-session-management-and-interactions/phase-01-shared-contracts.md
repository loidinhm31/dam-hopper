# P01 — Shared contracts and fixtures

Priority P2 · Status pending · Effort 8h · Owner ContractOwner · Sequential prerequisite.

## Context and prerequisites
- [Frozen C1–C5](architecture-contracts.md), [intake](reports/planning-intake.md), [terminal evidence](reports/session-contract-evidence.md), [interaction evidence](reports/recipe-interaction-evidence.md), [acceptance](acceptance-matrix.md).
- Current seams: `packages/ui/src/api/client.ts:194-220`, `api/ws-transport.ts:3156-3204`, `api/queries.ts:1099-1119`, `hooks/use-aggregated-terminal-sessions.ts:54-116`, `os/intents.ts`, `os/types.ts`, `os/window-context.tsx`.
- Entry: separate later implementation authorization; coordinator has exclusive handoff for overlapping related plans listed in [ownership](execution-ownership.md). No unfinished branch may supply this prerequisite.

## Requirements, rationale and architecture
Freeze the small contract surface before P02/P03/P05/P06 fan-out. Headers attach authority to original list body; fresh epoch + old row unsafe. Preserve numeric compatibility while additive exact strings allow full-u64 inventory actions; malformed exact never numeric fallback. Live termination and pre-admission restart cancellation have distinct completion proofs. No new query, poller, runtime, registry or persisted authority. Binding [V1–V3 receipt](reports/validation-decisions.md).

### Task `freeze-shared-contracts`
**Modify:** `packages/ui/src/os/types.ts`, `packages/ui/src/os/intents.ts`, `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` (MountedSession type only). **Create:** `packages/ui/src/api/terminal-session-contract.ts`, `packages/ui/src/api/terminal-termination-fixtures.json`. **Delete:** none. ContractOwner alone; transfer these files to subsequent named owners only after this task is terminal. No behavioral consumer cutover yet.

1. Publish complete TS types (not placeholder implementations) and independent literal fixture examples. Exact proposed names:
   - `TerminationMetadata = {version:1;serverEpoch:string} | {version:null;serverEpoch:null;reason:"unsupported"|"invalidMetadata"}`.
   - `TerminalInventoryRow = SessionInfo & {readonly incarnationExact?:string;readonly terminationState?:"live"|"terminationRequested"|"restartPending"|"restartCancelled"|"exited"|"unavailable"}`; optional wire fields permit readable old/malformed rows, not eligibility. `TerminalInventoryDetailedRow = TerminalInventoryRow & {buffer_bytes:number}` preserves existing detailed key. ClientOwner adds optional compatibility fields to SessionInfo P03; shared contract does not require concurrent edits.
   - `TerminalInventoryPayload = {sessions:readonly TerminalInventoryRow[];termination:TerminationMetadata}`; detailed equivalent uses TerminalInventoryDetailedRow. `TerminalInventoryObservation = TerminalInventoryPayload & {owner:ConnectionRef|null}` (and detailed equivalent). Null owner means ambient READ-ONLY; capture owner before fetch/check after await.
   - `TerminalTarget = Readonly<{profileId:string;generation:number;serverEpoch:string;terminalId:string;incarnation:string}>`; incarnation comes ONLY from canonical positive-u64 `incarnationExact` in that same observation. Missing/malformed exact ->no target even if numeric safe. When `Number.isSafeInteger(n)` for legacy numeric, require `n>0 && String(n)===incarnationExact`; safe disagreement/nonpositive rejects. Unsafe numeric neither invalidates valid exact nor supplies equality proof. No raw-ID/latest-incarnation/port-event target construction.
   - `TerminalCloseRequest = {windowId:string;entry:"frame"|"window-list"|"pane-tab";target:TerminalTarget|null;availability:"live"|"restartPending"|"restartCancelled"|"exited"|"unknown";reason?:string}`. Exact-owner state, not alive/agent label, determines policy.
   - `TerminationState`: `captured | confirming | dispatching | terminationRequested | restartCancelled | ended | refused | failed | outcomeUnknown`, carrying immutable target, `origin:"live"|"restartPending"`, typed reason/error. Live ->202 then exact observed exited ->ended; pending ->200 exact cancellation ->restartCancelled (or matching retained marker after loss). Neither ordinary exited/absence for pending origin nor cancellation marker for live origin completes. After dispatch no transition to cancelled/no-effect.
2. Freeze wire: list/detailed arrays and legacy numeric fields retained; additive flat `incarnationExact` + `terminationState` in BOTH projections, detailed retains `buffer_bytes`. API `TerminalInventoryRowDto` flattens SessionMeta, exact u64.to_string(), state, optional buffer bytes (omitted for list). BackendOwner defines `PtyManager::termination_inventory_snapshot(include_buffer_bytes:bool) -> TerminalInventorySnapshot {server_epoch,rows}` with internal `{meta,incarnation:u64,termination_state,buffer_bytes:Option<usize>}` rows under one inner lock; API serializes that one snapshot outside lock. No `list()` + second state query or new SessionMeta/persistence fields. Headers `X-DamHopper-Termination-Version:1`, `X-DamHopper-PTY-Epoch:<canonical lowercase hyphenated UUID>`, `Cache-Control:no-store`; CORS exposes both. `terminal:listObservation` / `terminal:listDetailedObservation` decode SAME GETs at HTTP boundary; compatibility methods remain array reads without extra request or global epoch.
3. Freeze strict authenticated `POST /api/terminal/{id}/terminate`: application/json, max512 bytes before allocation/deserialization; exactly `{version:1,expectedServerEpoch:string,expectedIncarnation:string}` with canonical UUID/positive-u64 decimal (1..18446744073709551615; no signs/whitespace/leading zero/floats/exponent). Owner fields never sent. `TerminationResult = {version:1;serverEpoch:string;terminalId:string;incarnation:string;outcome:"terminationRequested"|"restartCancelled"}`; 202 ONLY terminationRequested after live signal, 200 ONLY restartCancelled after exact pending cancellation. Validate status/outcome+exact echoed identity; origin-incompatible/malformed success ->outcomeUnknown, not completed End.
4. Stable `{error:string,code:string}` envelope: 400 `TERMINATION_INVALID_REQUEST` / `TERMINATION_UNSUPPORTED_VERSION`; 404 `TERMINATION_NOT_FOUND`; 409 `TERMINATION_EPOCH_MISMATCH`, `TERMINATION_INCARNATION_MISMATCH`, `TERMINATION_REPLACEMENT_PENDING`, `TERMINATION_NOT_LIVE`, `TERMINATION_MANAGER_CLOSING`, `TERMINATION_ALREADY_REQUESTED`; 500 `TERMINATION_SIGNAL_FAILED`; 413 `TERMINATION_BODY_TOO_LARGE`; existing 401/403/415. Precedence parse/auth ->epoch ->closing/handoff ->pending replacement ->absent across stores ->exact current live/dead incarnation ->already requested/cancelled ->live signal OR exact restart admission predicate ->not-live/not-pending. Known ordinary exited/unavailable without pending restart is 409 NOT_LIVE; pending-only create is replacement conflict. Duplicate requested/cancelled ->ALREADY_REQUESTED. Refusals mutate nothing. Pending cancellation clears exact fleet pending/sets tombstone completion without signal/history eviction; admitted replacement always protected.
5. Freeze `TerminalPlacementIntent = {sourceHubWindowId:string;target:TerminalTarget;action:"focus-existing"|"open-beside"|"move-beside"}` as runtime-only `terminal:place-existing`. `ReviewTarget = Readonly<{profileId:string;generation:number;terminalId:string;terminalIncarnation:string;ompSessionId:string;serverEpoch:string;rootId:string;baselineId:string}>`; strings nonempty, incarnation canonical exact, root/baseline verified. Review epoch SessionChanges NOT PTY. Numeric agent/port/replay evidence joins ONLY positive-safe lossless canonical equality to exact target; unsafe/missing proof unavailable, never round/coerce or broaden producers. Status string incarnation matches exact inventory. `session-changes:open` full tuple; P04 producers/P07 deep links migrate. Locator focus discovery-only/no auto-create/mutation authority.
6. Add optional in-memory `OsWindow` runtime identity member (terminal target OR review target) and optional string authority field in ResourceClaimKey rather than overloading numeric epoch. Runtime identity must never serialize as trusted portable layout. P07 supplies explicit persistence projection/revalidation; older layout remains compatible. Freeze `toggleWindowMode(windowId)` atomic store operation and `calculateNextFloatBounds(session,desktopId,viewport)` / `projectFloatBounds(saved,viewport)` pure seams. P06 owns their complete implementations.
7. Freeze shell input seam: actual Cognito boolean + current named modal/nonmodal ownership callbacks propagated from OsShell; Radix owns nested dismiss/focus. At most one shell nonmodal/palette active by controlled state; child dialogs own their nested portal/confirmation state. Modal depth/token is explicit mount/unmount state, not a portal selector or generalized layer registry. Freeze `requestTerminalClose(request,onCloseView)` controller callback for P04 UI, mounted once P07; presentation callback is never invoked on mere 202. Existing Close store action remains low-level presentation primitive for programmatic cleanup. Extend existing MountedSession type with optional `terminalTarget:TerminalTarget` and `attachPolicy:"existing-only"|"create-explicit"`; P07 implements propagation. No creation behavior is added in this prerequisite.
8. Fixtures: max-u64 exact inventory ELIGIBLE despite unsafe legacy number; canonical exact with safe legacy equality/disagreement; malformed/missing exact NEVER numeric fallback; headers missing/malformed/version unsupported; same IDs/incarnations across epochs; all six flat states; 200 exact cancellation vs202 requested; pending replacement precedence/both orderings; stale queue, normal respawn publication, same-ID later create; signal/wait failure and origin-dependent loss reconciliation. Unsafe downstream agent/port/replay numbers cannot join even with valid exact inventory. Rust include_str! and TS consume same independent literal JSON; no duplicated expected algorithms or runtime-proof claim.

## Consumer acceptance and checks
P02/P03 compile against one frozen wire contract without waiting for each other; P05/P06 use already-final intent/types/canvas seams. Headerless servers remain browsable but never End-enabled. Commands at P08: `pnpm --filter @dam-hopper/ui build`; backend/API and client contract checks named in P02/P03; no wiring-only contract tests.

## Failure, rollback, security and resources
Contract disagreement blocks fan-out and requires coherent revision, not silent worker divergence. Runtime identities stay memory-only; no output/credentials in fixtures. Restore only owned interface additions if whole change is abandoned; never retain an unsafe compatibility End alias. This phase supplies schemas/fixtures, not fake runtime implementations.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "freeze-shared-contracts",
    "title": "Freeze shared identity, action and wire contracts",
    "blocked_by": [],
    "allowed_files": [
      "packages/ui/src/api/terminal-session-contract.ts",
      "packages/ui/src/api/terminal-termination-fixtures.json",
      "packages/ui/src/os/types.ts",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/components/organisms/MultiTerminalDisplay.tsx"
    ],
    "constraints": [
      "ContractOwner only; P02/P03/P05/P06 start only after complete contract handoff.",
      "Preserve C1-C5; no product implementation or stubbed runtime services in this prerequisite."
    ],
    "acceptance": [
      "Every field, error, action and metadata boundary above is settled and supplied before concurrent work.",
      "Inventory fixtures cover full-u64 exact eligibility, malformed no-fallback, distinct requested/cancelled states and origin-dependent completion."
    ],
    "verification": [
      "At P08 run pnpm --filter @dam-hopper/ui build and fixture-consuming P02/P03 checks; inspect authority persistence projection in P07."
    ]
  }
]
```

- [ ] <!-- evcrate-task:freeze-shared-contracts --> Freeze shared identity, action and wire contracts
