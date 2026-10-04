# Privacy and Agent Notification Components

Cognito Mode, agent notifications, and terminal title details moved from the [component index](../frontend-components.md).
## Cognito Privacy Mode (Phases 02–04)

**Locations:** `packages/ui/src/stores/cognito-mode.ts`,
`components/organisms/CognitoModeOverlay.tsx`,
`hooks/use-cognito-mode-input-guard.ts`, `lib/cognito-mode-events.ts`,
`lib/shortcuts.ts`, `lib/terminal-keyboard-shortcuts.ts`,
`components/organisms/TerminalPanel.tsx`, `embed/dam-hopper-app.tsx`,
`index.css`, `TerminalNotificationToastViewport.tsx`,
`BrowserDebugKeepAliveHost.tsx`,
`components/organisms/SettingsKeyboardShortcutsSection.tsx`, and
`components/organisms/SettingsAppearanceSection.tsx`.

`useCognitoModeStore` is memory-only UI state: it starts inactive, and
`toggle(shortcut)` activates with that chord captured for dismissal. Toggling
again clears the active state and chord; `reset()` is lifecycle cleanup, not a
user dismissal control. The shortcut and style remain persisted preferences;
activation state is never stored.

In Settings > Keyboard Shortcuts, capture/reset Cognito's shortcut; Settings > Appearance offers **Heavy Blur** and **Black Screen**. Preferences persist, but activation is memory-only and reload starts inactive. Only the same chord that activated the mask dismisses it; notifications and audio continue while masked.

`CognitoModeOverlay` portals a focusable, labelled region to `document.body`
only while active. Its full-viewport fixed layer uses the app viewport
dimensions and `z-index: 10000`. `black-screen` is opaque black; `heavy-blur`
uses a 16px backdrop blur with 180% saturation, a subtle slate frost tint (0.12 alpha), and an
inset glass highlight, with an opaque-black fallback when backdrop filtering is
unsupported or, in engines that support `prefers-reduced-transparency`, when
reduced transparency is preferred. The accessible description
includes the captured dismissal chord, and activation moves focus to the overlay.

`useCognitoModeInputGuard` owns window-capture input isolation. It registers
non-passive capture listeners for pointer, mouse, touch, click/context, wheel,
drag, clipboard, input, composition, focus, and keyboard events. While active it
cancels cancelable input and stops immediate propagation; gesture tracking also
consumes a trailing release/click after dismissal. It redirects focus to the
overlay and restores the previous target only if it remains connected and
non-inert. The pointer-event list is defined in `cognito-mode-events.ts`.

`DamHopperApp` mounts this guard first, before the browser shortcut and context
menu guards. A fresh, matching nonrepeat/noncomposing keydown toggles the mask;
IME input (including legacy key code `229`) and repeats never toggle it. While
active, only a fresh keydown matching the frozen activation chord dismisses;
all keyboard events are consumed, including repeats and the physical key
sequence through release. The guard tracks intercepted physical keys and clears
that tracking on window blur without dismissing the mask. The
`data-shortcut-capture="true"` path passes through only while inactive.

`TerminalPanel` performs a defensive Cognito check before Backspace handling,
suggestion acceptance/history, or selection copying. Its shared shortcut helper
checks again before font, find, panel, and new-terminal actions. These terminal
checks only consume input; the root capture guard is the sole toggle owner.
Ordinary terminal behavior resumes after dismissal; PTY write/transport APIs
are unchanged.

The app root mounts the overlay outside the routed content and keeps global
shortcut services and the notification viewport mounted. A neutral content
wrapper receives `inert` and `aria-hidden` while masked rather than unmounting
productive routes. The terminal toast viewport remains visible above the mask
(z-index `10001` while active), but capture listeners prevent pointer
interaction; toast lifetime and other notification delivery are unchanged.
`BrowserDebugKeepAliveHost` separately hides the requested viewport: native
hosts receive a null viewport and the iframe fallback receives
`isViewportVisible={false}`. Dismissal restores the measured viewport without
replacing the Browser target or host.

The shortcut is scoped to events in DamHopper's app document; this is not an
OS-wide hotkey and does not capture keys from foreign iframes or native child
surfaces. Phase 05 still owns real-browser, xterm, visual, and native-shell
qualification; component and unit coverage alone do not prove those runtime
boundaries.

## Terminal Agent Notifications

**Primary locations:**

