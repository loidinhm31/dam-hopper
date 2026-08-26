# Phase 03 — Validation and release checks

## Context links

- Parent: [plan](./plan.md)

## Parallelization info

Depends on Phases 01 and 02.

## Overview

Priority P1. Status pending. Run focused regression suites, then prove deployed asset and Git behavior.

## Key insights

Both prior failures only appear across runtime boundaries: configured filesystem state and a deployed stale browser tab.

## Requirements

- Run focused Rust API and UI tests.
- Run applicable TypeScript/build validation.
- Verify production against an authenticated real Git clone after deployment.

## Related code files

- None. This phase owns commands and release evidence only.

## File ownership

No implementation files.

## Implementation steps

1. Run focused server tests for Git error mapping/root resolution.
2. Run UI component/API tests, type-check, and production build.
3. Deploy through the existing Pages workflow.
4. From a fresh browser tab and a deliberately stale-tab scenario, confirm one reload then successful load.
5. Configure the production project to a real clone and confirm authenticated `roots`, `branches`, and Changes requests return 200.

## Todo list

- [ ] Automated suites
- [ ] Build
- [ ] Pages smoke test
- [ ] Authenticated production Git smoke test

## Success criteria

- All relevant tests pass.
- Current hashed lazy assets return 200.
- No-Git and real-Git states are distinguishable to users.

## Conflict prevention

Do not alter source. Report failures back to the owning phase.

## Risk assessment

The production project configuration is operational work and cannot be validated from this repository alone.

## Security considerations

Use an authenticated browser/session; never place production tokens in commands or reports.

## Next steps

Code review after test evidence.
