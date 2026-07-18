# Phase 03 — Wire delivery gates and Settings UI

## Context Links

- [Notification integration](../../packages/ui/src/lib/terminal-agent-notification-integration.ts)
- [Browser service](../../packages/ui/src/lib/browser-notification-service.ts)
- [Notification store](../../packages/ui/src/stores/terminal-notifications.ts)
- [Settings component](../../packages/ui/src/components/molecules/TerminalAgentNotificationSettings.tsx)
- [Appearance section](../../packages/ui/src/components/organisms/SettingsAppearanceSection.tsx)
- [Component guide](../../docs/frontend-components.md)

## Overview

- **Date:** 2026-07-19
- **Priority:** P2
- **Status:** Pending
- **Goal:** Fan an accepted OSC 9 event through independent history, toast, browser, and chime channels while exposing accessible live controls.

## Key Insights

- `addNotification(event)` currently creates both history and toast. The store needs a narrow opt-out parameter or method so toast off does not change bell/feed behavior, limits, navigation, or unread state.
- Master enabled is the capture gate and only control that changes Codex's TUI config. Sound, toast, and browser child settings must be available only when master is on, but must retain their saved values.
- Browser permission is browser-managed runtime state; toggling native browser delivery never asks for, revokes, or stores permission.

## Requirements

- For each valid non-replay OSC 9 event while master enabled: always add history; add a toast only when toast enabled; create native `Notification` only when browser delivery enabled and existing browser service gates pass; play selected chime only when sound enabled.
- Preserve source/session rate limiting, terminal navigation, sanitization, TUI-sync behavior, three-toast cap, six-second expiry, and 50-item history cap.
- Settings labels must distinguish **In-app toast**, **Browser popup**, **Notification sound**, **Sound style**, **Volume**, and **Play sound**; show that browser/OS popup sound is controlled by the browser and is not customizable here.
- Preview must call the selected pattern and volume from an explicit button click; it must not create a browser notification or change permission.

## Architecture

`accepted OSC 9 event → addNotification({showToast}) → [sound enabled ? Web Audio(pattern, volume) : no-op] + [browser enabled ? BrowserNotificationService : no-op]`.

The event remains the single sanitized object. The integration, not the browser service, decides whether the native channel is enabled; the browser service retains permission/support/rate-limit guards. Keep toast selection/navigation attached to the normal store record.

## Related Code Files

- Modify: `packages/ui/src/lib/terminal-agent-notification-integration.ts`, `packages/ui/src/stores/terminal-notifications.ts`, `packages/ui/src/lib/browser-notification-service.ts` only if a clearly typed enabled option needs adjustment.
- Modify: `packages/ui/src/components/molecules/TerminalAgentNotificationSettings.tsx`, `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx`.
- Modify tests: `packages/ui/src/lib/terminal-agent-notification-integration.test.ts`, `packages/ui/src/stores/terminal-notifications.test.ts`, `packages/ui/src/lib/browser-notification-service.test.ts`, `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx`, relevant browser tests under `packages/ui/browser-tests/`.
- Create/delete: none unless an existing component exceeds the repository's 200-line guideline and needs a focused extracted selector component.

## Implementation Steps

1. Extend the notification-store API with an explicit `showToast` option defaulting to `true`; history creation remains unconditional on that option.
2. Read all four settings once in the OSC 9 integration. Keep the master early return before parsing/delivery and leave replay suppression unchanged.
3. Pass toast preference to the store, selected pattern/volume to Web Audio, and browser preference to the existing service's `enabled` option. Do not move browser permission logic into state persistence.
4. Extend the settings props/patch and Appearance-section wiring. Use existing `SettingRow`, `Switch`, `Button`, and native select/control styling patterns; every input gets an accessible label.
5. Keep child settings disabled visually while master is off, without resetting them. Add short helper text: toast off still keeps the bell/history; browser popup requires browser permission; only in-app chime style is selectable.
6. Ensure Play sound uses current style and volume and settings updates persist through the existing debounced save path.
7. Add the delivery-matrix unit/component/browser cases, including repeated/replay events and disabled child channels.

## Todo List

- [ ] Decouple toast enqueue from in-memory history.
- [ ] Wire three independent child settings into event delivery.
- [ ] Add accessible controls and accurate channel descriptions.
- [ ] Keep explicit permission and preview interactions isolated.
- [ ] Add UI and delivery-matrix coverage.

## Success Criteria

- Toast off: one history/unread record, no toast ID, normal bell/feed navigation, unchanged chime/browser behavior.
- Browser off: no `Notification` construction and no permission-state mutation; history/toast/chime remain independently correct.
- Sound off: no Web Audio attempt; toast/browser behavior remains correct. Style/volume preview uses current saved values when enabled.
- Master off: accepts no OSC 9 delivery and all child controls are disabled, while saved child choices survive re-enabling.

## Risk Assessment

- **Coupled store semantics:** make the new parameter opt-in/default-true and retain existing store test cases.
- **Ambiguous labels:** explicitly call the native channel “Browser popup” and state its sound cannot be selected.
- **Accessibility regression:** preserve focusable controls, label associations, disabled semantics, and permission status announcements.

## Security Considerations

- Do not pass untrusted terminal fields into settings UI or audio definitions. Continue passing the existing sanitized event to the browser service.
- Keep permission requests exclusively in the existing user-click handler; a toggle/save must not call `Notification.requestPermission()`.

## Next Steps

Run the full validation matrix and update docs to reflect the finalized configuration contract in Phase 04.
