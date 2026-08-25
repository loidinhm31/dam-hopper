# Phase 04 — Validate and review

## Context links

- Parent: [plan](./plan.md)
- Commands: `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui type-check`, `pnpm --filter @dam-hopper/ui build`

## Parallelization info

Runs after Phases 01–03. Owns no source files.

## Overview

- Priority: P1
- Status: Pending
- Review: Pending
- Goal: verify the three repairs and request a code review.

## Requirements

- Run focused Vitest suites first, then UI package test/type/build checks.
- Run browser menu geometry smoke and a multi-terminal WebGL smoke where a browser is available.
- Request review of the final diff and resolve critical findings before completion.

## Related code files

No edits. Validate files owned by Phases 01–03 only.

## File ownership

None.

## Implementation steps

1. Run targeted tests for each phase.
2. Run UI package validation commands.
3. Inspect browser console while cycling many tabs and split panes; confirm no context-limit, delete-context, or pre-trigger menu warnings.
4. Request a focused review of all changed files.

## Todo list

- [ ] Focused tests.
- [ ] UI package test/type/build.
- [ ] Browser smoke.
- [ ] Code review.

## Success criteria

- All automated checks pass.
- Browser console is clean for the three reported warning classes.
- Reviewer finds no unresolved critical or important issue.

## Conflict prevention

Validation does not edit phase-owned files without routing the repair back to that phase.

## Risk assessment

Browser WebGL limits vary; record the tested session/pane count and browser version.

## Security considerations

Avoid real destructive Git or filesystem actions in browser checks.

## Next steps

Ask user before committing; commit only implementation files explicitly approved for staging.
