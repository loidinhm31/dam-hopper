# Phase 07: Qualification, Code Review & Docs

## Objective
Run full test suite validation, code review, project management signoff, and update project documentation.

## Activities
1. **Testing**:
   - Run full unit test suite with `pnpm --filter @dam-hopper/ui test run`.
   - Run typecheck and linting (`pnpm check` or `pnpm lint`).
   - Use `evc-tester` subagent for test qualification.
2. **Code Review**:
   - Deploy `evc-code-reviewer` to audit all modified and new files.
3. **Documentation**:
   - Deploy `evc-docs-manager` to update `docs/` (codebase summary, architecture, design guidelines).
   - Deploy `evc-project-manager` for completion report.
4. **Git Commit**:
   - Stage, commit, and prepare delivery via `evc-git-manager`.
