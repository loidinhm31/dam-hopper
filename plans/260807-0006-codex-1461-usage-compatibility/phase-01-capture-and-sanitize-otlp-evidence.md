# Phase 01: Capture and sanitize 0.146.1 OTLP evidence

## Context links

- Parent: [plan.md](./plan.md)
- Existing decoder: `server/src/telemetry/codex_otlp/decoder.rs`
- Existing fixture provenance: `server/src/telemetry/codex_otlp/fixtures/provenance.txt`
- Architecture: `docs/system-architecture.md#codex-otel-usage-analytics`

## Overview

**Date:** 2026-08-07 · **Priority:** P1 · **Status:** completed · **Effort:** 2h

Capture one controlled Codex CLI 0.146.1 OTLP export, prove its identity and timestamp shape, then
commit only a minimized sanitized protobuf. This is the root-cause gate; no fallback design starts
from inferred fields.

## Key insights

- Live counters prove decode reached the receiver, not why normalization returned no event.
- Decoder already accepts future versions and marks them unverified.
- Current normalizer requires valid 16-byte trace plus 8-byte span identity.
- Existing 0.145.0 fixture omits real source identity and tests inject synthetic IDs.
- Receipt time and conversation ID cannot distinguish retries from distinct events.

## Requirements

- Use installed `codex-cli 0.146.1`, `log_user_prompt=false`, and a fixed synthetic prompt/reply.
- Capture through a disposable loopback sink/config override; do not alter production collector,
  `~/.codex/config.toml`, bearer secret, HMAC key, or telemetry database.
- Before sanitizing, record only structural facts: event/resource keys, value types, byte lengths,
  timestamp field used, trace/span presence, and candidate event-ID semantics. Never record values.
- Keep only one or a minimal pair of `codex.sse_event` / `response.completed` records and fields
  needed to prove tokens, version, timestamp, identity, model, and conversation behavior.
- Replace conversation/model/timestamps/identity values with deterministic fixtures while preserving
  wire types, zero/nonzero state, lengths, and identity relationships. Keep version `0.146.1`.
- Scan fixture and provenance for prompt/response/tool content, credentials, paths, raw IDs, URLs,
  host/user names, and bearer material before check-in.

## Architecture

`Codex 0.146.1 -> disposable loopback capture -> structural inspection -> allowlist sanitizer ->
sanitized protobuf -> decoder/normalizer/receiver regression tests`. Raw capture remains temporary
and is deleted after validation; it never enters Git or production SQLite.

## Related code files

- **Create:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/fixtures/codex-cli-0.146.1-response-completed.bin` — sanitized protobuf.
- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/fixtures/provenance.txt` — capture version/date, sanitization, structural identity/timestamp result.
- **Do not modify:** production Rust in this phase.

## Implementation steps

1. Record `git status --short`; confirm unrelated `ImportDialog.tsx`, logs, and plans stay untouched.
2. Verify CLI version and supported per-invocation OTel config override without writing user config.
3. Start disposable loopback OTLP capture on an unused port; issue one synthetic Codex request.
4. Decode capture locally. Inventory bounded structural facts and all attribute keys/types.
5. Decide evidence result: valid trace/span; missing/invalid trace/span plus candidate provider event ID;
   or no safe identity. Record no raw identifier values.
6. Build minimized sanitized protobuf. Substitute deterministic nonzero identity only when the raw
   field existed with the same valid shape; never manufacture a field claimed as provider evidence.
7. Add provenance: exact CLI version, Linux, date, safe capture setup, retained fields,
   substitutions, raw identity/timestamp shape, and sanitized fixture checksum.
8. Run binary/string and decoded-attribute privacy review. Remove temporary raw capture securely.

## Todo list

- [x] Controlled capture completed without production config or DB mutation.
- [x] Identity and timestamp shape documented without values.
- [x] Sanitized fixture and provenance added.
- [x] Privacy scan finds no content, secret, path, or raw identifier.
- [x] A/B/block decision recorded for Phase 3: blocked because the real capture has no trace/span
  or per-event identity; retain fail-closed admission and do not use timestamp/conversation/UUID.

The shared workspace mount presents new files as `0777` and restores that mode after `chmod`; the
existing checked-in fixture has the same working-tree mode and `core.fileMode=false` tracks it as
`100644`. Final staging must preserve the non-executable `100644` index mode.

## Success criteria

- Fixture is structurally valid and represents a real 0.146.1 `response.completed` event with four
  core token attributes; decoder regression is covered and `cargo test codex_otlp --lib` passes 33/33.
- Fixture preserves observed identity/timestamp shape and contains only synthetic bounded values.
- Evidence is sufficient to select A, prove B, or block unsafe fallback explicitly.

## Risk assessment

- Binary protobuf may hide content from simple string review. Decode and inspect every retained key
  and value, then scan bytes as a second check.
- Sanitizing by adding trace/span would conceal the root cause. Preserve presence and validity shape.
- Disposable capture can conflict with production port 4811. Use a separate unused loopback port.

## Security considerations

No raw prompt/reply, bearer, provider ID, conversation ID, machine path, or user metadata may be
written under the repository. Keep raw capture in a temporary owner-only location and remove it
after the sanitized fixture is independently decoded and reviewed.

## Next steps

Phase 3 is blocked by the documented unsafe-identity result. Phase 2 diagnostics remain pending and
may proceed independently using the structural findings for counter naming.

## Unresolved questions

None for Phase 01. The live capture established event timestamp plus observed time, with no
trace/span bytes and no per-event identity attribute.
