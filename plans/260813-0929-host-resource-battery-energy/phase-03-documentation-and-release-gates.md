# Phase 03 — Documentation and Release Gates

## Context Links

- [Plan overview](./plan.md)
- [Backend phase](./phase-01-contract-and-linux-collector.md)
- [UI phase](./phase-02-ui-presentation-and-compatibility.md)
- [Repository commands](../../package.json)

## Overview

- **Date:** 2026-08-13
- **Priority:** P2
- **Status:** DONE — Completed 2026-08-13 11:39:20 +07:00
- **Goal:** document observable semantics and prove focused plus repository-wide compatibility.

## Key Insights

- This is a public DTO addition; API wording and tests must lock Wh versus W and absence semantics.
- No deployment/config migration exists, so rollback is removal/ignore of the additive field and UI rows.
- Full validation must include Rust, TypeScript, Chromium, lint, and builds because the field crosses backend/frontend boundaries.

## Requirements

- Document the additive battery object, normalized status, units, aggregation completeness, and availability behavior.
- Document UI conditional rendering and old-server absence tolerance.
- Run formatting, focused tests, type/build gates, browser regression, and repository-standard checks.
- Treat any failure as blocking; diagnose root cause, fix within scope, and rerun the failed gate plus relevant regression set.
- Confirm git diff contains only planned feature/docs/tests and the plan/scout artifacts; no generated output or dependency lock changes.

## Architecture

No new component, endpoint, cache, state machine, dependency, config, or deployment unit. Final review compares implementation against the Phase 01 architecture text and corrects intended drift before approval.

## Related Code Files

- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/docs/api-reference.md` — battery JSON semantics, availability, units, compatibility.
- **Modify** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/docs/frontend-components.md` — conditional diagnosis rows and old-server behavior.
- **Review/modify if drifted** `/home/loidinh/WS/dam-hopper-host-resource-battery-energy/docs/system-architecture.md` — ensure implementation matches the pre-code architecture gate.
- **Validate** all files listed in Phases 01–02.

## Implementation Steps

1. Update API reference with field names, allowed statuses, direct micro-unit conversion, complete aggregation, and absent-value rules.
2. Update frontend docs with exact visible labels and conditional/old-server behavior.
3. Run `cargo fmt -- --check` and focused collector/serde/API tests from `server/`.
4. Run focused UI unit and browser tests, then `pnpm --filter @dam-hopper/ui build`.
5. Run `pnpm lint`, `pnpm build`, `pnpm test`, and final `pnpm check` per repository policy.
6. Review diff for architecture/contract alignment, additive legacy compatibility, accidental generated files, and scope creep.

## Todo List

- [x] Update API and frontend docs.
- [x] Pass Rust format/focused tests.
- [x] Pass UI unit/browser/build gates.
- [x] Pass repository lint/build/test/check gates.
- [x] Complete final diff and architecture-drift review.

## Success Criteria

- Documentation distinguishes remaining energy (Wh) from instantaneous power (W).
- Focused tests cover happy, partial, multiple, missing, malformed, denied, stale, old-server, and UI omission paths.
- `cargo fmt -- --check`, Rust tests, UI unit/browser tests, UI build, lint, web build, and `pnpm check` pass without bypasses.
- No legacy endpoint/DTO change, dependency/config change, fabricated value, or guessed conversion is present.

## Risk Assessment

- **Environment-specific browser/native gate:** the `TAURI_SIGNING_PRIVATE_KEY` native signing gate was explicitly waived by the user; this is a validation caveat, not a product/configuration change.
- **Flaky host-dependent API assertion:** assert shape/availability, not local battery presence.
- **Documentation drift:** compare JSON field names directly with Rust serde and TypeScript types.

## Security Considerations

- Reconfirm endpoint protection and startup-owned read-only source are unchanged.
- Confirm no raw sysfs content/path enters logs, UI, diagnostics, or persistence.
- Confirm no new permissions, secrets, configuration, or host mutation capability.

## Next Steps

Finalization approved. No commit/push performed per scope.
