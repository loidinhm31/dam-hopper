# Scout: Codex terminal notification controls

Date: 2026-07-19

## Findings

- `packages/ui/src/lib/terminal-agent-notification-integration.ts` uses the master `terminalCodexNotificationsEnabled` setting to accept Codex OSC 9 events. It then always creates in-app history and a top-right toast, conditionally plays the chime, and emits a native browser notification.
- The top-right toast and notification-center history are coupled in `packages/ui/src/stores/terminal-notifications.ts`; history is capped at 50 and concurrent toasts at 3.
- Native browser popup delivery is `BrowserNotificationService` in `packages/ui/src/lib/browser-notification-service.ts`; it is gated by permission and the master setting only.
- The default sound is synthesized in `packages/ui/src/lib/terminal-notification-sound.ts`: a 0.32-second 880 Hz sine chime through Web Audio. No audio asset exists in the repository.
- The settings UI is `packages/ui/src/components/molecules/TerminalAgentNotificationSettings.tsx`, mounted by `SettingsAppearanceSection.tsx`.
- Preferences persist across TypeScript types/defaults/store and server TOML schema/mapping. Existing settings: master enable, chime enable, volume.

## Constraints

- Web Notifications cannot choose a custom sound for a browser/OS popup; app-controlled chimes can only be Web Audio played alongside notification delivery.
- Permission remains runtime/browser-managed and must be requested from a user click.
- Safest compatibility default for new channel toggles is `true`, preserving today's delivery when the master setting is on.

## Recommended direction

- Keep the master setting as Codex OSC 9 enablement and Codex TUI synchronization.
- Add independent persisted controls for top-right in-app toasts and native browser popups.
- Keep in-app notification history/bell when toasts are disabled unless product direction says otherwise.
- Add a small fixed set of synthesized chime patterns, selected independently of browser-popup delivery; no assets, upload, or licensing work.

## Relevant tests

- `packages/ui/src/lib/terminal-agent-notification-integration.test.ts`
- `packages/ui/src/lib/browser-notification-service.test.ts`
- `packages/ui/src/lib/terminal-notification-sound.test.ts`
- `packages/ui/src/components/organisms/SettingsAppearanceSection.test.tsx`
- `packages/ui/src/lib/ui-config.test.ts`
- `server/src/config/tests.rs`
- `server/src/api/tests.rs`

## Open questions

- Should disabling app toast hide only the transient top-right alert, or also remove notification-center history/bell records?
- Should users select a small library of built-in synthesized chimes, or custom uploaded audio (larger scope)?
