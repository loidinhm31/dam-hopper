# Phase 07 — Integrate root Browser lifecycle and retire iframe path

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `reports/viewer-boundaries.md:6–54; reports/design-direction.md:53–58; current OsResourceHost.tsx:38–75,396–405; persistence.ts:56–60`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-09). Effort: not-estimated.
- Deliverable: Integrate root Browser lifecycle and retire iframe path. Marked DONE per user approval with noted issues after Cycle 2 (2026-11-09; score 4/10; 208 validation checks passing across unit [184/184], Chromium browser tests [22/22 across os-lifecycle, os-input-isolation, and host-browser-lifecycle], UI build, and E2E typecheck). Ready to proceed to Phase 08; Phase 08 unblocked. Technical carryovers W1–W10 tracked into Phases 08 and 09.

## Key insights
Current slot host keys by URL and resource registry excludes second holder; new sessions must be target identity and presentation claims viewer-local. closeWindow is pure state: explicit resource action belongs in existing execution/store integration, not hidden async mutation in reducer.

## Requirements
All placements preserve canvas DOM/controller and live target. Navigation/history/popups/dialogs, current intents/deep links/PortsTunnels, persistence/recipes and privacy/close must cleanly cut over while preserving PTY/Monaco/HtmlPreview/extension.

## Architecture
One sequential integration owner updates shared OS callsites. Root Browser host/controller persists under OsResourceHost; child BrowserApp attaches a placement portal. Explicit close closes target; placement/unmount only changes presentation demand.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — integrate-root-browser
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/OsResourceHost.tsx` | Replace iframe host with root-owned streamed Browser; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/BrowserStreamKeepAliveHost.tsx` | Replace iframe host with root-owned streamed Browser; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/apps/BrowserApp.tsx` | Replace iframe host with root-owned streamed Browser; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/resource-registry.ts` | Replace iframe host with root-owned streamed Browser; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/resource-registry.test.ts` | Replace iframe host with root-owned streamed Browser; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/types.ts` | Replace iframe host with root-owned streamed Browser; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/os-lifecycle.browser.tsx` | Replace iframe host with root-owned streamed Browser; exact responsibilities in numbered steps below. |

### File map — migrate-browser-launch-state
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/OsShell.tsx` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/intents.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/deep-links.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/deep-links.test.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/apps/PortsTunnelsApp.tsx` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/persistence.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/persistence.test.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/recipes/recipe-source-context.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/recipes/recipe-source-context.test.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/recipes/recipe-engine.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/recipes/recipe-engine.test.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/recipes/schema.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/recipes/schema.test.ts` | Migrate all launches persistence and recipes to logical sessions; exact responsibilities in numbered steps below. |

### File map — bind-browser-window-policy
| Action | Full path | Purpose |
|---|---|---|
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/BrowserStreamKeepAliveHost.tsx` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/apps/BrowserApp.tsx` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/OsShell.tsx` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/action-executor.ts` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/window-store.ts` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/window-ops.test.ts` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/host-browser-lifecycle.browser.tsx` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/os-input-isolation.browser.tsx` | Integrate privacy explicit close popups and dialogs; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### integrate-root-browser
- Dependencies: instrument-stream-bounds, implement-web-input.
- Bounded outcome: Replace iframe host with root-owned streamed Browser.
1. Mount root BrowserStreamKeepAliveHost alongside preserved Terminal/Monaco hosts. Own canvas/controller by profile+generation+logical session+viewer window; reparent through established portal/slot ownership pattern, not arbitrary React DOM removal.
2. Delete obsolete browserSlots/registerBrowserSlot/updateBrowserSlot/OsBrowserIframe/OsBrowserKeepAliveHost symbols and every old import/assertion in writable files. Preserve cooperative BrowserDebugKeepAliveHost definitions and existing component/bridge harnesses plus HtmlPreview iframe; no established cooperative SPA mount is claimed and no new cooperative mount/restoration requested.
3. BrowserApp uses capabilities/reasons, view-only/controller indicators, navigation/history/reload/resize and explicit text focus. Replace URL-global claim with viewer-local presentation identity; allow two viewers of one target without resource exclusion.
4. Rewrite lifecycle tests to assert same root canvas DOM/controller and server session across tile/float/max/min/desktop transitions and no unintended navigation, including unsupported capability state.
- Consumer-visible acceptance:
  - Frame-denying real page renders top-level without extension; all OS placements retain live in-page state and same canvas DOM.
  - Two windows may view same target; no URL-based ownership collision or accidental target destruction on component unmount.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-lifecycle.browser.tsx`
  - `pnpm --filter @dam-hopper/ui test -- src/os/resource-registry.test.ts`
  - Smoke: type unsaved page text, move/maximize/minimize/desktop-switch/restore and compare target session/incarnation, DOM text and canvas identity.

### migrate-browser-launch-state
- Dependencies: integrate-root-browser.
- Bounded outcome: Migrate all launches persistence and recipes to logical sessions.
1. Keep browser:open/browser:preview public intents and current source owner captures, but make create idempotent per explicit launch. Deep links/PortsTunnels open managed targets with URL policy; identical URLs do not merge sessions.
2. Persist display URL and optional non-secret stable logical session reference only; strip ticket/lease/incarnation/rawCDP/transport authority. SPA reload lists live authenticated targets and adopts exact session; unknown/restarted target offers explicit Reload/Restore with new idempotency key and reloaded label.
3. Recipes export only URL/config and no live session ID/capability, preserving project-context inclusion/exclusion rules. Launching recipe always creates its own targets; no accidental sharing with saved window.
4. Remove all URL-as-resource/session identity assumptions in affected tests and callsites. Preserve generic app registry and deep-link public behavior; no unrelated recipe/context policy changes.
- Consumer-visible acceptance:
  - SPA reconnect adopts exact live target without navigation; host restart is explicit reload and preserves storage, not unsaved DOM.
  - Recipe import/export contains no live authority/session and opens independent targets on each launch.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test -- src/os/deep-links.test.ts src/os/persistence.test.ts src/os/recipes/recipe-source-context.test.ts src/os/recipes/recipe-engine.test.ts src/os/recipes/schema.test.ts`
  - Smoke: same URL in2targets, reload SPA and launch exported recipe; original targets remain distinct and recipe creates new target.

