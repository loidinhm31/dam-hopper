# P07 — One sequential shell/resource/action integration owner

Priority P2 · Status completed · Effort 16h · Owner IntegrationOwner.

## Context, prerequisite barrier and handoff
Read [C1–C5](architecture-contracts.md), [ownership matrix](execution-ownership.md), P01–P06, current `OsShell` intent handlers, `OsResourceHost:184-223`, `TerminalsApp`, resource registry, persistence codecs, TerminalKeepAliveHost and `TerminalPanel:940-1044`.
Entry: ALL P02/P03/P05/P06 branches terminal and P04 `review-authority-retirement` terminal, actual contract outputs inspected; ShellOwner releases OsShell/WindowFrame/WindowList/window-store before any write. No branch owns shared files concurrently. IntegrationOwner alone performs both tasks sequentially; no parallel product checks or shared-file patching by other owners. End remains disabled if backend capability/integration is missing, never optimism from build.

## Requirements and architecture
Qualify runtime identity through existing keep-alive/claim paths, serialize shared Close wiring, and retire protected hidden Review windows at root. No second renderer, ambient rebind, duplicate visible claim, auto-create-on-reopen or broad runtime registry. Runtime authority stays in memory and is removed from portable layout exports/imports.

### Task `integrate-qualified-session-routing`
**Modify:** `packages/ui/src/os/OsShell.tsx`, `packages/ui/src/os/OsResourceHost.tsx`, `packages/ui/src/os/apps/TerminalsApp.tsx`, `packages/ui/src/os/window-store.ts`, `packages/ui/src/os/types.ts`, `packages/ui/src/os/intents.ts`, `packages/ui/src/os/intents.test.ts`, `packages/ui/src/os/deep-links.ts`, `packages/ui/src/os/deep-links.test.ts`, `packages/ui/src/os/resource-registry.ts`, `packages/ui/src/os/resource-registry.test.ts`, `packages/ui/src/os/persistence.ts`, `packages/ui/src/os/persistence.test.ts`, `packages/ui/src/components/organisms/MultiTerminalDisplay.tsx`, `packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx`, `packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx`, `packages/ui/src/components/organisms/TerminalPanel.tsx`, `packages/ui/src/components/organisms/TerminalPanel.test.tsx`. **Create/Delete:** none. Each path is exact ownership, not blanket permission for neighboring modules.

