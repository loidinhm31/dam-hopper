# Phase 01: Implement and verify

## Context links

- Parent: [plan.md](./plan.md)
- Scout: [floating terminal key controls](../reports/scout-260806-1710-floating-terminal-key-controls.md)
- Docs: [frontend components](../../docs/frontend-components.md), [code standards](../../docs/code-standards.md), [system architecture](../../docs/system-architecture.md)
- Existing patterns: [`MobileTerminalAccessoryBar.tsx`](../../packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx), [`TerminalScrollButtons.tsx`](../../packages/ui/src/components/organisms/TerminalScrollButtons.tsx)

## Overview

- Date: 2026-08-06
- Description: expose one floating Keys/Type group for the active session on normal desktop and mobile terminal surfaces; preserve current panels and input policy.
- Priority: P2
- Implementation status: Completed 2026-08-06 22:51 +07:00 (Asia/Saigon)
- Review status: Approved 9/10

## Key Insights

- `MobileTerminalAccessoryBar` already owns all local open/modifier/native/custom keyboard state and PTY writes; reuse it, no new store/controller.
- Its current in-flow mount shrinks xterm and its compact/coarse gate also hides controls on desktop. Visibility and native-input suppression must become separate decisions.
- `TerminalRuntimeOutput` has the ideal `relative overflow-hidden` host and already owns scroll controls. `MultiTerminalDisplay` has a `relative` surface around `SplitLayout` and should render one shared group targeting `activeSessionId`, not one per pane.
- Scroll controls use host-local absolute placement, translucent surface, focus rings, propagation guards, outside/Escape handling. Copy that language; do not add a portal unless inspection during `/code` proves host clipping cannot be solved locally.
- Compact `MobileWorkspaceShell` keeps inactive surfaces mounted/inert and has a z-40 draggable Panels trigger; terminal controls must stay scoped to the active visible surface and below shell/dialog overlays.

## Requirements

### Preflight checklist

- [ ] Output one floating Keys/Type control group on each active terminal surface in desktop and mobile layouts.
- [ ] Match scroll-button surface, border, shadow, blur, hover/active, focus-ring, and event behavior.
- [ ] Keep xterm host height unchanged when controls mount or expand; controls overlay instead of adding a flex row.
- [ ] Target only current `activeSessionId`; split mode renders one group over the shared split surface and follows active pane/session changes.
- [ ] Reserve a distinct lower-right lane from `TerminalScrollButtons`; account for collapsed and expanded states.
- [ ] Apply bottom/right safe-area variables and verify short/mobile viewports plus OS/custom keyboard states.
- [ ] Preserve real buttons, current `aria-label`, `title`, `aria-pressed`, keyboard focus, and visible focus rings; label any new group.
- [ ] Preserve special-key, custom-keyboard, and native Type input writes and open/close behavior.
- [ ] Prevent trigger/action pointer events from selecting/focusing xterm or starting split drag; still allow the native input itself to receive focus.

### Side-effect review checklist

- [ ] Auth/session/permissions: unaffected; existing authenticated PTY transport and session selection reused, no permission request.
- [ ] API/client compatibility: unaffected; no transport method, payload, endpoint, or host contract change.
- [ ] Data/schema: unaffected; no persistence, migration, settings, TOML, or local-storage shape change.
- [ ] Business logic: unaffected; PTY lifecycle, active-session ownership, restart, split docking, and browser handoff unchanged.
- [ ] Security/privacy/logging: unaffected; no new input capture, telemetry, diagnostics, raw terminal logging, or secret handling.
- [ ] Performance/concurrency: local React state/CSS only; no listener per pane, polling, portal, global subscription, PTY duplication, or backend concurrency change.
- [ ] Docs/config/deployment: update terminal component behavior in `docs/frontend-components.md`; no config, feature flag, build pipeline, native permission, or deployment change. `docs/system-architecture.md` remains accurate unless implementation introduces a new structural boundary.

## Architecture