### bind-browser-window-policy
- Dependencies: migrate-browser-launch-state.
- Bounded outcome: Integrate privacy explicit close popups and dialogs.
1. Route explicit window-close via existing action/store resource-finalization convention using captured owner+logical target; close target once, then close window. Component unmount, desktop change or placement detach never calls target delete.
2. Aggregate hidden/minimized/inactive desktop/document visibility, Cognito, PIN and modal suppression. Black retained canvas synchronously for privacy, release original held input and pause only this viewer; another viewer/agent continues.
3. Project each native popup target into one OS Browser window with bounded overflow notice; do not add a tab bar. Radix admin-owned alert/confirm/prompt requires explicit response, dismiss on controller loss; permissions/file upload/download deny with visible reason.
4. Exercise late popup/dialog/resize/decode/control completion across profile switch, window close and target replacement. Preserve root PTY/Monaco and terminal-specific keyboard invariants.
- Consumer-visible acceptance:
  - Explicit close destroys exactly captured target; unmount/hide does not. Popup and dialog policy cannot leave invisible native windows or auto-accept sensitive prompts.
  - Cognito/PIN/modal immediately suppress input and privacy pixels without pausing other viewers/agents; terminal/editor regressions remain absent.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx`
  - `pnpm --filter @dam-hopper/ui test -- src/os/window-ops.test.ts`
  - Smoke: close one of2same-URL targets while a late callback arrives; only original closes, sibling/agent stays live.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "integrate-root-browser",
    "title": "Replace iframe host with root-owned streamed Browser",
    "blocked_by": [
      "instrument-stream-bounds",
      "implement-web-input"
    ],
    "allowed_files": [
      "packages/ui/src/os/OsResourceHost.tsx",
      "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx",
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/os/resource-registry.ts",
      "packages/ui/src/os/resource-registry.test.ts",
      "packages/ui/src/os/types.ts",
      "packages/ui/browser-tests/os-lifecycle.browser.tsx"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Frame-denying real page renders top-level without extension; all OS placements retain live in-page state and same canvas DOM.",
      "Two windows may view same target; no URL-based ownership collision or accidental target destruction on component unmount."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/os-lifecycle.browser.tsx",
      "pnpm --filter @dam-hopper/ui test -- src/os/resource-registry.test.ts",
      "Smoke: type unsaved page text, move/maximize/minimize/desktop-switch/restore and compare target session/incarnation, DOM text and canvas identity."
    ]
  },
  {
    "id": "migrate-browser-launch-state",
    "title": "Migrate all launches persistence and recipes to logical sessions",
    "blocked_by": [
      "integrate-root-browser"
    ],
    "allowed_files": [
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/intents.ts",
      "packages/ui/src/os/deep-links.ts",
      "packages/ui/src/os/deep-links.test.ts",
      "packages/ui/src/os/apps/PortsTunnelsApp.tsx",
      "packages/ui/src/os/persistence.ts",
      "packages/ui/src/os/persistence.test.ts",
      "packages/ui/src/os/recipes/recipe-source-context.ts",
      "packages/ui/src/os/recipes/recipe-source-context.test.ts",
      "packages/ui/src/os/recipes/recipe-engine.ts",
      "packages/ui/src/os/recipes/recipe-engine.test.ts",
      "packages/ui/src/os/recipes/schema.ts",
      "packages/ui/src/os/recipes/schema.test.ts"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "SPA reconnect adopts exact live target without navigation; host restart is explicit reload and preserves storage, not unsaved DOM.",
      "Recipe import/export contains no live authority/session and opens independent targets on each launch."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/os/deep-links.test.ts src/os/persistence.test.ts src/os/recipes/recipe-source-context.test.ts src/os/recipes/recipe-engine.test.ts src/os/recipes/schema.test.ts",
      "Smoke: same URL in2targets, reload SPA and launch exported recipe; original targets remain distinct and recipe creates new target."
    ]
  },
  {
    "id": "bind-browser-window-policy",
    "title": "Integrate privacy explicit close popups and dialogs",
    "blocked_by": [
      "migrate-browser-launch-state"
    ],
    "allowed_files": [
      "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx",
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/os/OsShell.tsx",
      "packages/ui/src/os/action-executor.ts",
      "packages/ui/src/os/window-store.ts",
      "packages/ui/src/os/window-ops.test.ts",
      "packages/ui/browser-tests/host-browser-lifecycle.browser.tsx",
      "packages/ui/browser-tests/os-input-isolation.browser.tsx"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Explicit close destroys exactly captured target; unmount/hide does not. Popup and dialog policy cannot leave invisible native windows or auto-accept sensitive prompts.",
      "Cognito/PIN/modal immediately suppress input and privacy pixels without pausing other viewers/agents; terminal/editor regressions remain absent."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-lifecycle.browser.tsx browser-tests/os-input-isolation.browser.tsx",
      "pnpm --filter @dam-hopper/ui test -- src/os/window-ops.test.ts",
      "Smoke: close one of2same-URL targets while a late callback arrives; only original closes, sibling/agent stays live."
    ]
  }
]
```

