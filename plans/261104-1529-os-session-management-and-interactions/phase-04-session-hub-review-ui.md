# P04 — Session Hub, shared Close policy and Review

Priority P2 · Status completed · Effort 20h · Owner SessionUiOwner.

## Context, parallelization and prerequisites
Read [C2/C3](architecture-contracts.md), [source report](reports/session-contract-evidence.md), [P03](phase-03-client-observation-actions.md), [acceptance rows 1/3/4](acceptance-matrix.md), and actual SessionChanges `Status` in `packages/ui/src/api/session-changes-types.ts:121-136`.
P04 starts only after `guarded-termination-http`, `migrate-terminal-actions`, `recipe-source-target-capture`, `dismiss-shell-layers` and `canvas-placement-gestures` are terminal. Conservative barrier satisfies no overlap with other live branches; dependency on P03 is mandatory, no backend-enabled End before integrated route qualification. SessionUiOwner performs both tasks sequentially. Shared OsShell/resource-host/store/frame/window-list files remain read-only until P07 handoff.

## Requirements and rationale
Hub is inventory-first, agent-observation joined, never agent-only. Background means no qualified open view on ANY desktop; minimized/other-desktop views remain open. Review is metadata-qualified read-only access with exact owner/root/baseline and protected retirement, not badge-based availability. Close view and End are deliberately distinct operations with safe Cancel focus.

### Task `hub-and-close-ui`
**Modify:** `packages/ui/src/os/apps/AgentHubApp.tsx`, `packages/ui/src/os/apps/SystemMonitorApp.tsx`, `packages/ui/src/os/agent-hub.ts`, `packages/ui/src/os/agent-hub.test.ts`, `packages/ui/browser-tests/os-agent-hub.browser.tsx`, `packages/ui/browser-tests/os-system-monitor.browser.tsx`. **Create:** `packages/ui/src/os/terminal-close-context.tsx`, `packages/ui/src/os/TerminalCloseDialog.tsx`. **Delete:** none. SessionUiOwner only. Context/controller is a real bounded Close service, not a second inventory or terminal runtime; P07 mounts it once and wires existing controls.

1. Hub rows from aggregate inventory with canonical exact targets, flat terminationState, legacy SessionInfo rendering. Join agent evidence by owner/id and losslessly proven incarnation: numeric positive safe integer canonical-equal to exact string only; unsafe numeric agent proof cannot be rounded/stringified. Unmatched inventory still visible/unobserved with valid exact End; agent-derived Review/urgency unavailable where proof missing. Preserve project grouping/owning labels, All/Agents/Background counts and Cognito masking; unobserved !=idle/safe.
2. Match terminal membership across every `session.windows` entry by exact runtime target (including generation/PTY epoch/incarnation), not raw ID or active desktop only. Minimized same-desktop -> restore/focus; other desktop -> Go to window or explicit Move beside. No view -> Background. Restored windows without verified runtime target remain unverified until P07 revalidation, never guessed as same PTY.
3. Emit frozen `terminal:place-existing` intent from Hub, carrying source Hub window and captured target plus explicit action. Render unavailable/replaced/disconnected refusal. No backend create, embedded terminal or claim acquisition here. P07 applies normal tile/pane operation and handles additional tabs.
4. Shared Close provider accepts frozen request+callback. Exact live OR restartPending (`alive:false`) ->Close view / End session / Cancel, initial Cancel; describe live signal vscancel scheduled restart. Unknown/disconnected/headerless/malformed exact/unavailable ->safe Close/Cancel +disabled End reason. Unsafe legacy numeric alone does NOT disable valid exact inventory End. Exact exited/restartCancelled ->presentation Close without running prompt. Before dispatch Cancel no effect; afterward dismissal never cancels mutation; retain action+origin until resolved/acknowledged without undo claim.
5. End uses P03 once with captured origin. Live202 only awaiting exit; keep selected view until exact current-owner/epoch/id/incarnation state exited. Pending200 exact restartCancelled completes immediately and may close only original matching view; lost pending response resolves ONLY same exact retained restartCancelled marker. Ordinary exited/absence/alive:false cannot prove pending cancellation, and cancellation marker cannot prove live-origin exit. Wrong kind/missing/replacement/retired owner unresolved/refused, no retry/retarget/eviction. Explicit Close always remains available; recheck original target/window +owner around awaits.
6. Monitor bare-kill/preflight ->captured aggregate exact target AND state/origin, same service/policy. Focus emits exact placement intent/source window, no ambient raw ID. Valid max-u64 End permitted without numeric agent join; headerless server upgrade guidance. Existing metrics/SSE/host-actions unchanged.
7. Browser checks: inventory filters/membership, full-u64 exact confirmation, restartPending alive:false three choices, 200 immediate exact cancellation vs202 no close, both response-loss origins, ordinary-exited-not-cancel-proof, malformed exact no fallback, safe focus/normal-window payload. Cross profile/epoch collisions and unsafe agent joins cannot enable Review; inventory remains usable. Behavioral API boundary effects, not captions/private spellings; traditional agent builders unchanged.

