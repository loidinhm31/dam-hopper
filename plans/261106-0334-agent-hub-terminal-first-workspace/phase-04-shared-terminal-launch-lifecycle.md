# Phase 04 — Shared terminal launch lifecycle

## Context Links
- Evidence A "Terminal launch lifecycle", B3, C (Hub launch reuses lifecycle): `./reports/scout-261106-0334-evidence-and-decisions.md`
- P01 claim key + revealWindow: `./phase-01-shared-contracts.md`

## Overview
- Priority: P1 · Status: completed · Effort: 8h
- Extract reservation identity + create/settle core from TerminalsApp/action-executor into a window-agnostic module with identical fences and settlement outcomes; TerminalsApp/action-executor adopt it unchanged in behavior; TerminalsApp adopts P01 claim-key helper and B1 reveal.

## Parallelization Info
- Group A · Depends on: P01 · Blocks: P06 · Concurrent peers: P02, P03, P05 (disjoint files).

## Key Insights
- Identity params duplicated: `packages/ui/src/os/action-executor.ts:255-271` and `packages/ui/src/os/apps/TerminalsApp.tsx:287-302` (same shape, `LaunchIdentityParams` `packages/ui/src/os/persistence.ts:919-929`).
- Create/settle core `TerminalsApp.tsx:91-244`: pre-check connected + generation (settle `confirmed-not-created`), `client.terminal.create`, canonical `serverEpoch` (`isCanonicalUuid`) + `incarnationExact` (`isCanonicalPositiveU64`) → `TerminalTarget` (`:144-174`), settle `confirmed-success` even if owner changed after (`:183-197`, Contract C3 Rule 3) else `uncertain`, post-owner-change error (`:199-201`), catch: `confirmed-not-created` if not sent or HTTP 400/401/403/404/413/422, else `uncertain` (`:228-241`).
- `reserveTerminalLaunch` blocks while an unresolved (`reserved-dispatch-capable`/`uncertain`) record has the same canonical identity — no TTL (`persistence.ts:1109-1121`). Hub inherits this (parity).
- TerminalsApp denied UI only `focusWindow(holder)` (`TerminalsApp.tsx:379-397`) — cannot reach a holder on another desktop (B1).
- No `TerminalsApp` unit test exists; `packages/ui/src/os/action-executor.test.ts` exists.
- V3 facts: `reserveTerminalLaunch` returns `{status:"blocked", existingAttemptId}` for an unresolved same-identity record (`persistence.ts:1109-1121`; result type `:962-972`); `settleTerminalLaunch` moves `reserved-dispatch-capable|uncertain` → `confirmed-success|confirmed-not-created` and keeps settled states immutable (`:1218-1293`). `StoredLaunchRecord` carries `profileId`, `requestedTerminalId`, `ownerGeneration`, `state`, `provenance`, `failureReason` (`:931-955`); `endpointBinding` is the constant `"default-endpoint"` (`action-executor.ts:255`) so the live profile owner is the only endpoint identity. The journal reader `readLaunchJournalDocument` is module-private (`:1027`) and no exported per-attempt getter exists (grep 2026-11-06) → P04 adds one. Journal tests live in `packages/ui/src/os/app-launch-journal.test.ts` (no other phase writes it).
- F8 facts: action-executor reserves then opens a TerminalsApp window that executes later (`action-executor.ts:273-312`) → a reserved attempt may be legitimately in flight in this page with its id absent from inventory. Aggregated `isSuccess` is any-profile (`hooks/use-aggregated-terminal-sessions.ts:137-139`) and inventory query data is cached with `staleTime: Infinity` (`api/queries.ts:1138`) → neither proves a fresh per-profile absence. Fresh owner-bound read: `terminalInventoryQueryOptions(owner).queryFn` (`api/queries.ts:1104-1137`, `getBoundTransport(owner)`, throws on stale owner `:1126-1131`); exact target via `createTerminalTargetFromObservation` (`api/terminal-session-contract.ts:462`; null for unsupported/noncanonical).
- F9 facts: `settleTerminalLaunch` returns `{status:"uncertain"}` on journal read/write failure (`persistence.ts:1227-1241,1281-1292`) and `{status:"settled"}` for an already-settled record regardless of requested outcome (`:1244-1250`) → `settled` alone does not prove the intended durable state.

