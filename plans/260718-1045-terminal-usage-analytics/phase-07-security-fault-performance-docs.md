# Phase 07: Security, Fault, Performance, Documentation

## Context links

- [Parent plan](./plan.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [All phase files](./plan.md#phases)
- [Development commands](../../CLAUDE.md)
- [Code standards](../../docs/code-standards.md)

## Overview

- Date: 2026-07-18; completed 2026-07-26
- Description: Prove privacy, resilience, correctness, performance, shared-host behavior, and documentation completeness before enabling rollout.
- Priority: P1 release gate
- Implementation status: Complete (2026-07-26)
- Review status: Complete (2026-07-26)
- Effort: 32h

## Key Insights

- The primary failure mode is not a wrong chart; it is silent sensitive-data capture or PTY degradation.
- Existing terminal tests are real PTY/filesystem tests; preserve that boundary.
- Native host shares UI but must not gain a server sidecar or extra permissions.
- Docs must state coverage and interpretation limits, not market this as productivity scoring.

## Requirements

- Rust lifecycle/property/real-shell tests across Bash/Zsh/Fish.
- SQLite concurrent reader/writer, locked/full/readonly/corrupt, queue saturation, writer panic/restart, kill-between-commit, WAL/purge tests.
- API auth, bounds, injection, UTC/DST, null token, retention cutoff, delete/pause/exclusion tests.
- Privacy scan of DB/API/logs with secrets, URLs, exports, cwd/env, prompts, responses, tool content.
- Codex binary fixture matrix, loopback assertion, replay/cumulative token tests, disabled collector smoke.
- Browser/native route/filter/accessibility/responsive smoke and existing terminal regressions.
- Query benchmark on 100k detail rows (and 1M if practical) under 200 ms target.
- Update architecture/API/config/code standards docs after implementation matches design.

## Architecture

Verification flow:

```text
Real PTY + Codex fixtures
          -> normalized event assertions
          -> telemetry.db/API privacy scan
          -> fault/backpressure tests
          -> browser/native UX gates
          -> docs/release decision
```

Feature flags/defaults permit safe rollout: terminal analytics disabled for existing installations until enabled; Codex collector disabled by default; failed collector cannot affect PTY. Rollback stops collection and leaves already committed telemetry for explicit purge; no destructive schema rollback.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/tests.rs` — parser/real PTY/replay/respawn/fault tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/*` tests — storage/privacy/retention/receiver fixtures.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs` — protected API and control tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.test.ts` — endpoint/DTO behavior.
- Create `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/usage/UsagePage.test.tsx` and focused tests — UI states/accessibility.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/api-reference.md` — usage routes and privacy-safe response contracts.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/configuration-guide.md` — telemetry settings, retention, collector setup.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md` — replace planned labels with implemented flow/schema/invariants.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/code-standards.md` — telemetry module/testing/privacy patterns if new convention is established.
- Modify `/mnt/data/ws/sharing/dam-hopper/docs/codebase-summary.md` — current feature/touchpoints after release.

## Implementation Steps

1. Run focused Rust lifecycle tests: split frames, BEL/ST, escaped command markers, bad nonce, reorder/duplicate/missing markers, ambiguous Bash, nonzero/Ctrl-C, shell death, nested/TUI/alternate buffer.
2. Run real PTY Bash/Zsh/Fish fixtures; verify visible output and existing suggestion/notification boundaries.
3. Exercise telemetry DB with concurrent reads, forced `SQLITE_BUSY`, full/read-only/corrupt file, queue saturation, writer restart, process kill between commits, and purge with readers.
4. Scan DB/API/log output recursively for known secret fixtures and forbidden field names/content; fail release on any match.
5. Test OTLP listener loopback/auth/body limits, unknown fields, malformed content, retry/dedupe, cumulative reset, prompt/tool rejection, disabled behavior.
6. Run API test suite with auth/no-auth, range caps, SQL injection values, UTC/DST, null/unavailable semantics, deletion/pause/exclusion.
7. Run UI unit/browser suite and native shared-host smoke at narrow widths; verify no terminal remount/replay regression.
8. Benchmark aggregate queries and capture plans/indexes. Add rollups/histograms only when measured target requires them.
9. Run project lint/build/check commands in proportion to changed surfaces; record evidence in review.
10. Update docs to live behavior, review architecture drift, document retention/key deletion and metric interpretation.
11. Rollout behind flags, monitor health counters/drops/lag, and define disable/purge recovery steps.

## Todo list

- [x] All focused Rust tests pass.
- [x] Browser/native UI tests pass.
- [x] Privacy scan clean.
- [x] Fault/backpressure evidence recorded.
- [x] Aggregate benchmark meets target.
- [x] Docs and architecture match implementation.
- [x] Rollback/purge runbook documented.

## Success Criteria

- No raw sensitive content reaches telemetry DB, API, or logs.
- PTY responsiveness unchanged under normal and DB-failure tests.
- No duplicate command/token events after retry/replay/restart.
- Supported coverage and unavailable/approximate states accurate.
- Query target and responsive accessible UI pass.
- Feature can be disabled without server restart corruption or terminal loss.

## Risk Assessment

- Test fixtures accidentally contain secrets: generated values, scans, review before commit.
- “Green” tests miss shell/plugin variants: manual matrix and explicit coverage cards.
- Benchmark environment variance: record hardware/fixture/index plan, use relative regression gate.
- Docs drift: architecture review after code, not before release only.

## Security Considerations

- Do not include bearer/HMAC/OTLP secrets in CI logs or screenshots.
- Keep telemetry server-local; no remote export path.
- Review destructive delete behavior and recovery before enabling settings UI.
- Existing auth bypass remains dev-only and must not weaken usage-route protections in production.

## Next steps

- Keep terminal analytics and Codex collection behind their existing opt-in flags.
- Run the documented external shell/accessibility/renderer checks on hosts that provide them.
- Use the pause/delete/purge runbook if rollout monitoring finds drops, lag, or privacy faults.

## Unresolved questions

- Final rollout default for new installations versus existing installations.
- Exact aggregate retention and timezone copy.
- External Zsh/Fish PTY validation remains environment-dependent.
- External IME, screen-reader, and renderer/browser validation remains environment-dependent.
