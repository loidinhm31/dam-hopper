# OTLP Spike Decision

`opentelemetry-proto 0.32` with only `gen-tonic-messages` and `logs` is selected.

- Fixture: sanitized OTLP/HTTP binary captured from `codex-cli 0.145.0`; decoder verifies `response.completed` input/output/cached/reasoning components and ignores unknown fields.
- Evidence: initial cold focused compile added 8 transitive packages and completed in about 26 seconds; the generated-proto dependency removes locally maintained protobuf code and supports forward-compatible unknown fields.
- Privacy: raw captures included account attributes, so only the allowlisted sanitized record is checked in. Future supported Codex versions require a separately sanitized fixture and passing decoder tests before support is declared.

Unresolved questions: none for Phase 01.