- [x] <!-- evcrate-task:integrate-root-browser --> Replace iframe host with root-owned streamed Browser
- [x] <!-- evcrate-task:migrate-browser-launch-state --> Migrate all launches persistence and recipes to logical sessions
- [x] <!-- evcrate-task:bind-browser-window-policy --> Integrate privacy explicit close popups and dialogs

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
Shared OS files overlap related active plans; coordinator must reserve them before this sequential phase. Placement must use existing ownership-safe portals.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
No iframe fallback; unsupported engine/protocol displays reason. Privacy clear is synchronous and cannot be undone by delayed bitmap completion.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Phase 07 is DONE (2026-11-09). Phase 08 is unblocked. Phase 08 (Secure selection artifacts and confirmed logout reset) exclusively owns shared auth/client/artifact integration. Independent extension and HtmlPreview remain unchanged by intent.
- User approved Phase 07 after Cycle 2 (score 4/10; 208 validation checks passing). Technical carryovers for subsequent phases:
  - **Phase 08 (Secure selection artifacts and confirmed logout reset):** W1 navigation revision JSON string/number wire contract reconciliation across backend and client endpoints; W2 persisted live target adoption/reconciliation via authenticated session listing; W4 lease renewal/release and expiration state handling; W5 document/shell-modal input arbitration and deliberate text proxy focus; W6 pending-create and failed-delete target closure tracking with captured owner finalization; confirmed logout reset flow with no preselected choice.
  - **Phase 09 (Qualify full app security platforms and efficiency):** W3 restore ticket demand-fencing and generation reactivity; W7 bounded native popup projection and shared Radix dialog modal; W8 connected-boundary behavioral test depth vs real connected backend; W9 imperative portal reparenting convention; W10 capability/transport failure error boundaries; full multi-target soak testing; real physical Android SPA verification (IME virtual keyboard, touch gestures, letterbox mapping); complete end-to-end OS privacy proof; global memory ceiling validation across backend and client.
- Parent owns independent plan review/optional validation and implementation permission. This phase text neither executes tasks nor supplies approval.
## Unresolved questions
- No additional product interview here. Exact compatibility/platform/performance and human observations remain future gates where applicable; their absence is not a pass.
