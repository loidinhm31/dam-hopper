# Phase 03: Settings UX

## Context Links

- [Parent plan](./plan.md)
- [Settings page](../../packages/ui/src/components/pages/SettingsPage.tsx)
- [Usage page](../../packages/ui/src/components/pages/UsagePage.tsx)
- [Web testing gate](../../packages/ui/browser-tests/usage-page.browser.tsx)

## Overview

- Priority: P1
- Status: completed (2026-07-26 16:48 +07)
- Goal: make opt-in understandable without showing ports, bearer tokens, or raw configuration.

## Requirements

- Add a dedicated "Usage insights" Settings accordion near Global/Workspace configuration.
- Primary terminal toggle/action: disabled -> enable locally -> active/paused/error; controls use live API, not raw config editor.
- Optional nested Codex token action: explains privacy boundary and no extra model usage; displays managed, conflict, receiver unavailable, and restart-Codex-needed states.
- Use clear status copy: "DamHopper ready; open a new terminal" and "Restart or start a new Codex session".
- Keep advanced retention/exclusion/delete controls in `/usage`; link there from Settings.
- No token, endpoint, raw `~/.codex/config.toml`, or setup copy field in the browser.
- Keyboard-accessible switches/actions, `aria-live` completion/errors, disabled action while transition pending, narrow responsive layout.

## Architecture

```text
SettingsUsageInsightsSection
  -> useUsageSetupStatus / useConfigureUsageInsights
  -> protected setup API
  -> invalidate usage health/settings/summary + config queries
```

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/SettingsPage.tsx` — mount section.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/SettingsUsageInsightsSection.tsx` — stateful setup UI.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/{client.ts,queries.ts,ws-transport.ts}` — typed setup status/action and invalidation.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/pages/UsagePage.tsx` — replace misleading pause/resume behavior when master telemetry is disabled; link to Settings setup.
- Create focused unit/browser tests under `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/` and `/mnt/data/ws/sharing/dam-hopper/packages/ui/browser-tests/`.

## Implementation Steps

1. Add opaque DTOs only; model status/state names instead of internal config values.
2. Create restrained card/action-row UI matching current Settings accordion and existing switches/buttons.
3. Render disabled, enabling, active, paused, conflict, collector failure, and Codex-restart states independently.
4. Add a confirmation only before touching Codex config; explain exact managed effect and prompt-redaction behavior.
5. Invalidate all usage/config queries after a successful transition and preserve error detail without secret content.
6. Add keyboard/focus tests and narrow-viewport browser coverage.

## Todo List

- [x] Settings section and API hooks
- [x] Usage-page disabled recovery CTA
- [x] Accessible state/error handling
- [x] Browser coverage

## Success Criteria

- First-time local setup completes without editing TOML or copying a token.
- User can understand exactly why an existing terminal/Codex process does not yet provide data.
- Conflict action preserves user control and avoids any config change.

## Risk Assessment

- Toggle ambiguity: separate terminal capture from optional Codex tokens.
- Async UI race: disable controls/poll status while mutation is active.
- Responsive density: use existing Settings action rows and accordion, not a bespoke wizard.

## Security Considerations

- Never render secret/token snippets or raw Codex configuration.
- Explicit confirmation precedes any `~/.codex/config.toml` mutation.

## Next Steps

Focused unit/API client tests pass (19/19); browser suite passes (58/58 across
13 files). Remaining verification and documentation belong to Phase 04.
