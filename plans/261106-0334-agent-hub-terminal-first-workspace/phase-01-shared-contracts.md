# Phase 01 — Shared contracts (identity, claims, mounts store, workspace union, file:open mode, reveal)

## Context Links
- Evidence: `./reports/scout-261106-0334-evidence-and-decisions.md` (A, B1–B4, C)
- Design: `../reports/ui-ux-designer-261106-0226-agent-hub-workspace-flow.md` (§5, §7 AC1–AC6)
- Standards: `docs/code-standards.md:166-173` (single-transaction placement ops, single-visible-slot registry, layout v3 keys)

## Overview
- Priority: P1 · Status: completed · Effort: 5h
- Pure, tested building blocks + frozen interfaces consumed by Group A (P02–P05) and P06. No UI behavior change.

## Parallelization Info
- Group: sequential prerequisite · Depends on: none · Blocks: P02, P03, P04, P05 · Concurrent peers: none.
- MUST NOT run concurrently with `plans/261103-1608-workspace-file-tree-project-marks` Phase 03/04 (`os/intents.ts` overlap).

## Key Insights
- TerminalsApp claim key has two branches (`packages/ui/src/os/apps/TerminalsApp.tsx:56-77`): target → `{terminal, target.profileId, target.generation, resourceId: terminalId, incarnation: target.incarnation (string), authority: serverEpoch}`; untargeted → `{terminal, owner.profileId, owner.generation, resourceId: sessionId, incarnation: latestTerminalSessionIncarnation() (number|undefined)}`. `formatClaimKey` in `packages/ui/src/os/resource-registry.ts:10-21`.
- Canonical exact target already exists: `AggregatedSessionInfo.terminationTarget` (`packages/ui/src/hooks/use-aggregated-terminal-sessions.ts:26-31`) built by `createTerminalTargetFromObservation` (`packages/ui/src/api/terminal-session-contract.ts:462-479`; enforces owner, version 1, canonical UUID epoch, row membership, eligibility; uses `incarnationExact`). Resolver REUSES it (DRY); it must not re-derive from `SessionInfo.serverEpoch`.
- Logical tab id `terminalKey` = `JSON.stringify([profileId,id])` (`packages/ui/src/api/ownership.ts:315`) ≠ runtime registry key `terminalTargetKey` (`terminal-session-contract.ts:123-131`).
- Group ids are `projectKey(ref)` (`packages/ui/src/lib/traditional-terminal-projects.ts:45`, `api/ownership.ts:108`); union MUST use the same id so layout keys `traditionalTerminalLayoutStorageKey(group.id)` stay stable.
- Only the active desktop's non-minimized windows mount (`packages/ui/src/os/OsShell.tsx:1661-1666`, `packages/ui/src/os/DesktopCanvas.tsx:87-88`); claims therefore follow visibility; a reveal action still needs desktop switch + restore for robustness (B1).
- Placement mutations must be single pure transitions (`docs/code-standards.md:168`); store actions exist for `switchDesktop/restoreWindow/focusWindow` (`packages/ui/src/os/window-store.ts:151-196`) but not as one transaction.

## Requirements
- R1 `buildTerminalClaimKey` returns byte-identical `formatClaimKey` output to today's TerminalsApp for both branches.
- R2 Resolver fail-closed: undefined unless logical key parses, a current inventory row has non-null `terminationTarget` with same profileId/terminalId, snapshot `connected`, `snapshot.owner.generation === target.generation`, canonical epoch/incarnation.
- R3 Hub mounts store: in-memory Zustand, never persisted, no-op publish when structurally equal (avoid render churn).
- R4 Workspace union: session groups ∪ explicit refs hydrated from inventory → `terminalTabs: []`, `mountedSessions: []`; stable order; refs absent from inventory dropped; `canDismissWorkspace(group)` true only for zero-terminal groups.
- R5 `file:open` payload gains `mode?: "float"` (doc: "float requires generation; handled by OsShell P02"). Legacy callers compile unchanged.
- R6 Pure `revealWindow(session, windowId)` = switch to window's desktop + restore if minimized + focus, one transaction; store action `revealWindow(id)`.
- Non-goals: no consumer adoption (P03/P04/P06 adopt), no UI.