1. Route frozen `terminal:place-existing` from fresh current store snapshot. Validate captured owner, PTY epoch/incarnation against current original-authority inventory and source Hub/source window existence BEFORE modifying layout; revalidate after awaits. `focus-existing`: restore/focus matching view; `open-beside`: reuse same-desktop ordinary view or create presentation only for existing PTY; `move-beside`: only explicit cross-desktop choice. Other desktop Go to window switches/focuses without rearrangement. Refuse missing/replaced/retired targets, no `terminal.create` fallback.
2. Add one atomic store placement operation using existing dock/split/tab helpers. Split only source Hub pane as needed; preserve unrelated tile subtrees. Reuse adjacent ordinary terminals pane for subsequent sessions as tabs. Moving existing view preserves window ID and exact resource identity; minimized view restores. Source intent may be SystemMonitor exact-focus action: source window remains explicit, no ambient Hub lookup. Matching uses full terminal target, not raw ID.
3. Propagate exact string TerminalTarget OsResourceHost ->MountedSession ->TerminalKeepAliveHost ->TerminalPanel +TerminalsApp claim, preserving owner/generation/PTY epoch/incarnation across await/reparent. Never convert target to Number or replace with numeric SessionInfo identity. Legacy physical locator keys allowed only with full-target validation before reuse; mismatched entry cannot adopt. Claim includes authority/full exact tuple, one visible claim; no second host/renderer. Preserve display compatibility separately from authority.
4. Attach/recovery stays existing-only. Replace raw-ID inventory probes in TerminalPanel with typed captured-owner observation/cache; reconnect may refetch same key, never new epoch retrofitted to prior capture. Existing replay/live events carry numeric incarnation: allow render/input only when positive safe integer losslessly canonical-equal to exact target AND owner/epoch current. Unsafe/missing/mismatched downstream proof ->explicit unavailable/input disabled and withhold unproven output/cached content, NOT target coercion, rounded cache acceptance, new backend create or protocol expansion. Numeric latest-incarnation cache is not authority. Stable full-target keys prevent placement reattach/replay/reset; fresh reopen may create renderer/replay only after proof.
5. Remove inactive-adoption Launch Terminal Session fallback from TerminalsApp for `existing-only` windows. Fresh explicit launch uses existing owned creation flow, records completed creation then acquires authority through original list observation; capture/check originating generation before/after create. Never use latest connection as origin after await. Missing adopted PTY displays refusal; no replacement button. Preserve F1 unknown-create gate, do not add retry or certify its broader unresolved workflow.
6. Persist/export `OsSessionV1` layout and existing locators only; explicitly strip runtimeIdentity/termination metadata and protected Review tuple fields from appState. Import/restored windows start unverified and disabled for sensitive actions until explicit current-owner resolution; never restore epoch as trusted authority. Keep os:v1/terminal-layout:v3 keys compatible; no schema fork or migration. Preserve user geometry/default preference. Tests exercise non-destructive round-trip and untrusted imported identity rejection.
7. `session-changes:open`: require full ReviewTarget, config/current-owner check and exact tuple focus/creation. Do not fill missing generation or root from ambient state. Deep links with incomplete Review identity give upgrade/unavailable guidance; complete explicit tuples are revalidated via Status before viewer creation. Raw `terminal:focus` remains locator discovery from Workflow/Recipe/deep-link producers, not captured runtime intent: resolve fresh owner inventory for navigation, no auto-create or destructive authorization. P04 Monitor/Hub use exact placement intent. Do not change Recipe executor to supply missing runtime authority.
8. Tests: owner/epoch/generation raw-ID collisions; exact full-u64 target traverses every host/claim unchanged; unsafe numeric replay/live proof refuses (valid inventory End unaffected); safe exact-equal replay renders, safe disagreement/missing proof fails closed. One claim, normal pane tabs/minimize/cross-desktop topology, stable host membership/no missing-adopt create, persistence strips authority. Keep-alive component tests supporting only; P08 live counters/PTY oracle final.

### Task `integrate-close-input-retirement`
**Modify:** `packages/ui/src/os/OsShell.tsx`, `packages/ui/src/os/OsResourceHost.tsx`, `packages/ui/src/os/WindowFrame.tsx`, `packages/ui/src/os/WindowList.tsx`, `packages/ui/src/os/window-store.ts`, `packages/ui/src/os/terminal-close-context.tsx`, `packages/ui/src/os/shell-input-context.tsx`, `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/components/organisms/TerminalPanel.tsx`, `packages/ui/src/components/organisms/TerminalPanel.test.tsx`, `packages/ui/src/lib/terminal-input-policy.ts`, `packages/ui/src/lib/terminal-input-policy.test.ts`, `packages/ui/src/lib/terminal-buffer-replay.ts`, `packages/ui/src/lib/terminal-buffer-replay.test.ts`. **Create:** `packages/ui/src/os/review-retirement.tsx`. **Delete:** no files; obsolete aliases/listeners/fallback blocks removed within owned files. Sequential file reuse after prior task intentional.

