# Phase 06 - Integration Tests + Windows Paths + Docs

## Context links

- Parent plan: [plan](./plan.md)
- Depends on: [phase-04](./phase-04-api-state-adjustments.md), [phase-05](./phase-05-config-write-roundtrip.md)
- Research: [config registry research](./research/researcher-01-config-registry.md), [sandbox API research](./research/researcher-02-sandbox-api.md)
- Docs baseline: [configuration guide](../../docs/configuration-guide.md), [system architecture](../../docs/system-architecture.md), [CLAUDE](../../CLAUDE.md)

## Overview

Date: 2026-07-12
Description: Prove the new registry model with integration tests, Windows path coverage, manual smoke steps, and docs.
Priority: P1
Implementation status: Completed
Review status: Reviewed (9/10)
Effort: 3h

## Key Insights

- The feature is security-sensitive; parser tests alone are not enough.
- Windows path behavior is a first-class requirement because the current workspace is Windows and the desired registry examples use Windows paths.
- Existing docs still describe `--workspace` as the primary resolution model.

## Requirements

- Cover config resolution priority.
- Cover absolute and relative project parsing.
- Cover per-project sandbox isolation and traversal rejection.
- Cover config write roundtrip for global registry paths.
- Update user docs and developer docs.
- Include manual smoke steps for projects on separate roots or drives.

## Architecture

Testing layers:

- Unit: config path resolution, parser validation, path formatting helper, sandbox validation.
- API integration: status, switch, config update, file list/read/search/write.
- Platform-specific: `#[cfg(windows)]` drive-letter/verbatim/UNC behavior where feasible.
- Manual: two real projects in different directories, terminal cwd, file explorer, search, mutation rejection.

## Related code files

- [server/src/config/tests.rs](../../server/src/config/tests.rs)
- [server/src/api/tests.rs](../../server/src/api/tests.rs)
- [server/tests](../../server/tests)
- [docs/configuration-guide.md](../../docs/configuration-guide.md)
- [docs/system-architecture.md](../../docs/system-architecture.md)
- [docs/project-overview-pdr.md](../../docs/project-overview-pdr.md)
- [CLAUDE.md](../../CLAUDE.md)
- [README.md](../../README.md)

## Implementation Steps

1. Add config resolver priority tests.
2. Add parser tests for absolute paths and strict `env_file` behavior.
3. Add sandbox tests for multi-root validation, sibling rejection, traversal, and symlink escape.
4. Add API tests for global registry status/switch/config update/file access.
5. Add or mark Windows-only tests for drive letters, mixed separators, and verbatim prefixes.
6. Run focused tests after each test cluster, then `cd server && cargo test -j 1`.
7. Update docs after code behavior is final.
8. Record manual smoke steps and expected results in docs or a phase report.

## Todo list

- [x] Add config resolution tests.
- [x] Add parser/roundtrip tests.
- [x] Add sandbox and API integration tests.
- [x] Add Windows-specific tests where practical.
- [x] Update configuration and architecture docs.
- [x] Update CLAUDE and README command guidance.
- [x] Run final validation commands.

## Success Criteria

- `cd server && cargo test -j 1` passes.
- Frontend package tests pass if API type changes touch UI code.
- Server can start from a global registry with two absolute project paths.
- File list/read/search/write work inside configured projects and reject escapes.
- Terminal opens in the selected project root.
- Docs accurately describe the new primary model and manual migration steps.

## Risk Assessment

- Low implementation risk, high verification importance.
- Windows CI may not run platform-specific tests; document manual verification when CI cannot prove it.
- Docs can drift if written before final code decisions; update docs last.

## Security Considerations

- Include negative tests for sibling access, parent traversal, symlink escape, and unknown project names.
- Confirm no endpoint accepts raw absolute client paths outside configured roots.
- Review diagnostics/logging so rejected paths do not leak sensitive path details unnecessarily.

## Next steps

- After Phase 06 passes, consider a separate UX cleanup plan for renaming workspace concepts to registry/projects where the UI still feels ambiguous.