1. Keep `MobileTerminalAccessoryBar` as the single behavior component. Convert its outer presentation to a host-local floating panel (or narrowly add a placement prop only if another in-flow consumer is found). Use pointer-inert empty wrapper space and pointer-active controls/panels.
2. In `TerminalRuntimeOutput`, derive `mobileInputPolicyApplies` from Android suppression or compact + coarse pointer. Use it only for `suppressTerminalNativeInput`; render the accessory whenever `activeSessionId` exists.
3. Mount the accessory inside `terminal-runtime-output-host`. Coordinate safe-area-aware right/bottom offsets with `terminalScrollButtonsEnabled`: scroll rail retains its lower-right lane; Keys/Type and expanded panel end before that lane. Remove the old `bottom-2`/in-flow-bar coupling.
4. In `MultiTerminalDisplay`, retain the same mobile suppression derivation, move one accessory into the existing relative split surface, and bind it to global `activeSessionId`. Do not duplicate controls in `PaneContainer`, add global state, or portal across split panes.
5. Preserve trigger mouse-down default prevention and stop bubbling pointer/click events at the floating surface. Do not prevent default on the native Type input path, so desktop/mobile input focus still works.
6. Keep z-index below mobile Panels/dialogs and above xterm/docking content. Bound expanded panel width/height to host/viewport and safe areas; let existing terminal resize/refit react only to actual host or OS keyboard size changes.

## Related code files

### Modify

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MobileTerminalAccessoryBar.tsx` — floating visual/event shell; preserve state and children.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.tsx` — always-on active-session mount, policy separation, scroll-lane coordination.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MultiTerminalDisplay.tsx` — one overlay over split surface, policy separation.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MobileTerminalAccessoryBar.test.tsx` — labels/pressed state, panel branches, propagation/focus contract.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalRuntimeOutput.test.tsx` — desktop/mobile visibility, no in-flow row, policy and scroll offset regressions.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/mobile-terminal-accessory-bar.browser.tsx` — real geometry, focus, expansion, desktop/mobile viewports.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/terminal-scroll-buttons.browser.tsx` — combined collision/interaction coverage if best kept with existing scroll harness.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/mobile-workspace-shell.browser.tsx` — update old in-flow accessory fixture and verify Panels/control separation if affected.
- `/mnt/data/ws/sharing/dam-hopper/docs/frontend-components.md` — document floating desktop/mobile controls and split/session ownership.

### Create only if focused coverage cannot fit existing seams

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/MultiTerminalDisplay.test.tsx` — prove one group and active-session retargeting without browser complexity.
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/floating-terminal-key-controls.browser.tsx` — combined runtime/split geometry matrix; prefer extending existing browser files first.

### Reference, no planned change

- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/TerminalScrollButtons.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/ActiveTerminalRuntimeDisplay.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/PaneContainer.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/SplitLayout.tsx`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/index.css`

## Implementation Steps

1. `/code` must call `ui-ux-designer` first. Give it this plan, scout, `TerminalScrollButtons`, safe-area variables, mobile Panels trigger, and 320/375/1440px constraints. Require a concise placement token decision: z-index, touch target, gap, safe-area offsets, expanded width/max-height, and scroll-lane rule.
2. Refactor accessory presentation only. Retain all current state, settings reads, transport writes, labels, `aria-pressed`, and custom/native keyboard branching. Add group semantics and propagation guards without blocking input focus.
3. Refactor `TerminalRuntimeOutput` visibility vs suppression. Mount the overlay inside the positioned host, implement collision classes from step 1, and remove layout-row/scroll-bottom coupling.
4. Refactor `MultiTerminalDisplay` similarly. Mount exactly once over the split surface and retarget via `activeSessionId`; verify terminal/browser split and docking overlays remain above/below as intended.
5. Add focused Vitest assertions: desktop fine-pointer render; compact/coarse and Android policy; custom setting does not suppress desktop xterm merely because controls render; zero/one group; active-session ID forwarding; labels/pressed state; expanded children; no host click from control actions.
6. Activate `web-testing` for Chromium validation. At desktop and mobile sizes assert bounding boxes stay in host/safe area, collapsed and expanded controls do not overlap scroll controls or Panels, xterm host dimensions do not shrink, Tab/Enter/Escape and pointer behavior work, native Type input focuses/writes, and split active-session changes keep one group.
7. Update `docs/frontend-components.md`; avoid architecture/config docs unless implementation actually changes their contracts.
8. Run tester gate, then `code-reviewer` gate. Fix findings and rerun affected checks before completion; reviewer must inspect stacking/clipping, split anchoring, desktop Type focus, safe areas/OS keyboard, event propagation, duplication, and scope drift.