1. Mount ONE shared TerminalClose provider with existing aggregate observation service; frame X, WindowList terminal close, pane-tab/window close and keyboard explicit Close all call `requestTerminalClose` with captured runtime identity and callback. Pure store close remains presentation-only for cleanup/desktop removal. Preserve editor dirty save/discard/cancel wiring. No End from minimize, reparent, desktop removal, effect cleanup or app unmount. Close view disposes local renderer as current implementation allows while PTY/history survive.
2. Session-target vs pane close explicit: selected exact view only, no bulk End. Exact exited/restartCancelled presentation Close; live OR restartPending uses shared prompt+captured origin; unknown safe Close/Cancel. Live202 waits exact exited; pending200 exact cancellation immediately completes or retained same-exact marker resolves loss. Wrong completion kind/ordinary exited for pending/absence never proof. Invoke presentation callback only if original window/target still matches, never newly rebound view. Explicit Close remains available while unresolved; status retained in management surface without undo fiction.
3. Mount root `ReviewRetirementGuard` per protected Review window, including minimized/other desktops, using existing connection/config subscriptions and P04 exact query helpers. On disable/disconnect/retirement: synchronously remove live/protected viewer eligibility, cancel + purge affected queries, strip captured Review tuple/root/baseline/generation from runtime/appState, and retain content-free reason. Late fulfilled promises cannot republish. Remove guard with window; no hidden file-content fetch. Single close scopes only exact identity and leaves active siblings; owner retirement purges owner scope. Keep only ordinary configured-profile Settings navigation identity when safe, not former protected authority.
4. Feed actual shell modal/Cognito suppression through resource host/keep-alive flags and existing `syncTerminalInputSuppression`: hidden textarea inputMode none/tabIndex -1/blur plus disableStdin, owner-current checks on all onData/paste/key paths. Do not rely solely on focus trap or hardcoded modal bool. Nested layer Escape and palette/backdrop consumption must reach this generic gate. Restore stdin/focus only after current owner/claim/visibility valid; hidden resources never receive input or unnecessary rendering.
5. Final caller audit includes every `terminal.kill`, `terminal.remove`, `terminal:kill`, `terminal:remove` and raw direct DELETE path in web source. After P04 Monitor and P03 ports/hook migrations, delete unsafe ApiClient methods/type members and ws command mappings, no deprecated alias/shim. Keep server legacy DELETE and Android/unrelated-client behavior unchanged. No executable hidden legacy-shell restore. Any newly discovered reachable caller is a plan revision with exact ownership before edits, not unowned work.
6. For H1 evidence reuse bounded existing client diagnostics, not a new telemetry subsystem. Add opaque per-xterm instance token at actual creation/dispose and record actual reset at `terminal-buffer-replay.ts` reset boundary; associate existing attach/replay events with token/qualified sanitized owner. No terminal bytes/commands/paths, no global test flag. P08 reads existing bounded diagnostic snapshot/storage and network frames; missing/truncated baseline invalidates zero-count claims. Record retries too (actual attach send, not only first attempt). Placement delta must be attach=0/replay=0/reset=0/created=0/disposed=0 for same live token; close/reopen is separate nonzero-allowed scenario. Remove throwaway probes after qualification; retain only justified minimal existing diagnostics enrichment.
7. Existing input/replay/TerminalPanel tests cover exact target/owner propagation and suppression restoration, safe numeric-equal replay acceptance vsunsafe/missing/mismatch refusal, origin-specific Close completion and diagnostics at real boundary, not source text. Add exact target checks to `terminal-buffer-replay.ts` helper boundary in THIS task without widening numeric producer protocol; panel/keep-alive checks already wired by prior task. Full app P08 final PTY/input oracle. IntegrationOwner hands off all writes before qualification; scoped failures return to same owner, never concurrent patchers.

## Acceptance and exact future checks
P07 is integrated behavior, not runtime sign-off. No stale/raw intent auto-creates or rebinds; one qualified renderer survives placement; all explicit Close controls converge; hidden Review data retires and siblings survive ordinary close; unsafe web aliases gone.
P08: `pnpm --filter @dam-hopper/ui test -- src/os/intents.test.ts src/os/deep-links.test.ts src/os/resource-registry.test.ts src/os/persistence.test.ts src/components/organisms/TerminalKeepAliveHost.test.tsx src/components/organisms/TerminalPanel.test.tsx src/lib/terminal-input-policy.test.ts src/lib/terminal-buffer-replay.test.ts`; UI build and full app matrix afterward. Final source search is caller evidence only, not behavior proof.

