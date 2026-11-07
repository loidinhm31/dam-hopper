# P03 — Typed observation and safe existing actions

Priority P2 · Status pending · Effort 16h · Owner ClientOwner.

## Context, prerequisites and parallelization
Read [C1/C2](architecture-contracts.md), [P01 DTOs](phase-01-shared-contracts.md), [terminal evidence](reports/session-contract-evidence.md), [caller disposition](execution-ownership.md#callsite-disposition). Sources: `api/ws-transport.ts:676-679,748-757,3156-3204`, `api/client.ts:3352-3358,4105-4109`, `api/queries.ts:1099-1119`, `hooks/use-aggregated-terminal-sessions.ts`, `hooks/use-ports.ts:403-415`, `hooks/use-terminal-manager.ts:717-738,1063-1193,1524-1556`.
Only depends on completed P01, not unfinished backend or shell schemas; P02/P05/P06 concurrent with disjoint paths. Freeze observation before migrating hooks. No P04 writer starts until all four branches terminal.

## Requirements, rationale and dataflow
HTTP response -> TerminalInventoryPayload from original headers +original exact/state rows ->owner-checked cached observation ->compatibility array/aggregate +immutable target. One existing query/invalidation flow, no duplicate polling. Headerless/malformed exact rows visible read-only; valid max-u64 exact string remains End-eligible despite unsafe legacy number. Authority never from rounded numbers/latest-incarnation/port event/active profile.

### Task `inventory-observation`
**Modify:** `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/api/queries.ts`, `packages/ui/src/api/queries.test.ts`, `packages/ui/src/api/ws-transport.test.ts`, `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts`, `packages/ui/src/hooks/use-aggregated-terminal-sessions.test.ts`. **Create:** `packages/ui/src/api/terminal-session-contract.test.ts`. **Delete:** none. ClientOwner; P01 contract module read-only. P04 consumes completed types/data projection.

1. Add typed observation methods/commands named P01, mapped to SAME list/detailed URLs. Thread a narrow response-decoder option from invoke dispatch to HTTP JSON response boundary so headers/body decode together; no transport-wide mutable epoch. Existing `list`/`listDetailed` keep old array returns (other clients/Recipe preflight), not separate requests when the inventory query projects them.
2. Add optional `incarnationExact`/`terminationState` fields on existing SessionInfo for compatibility rendering; shared observation types remain P01 authority. Strict decoders: missing capability ->unsupported; malformed metadata ->invalidMetadata; missing/malformed exact ->no target, NEVER numeric fallback. Exact canonical positive-u64 authoritative; if Number.isSafeInteger(n), require n>0 and String(n)===exact (safe disagreement/nonpositive rejects); unsafe numeric must not disable valid exact. Validate six states/alive consistency for action eligibility, not labels. POST exact strings only; validate202/terminationRequested OR200/restartCancelled +echoed tuple, malformed/origin-incompatible ->outcomeUnknown. P07 deletes kill/remove after P04 Monitor migration; no fallback.
3. Reuse query options/`useTerminalInventory(owner)` at existing `profileQueryKey(owner,"terminal-sessions")`; cache complete owner-captured observation. `useTerminalSessions` selects compatibility array from SAME options/key; aggregate returns `{sessions,observations,isSuccess,isLoading}`, each row has existing read-only SessionInfo/profile fields plus generation, flat state and `terminationTarget:TerminalTarget|null` from exact original observation. Detailed observation equivalent uses original detailed response, no second state fetch. Discard stale generation before publish; null-owner ambient path read-only. `use-terminal-tree` compatibility intentionally unchanged.
4. Preserve `staleTime:Infinity` event invalidation. `terminal:changed` and bare exit invalidate owning key; never synthesize exited state or attach fresh authority to old cached rows. Existing `use-sse.ts` invalidation-only behavior intentionally unchanged. Reconnect retires old owner query; no global last-seen epoch or extra fetch per row/action. Reconciliation may explicitly invalidate/refetch same key once; it cannot mint authority for a prior capture.
5. Contract tests: max-u64 valid exact +unsafe numeric ELIGIBLE; safe exact/number agree vsdisagree; malformed/missing exact +safe numeric REJECTED; numeric-only old server read-only; unsafe downstream association unavailable (not valid exact End disabled). Cover all six states, list/detailed same-response metadata, header/version failure, malformed 200/202/status-outcome/origin mismatch, owner/epoch swap, post-await retirement, same-key single fetch and ambiguous absence. Shared P01 literal fixtures, independent expected outcomes.

### Task `migrate-terminal-actions`
**Modify:** `packages/ui/src/hooks/use-terminal-manager.ts`, `packages/ui/src/hooks/use-terminal-manager.test.ts`, `packages/ui/src/hooks/use-ports.ts`, `packages/ui/src/components/organisms/PortsPanel.tsx`, `packages/ui/src/components/organisms/PortsPanel.test.tsx`. API methods added by the prior task remain available until final P07 cutover. **Create:** `packages/ui/src/lib/terminal-session-actions.ts`, `packages/ui/src/lib/terminal-session-actions.test.ts`. **Delete:** no files. ClientOwner exclusively; sequential overlap with prior API files intentional.

1. Implement `captureTerminalTarget(observation,id)`, `requestGuardedTermination(target,origin)`, `reconcileTermination(action,observation)` in bounded shared service; action stores immutable target AND `origin:"live"|"restartPending"`. Captured-owner getApi/current checks before/after awaits; dispatch once, no retry. Live origin:202 ->terminationRequested, exact current-owner state exited ->ended (also reconciles loss); restartPending state or alive:false alone not ended. Pending origin:200 exact restartCancelled ->completed cancellation, or exact retained restartCancelled observation reconciles loss. Ordinary exited/absence/not-pending NEVER proves cancellation; live-origin cannot complete from cancellation marker. Identity/status-outcome/origin mismatch ->unknown/refused; same tuple live/pending stays unresolved. No row/epoch replacement proof or raw-event completion.
2. Ports: PortEntry carries captured owner +optional target ONLY through SAME current inventory exact id/incarnation join. Numeric port incarnation must be positive safe integer losslessly equal to exact string; unsafe/missing ->End unavailable even though corresponding inventory End may be valid. No per-port query/polling/coercion. Rename to `endPortSession(target,origin)`; PortsPanel captures tuple+origin before confirmation and renders live-requested vsrestart-cancelled/loss/refusal. Tunnel APIs unchanged; never resolve ambient owner at click/after await.
3. `use-terminal-manager`: `handleCloseTab` removes only local tab/mounted/pin presentation state and suppresses immediate auto-attach; no durable remove. Guarded explicit End takes a captured target through the shared service, not rawId. Remove obsolete `removeSessionDurably` and `removingSessionIdsRef` if now unused. `handleRemoveFreeTerminal` becomes presentation-close semantics or is removed if unreferenced; do not leave an unsafe web remove export.
4. Audit all six durable helper uses: Close tab, free-terminal remove, profile delete, profile rename and custom-command rename loops. Config edits/renames are not End consent: remove automatic kill+evict loops; update config while preserving live sessions/history and owner-qualified inventory. No bulk implicit End or tombstone cleanup. Hook currently has no production importer in scoped search; harden/remove dead destructive exports without resurrecting legacy shell. Record final caller search as implementation evidence. Retained unmounted tree/tab adapters are intentionally unchanged unless a newly discovered reachable call requires scoped ownership revision.
5. Tests replace kill/remove-as-close with backend-survival/presentation-only, exact full-u64 forwarding, no malformed fallback/refusal effects, both operation origins and 200-vs202 completion/loss reconciliation. Pending loss ordinary exited/absent remains unknown; matching cancellation marker resolves; live loss requires exited. Ports delayed-confirmation tests prove captured tuple+origin and reject unsafe numeric join. Delete obsolete assertions only. P04 migrates Monitor, P07 removes aliases after caller audit; completed P01 schemas only, no checks mid-flight.

## Acceptance and exact future checks
- Captured inventory authority reaches Monitor (P04), ports and terminal-manager actions; all reach same service. Read-only inventory never disappears because guard unsupported.
- No web kill/remove command reaches DELETE; config housekeeping and explicit presentation Close do not terminate. Existing server routes intentionally preserved P02.
- At P08: `pnpm --filter @dam-hopper/ui test -- src/api/terminal-session-contract.test.ts src/api/ws-transport.test.ts src/api/queries.test.ts src/hooks/use-aggregated-terminal-sessions.test.ts src/hooks/use-terminal-manager.test.ts src/components/organisms/PortsPanel.test.tsx src/lib/terminal-session-actions.test.ts`; full build later, not mid-branch.
- Full app: live response loss +exact exited ->ended, restartPending response loss +exact restartCancelled ->cancelled; wrong completion kind/ordinary exited for pending/absence/replaced stays unresolved/no retarget. Valid max-u64 exact inventory still End-enabled; unsafe ports remain unavailable. Old-headerless server and equal raw IDs across profiles fail closed.

## Failure, rollback, security and resources
Capability/owner ambiguity disables End, never fallback. No mutation retry on network error or query retry of POST. Request/controller state in memory only; remount does not imply cancellation. On rollback keep safe action disabled rather than restore bare-ID methods. Query errors remain explicit; no catch-to-empty list authorizes destruction. Retain background sessions and bounded action state; no output/credentials logged.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "inventory-observation",
    "title": "Publish original-authority terminal observations through existing queries",
    "blocked_by": [
      "freeze-shared-contracts"
    ],
    "allowed_files": [
      "packages/ui/src/api/client.ts",
      "packages/ui/src/api/ws-transport.ts",
      "packages/ui/src/api/queries.ts",
      "packages/ui/src/api/queries.test.ts",
      "packages/ui/src/api/ws-transport.test.ts",
      "packages/ui/src/hooks/use-aggregated-terminal-sessions.ts",
      "packages/ui/src/hooks/use-aggregated-terminal-sessions.test.ts",
      "packages/ui/src/api/terminal-session-contract.test.ts"
    ],
    "constraints": [
      "ClientOwner only; consume P01 contract, not unfinished backend code.",
      "One existing inventory query; no global epoch, duplicate poller or unsafe numeric coercion."
    ],
    "acceptance": [
      "Original headers and rows publish atomically with captured owner.",
      "Compatibility rows remain visible; full-u64 exact identity eligible, malformed exact never numeric fallback and unsafe downstream joins unavailable."
    ],
    "verification": [
      "P08 run P03 exact unit command and UI build; inspect same-query network count under aggregate/legacy projections."
    ]
  },
  {
    "id": "migrate-terminal-actions",
    "title": "Migrate ports and terminal-manager destructive actions",
    "blocked_by": [
      "inventory-observation"
    ],
    "allowed_files": [
      "packages/ui/src/hooks/use-terminal-manager.ts",
      "packages/ui/src/hooks/use-terminal-manager.test.ts",
      "packages/ui/src/hooks/use-ports.ts",
      "packages/ui/src/components/organisms/PortsPanel.tsx",
      "packages/ui/src/components/organisms/PortsPanel.test.tsx",
      "packages/ui/src/lib/terminal-session-actions.ts",
      "packages/ui/src/lib/terminal-session-actions.test.ts"
    ],
    "constraints": [
      "ClientOwner only; last Monitor caller migrates P04 before integrated checks.",
      "Close/config cleanup never End or durable remove; no automatic retry/retarget/eviction."
    ],
    "acceptance": [
      "Ports and explicit End capture immutable exact identity plus live/restartPending origin; 202 and 200 have distinct outcomes.",
      "All durable remove-as-close and implicit config cleanup calls removed; unrelated legacy server clients retained.",
      "Live loss resolves only exact exited; pending loss only exact retained cancellation marker, never absence/ordinary exited or retry."
    ],
    "verification": [
      "P08 run P03 exact unit command, caller inventory search and real response-loss/replacement/unsupported guard scenarios."
    ]
  }
]
```

- [ ] <!-- evcrate-task:inventory-observation --> Publish original-authority terminal observations through existing queries
- [ ] <!-- evcrate-task:migrate-terminal-actions --> Migrate ports and terminal-manager destructive actions
