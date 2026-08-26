# Phase 02 — Opt-in Terminal Correlation and Model Types

## Context links

- [Parent plan](./plan.md)
- [Phase 01 gate](./phase-01-codex-app-server-compatibility-gate.md)
- [Brainstorm](../reports/brainstorm-260801-1455-session-model-delegation-audit.md)
- `/mnt/data/ws/sharing/dam-hopper/server/src/api/terminal.rs`
- `/mnt/data/ws/sharing/dam-hopper/server/src/pty/manager.rs`
- `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/types.rs`

## Overview

- Date: 2026-08-01
- Description: Make terminal ownership correlation opt-in and accept bounded opaque model identifiers.
- Priority: P1
- Implementation status: Completed (2026-08-01 Asia/Saigon)
- Review status: Approved 8.5/10 (2026-08-01 Asia/Saigon)

## Key Insights

- Current marker injection only recognizes literal lowercase `codex`; `CODEXNSB` is an interactive-shell alias.
- Capturing command text is unnecessary and prohibited. An inherited opaque OTel resource marker is sufficient.
- Existing `CodexModel` rejects every model except `gpt-5.6-sol`; model rank must not be encoded.
- Existing user `OTEL_RESOURCE_ATTRIBUTES` must not be overwritten silently.

## Requirements

- Add a separate runtime setting for terminal-to-Codex correlation; preserve telemetry disabled/no-op behavior.
- Generate one safe random marker per PTY incarnation when enabled; map marker to terminal run/session and expiry in memory.
- Inject only the DamHopper-owned attribute into a clean child environment; if user OTel attributes already exist, fail closed with a coverage signal or perform an explicit safe merge proven by tests.
- Replace model allowlist with bounded safe opaque identifier validation (length/characters only).
- Keep raw marker, command, alias, environment, and provider ID out of persistence/logs/browser.

## Architecture

`terminal:create` selects a correlation snapshot before PTY spawn. `PtyCreateOpts` carries the marker to `apply_child_env`; `CodexCorrelationRegistry` stores marker -> terminal identity/expiry. OTel decoding returns the marker, and normalization resolves exact terminal correlation without exposing the marker. Existing direct Codex behavior remains compatible; aliases and scripts work through inheritance.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs` — add validated opt-in correlation setting/default.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/terminal.rs` — allocate marker for eligible terminal shells without command parsing.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/pty/manager.rs` — preserve marker through child environment creation and restart generations.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/types.rs` — generalize model validation and registry value.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/decoder.rs` and `normalizer.rs` — carry terminal identity resolution.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/tests.rs` and PTY tests — marker/alias/privacy coverage.

## Implementation Steps

1. Define config/API semantics, default off, and conflict behavior for existing OTel attributes.
2. Extend correlation registry with terminal run identity, bounded expiry, cleanup, and lookup result quality.
3. Thread the marker through PTY restarts without persisting it in session snapshots.
4. Generalize `CodexModel` and API model query types to safe opaque values; remove UI hardcode later in Phase 06.
5. Add tests for direct Codex, `CODEXNSB`, wrapper/script descendants, disabled capture, inherited custom OTel values, restart, expiry, and forbidden-value scans.

## Todo list

- [x] Config roundtrip/default tests
- [x] Marker ownership/expiry tests
- [x] Alias inheritance smoke test
- [x] Model identifier acceptance/rejection tests
- [x] Privacy scan proves no marker/command/env persistence

## Success Criteria

- `CODEXNSB` launched inside a DamHopper-managed shell receives the marker without command capture.
- Existing custom OTel configuration is preserved or explicitly reported unavailable.
- `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.5`, `gpt-5.4`, and future safe IDs decode; unsafe/unbounded IDs do not.
- PTY latency and session persistence remain unchanged when capture is disabled.

## Risk Assessment

- Generic OTel marker inheritance may tag non-Codex descendants; mitigate with separate opt-in and opaque value.
- Shell environment snapshot behavior differs on restart; capture generation and test each new incarnation.
- Model strings may contain provider-specific characters; bounded allowlist must be broad enough without accepting content.

## Security Considerations

- Never log marker or provider IDs.
- Keep marker random, short-lived, and owner-readable only in memory.
- Do not overwrite user OTel exporters/attributes.
- Preserve existing authenticated settings route and no-op fallback.

## Next steps

Phase 01 hard gate failed; this phase is complete only for the flat OTel fallback. Phase 03 is N/A. Continue with `lineage_unavailable`; do not infer parent edges.

## Unresolved questions

- Whether to reject or safely append when `OTEL_RESOURCE_ATTRIBUTES` already exists.
- Whether a terminal restart should retain one logical terminal association or create a new correlation generation.
