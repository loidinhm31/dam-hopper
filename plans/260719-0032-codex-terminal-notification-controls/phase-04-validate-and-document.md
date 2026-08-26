# Phase 04 — Validate and document

## Context Links

- [Preflight and side-effect review](./plan.md)
- [UI config tests](../../packages/ui/src/lib/ui-config.test.ts)
- [Integration tests](../../packages/ui/src/lib/terminal-agent-notification-integration.test.ts)
- [Server config tests](../../server/src/config/tests.rs), [API tests](../../server/src/api/tests.rs)
- [Frontend components doc](../../docs/frontend-components.md)
- [System architecture](../../docs/system-architecture.md)
- [Configuration guide](../../docs/configuration-guide.md)

## Overview

- **Date:** 2026-07-19
- **Priority:** P2
- **Status:** Pending
- **Goal:** Prove compatibility across persisted config and runtime delivery, then document exact user-visible boundaries.

## Key Insights

- This plan intentionally does not edit architecture/docs before implementation because the assigned scope is plan files only. The implementation handoff must update the existing architecture and configuration descriptions to match the shipped behavior.
- Browser permission and popup sound are external browser/OS behavior. Validation must check both granted and denied/default states without claiming cross-platform native-sound control.

## Requirements

- Test old/missing config defaults, full JSON/TOML round trip, invalid pattern validation, and child-setting partial merge without Codex TUI side effects.
- Test the 2×2×2 master/toast/browser/sound delivery matrix at least through representative rows, with explicit assertions for history, toast, browser factory calls, and sound calls.
- Verify all four patterns and live preview style/volume. Retain no-op coverage for unsupported, SSR, suspended, and blocked audio.
- Update user and architecture docs only after behavior is implemented and verified.

## Architecture

Validation follows the contract boundary: Rust owns persisted shape/atomic TOML/API merge; UI owns normalized defaults, delivery fan-out, Web Audio, and runtime browser permission. No server process or service worker participates in notification delivery.

## Related Code Files

- Modify tests named in Phases 01–03; run existing browser suites under `packages/ui/browser-tests/`.
- Modify docs: `docs/frontend-components.md`, `docs/system-architecture.md`, `docs/configuration-guide.md`.
- Create/delete: none, unless an existing test fixture needs a small local helper.

## Implementation Steps

1. Run targeted Vitest tests for config, sound, browser service, integration, store, and Appearance section; add missing edge/error coverage before broad checks.
2. Run `pnpm --filter @dam-hopper/ui test`, `pnpm build`, and `pnpm lint`; run `cd server && cargo test` (use `-j 1` only if the host needs it).
3. Execute the relevant browser notification tests and manually verify an enabled Codex terminal in a browser: all channels on, toast off, browser off, sound off, each pattern preview, denied/default permission, and master toggle TUI synchronization.
4. Update frontend-components flow to state history is unconditional after master acceptance, toast/browser/chime are independent child channels, and only app chimes are configurable.
5. Update system architecture data flow and configuration guide tables/examples with the three new snake_case keys, four valid pattern IDs, defaults, runtime-only permission, and no custom native-popup sound.
6. Review changes for YAGNI/KISS/DRY: no assets, service worker, upload, native sound API, or duplicate config mapping.

## Todo List

- [ ] Complete unit, config/API, and browser coverage.
- [ ] Run UI build/lint and Rust tests.
- [ ] Perform manual permission/live-terminal matrix check.
- [ ] Update docs after tested behavior matches the plan.
- [ ] Request code review and resolve critical findings before completion.

## Success Criteria

- All targeted and required project checks pass with no skipped failures.
- The behavior matrix and backward-config defaults are evidenced by automated tests.
- Documentation describes the actual control ownership and does not imply browser permission or OS sound is persisted/controlled.
- Existing caps, sanitization, replay suppression, native rate limiting, and Codex TUI master sync remain verified.

## Risk Assessment

- **Browser test environment lacks audio/Notification support:** use deterministic unit doubles for contracts and a manual browser matrix for platform behavior.
- **Doc drift:** update docs after tests, then compare wording to field names and UI labels.
- **Broad test failures:** diagnose root cause before changes; do not weaken assertions or add temporary bypasses.

## Security Considerations

- Verify diagnostics and documentation never expose raw OSC 9 payloads or terminal output.
- Validate config rejects unsupported style identifiers; no configuration becomes a file path or executable instruction.

## Next Steps

Handoff to code review, then mark each phase complete only after its validation evidence is recorded.

## Unresolved Questions

None.
