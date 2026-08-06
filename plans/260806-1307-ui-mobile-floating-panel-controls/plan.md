# Mobile floating panel controls

Date: 2026-08-06
Status: completed and validated
Completed: 2026-08-06 13:48 Asia/Ho_Chi_Minh

## Outcome

Make the mobile `Panels` selector a compact, draggable floating control and tighten the bottom terminal `Keys`/keyboard controls without changing their behavior or public contracts.

## Phases

| Phase | Status | Details |
| --- | --- | --- |
| 01 — Implement and verify mobile controls | Completed (2026-08-06 13:48 Asia/Ho_Chi_Minh) | [phase-01-implement-and-verify.md](./phase-01-implement-and-verify.md) |

## Preflight contract

- Output: compact draggable mobile panel trigger, compact bottom terminal controls, focused tests.
- Acceptance: tap still opens and switches panels; drag moves the trigger; drag remains within viewport; resize re-clamps it; trigger remains at least 44px tall; `Keys` and `Kbd`/`Type` remain accessible and fit a single compact row.
- Scope: mobile shell trigger and terminal accessory bar plus tests/docs needed to describe the changed behavior.
- Non-goals: desktop shell changes, API/data/auth changes, persisted position, new dependencies, visual assets.
- Public/risk areas: Radix Select pointer/keyboard behavior, focus restoration, safe-area/viewport layout, touch target accessibility.
- Expected files: `use-mobile-panel-trigger-drag.ts`, `MobileWorkspaceShell.tsx`, `MobileTerminalAccessoryBar.tsx`, existing shell/accessory browser or unit tests, and the mobile behavior section of `docs/frontend-components.md` if wording needs updating.
- Validation: focused UI unit tests, Chromium browser test, package TypeScript build, and lint for changed files.
- Open questions: none; compact means reduce visual padding while preserving usable touch targets.

## Side-effect review

- Auth/session/permissions: not applicable; UI-only.
- API/client compatibility: unchanged.
- Data/schema/migrations: none.
- Business meaning: unchanged; only interaction/layout.
- Security/privacy/secrets/logging: no new data or logging.
- Performance/concurrency: pointer listeners cleaned up; no new long-lived process or dependency.
- Docs/config/deployment: no config impact; update behavior documentation only if required by implementation.