### Task `review-authority-retirement`
**Modify:** `packages/ui/src/os/apps/AgentHubApp.tsx`, `packages/ui/src/os/apps/SessionChangesApp.tsx`, `packages/ui/src/api/session-changes-queries.ts`, `packages/ui/src/api/session-changes-queries.test.tsx`, `packages/ui/src/components/organisms/SessionChangesPanel.tsx`, `packages/ui/browser-tests/os-review-apps.browser.tsx`, `packages/ui/browser-tests/session-changes-panel.browser.tsx`. **Create/Delete:** none. Same SessionUiOwner, sequential reuse of AgentHubApp intentional. P07 exclusively supplies root hidden-window retirement wiring later.

1. Resolve origin from captured exact inventory target plus losslessly joined agent authority; unsafe numeric agent identity ->Review unavailable, never coerce/rebind. Query existing owning config/metadata-only Status (optional root only existing metadata semantics, never `.`). Compare existing string terminalIncarnation exactly to target incarnation, then capture ID/SessionChanges epoch/non-null verified root/baseline; reflect initializing/partial coverage. Revalidate before dispatch/after await; missing proof/config support ->explicit reason. No agent/SessionChanges producer protocol expansion.
2. Emit complete frozen ReviewTarget for `session-changes:open`; no generation fallback to latest connection, guessed root or badge-derived eligibility. Render loading/disabled/unsupported/missing capture/root/baseline/disconnected/retired explanations, with exact `settings:open` target for server settings where relevant. Do not auto-enable tracking or claim lost history can be rebuilt.
3. In SessionChangesApp use supplied immutable tuple and separate live viewer subtree from content-free refusal. Remove guessed-root/generation fallbacks and silent close-on-retirement. Claims and file/detail queries include owner, terminal/incarnation/capture, SessionChanges epoch/root/baseline (comparison revision for file content). Reject mismatched returned metadata. Extend existing query-key helpers with an exact ReviewTarget predicate for cancellation/removal; no owner-wide purge on normal close.
4. Single view close cancels and purges only that exact review identity and releases its claim; preserve sibling review caches/reads under same owner. Disable/disconnect/retirement purge all affected protected owner/identity data and unmount viewer; content-free explanation may remain. Component guards handle visible mount changes; P07 root-level observer covers minimized and other-desktop windows whose app components are unmounted. No dependence on visibility to enforce retirement.
5. SessionChangesPanel may retain public optional-root metadata lookup for others; OS passes verified exact string/root/epoch/baseline and close scope. No producer/schema broadening. Tests include max-u64 inventory with unsafe numeric agent association (Review unavailable, End still eligible), exact Status disagreement, safe equality, disable hidden, retirement during Status/files, late discard, tuple mismatch, two identities/one closes. P07/P08 root hidden lifecycle fixture separate.

## Consumer acceptance and exact future checks
- Hub discovers all sessions and no-view work without changing agent classification. Open beside emits correct immutable action; window placement remains P07 responsibility.
- One shared three-way Close policy for live and pending restart; live202 waits exact exit, pending200 completes exact cancellation; correct origin-dependent loss proof. Safe Close always available; unsupported/malformed exact never fallback.
- Review opens/focuses exact verified data or explains refusal, with no silent disappearance or sibling purge.
- P08: `pnpm --filter @dam-hopper/ui test -- src/os/agent-hub.test.ts src/api/session-changes-queries.test.tsx`; `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-agent-hub.browser.tsx browser-tests/os-system-monitor.browser.tsx browser-tests/os-review-apps.browser.tsx browser-tests/session-changes-panel.browser.tsx`; actual authenticated app rows 1/3/4 afterward.

