# Phase 04: Verification and Documentation

## Context Links

- [Parent plan](./plan.md)
- [Telemetry tests](../../server/src/telemetry/codex_otlp/tests.rs)
- [Configuration guide](../../docs/configuration-guide.md)
- [Architecture](../../docs/system-architecture.md)

## Overview

- Priority: P1
- Status: pending
- Goal: prove live lifecycle, config safety, accessible UI, and truthful onboarding.

## Requirements

- Rust tests use real temp files and loopback listeners; no real Codex account/session required.
- Browser tests cover first-time setup, config confirmation, conflict, error/retry, focus/keyboard, and Settings-to-Usage navigation.
- Manual smoke uses a live server: enable in Settings, verify health, open a new terminal, start a new Codex process, run one task, inspect aggregates.
- Update architecture/API/configuration docs from startup-only wording to live runtime semantics; clearly distinguish server restart from required Codex process restart.

## Related Code Files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/{api/tests.rs,telemetry/**/tests.rs,pty/tests.rs}`.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/*.test.tsx` and `packages/ui/browser-tests/`.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/{system-architecture.md,api-reference.md,configuration-guide.md,codebase-summary.md}`.

## Implementation Steps

1. Add activation/deactivation/reconfigure/failed-bind and worker-drain tests.
2. Add ownership/config atomicity/privacy tests, including no secret in response/log serialization.
3. Run focused UI unit tests, Chromium browser tests, UI build, and focused Rust tests before full suites.
4. Capture manual proof of live server enable with no restart; record the necessary new terminal and Codex-process conditions.
5. Update docs and re-check code/docs state-machine alignment.

## Todo List

- [ ] Runtime and config-manager test matrix
- [ ] Settings browser/a11y coverage
- [ ] Build/test gates
- [ ] Documentation and onboarding update

## Success Criteria

- No server restart required for DamHopper configuration changes.
- Codex restart guidance is precise and never mislabeled as a server restart.
- All exposed states remain privacy-safe and recoverable.

## Risk Assessment

- Platform-specific Codex config location: use existing `dirs` resolution and path-explicit tests.
- Browser harness cannot run real Codex: isolate config contract in Rust, use live manual smoke for exporter.

## Security Considerations

- Do not commit fixtures with real bearer tokens.
- Verify logs/API/browser state contain no token or raw OTel fields.

## Next Steps

Handoff to `/code` with this plan and no unresolved product decisions.