## Todo list

- [x] `ui-ux-designer` approves placement tokens and responsive geometry.
- [x] Accessory floats with scroll-button visual/event language.
- [x] Runtime output renders one active-session group on desktop/mobile without changing input suppression semantics.
- [x] Split display renders one active-session group and follows session changes.
- [x] Expanded Keys/custom/native Type panels remain functional and bounded.
- [x] Unit tests pass for controls, runtime mounting, and split ownership.
- [x] Chromium desktop/mobile geometry, focus, interaction, and collision evidence captured.
- [x] UI TypeScript build, web build, lint, docs, tester, and `code-reviewer` gates pass.

## Validation

- Focused unit: 19/19 passed; relevant Chromium: 16/16 passed.
- UI/web builds, lint, formatting, and scoped diff checks passed.
- Unrelated stale `terminalRegistry` browser import failure remains; remaining warnings are non-blocking.

## Success Criteria

- One keyboard-focusable Keys/Type group is visible for every active normal desktop or mobile terminal surface; none without an active session and no duplicate per split pane.
- Terminal host bounding height is identical before/after collapsed control mount and panel expansion; only real viewport/OS keyboard changes can trigger a fit.
- At 320/375px mobile and representative 1280/1440px desktop widths, controls/panels stay in bounds, honor safe areas, and have no bounding-box intersection with enabled scroll controls or compact Panels trigger.
- Current labels, pressed state, special-key sequences, custom modifiers, native text/Backspace/Enter, and Android policy all pass.
- Control interaction does not bubble to terminal host, switch pane, start docking, or steal xterm focus; native Type input remains intentionally focusable.
- Validation passes: focused Vitest; focused Chromium browser suite; `pnpm --filter @dam-hopper/ui build`; `pnpm build`; `pnpm lint`; tester and `code-reviewer` approval.

## Risk Assessment

| Risk | Mitigation / proof |
| --- | --- |
| Overlay clipped or hidden by `overflow-hidden`/stacking contexts | Mount inside each positioned terminal host; use local z-index; browser geometry at expanded states and browser/split layouts. |
| Split controls target wrong pane/session or duplicate | One `MultiTerminalDisplay` mount bound to `activeSessionId`; unit/browser switch assertions. |
| Desktop Type changes xterm suppression/focus | Keep responsive policy separate from render; test fine-pointer desktop with custom setting on/off. |
| OS keyboard, home indicator, short viewport collision | Safe-area bottom/right offsets, bounded panel, 320x420 and mobile keyboard/manual evidence. |
| Scroll or Panels overlap | Designer-defined reserved lane; bounding-box assertions collapsed/expanded and settings on/off. |
| xterm click/focus or dnd propagation | Prevent trigger mouse-down default, stop wrapper events, exempt native input default; host-click/focus tests. |
| Overlay intercepts terminal across empty width | Pointer-inert outer geometry with pointer-active controls/panel only; real-browser click-through check. |
| Scope grows into portal/global state | Stop and document proof before adding either; default implementation remains host-local/local-state. |

## Security Considerations

- Reuse `getTransport().terminalWrite`; do not add alternate write paths, auto-submit, command buffering, telemetry, or raw input/output logs.
- Preserve authenticated session routing by current `sessionId`; test retargeting so input cannot be sent to a stale split session.
- No new browser/native permissions, persisted data, HTML injection, or cross-origin behavior.
- Keep input/control labels free of terminal content and secrets; diagnostics remain unchanged.

## Next steps

1. Handoff with `/code plans/260806-1710-floating-terminal-key-controls/plan.md`.
2. Enforce sequential gates: `ui-ux-designer` decision → implementation → tester/unit/build/lint → `web-testing` Chromium evidence → `code-reviewer` → fixes/revalidation.
3. Final report must include exact commands/results, browser evidence, changed docs, unaffected side effects, and remaining risk.

## Unresolved questions

- None blocking. The unrelated stale `terminalRegistry` browser import failure and non-blocking warnings remain for separate follow-up.
