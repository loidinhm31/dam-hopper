# Phase 02 — F-01 Config Extension: RestartPolicy

## Context
- Parent: [plan.md](./plan.md)
- Source: [f01-feasibility-plan.md § Phase 1](./f01-feasibility-plan.md)
- Dependencies: none. Unlocks Phase 3 (session meta uses the enum).

## Overview
- Date: 2026-04-16
- Description: Add `restart`, `restart_max_retries`, `health_check_url` fields to project TOML schema. Parse and propagate defaults.
- Priority: P1
- Implementation status: pending
- Review status: pending

## Key Insights
- `ProjectConfigRaw` (on-disk TOML) uses `snake_case`; serde `rename_all = "kebab-case"` on the policy enum matches `"on-failure"` spelling.
- `ProjectConfig` (resolved) holds non-Optional `RestartPolicy` with default `Never`.
- `health_check_url` parsed but unused in this feature — deferred to F-06.

## Requirements
- Backward compatible: missing fields resolve to safe defaults (`Never`, `5`, `None`).
- Config parsing unit tests cover: missing, `"never"`, `"on-failure"`, `"always"`, invalid (reject).
- Frontend type `ProjectConfig` in `client.ts` mirrors the new fields.

## Architecture
Pure additive schema change. No runtime behavior difference yet.

## Related Code Files
- `server/src/config/schema.rs` — add enum + raw/resolved fields
- `server/src/config/parser.rs` — defaulting in `resolve()`
- `server/src/config/tests.rs` — parse tests
- `packages/web/src/api/client.ts` — mirror types (around L127)

## Implementation Steps
1. Add `RestartPolicy` enum with `#[serde(rename_all = "kebab-case")]` and `Default = Never`.
2. Extend `ProjectConfigRaw` with three Optional fields.
3. Extend `ProjectConfig` (resolved) with concrete fields.
4. Implement defaulting in parser.
5. Add 4 parse tests (missing, each variant, rejection of bad string).
6. Update `packages/web/src/api/client.ts`: `restart?`, `restartMaxRetries?`, `healthCheckUrl?`.

## Todo
- [ ] `RestartPolicy` enum
- [ ] `ProjectConfigRaw` fields
- [ ] `ProjectConfig` resolved fields
- [ ] Parser defaults
- [ ] Parse tests (4)
- [ ] Mirror in client.ts

## Success Criteria
- `cargo test` passes; new tests cover happy + error paths.
- Existing `dam-hopper.toml` files load unchanged.

## Risk Assessment
- Low. Additive only. Deserialization rejecting unknown policy strings is desirable.

## Security Considerations
None — config is local file owned by user.

## Next Steps
Phase 3 threads the enum into `SessionMeta`.