## Requirements
- R1 `buildTerminalLaunchIdentity({ profileId, target: FsTargetRef, fallbackProjectId?, fallbackWorktreeId?, cwd })` reproduces both call sites exactly.
- R2 `executeTerminalLaunch(input)` returns a discriminated outcome; all fences/settlements identical to today; no window-store access; no React.
- R3 `reserveAndExecuteTerminalLaunch` (for Hub, P06) = reserve (with caller's `desktopId`, `generation`) then execute; returns `{kind:"blocked", reason}` on reservation block.
- R4 Hub-closed-while-pending semantics (defined here, implemented by callers): the promise is not tied to any component; it always settles the journal normally; callers apply UI effects only if still mounted/current; a confirmed session simply appears in inventory as a background session (no window opened, never killed).
- R5 TerminalsApp uses R1/R2 with identical UI states (`isLaunching`, `launchError`, appState writes incl. `target`, `incarnationExact`, `serverEpoch`, `createError`); action-executor uses R1.
- R6 TerminalsApp `claimKey` via `buildTerminalClaimKey` (identical key); denied button calls store `revealWindow(holderId)` (B1 parity: switch desktop + restore + focus); label/test ids unchanged.
- R7 Presentation input (F2, P01 contract): TerminalsApp's attach effect (`TerminalsApp.tsx:331-355`) acquires `acquireTerminalPresentation(term, "terminals:<windowId>")` after claim success + attach (also on registry-callback re-attach of a late renderer); on claim loss/unmount it releases, and any cleanup it performs (blur, suppression) runs via `runIfCurrentPresenter`. Acquisition is what restores stdin on a quiet PTY after a Hub→standalone handoff (TerminalPanel re-syncs via subscription, P03 R7b).
- R8 Manual stuck-launch resolution (V3; F8/F9; no auto-reconcile). All in `terminal-launch-lifecycle.ts`:
  1. In-flight registry (page-scoped, in-memory): `reserveTrackedTerminalLaunch(identity, meta)` = `reserveTerminalLaunch` + mark attemptId active; `executeTerminalLaunch` marks its attemptId active before dispatch and releases it only after its settlement call returns (finally). `reserveAndExecuteTerminalLaunch` and action-executor use the tracked reserve, so an attempt is active from reservation until its executor settles. `isLaunchAttemptActive(attemptId)`. A reservation whose executor never runs in this page stays active until reload (fail closed).
  2. `getLaunchAttempt(attemptId)` (new read-only export in `persistence.ts`): `{status:"ok", record} | {status:"missing"} | {status:"unreadable", reason}`. `missing` or settled → `{kind:"already-resolved"}`; `unreadable` → `{kind:"unavailable"}`.
  3. `isLaunchAttemptActive` → `{kind:"in-flight"}`; never settles.
  4. Fresh owner-qualified observation for THAT profile: snapshot of `record.profileId` must be `connected`; capture its `owner` before I/O; `observeInventory(owner)` (default: `terminalInventoryQueryOptions(owner).queryFn()`, network read; cached query data, aggregated `isSuccess` and other profiles' observations are NEVER used); accept only if the fetch resolved, `obs.owner` equals the captured owner and `isCurrentConnection(owner)` still holds after I/O. Otherwise classification `unknown`.
  5. Classify the requested id: `present-canonical` (row `id === record.requestedTerminalId` and `createTerminalTargetFromObservation` returns a target at the captured generation); `present-unresolvable` (row exists, target null/retired/noncanonical); `definitely-absent` (accepted fresh observation, no row); `unknown` (step 4 failed).
  6. Act: `present-canonical` → settle `confirmed-success` (no new PTY); `present-unresolvable` / `unknown` → return as-is, no settle, block stays; `definitely-absent` without `confirmNotCreated` → return `definitely-absent` (UI asks); with `confirmNotCreated === true` → re-run steps 2–5 at confirmation time (fresh observation again, active check again) and settle `confirmed-not-created` (reason `"Cleared by user"`) only if still `definitely-absent` and not active; otherwise return the new classification.
  7. Durable verification (F9): settle result must be `settled`, then re-read `getLaunchAttempt`; `found` only if state `confirmed-success` and `provenance` equals the target (`terminalId`, `serverEpoch`, `incarnationExact`); `cleared` only if state `confirmed-not-created` with `failureReason === "Cleared by user"`. Settle `uncertain` or re-read not `ok` → `{kind:"unavailable", reason}`; settled to a different state/provenance → `{kind:"conflict", state}`.
  `reserveAndExecuteTerminalLaunch` blocked result carries `existingAttemptId`.
- Non-goals: no journal schema change; no automatic stuck-attempt reconciliation (V3 decided manual); no cross-tab in-flight detection — DECIDED documented limitation (V5): page-scoped registry; other tabs covered only by fresh inventory.

## Architecture (frozen for P06)
```ts
// packages/ui/src/os/terminal-launch-lifecycle.ts
export function buildTerminalLaunchIdentity(input: { profileId: string; target: FsTargetRef; fallbackProjectId?: string | null;
  fallbackWorktreeId?: string | null; cwd: string | null }): LaunchIdentityParams;
export interface TerminalLaunchRequest { owner: { profileId: string; generation: number }; attemptId?: string; terminalId: string;
  command: string; project?: string; cwd?: string; wireTarget?: ServerFsTarget }
export type TerminalLaunchOutcome =
  | { kind: "created"; terminalId: string; target?: TerminalTarget; incarnation?: number; incarnationExact?: string; serverEpoch?: string }
  | { kind: "failed"; terminalId: string; error: string; settlement: "confirmed-not-created" | "uncertain" | "confirmed-success" | "none" };
export function executeTerminalLaunch(req: TerminalLaunchRequest, deps?: { getSnapshot?; getApi?; settle? }): Promise<TerminalLaunchOutcome>;
export function reserveAndExecuteTerminalLaunch(input: { identity: LaunchIdentityParams; generation: number; desktopId: string;
  request: Omit<TerminalLaunchRequest, "attemptId" | "terminalId"> }): Promise<TerminalLaunchOutcome | { kind: "blocked"; reason: string; existingAttemptId?: string }>;
export function reserveTrackedTerminalLaunch(identity: LaunchIdentityParams, meta: { generation: number; desktopId: string;
  explicitRequestedTerminalId?: string }): Promise<ReserveLaunchResult>; // marks attemptId active on "reserved"
export function isLaunchAttemptActive(attemptId: string): boolean;
export type StuckLaunchResolution =
  | { kind: "already-resolved" } | { kind: "in-flight" } | { kind: "unknown"; reason: string }
  | { kind: "present-unresolvable"; reason: string } | { kind: "definitely-absent" }
  | { kind: "found"; target: TerminalTarget } | { kind: "cleared" }
  | { kind: "unavailable"; reason: string } | { kind: "conflict"; state: LaunchAttemptState };
export function resolveStuckLaunch(input: { attemptId: string; confirmNotCreated: boolean },
  deps?: { getAttempt?; getSnapshot?; isCurrent?; observeInventory?; isActive?; settle? }): Promise<StuckLaunchResolution>;
// packages/ui/src/os/persistence.ts (read-only addition)
export type LaunchAttemptRead = { status: "ok"; record: StoredLaunchRecord } | { status: "missing" } | { status: "unreadable"; reason: string };
export function getLaunchAttempt(attemptId: string): LaunchAttemptRead;
```
- `terminalId` (the reserved/requested id) is ALWAYS returned, independent of `target`, so callers can select `terminalKey({profileId, id: terminalId})` even when the server omitted canonical epoch/incarnation (`uncertain` settlement) — tested.
- Owner change after a canonical create surfaces as `failed` with `settlement:"confirmed-success"` (matches today's thrown "Connection owner changed during launch"). Exact parameter names may be refined by the implementer; P06 consumes the semantics above.

## Related Code Files
- Create: `packages/ui/src/os/terminal-launch-lifecycle.ts`, `packages/ui/src/os/terminal-launch-lifecycle.test.ts`
- Modify: `packages/ui/src/os/apps/TerminalsApp.tsx`, `packages/ui/src/os/action-executor.ts`, `packages/ui/src/os/action-executor.test.ts`, `packages/ui/src/os/persistence.ts` (add read-only `getLaunchAttempt` only), `packages/ui/src/os/app-launch-journal.test.ts` (getter tests)
- Create: `packages/ui/src/os/apps/TerminalsApp.test.tsx` (presentation acquire/release + denied reveal)
- Delete: none (duplicated inline logic removed from the two callers)

## Ownership & Conflict Prevention
- Exclusive in Group A. Amendment (V3): P04 owns `os/persistence.ts` during Group A ONLY for the read-only `getLaunchAttempt` export (no other Group A phase writes it); ownership then transfers sequentially to P06 (agent-hub appState projection). `os/app-launch-journal.test.ts` owned by P04. `persistence.test.ts` stays P06-owned.

## Implementation Steps
1. `p04-launch-lifecycle-module`: implement R1–R4 + R8.1 in-flight registry (`reserveTrackedTerminalLaunch`, `isLaunchAttemptActive`; `executeTerminalLaunch` keeps its attemptId active until its settle call returns) with injectable deps; table-driven tests: not connected pre-send; generation changed pre-send; canonical success → `confirmed-success` with exact target; success non-canonical epoch/incarnation → `uncertain`; success then owner changed → journal `confirmed-success` + failed outcome; HTTP 400/401/403/404/413/422 → `confirmed-not-created`; network error after send → `uncertain`; no attemptId → no settle; reserve blocked passthrough (incl. `existingAttemptId`); promise settles after caller "unmount" (no component coupling); attempt active from tracked reserve through a delayed create until settle returns, inactive afterwards (also when settle throws).
2. `p04-adopt-lifecycle`: replace TerminalsApp `handleLaunchSession`/`handleRetryLaunch` internals and action-executor identity block with module calls; action-executor reserves via `reserveTrackedTerminalLaunch` (same identity/meta, F8); adopt `buildTerminalClaimKey`; denied button → `revealWindow`; R7 presentation acquire/release. Extend `action-executor.test.ts` to assert identity params unchanged for project/workspace/explicit-cwd cases and that the reserved attempt is active until the TerminalsApp execution settles. New `TerminalsApp.test.tsx`: acquires after claim+attach, releases on unmount and on claim loss, late cleanup after another presenter acquired is a no-op, denied button calls `revealWindow`. Run existing browser suites touching TerminalsApp (read-only).
3. `p04-stuck-launch-resolution`: add `getLaunchAttempt` (+ `app-launch-journal.test.ts`: `ok` record, `missing` for unknown id, `unreadable` for corrupt/throwing storage, never mutates) and `resolveStuckLaunch` per R8.2–R8.7 (+ lifecycle tests with injected deps):
   - definitely-absent + confirmation (fresh re-observation still absent, not active) → durable `confirmed-not-created` verified by re-read → `cleared`; a fresh reserve for the same identity then succeeds.
   - present-canonical → `confirmed-success` with provenance verified → `found`; no create call (no duplicate PTY).
   - delayed create (attempt active in this page) → `in-flight`, no settle, even with confirmation.
   - stale negative: first observation absent, confirmation-time observation shows the id (or fetch fails / owner changed) → no not-created settle; returns new classification.
   - row present with null/retired/noncanonical target → `present-unresolvable`, block stays.
   - this profile's fetch fails / disconnected / owner changes during I/O → `unknown`; another profile's successful inventory (or cached query data) is never consulted.
   - cancelled confirmation → `definitely-absent` returned, record still blocks.
   - settle `uncertain` (quota/write failure) → `unavailable`; re-read `unreadable` → `unavailable`; competing settlement (settle returns `settled` but re-read shows other state/provenance/reason) → `conflict`; none of these report `found`/`cleared`.
   - already settled / missing → `already-resolved`.

```evcrate-tasks
[
  {
    "id": "p04-launch-lifecycle-module",
    "title": "Window-agnostic terminal launch lifecycle module",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/os/terminal-launch-lifecycle.ts", "packages/ui/src/os/terminal-launch-lifecycle.test.ts"],
    "constraints": ["Preserve every generation fence and settlement outcome of TerminalsApp.tsx:91-244 (Contract C3).", "No window-store or React imports; journal APIs from persistence.ts imported, not modified.", "In-flight registry is page-scoped in-memory state only; tracking never changes reservation or settlement outcomes (F8)."],
    "acceptance": ["Each pre-send, post-create and error path yields the same journal settlement as today, including confirmed-success when the owner changes after a canonical create (B3).", "Every created/failed outcome carries the reserved terminalId even when no canonical target exists.", "A launch whose initiating component unmounts still settles the journal and returns an outcome (Hub-closed-while-pending semantics, Invariant C).", "An attempt reserved via reserveTrackedTerminalLaunch or executing in executeTerminalLaunch reports isLaunchAttemptActive until its settle call returns (F8)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/terminal-launch-lifecycle.test.ts src/os/app-launch-journal.test.ts"]
  },
  {
    "id": "p04-adopt-lifecycle",
    "title": "TerminalsApp and action-executor adopt shared lifecycle, claim key and reveal",
    "blocked_by": ["p01-terminal-claim-key", "p01-reveal-window", "p01-terminal-presentation-input", "p04-launch-lifecycle-module"],
    "allowed_files": ["packages/ui/src/os/apps/TerminalsApp.tsx", "packages/ui/src/os/apps/TerminalsApp.test.tsx", "packages/ui/src/os/action-executor.ts", "packages/ui/src/os/action-executor.test.ts"],
    "constraints": ["Behavior-identical refactor apart from the denied button now calling revealWindow (B1 parity), presentation acquire/release (F2) and in-flight tracking of reservations (F8); keep labels and data-testids.", "Claim key must come from P01 buildTerminalClaimKey; presentation only via P01 terminal-presentation-input; action-executor reserves only via reserveTrackedTerminalLaunch."],
    "acceptance": ["TerminalsApp launch, retry, settle and appState writes behave as before; action-executor reservation identity params unchanged (B3).", "An action-executor reservation stays active in this page until the TerminalsApp execution of that attemptId settles (F8).", "Denied TerminalsApp button switches to the holder's desktop, restores it if minimized and focuses it (B1).", "TerminalsApp acquires presentation after claim success + attach and releases symmetrically; its late cleanup after another presenter acquired is a no-op (F2)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/action-executor.test.ts src/os/apps/TerminalsApp.test.tsx src/os/terminal-close-context.test.tsx", "pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-lifecycle.browser.tsx browser-tests/os-workspace-apps.browser.tsx browser-tests/workspace-workflow-terminal-continuity.browser.tsx", "pnpm --filter @dam-hopper/ui build"]
  },
  {
    "id": "p04-stuck-launch-resolution",
    "title": "Manual stuck-launch resolution helper and read-only journal getter",
    "blocked_by": ["p04-launch-lifecycle-module", "p04-adopt-lifecycle"],
    "allowed_files": ["packages/ui/src/os/terminal-launch-lifecycle.ts", "packages/ui/src/os/terminal-launch-lifecycle.test.ts", "packages/ui/src/os/persistence.ts", "packages/ui/src/os/app-launch-journal.test.ts"],
    "constraints": ["persistence.ts: add only the read-only getLaunchAttempt export (ok/missing/unreadable); no schema, reserve or settle behavior change; ownership transfers to P06 after this task.", "No automatic resolution (V3). Not-created settlement only with explicit confirmation AND a fresh owner-qualified inventory observation of the record's profile at the live generation, re-taken at confirmation time, showing the id absent AND the attempt not active in this page (F8); cached query data, aggregated isSuccess and other profiles' observations are never evidence.", "found/cleared are returned only after settle returned settled AND a getLaunchAttempt re-read shows the intended state and provenance/reason; otherwise unavailable or conflict (F9)."],
    "acceptance": ["Confirmed definitely-absent attempt settles confirmed-not-created, verified by re-read, returns cleared and a subsequent reserve for the same identity succeeds (V3, F9).", "Requested id present with exact canonical target settles confirmed-success with matching provenance and returns found without a new create (no duplicate PTY) (V3, F9).", "Delayed create still active in this page returns in-flight; stale negative (absent first, present or unobservable at confirmation) does not settle; row present with null/retired/noncanonical target returns present-unresolvable; this profile's failed/disconnected/owner-changed observation returns unknown even when another profile succeeded; cancelled confirmation leaves the block (F8).", "Write/quota failure or unreadable re-read returns unavailable and a competing settlement returns conflict; neither reports found or cleared (F9)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/terminal-launch-lifecycle.test.ts src/os/app-launch-journal.test.ts src/os/persistence.test.ts"]
  }
]
```

- [x] <!-- evcrate-task:p04-launch-lifecycle-module --> Window-agnostic terminal launch lifecycle module
- [x] <!-- evcrate-task:p04-adopt-lifecycle --> TerminalsApp and action-executor adopt shared lifecycle, claim key and reveal
- [x] <!-- evcrate-task:p04-stuck-launch-resolution --> Manual stuck-launch resolution helper and read-only journal getter

## Success Criteria
- B3 shared lifecycle with unchanged TerminalsApp/action-executor behavior; Hub-closed-while-pending defined and tested; supports AC4 (Hub [+ New Terminal] from zero-terminal workspace in P06); V3 manual stuck-launch resolution available to P06 with F8 absence proof and F9 durable-outcome verification.

## Risk Assessment
- Subtle refactor drift in settlement → table-driven parity tests mirror the original branches line by line.
- Unresolved/uncertain records block same-identity relaunch (existing C3, no TTL) → resolved manually via R8 (V3). Declaring not-created while a PTY can still appear could duplicate it → F8: page in-flight registry + fresh owner-qualified per-profile observation re-taken at confirmation + exact-id classification (present-unresolvable/unknown stay blocked) + explicit confirmation. Accepted residual (V5, decided documented limitation): a create still in flight from ANOTHER browser tab is not tracked; it is only caught if its PTY already appears in the fresh inventory. P07 records it in known limitations and docs.
- UI claims success after failed persistence → F9 durable re-read; `unavailable`/`conflict` never offer relaunch as success.
- Page reload mid-flight strands a `reserved-dispatch-capable` record for both TerminalsApp and Hub (attemptId not persisted per sanitization) — existing parity.

## Security Considerations
- Owner captured before I/O and rechecked after (capture-and-recheck, `docs/code-standards.md:190`); only canonical targets become runtime identity.

## Rollback
- Revert P04; callers return to inline logic. Module is additive.

## Next Steps
- P06 `use-hub-terminal-launch.ts` consumes `buildTerminalLaunchIdentity` + `reserveAndExecuteTerminalLaunch`; `HubStuckLaunchNotice` consumes `resolveStuckLaunch` outcomes (calls once without, once with confirmation).

## Unresolved questions
- None (V3 manual clear; V5 decided: cross-tab in-flight create is a documented limitation — page-scoped registry, no journal format change).
