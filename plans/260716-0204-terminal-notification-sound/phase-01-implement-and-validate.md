# Phase 01: Implement and Validate

## Context Links

- [Plan](./plan.md)
- `packages/ui/src/lib/terminal-agent-notification-integration.ts`
- `packages/ui/src/lib/terminal-agent-notification-integration.test.ts`
- `packages/ui/src/lib/browser-notification-service.ts`
- `packages/ui/src/stores/settings.ts`

## Overview

- Date: 2026-07-16
- Priority: P2
- Status: Completed 2026-07-16 02:14 +07
- Add an unobtrusive best-effort chime to valid, enabled Codex OSC 9 events.

## Key Insights

- The integration already gates OSC 9 delivery with `terminalCodexNotificationsEnabled` before it publishes to in-app and native channels.
- Browser notification permission is independent: the sound call must occur even when native permission is denied.
- Web Audio may be absent, suspended, or reject outside a user gesture. Treat each as a silent no-op, not a delivery error.

## Requirements

- Create `packages/ui/src/lib/terminal-notification-sound.ts` and `terminal-notification-sound.test.ts`.
- Export one narrowly scoped best-effort chime function, using a lazily created/reused `AudioContext` and fixed short, low-volume oscillator/gain envelope.
- Guard unsupported globals and SSR; catch context/node/start/resume failures without throwing or prompting.
- Invoke it once only after a valid OSC 9 event passes the existing master setting; do not make it dependent on native notification delivery or rate limiting.
- Keep existing in-app store publication, terminal selection, and native notification behavior unchanged.

## Architecture

`OSC 9 -> existing enabled gate -> parse valid event -> in-app store + sound attempt + native browser notification`

The sound helper owns Web Audio lifecycle and all failures. The integration only calls it; it must not await, inspect permission, or add a setting.

## Related Code Files

- Create `packages/ui/src/lib/terminal-notification-sound.ts` and its Vitest unit test.
- Modify `packages/ui/src/lib/terminal-agent-notification-integration.ts` and its existing test.
- Do not change backend, settings schema/UI, assets, package dependencies, or public API types.

## Implementation Steps

1. Implement the dependency-free helper with injectable/resettable seams only if existing test conventions require them; retain a single context and make all unavailable/rejected paths no-op.
2. Add the chime call to the valid enabled OSC 9 pipeline while preserving in-app-first delivery and the current native notification call.
3. Test a normal oscillator/gain scheduling path, missing AudioContext, suspended/rejected/resume failures, and that failures do not escape.
4. Extend integration coverage: enabled valid OSC 9 calls sound once; disabled event calls it zero times; denied native permission still calls sound and preserves in-app delivery.
5. Run focused tests, full UI tests, `pnpm build`, and changed-file/scoped lint; run browser regression only if available. Review the final diff for resource cleanup and YAGNI/KISS/DRY.

## Test Plan

- Unit: verify the helper creates/schedules a short low-volume chime and never throws for unsupported or failing audio APIs.
- Integration: mock the helper and assert only valid, enabled OSC 9 events invoke it, independently of browser notification permission.
- Regression: execute `pnpm --filter @dam-hopper/ui test`, `pnpm build`, and scoped ESLint; record any environmental browser-test limitation precisely.

## Todo List

- [x] Implement safe Web Audio chime helper and tests.
- [x] Integrate one enabled OSC 9 sound attempt and extend integration tests.
- [x] Validate focused/full tests, build, lint, and regression behavior.

## Success Criteria

- Every valid enabled Codex OSC 9 event attempts one short chime without changing existing notification results.
- Disabled, invalid, unsupported, SSR, autoplay-blocked, and failed-audio paths remain silent and error-free.
- Native permission denial cannot suppress the sound attempt or in-app notification.
- Required checks pass, or any unrelated/environmental failure is documented exactly.

## Risk Assessment

- Autoplay rejection: swallow errors and retain no rejected promise.
- Resource leak: reuse the context; stop/disconnect short-lived oscillator/gain nodes after the envelope.
- Concurrent terminals: each event schedules independently without creating one context per terminal.
- Test contamination: reset the helper singleton between tests if module state is exposed for tests.

## Security Considerations

- No user-provided terminal text is evaluated, persisted, logged, or sent to an external service.
- No additional browser permission, server endpoint, or configuration surface is introduced.

## Completion

- Completed: 2026-07-16 02:14 +07.
- User approved the terminal notification sound implementation after validation and review gates.

## Unresolved Questions

None.