## Failure, rollback, security and resources
Incomplete tuple disables Review/End, never guessed. Metadata only for availability; no hidden content fetch before eligibility. Cancellation does not prevent late response by itself: generation/identity rechecks must discard it. Only exact identity cancelled on close; owner-wide purge restricted to retirement/config disable/disconnect. Keep UI state bounded to open actions/windows, no durable runtime authority. Rollback keeps unavailable explanation and safe Close; never restore old bare kill or guessed-root Review.

All checks below are FUTURE implementation checks, executed once by P08 after branches and integration land, not by this plan author or mid-flight workers. Read installed test principles before execution; retain failures/skips/blocks. No Git, dependencies, release or implementation authorization is conveyed by this phase. Root for all literal paths: `/home/loidinh/WS/dam-hopper`. Escalate any additional writable path before editing; no directory-wide permissions. No source file deletions unless explicitly listed. Existing incidental-wording/default assertions must be replaced/deleted for changed semantics, not re-pinned; add permanent tests only for named behavioral risks.

## Durable tasks

```evcrate-tasks
[
  {
    "id": "hub-and-close-ui",
    "title": "Build inventory-first Hub and shared safe Close controller",
    "blocked_by": [
      "guarded-termination-http",
      "migrate-terminal-actions",
      "recipe-source-target-capture",
      "dismiss-shell-layers",
      "canvas-placement-gestures"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/AgentHubApp.tsx",
      "packages/ui/src/os/apps/SystemMonitorApp.tsx",
      "packages/ui/src/os/agent-hub.ts",
      "packages/ui/src/os/agent-hub.test.ts",
      "packages/ui/browser-tests/os-agent-hub.browser.tsx",
      "packages/ui/browser-tests/os-system-monitor.browser.tsx",
      "packages/ui/src/os/terminal-close-context.tsx",
      "packages/ui/src/os/TerminalCloseDialog.tsx"
    ],
    "constraints": [
      "SessionUiOwner only; no live parallel branch overlaps P04.",
      "Shared shell/store/resource/frame wiring reserved P07; no second terminal renderer."
    ],
    "acceptance": [
      "Hub includes unobserved/background sessions with exact membership and qualified beside intents.",
      "Shared Close controller/Monitor prompt live and restartPending; 202 waits exit, 200 exact cancellation completes; unsupported/malformed authority disables only End."
    ],
    "verification": [
      "P08 run P04 unit/browser commands and authenticated rows 1/4 including response loss and same raw IDs."
    ]
  },
  {
    "id": "review-authority-retirement",
    "title": "Qualify Review identity and exact protected-data retirement",
    "blocked_by": [
      "hub-and-close-ui"
    ],
    "allowed_files": [
      "packages/ui/src/os/apps/AgentHubApp.tsx",
      "packages/ui/src/os/apps/SessionChangesApp.tsx",
      "packages/ui/src/api/session-changes-queries.ts",
      "packages/ui/src/api/session-changes-queries.test.tsx",
      "packages/ui/src/components/organisms/SessionChangesPanel.tsx",
      "packages/ui/browser-tests/os-review-apps.browser.tsx",
      "packages/ui/browser-tests/session-changes-panel.browser.tsx"
    ],
    "constraints": [
      "SessionUiOwner only; root hidden-window observer wired P07.",
      "Use existing Status/config authority; no guessed root, new producer or automatic enable."
    ],
    "acceptance": [
      "Review requires losslessly proven agent/inventory/Status equality and complete exact tuple, else explicit unavailable; valid inventory End unaffected by unsafe agent proof.",
      "Normal close preserves sibling cache; disabled/disconnected/retired identity purges protected content and late responses."
    ],
    "verification": [
      "P08 run P04 Review unit/browser commands and authenticated row 3 hidden-window/late-response/sibling-cache scenarios."
    ]
  }
]
```

- [x] <!-- evcrate-task:hub-and-close-ui --> Build inventory-first Hub and shared safe Close controller
- [x] <!-- evcrate-task:review-authority-retirement --> Qualify Review identity and exact protected-data retirement