- `packages/ui/src/components/organisms/AgentStatusBridge.tsx`
- `packages/ui/src/hooks/use-agent-status-connections.ts`
- `packages/ui/src/stores/agent-status.ts`
- `packages/ui/src/lib/terminal-agent-notification-integration.ts`
- `packages/ui/src/components/organisms/AgentSettings.tsx`
- `packages/ui/src/components/atoms/AgentStatusBadge.tsx`
- `packages/ui/src/stores/terminal-notifications.ts`
- `packages/ui/src/components/organisms/TerminalNotificationCenter.tsx`
- `packages/ui/src/components/organisms/TerminalNotificationToastViewport.tsx`
- `packages/ui/src/lib/terminal-notification-sound.ts`
- `packages/ui/src/lib/browser-notification-service.ts`
- `packages/ui/src/lib/terminal-notification-navigation.ts`

**Purpose:** Shared notification UI for server-reported semantic agent attention. The app-root status bridge owns profile subscriptions; terminal output is not parsed as Codex status, and DamHopper's Codex OSC 9 notification integration has been removed.

**Flow:**

1. `AgentStatusBridge` keeps per-profile snapshots and authenticated WebSocket subscriptions active outside `TerminalPanel`.
2. The agent status store fences rows and attention by profile connection generation, server epoch, terminal incarnation, and attention revision; baseline snapshots do not replay historical alerts.
3. `terminal-agent-notification-integration.ts` accepts only matching current owner/status/attention identities, then selects the policy by agent.
4. When an enabled policy accepts attention, history is recorded; `toast`, `sound`, and `browser` independently control transient, audio, and browser delivery.
5. Version-2 policies route OMP turn-ended and needs-attention events, Claude qualified needs-attention only, and no Codex alerts.
6. `TerminalNotificationCenter` renders the bell, unread count, bounded history, mark-read/all, and clear actions. In-app selection uses the event's profile and terminal identity.
7. `TerminalNotificationToastViewport` renders up to three live top-right alerts with a six-second timeout. `BrowserNotificationService` gates popup delivery by permission, rate limit, and support.

**Behavior notes:**

- Codex hooks provide status only: no turn-ended alert or needs-attention notification. Claude alerts are attention-only for qualified approval, question, or error states; normal turn-ended alerts are suppressed. OMP retains both turn-ended and needs-attention alerts.
- All policy masters default off. Version-1 and legacy Codex settings normalize into version 2 while preserving Codex/OMP channel preferences; Claude defaults off. Status badges do not depend on notification policy.
- Agent Settings is under Agent Store. OMP enablement requires matching install/runtime paths and a current managed extension; Claude requires matching paths and ready hooks; Codex notification activation is disabled.
- Agent status badges show the agent and human-readable state, distinguish Unknown, and identify lifecycle versus hook observations with limited-coverage context in the tooltip.
- There is no Codex OSC 9 parser, notification handler, or terminal attach callback, and settings no longer write Codex TUI notification configuration. Status and attention use the server agent-status protocol.
- History is memory-only and capped at 50 records; toast IDs are capped at three. Sound uses the existing synthesized in-app chimes and does not control native browser popup sound.
- Semantic notification selection retains profile and terminal incarnation identity; stale or closed targets are ignored. Browser permission is runtime-only and requested only by the explicit **Request permission** action.

## Terminal Title Ordinals

Open terminal titles derive a current 1-based ordinal from the global `openTabs`
order within each exact project group. Interleaved tabs from projects A and B
therefore display `A #1`, `B #1`, `A #2`, `B #2`; the global array order itself
never changes. The display projection is ephemeral: base `TabEntry.label` remains
unsuffixed, while `DisplayTabEntry.title` carries
`{ baseLabel, ordinal, fullText }`. `TerminalTitleText` renders the base in a
shrinkable/truncating region and the `#N` suffix in a non-shrinking region,
exposing `fullText` exactly once to assistive technology. Reordering, opening,
closing, and hydrating tabs recalculate each project's sequence.

Project grouping uses explicit frontend/session project metadata, never labels.
Free or projectless tabs share one internal projectless group; their
`Terminal X`/`Terminal (starting…)` labels are not grouping keys. Mounted-only
runtime or browser-handoff entries are outside the open-title contract, so they
retain readable unsuffixed fallbacks. Open browser targets carry both the
structured title and its complete `fullText` label.

Title ordinals are separate from notification context: `TerminalKeepAliveHost`
continues to calculate `terminalOrder` as the tab's global 1-based `openTabs`
position. `sessionId` remains the identity for keys, selection, close/pin/
diagnostics, PTY attachment, notifications, and browser artifacts. No title or
fallback exposes opaque session IDs or PTY incarnations.


