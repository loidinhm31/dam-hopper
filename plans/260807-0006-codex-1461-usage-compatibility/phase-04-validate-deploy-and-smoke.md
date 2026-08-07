# Phase 04: Validate, deploy, smoke, and rollback

## Context links

- Parent: [plan.md](./plan.md)
- Compatibility phase: [phase 03](./phase-03-implement-evidence-selected-compatibility.md)
- Deployment helper: `deploy/run-linux-nohup.sh`
- Server scripts: `package.json`
- Usage API contract: `docs/api-reference.md`

## Overview

**Date:** 2026-08-07 · **Priority:** P1 · **Status:** pending · **Effort:** 2h

Run focused and broad backend gates, restart the production server without touching telemetry data,
then prove a 0.146.1 event is accepted or identify its exact remaining drop reason.

Current evidence: focused Codex OTLP tests (37), the authenticated Usage health regression, and
`cargo check` passed; the release binary was built; live 4800/4811 health and Usage smoke accepted
unverified events with nonzero response/token totals. Keep this phase open because the broad backend
suite and a stable helper-driven restart have not been fully verified.

## Key insights

- Unit success is insufficient: production currently has decoded traffic but no persisted row.
- Health counters are process-local, so capture a pre-smoke snapshot after restart and compare deltas.
- Production server is `0.0.0.0:4800`; use loopback `127.0.0.1:4800` for authenticated checks.
- OTLP receiver remains `127.0.0.1:4811`; never expose it or bypass bearer auth.

## Requirements

- Format/check/test using repository Rust commands; run focused failures before broad suite.
- Existing Usage API privacy/auth tests must pass.
- Build release and restart with existing deployment helper; no DB delete, reset, migration, key
  rotation, config rewrite, or exporter ownership change.
- Smoke with a synthetic, non-sensitive Codex 0.146.1 request and `log_user_prompt=false`.
- Verify health and Usage through authenticated API. Do not print bearer/server tokens.

## Architecture

`fixture tests -> cargo check/full test -> release build -> controlled restart -> health baseline ->
synthetic Codex -> health delta + Usage API -> accept or reason-specific diagnosis`. Deployment does
not transform storage, so rollback is binary-only.

## Related code files

- **Validate:** all files listed in Phases 1–3.
- **No source edits expected:** deployment and smoke are operational gates.
- **Do not touch:** `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/ImportDialog.tsx`, unrelated plans/logs, production telemetry DB or sidecars.

## Implementation steps

1. Review `git diff -- plans/260807-0006-codex-1461-usage-compatibility` and implementation diff;
   reject unrelated production/UI/database changes.
2. From `server/`, run `cargo fmt --check`, `cargo test codex_otlp --lib`,
   `cargo test usage_ --lib`, and `cargo check`.
3. Run full backend suite via repository `pnpm test`. Record pass/fail counts; investigate failures
   before proceeding. Do not waive privacy, dedupe, auth, or backpressure failures.
4. Run negative scans for raw-content fields/canaries in fixture, logs, serialized health, API
   responses, and temporary SQLite used by tests.
5. Build release with `pnpm build:server`. Capture production health and Usage state read-only.
6. Restart through `pnpm server:restart`; confirm server on port 4800 and collector on loopback 4811.
   Do not remove `telemetry.db`, `-wal`, or `-shm` and do not rotate HMAC/bearer keys.
7. Read authenticated `/api/usage/health` baseline, run one synthetic Codex 0.146.1 completion, wait
   for worker flush, then read health, summary, and sessions again.
8. Accept smoke only if `queued` and last accepted advance, reason-specific drops do not advance,
   and Usage gains an unverified response/session without exposing source version or content.
9. If still dropped, classify by counter: a nonzero missing-identity delta indicates the running
   binary is stale or a strict-mode regression; invalid timestamp validates raw shape; paused restores
   intended admission state; queue full/worker unavailable is an operational queue/runtime issue.
   Do not add a second identity fallback for operational failures.

## Todo list

- [x] Focused OTLP and Usage API privacy tests pass.
- [ ] `cargo check` and full backend suite pass.
- [ ] Release build/restart preserves telemetry DB and secrets (release build and live smoke verified;
      stable helper-driven restart remains open).
- [x] Production smoke advances accepted/persisted Usage.
- [ ] Any residual loss is assigned one bounded reason.
- [ ] Rollback path verified and results recorded in plan status during `/code`.

## Success criteria

- Sanitized fixture and live 0.146.1 traffic persist with unverified quality and stable dedupe.
- Existing 0.145.0, auth, privacy, queue/backpressure, pause, and API tests remain green.
- Production health distinguishes every remaining drop; no database reset occurs.

## Risk assessment

- Restart briefly interrupts server access. Use existing graceful helper and verify status promptly.
- Counter reset on restart can mislead comparison. Take baseline only after restart.
- A live empty result may be exporter restart/config lag. Verify managed status and receiver traffic
  before changing decoder/normalizer.

## Security considerations

Use authenticated loopback calls, suppress tokens from commands/reports, keep synthetic content
non-sensitive, and retain loopback/bearer enforcement. Never inspect or publish raw production OTLP.

## Rollback

Deploy the prior known-good server binary and restart. In-memory additive counters disappear; fixture
and tests are inert. No schema/data rollback is required. Preserve telemetry DB, WAL/SHM, bearer,
HMAC key, and managed Codex config throughout rollback.

## Next steps

After clean smoke, hand implementation results to review. Update plan statuses/evidence; no UI or
app-server follow-up unless separately requested.

## Unresolved questions

- Exact production reason-counter delta if the first post-restart smoke still drops.