## Architecture / Frozen interfaces (binding for P03/P04/P05/P06)
```ts
// packages/ui/src/os/terminal-claim-key.ts
export type TerminalClaimKeyInput =
  | { readonly target: TerminalTarget }
  | { readonly profileId: string; readonly generation: number; readonly sessionId: string; readonly incarnation: number | undefined };
export function buildTerminalClaimKey(input: TerminalClaimKeyInput): ResourceClaimKey;

// packages/ui/src/lib/terminal-runtime-identity.ts
export interface TerminalRuntimeCandidate { readonly profileId: string; readonly id: string; readonly terminationTarget: TerminalTarget | null }
export function resolveTerminalRuntimeTarget(logicalKey: string, candidates: readonly TerminalRuntimeCandidate[],
  getSnapshot?: (profileId: string) => ConnectionSnapshot | null): TerminalTarget | undefined;
export function buildTerminalRuntimeIndex(candidates: readonly TerminalRuntimeCandidate[],
  getSnapshot?: (profileId: string) => ConnectionSnapshot | null): ReadonlyMap<string /*terminalKey*/, TerminalTarget>;

// packages/ui/src/os/agent-hub/hub-terminal-mounts-store.ts
export interface HubTerminalMount { readonly logicalKey: string; readonly target: TerminalTarget; readonly project: string;
  readonly command: string; readonly cwd?: string; readonly worktreePath?: string }
export const useHubTerminalMountsStore: UseBoundStore<{ mountsByHub: Readonly<Record<string, readonly HubTerminalMount[]>>;
  publish(hubWindowId: string, mounts: readonly HubTerminalMount[]): void; clear(hubWindowId: string): void }>;

// packages/ui/src/lib/agent-hub-open-workspaces.ts
export interface OpenWorkspaceRef { readonly profileId: string; readonly project: string } // key = projectKey(ref)
export function unionOpenWorkspaceGroups<T extends TabEntry>(sessionGroups: readonly TraditionalTerminalProjectGroup<T>[],
  openRefs: readonly OpenWorkspaceRef[], inventory: readonly AggregatedProjectItem[]): TraditionalTerminalProjectGroup<T>[];
export function canDismissWorkspace(group: Pick<TraditionalTerminalProjectGroup, "terminalTabs">): boolean;

// packages/ui/src/os/window-ops.ts + window-store.ts
export function revealWindow(session: OsSessionV1, windowId: string): OsSessionV1; // store: revealWindow(windowId): void

// packages/ui/src/lib/terminal-presentation-input.ts  (F2: owner-scoped presentation input)
export interface TerminalPresentationToken { readonly presenterId: string; readonly epoch: number }
export function acquireTerminalPresentation(term: Terminal, presenterId: string): TerminalPresentationToken; // latest acquire wins; marks term "presentation-managed"
export function releaseTerminalPresentation(term: Terminal, token: TerminalPresentationToken): void;      // no-op unless token is current
export function isCurrentTerminalPresenter(term: Terminal, token: TerminalPresentationToken): boolean;
export function setPresenterInputSuppression(term: Terminal, token: TerminalPresentationToken, reason: string, suppressed: boolean): void; // no-op unless current
export function runIfCurrentPresenter(term: Terminal, token: TerminalPresentationToken, cleanup: () => void): boolean; // guards key-handler reset, blur, parking
export function computePresentedInputSuppression(term: Terminal, panelSuppressed: boolean): boolean;
  // = panelSuppressed (replay/global/authority, unchanged TerminalPanel semantics)
  //   || (managed && no current presenter) || (current presenter has any suppression reason); unmanaged ⇒ panelSuppressed (legacy)
export function subscribeTerminalPresentation(term: Terminal, listener: () => void): () => void; // fires on acquire/release/reason change
```
Frozen prose contracts (owners implement later; consumers code against these):
- **MultiTerminalDisplay attach gate (owner P03; consumer P06).** `MultiTerminalDisplay`, `SplitLayout`, `PaneContainer` gain optional `attachGate?: TerminalAttachGate` exported from `MultiTerminalDisplay.tsx`:
  `{ resolveTerminal(sessionId: string): TerminalEntry | undefined /* exact entry only when claim held AND current full target resolved; never raw-id fallback */; renderPlaceholder(sessionId: string): ReactNode | null /* null = attachable or claim still pending */; readonly revision: number /* bumps on any claim/resolution change */ }`. Absent gate ⇒ byte-identical legacy behavior. Hook: `useHubTerminalAttachGate(options: { hubWindowId: string; sessionIds: readonly string[]; resolveTarget(logicalKey: string): TerminalTarget | undefined } | null): TerminalAttachGate | undefined` (null ⇒ undefined, lets `TraditionalTerminalProjectsDisplay` call it unconditionally for the selected group's session ids).
- **Navigator workspace extension (owner P05; consumer P06).** All optional on `TraditionalTerminalProjectsNavigatorProps`: `disclosedGroupIds?: ReadonlySet<string>`, `onToggleDisclosure?(groupId)`, `onNewTerminalInGroup?(groupId)`, `onCloseWorkspace?(groupId)` (rendered only when `canDismissWorkspace`), `onOpenFile?(payload: IntentPayloadMap["file:open"])` (payload fully built by P05 from the clicked tree's own profile/project/worktree/generation; P06 only forwards to `dispatchIntent(createIntent("file:open", payload, hubWindowId))`), `picker?: { items: readonly AggregatedProjectItem[]; openGroupIds: ReadonlySet<string>; isLoading: boolean; onOpen(ref: OpenWorkspaceRef): void }`. File tree slot = P05 `TraditionalProjectWorkspaceTree` rendered by the row for disclosed groups (no render-prop).
- **Placeholder callback (owner P03).** `HubTerminalClaimPlaceholder` props `{ sessionLabel: string; reason: "claimed-elsewhere" | "legacy-presenter" | "unresolved"; holderWindowId?: string }`; "Go to window" calls store `revealWindow(holderWindowId)` (R6).
- **Presentation input (owner P01 module; adopters P03 PaneContainer+TerminalPanel, P04 TerminalsApp).** Rules: (1) a presenter acquires AFTER its claim succeeds and its element is attached, and releases on claim loss/unmount; (2) every late cleanup by a former presenter (custom key-handler reset, `syncTerminalInputSuppression`, blur, parking) runs only through `runIfCurrentPresenter` → no-op once a successor acquired; (3) `TerminalPanel.syncEffectiveStdinSuppression` (`TerminalPanel.tsx:294-311`) computes its existing panel-level value, then applies `computePresentedInputSuppression(term, panelValue)` and re-syncs on `subscribeTerminalPresentation` — so acquisition restores stdin on a quiet PTY and replay drain never unsuppresses a terminal with no presenter; (4) terminals never acquired (legacy gate-less MultiTerminalDisplay, TerminalRuntimeOutput) keep today's behavior. State keyed by `Terminal` instance (WeakMap), in memory only.
- **Launch lifecycle (owner P04; consumer P06)** frozen in `phase-04` Architecture.

## Related Code Files
- Create: `packages/ui/src/os/terminal-claim-key.ts`, `packages/ui/src/os/terminal-claim-key.test.ts`, `packages/ui/src/lib/terminal-runtime-identity.ts`, `packages/ui/src/lib/terminal-runtime-identity.test.ts`, `packages/ui/src/os/agent-hub/hub-terminal-mounts-store.ts`, `packages/ui/src/os/agent-hub/hub-terminal-mounts-store.test.ts`, `packages/ui/src/lib/agent-hub-open-workspaces.ts`, `packages/ui/src/lib/agent-hub-open-workspaces.test.ts`, `packages/ui/src/lib/terminal-presentation-input.ts`, `packages/ui/src/lib/terminal-presentation-input.test.ts`
- Modify: `packages/ui/src/os/intents.ts` (type/doc), `packages/ui/src/os/intents.test.ts` (type-compat case), `packages/ui/src/os/window-ops.ts` + `packages/ui/src/os/window-ops.test.ts` (add `revealWindow`), `packages/ui/src/os/window-store.ts` (add action); `packages/ui/src/lib/terminal-input-policy.ts` owned by P01 but expected unchanged (wrapped, not edited)
- Delete: none

## Ownership & Conflict Prevention
- P01 finishes before Group A. `window-ops.ts`, `window-ops.test.ts`, `window-store.ts` are written by P01 then by P02 (sequential; ownership amendment). `lib/terminal-input-policy.ts` writes belong to P01 only (no Group A phase may edit it). No other phase writes P01-created files — consumers import only.

## Implementation Steps
1. `p01-terminal-claim-key`: port both branches verbatim from `TerminalsApp.tsx:56-77`; tests compare `formatClaimKey` with literal expected strings for target, untargeted, same id/different profile, same id/new incarnation (distinct), undefined incarnation.
2. `p01-terminal-runtime-identity`: implement index/resolver over `AggregatedSessionInfo`-compatible candidates; default `getSnapshot = getConnectionSnapshot` (`packages/ui/src/api/connections.ts:339`). Tests: happy path, non-canonical/null target, disconnected, retired generation, profile/id mismatch, unparsable key, replacement incarnation returns the NEW target only.
3. `p01-hub-terminal-mounts-store`: `create()` without persist; `publish` compares by `terminalTargetKey`+fields; `clear` deletes key. Tests: publish/clear isolation per hub, equal publish no state change, no localStorage writes.
4. `p01-open-workspaces-union`: union keyed by `projectKey`; hydrate `projectName/projectRef/profileId/profileName/label` from inventory item; order = session groups first (existing order) then refs in open order; skip refs already present or missing in inventory. Tests incl. dismiss rule.
5. `p01-file-open-mode-contract`: add `mode?: "float"` with JSDoc; add compile-level test in `intents.test.ts` that legacy payload (no mode) and float payload both type-check.
6. `p01-reveal-window`: pure `revealWindow` composing existing `switchDesktop`/`restoreWindow` (minimized only)/`focusWindow`; result passes `validateOsSession`; store action wraps in one `set`. Tests: other desktop, minimized, maximized (stays maximized), missing id no-op.
7. `p01-terminal-presentation-input`: implement the presentation-input module (fake `Terminal` with `options.disableStdin` + textarea in jsdom). Tests: Hub→standalone handoff where the old presenter's cleanup runs AFTER the successor acquired (successor stays interactive; old cleanup returns false) and BEFORE (successor acquisition unsuppresses); quiet-PTY recovery (acquire alone notifies subscribers → recomputed unsuppressed); replay completion with no presenter on a managed terminal stays suppressed; presenter suppression reason toggling; unmanaged terminal equals `panelSuppressed`; release by stale token is a no-op.

```evcrate-tasks
[
  {
    "id": "p01-terminal-claim-key",
    "title": "Extract exact TerminalsApp terminal claim key builder",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/os/terminal-claim-key.ts", "packages/ui/src/os/terminal-claim-key.test.ts"],
    "constraints": ["Pure function; no React; do not modify TerminalsApp.tsx (P04 adopts).", "Output must equal today's TerminalsApp.tsx:56-77 keys for both branches, including incarnation type (string for target, number|undefined for untargeted)."],
    "acceptance": ["formatClaimKey(buildTerminalClaimKey(x)) equals the literal key TerminalsApp produces for target and untargeted inputs.", "Same terminalId with different profileId, and same profile/id with a replacement incarnation, produce distinct formatted keys."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/terminal-claim-key.test.ts"]
  },
  {
    "id": "p01-terminal-runtime-identity",
    "title": "Fail-closed logical-key to exact TerminalTarget resolver",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/lib/terminal-runtime-identity.ts", "packages/ui/src/lib/terminal-runtime-identity.test.ts"],
    "constraints": ["Reuse AggregatedSessionInfo.terminationTarget (createTerminalTargetFromObservation); never synthesize a target from SessionInfo fields.", "Never return a target for disconnected or generation-mismatched owners; no ambient profile fallback."],
    "acceptance": ["Returns the current inventory target only when owner connected, generation equal, and profileId/terminalId match the parsed logical key (Invariant C1).", "Returns undefined for null/non-canonical targets, retired generation, unknown key; after same-id replacement returns only the new incarnation target."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/lib/terminal-runtime-identity.test.ts"]
  },
  {
    "id": "p01-hub-terminal-mounts-store",
    "title": "In-memory Hub terminal mounts store",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/os/agent-hub/hub-terminal-mounts-store.ts", "packages/ui/src/os/agent-hub/hub-terminal-mounts-store.test.ts"],
    "constraints": ["Zustand without persist middleware; runtime authority (generation/serverEpoch/incarnation) never written to storage.", "publish with structurally equal mounts must not change state identity."],
    "acceptance": ["publish(hubId, mounts) and clear(hubId) affect only that hub's entry.", "No localStorage/sessionStorage writes occur in tests; equal publish keeps the same state reference."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/agent-hub/hub-terminal-mounts-store.test.ts"]
  },
  {
    "id": "p01-open-workspaces-union",
    "title": "Union session project groups with explicitly opened zero-terminal workspaces",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/lib/agent-hub-open-workspaces.ts", "packages/ui/src/lib/agent-hub-open-workspaces.test.ts"],
    "constraints": ["Group id must equal projectKey(ref) so layout keys and selection stay stable.", "Pure; inventory passed in (no TanStack Query import)."],
    "acceptance": ["Open refs absent from session groups appear with terminalTabs: [] and mountedSessions: []; refs missing from inventory are dropped; order is deterministic (AC4).", "canDismissWorkspace is true only for zero-terminal groups."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/lib/agent-hub-open-workspaces.test.ts"]
  },
  {
    "id": "p01-file-open-mode-contract",
    "title": "Add optional float mode to file:open payload type",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/os/intents.ts", "packages/ui/src/os/intents.test.ts"],
    "constraints": ["Type and doc only; no handler behavior (P02).", "Coordinate with plans/261103-1608-workspace-file-tree-project-marks: do not run concurrently with its Phase 03/04."],
    "acceptance": ["file:open payload accepts mode?: \"float\" documented as requiring generation; existing dispatchers (deep-links, FilesApp, SearchApp) compile unchanged."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/intents.test.ts", "pnpm --filter @dam-hopper/ui build"]
  },
  {
    "id": "p01-reveal-window",
    "title": "Atomic revealWindow placement op and store action",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/os/window-ops.ts", "packages/ui/src/os/window-ops.test.ts", "packages/ui/src/os/window-store.ts"],
    "constraints": ["Single pure transition composed from existing switchDesktop/restoreWindow/focusWindow; restore only minimized windows (maximized holder stays maximized).", "Do not change existing op semantics; P02 extends these files afterwards."],
    "acceptance": ["revealWindow switches to the holder's desktop, restores if minimized, focuses it, and the result passes validateOsSession (B1).", "Unknown window id returns the same session object."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/os/window-ops.test.ts"]
  },
  {
    "id": "p01-terminal-presentation-input",
    "title": "Owner-scoped terminal presentation input contract",
    "blocked_by": [],
    "allowed_files": ["packages/ui/src/lib/terminal-presentation-input.ts", "packages/ui/src/lib/terminal-presentation-input.test.ts", "packages/ui/src/lib/terminal-input-policy.ts"],
    "constraints": ["Wrap syncTerminalInputSuppression/calculateTerminalInputSuppression semantics; edit terminal-input-policy.ts only if strictly necessary and keep its exported behavior identical.", "In-memory only (WeakMap by Terminal); never-acquired terminals keep legacy behavior."],
    "acceptance": ["Acquire/release are symmetric and token-scoped; a former presenter's late cleanup (key handler, suppression, blur, parking) is a no-op once a successor acquired (Invariant C gate, F2).", "Acquisition notifies subscribers so a quiet PTY regains stdin; a managed terminal with no presenter stays suppressed after replay completion."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/lib/terminal-presentation-input.test.ts src/lib/terminal-input-policy.test.ts"]
  }
]
```

- [x] <!-- evcrate-task:p01-terminal-claim-key --> Extract exact TerminalsApp terminal claim key builder
- [x] <!-- evcrate-task:p01-terminal-runtime-identity --> Fail-closed logical-key to exact TerminalTarget resolver
- [x] <!-- evcrate-task:p01-hub-terminal-mounts-store --> In-memory Hub terminal mounts store
- [x] <!-- evcrate-task:p01-open-workspaces-union --> Union session project groups with explicitly opened zero-terminal workspaces
- [x] <!-- evcrate-task:p01-file-open-mode-contract --> Add optional float mode to file:open payload type
- [x] <!-- evcrate-task:p01-reveal-window --> Atomic revealWindow placement op and store action
- [x] <!-- evcrate-task:p01-terminal-presentation-input --> Owner-scoped terminal presentation input contract

## Success Criteria
- All seven tasks' tests green; `pnpm --filter @dam-hopper/ui build` passes. Contributes to AC1 (mode contract), AC4 (union), B1 (reveal), C1/C3 (identity, claim parity), F2 presentation-input handoff.

## Risk Assessment
- Untargeted claim branch (number incarnation) can never equal a target claim → P03 handles via "legacy-presenter" rule; documented here so builders don't "unify" types.
- Union ordering change could reorder Navigator rows → deterministic test.

## Security Considerations
- No persisted runtime authority (C1). Resolver fail-closed on disconnected/retired owners; no ambient profile fallback (`docs/code-standards.md:45`).

## Rollback
- Additive files; revert P01 commit. `intents.ts` change is optional-field only.

## Next Steps
- Unblocks P02–P05 in parallel.

## Unresolved questions
- None for this phase.
