# Phase 03 — F-01 Session Metadata Extension

## Context
- Parent: [plan.md](./plan.md)
- Source: [f01-feasibility-plan.md § Phase 2](./f01-feasibility-plan.md)
- Dependencies: Phase 2 (needs `RestartPolicy` enum).

## Overview
- Date: 2026-04-16
- Description: Extend `SessionMeta`, `DeadSession`, and `PtyCreateOpts` with restart tracking fields. Pass policy through create-session API.
- Priority: P1
- Implementation status: pending
- Review status: pending

## Key Insights
- `SessionMeta` already includes `alive`, `exit_code`, `started_at` — additive fields only.
- `PtyCreateOpts` is the seam where the API layer injects project-derived restart config into the manager.
- Reader thread will need to read the opts post-exit to respawn (Phase 4); this phase makes the data available.

## Requirements
- `SessionMeta`: `restart_count: u32`, `last_exit_at: Option<u64>`, `restart_policy: RestartPolicy`.
- `DeadSession`: `will_restart: bool`, `restart_in_ms: Option<u64>` (populated by Phase 4).
- `PtyCreateOpts`: `restart_policy: RestartPolicy`, `restart_max_retries: u32`.
- `LiveSession` stores a clone of `PtyCreateOpts` (minus non-Clone fields like the writer) so the reader thread can rebuild spawn args.
- API layer (`server/src/api/terminal.rs`) resolves policy from `ProjectConfig` when creating a session for a project-owned command.

## Architecture
```
terminal:create request
  └─> api/terminal.rs: resolve project.restart → PtyCreateOpts
        └─> PtySessionManager::create(opts)
              └─> LiveSession { opts.clone_for_respawn, … }
```

## Related Code Files
- `server/src/pty/session.rs` (`SessionMeta::new`, `DeadSession`)
- `server/src/pty/manager.rs` (`PtyCreateOpts`, `LiveSession`)
- `server/src/api/terminal.rs` (create path)
- Existing tests in `server/src/pty/tests.rs` need updated constructor args.

## Implementation Steps
1. Extend `SessionMeta` with 3 new fields; update constructor.
2. Extend `DeadSession` with 2 new fields (default `false`/`None`).
3. Extend `PtyCreateOpts`; add `clone_for_respawn()` method returning a struct with the subset needed to respawn (command, cwd, env, size, policy, max_retries).
4. Store respawn template in `LiveSession`.
5. Wire project `restart`/`restart_max_retries` into API terminal create handler.
6. Fix up existing tests.

## Todo
- [ ] `SessionMeta` fields + ctor
- [ ] `DeadSession` fields
- [ ] `PtyCreateOpts` fields + clone helper
- [ ] `LiveSession` stores respawn template
- [ ] API terminal.rs wires policy
- [ ] Existing tests compile

## Success Criteria
- `cargo test` passes.
- Wire JSON for session list includes new fields when alive.

## Risk Assessment
- Medium. Changes touch construction sites; compiler-guided refactor is safe.
- Clone semantics for `PtyCreateOpts`: env vec and command strings are cheap; avoid cloning raw FDs.

## Security Considerations
None.

## Next Steps
Phase 4 consumes the respawn template.