## Failure, rollback, security and resources
Missing identity fails closed, not ambient. Retirement purges protected data even hidden and rejects late responses. Placement cannot depend on mutable title/focus object or remount key; live registry token and actual network/reset counters prove continuity later. If integrated guard unavailable End stays disabled. Rollback preserves existing persisted layout and safe disabled actions, never bare-ID destructive fallback or guessed Review root. Clean only owned test processes/resources; no auto idle cleanup, tombstone eviction or unrelated predecessor repairs.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "integrate-qualified-session-routing",
    "title": "Integrate immutable session placement, claims and Review routing",
    "blocked_by": [
      "review-authority-retirement"
    ],
    "allowed_files": [
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/OsResourceHost.tsx",
      "packages/ui/src/os/apps/TerminalsApp.tsx",
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/types.ts",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/intents.test.ts",
      "packages/ui/src/os/deep-links.ts",
      "packages/ui/src/os/deep-links.test.ts",
      "packages/ui/src/os/resource-registry.ts",
      "packages/ui/src/os/resource-registry.test.ts",
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/persistence.test.ts",
      "packages/ui/src/components/organisms/MultiTerminalDisplay.tsx",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.tsx",
      "packages/ui/src/components/organisms/TerminalKeepAliveHost.test.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.test.tsx"
    ],
    "constraints": [
      "IntegrationOwner only after all branches and SessionUiOwner terminal; shared files handed off explicitly.",
      "No create-on-adopt, persisted runtime authority, duplicate renderer/claim or ambient generation."
    ],
    "acceptance": [
      "Exact placement reuses/restores/moves ordinary windows and tabs without unrelated topology reset.",
      "Full exact string target reaches host/claim/panel without Number coercion; unsafe numeric replay/live proof unavailable, missing/replaced adopt refuses, imports untrusted.",
      "Review routing and deep links require exact metadata-verified owner/root/baseline tuple."
    ],
    "verification": [
      "P08 run P07 exact unit command and authenticated rows 3/4/6/7 with live counter and close/reopen distinction."
    ]
  },
  {
    "id": "integrate-close-input-retirement",
    "title": "Integrate all Close controls, hidden retirement and physical-input gates",
    "blocked_by": [
      "integrate-qualified-session-routing"
    ],
    "allowed_files": [
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/OsResourceHost.tsx",
      "packages/ui/src/os/WindowFrame.tsx",
      "packages/ui/src/os/WindowList.tsx",
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/terminal-close-context.tsx",
      "packages/ui/src/os/shell-input-context.tsx",
      "packages/ui/src/api/client.ts",
      "packages/ui/src/api/ws-transport.ts",
      "packages/ui/src/components/organisms/TerminalPanel.tsx",
      "packages/ui/src/components/organisms/TerminalPanel.test.tsx",
      "packages/ui/src/lib/terminal-input-policy.ts",
      "packages/ui/src/lib/terminal-input-policy.test.ts",
      "packages/ui/src/lib/terminal-buffer-replay.ts",
      "packages/ui/src/lib/terminal-buffer-replay.test.ts",
      "packages/ui/src/os/review-retirement.tsx"
    ],
    "constraints": [
      "IntegrationOwner only; no concurrent source writer or half-integrated qualification.",
      "No unsafe web aliases, cancellation fiction, broad runtime/telemetry system or protected hidden cache."
    ],
    "acceptance": [
      "All explicit Close uses shared live/pending policy; cleanup never End; 202 waits exit and 200 exact cancellation/origin-specific marker may complete original view.",
      "Hidden Review retirement purges exact protected identity/owner data; normal close preserves sibling caches.",
      "Actual modal/Cognito gates terminal input; bounded actual lifecycle counters support non-vacuous qualification."
    ],
    "verification": [
      "P08 run P07 command, final destructive-caller search, physical PTY-byte oracle and all seven integrated acceptance rows."
    ]
  }
]
```

- [x] <!-- evcrate-task:integrate-qualified-session-routing --> Integrate immutable session placement, claims and Review routing
- [x] <!-- evcrate-task:integrate-close-input-retirement --> Integrate all Close controls, hidden retirement and physical-input gates
