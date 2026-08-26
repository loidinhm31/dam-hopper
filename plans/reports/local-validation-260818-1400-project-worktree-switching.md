# Local validation — project worktree target switching

Date: 2026-08-18
Branch: `feat/project-worktree-switching`

## Result

PASS. The delegated tester gate was attempted twice, but both model selections
returned a capacity error before executing. The same validation was then run
directly in the shared worktree.

## Commands

- `pnpm --filter @dam-hopper/ui test` — 183 files, 1,171 tests passed.
- `pnpm --filter @dam-hopper/ui test:browser` — 29 files, 130 tests passed.
- `pnpm --filter @dam-hopper/ui build` — passed.
- `pnpm lint` — passed.
- `cargo fmt --manifest-path server/Cargo.toml --all -- --check` — passed.
- `cargo test --manifest-path server/Cargo.toml` — 730 unit tests passed, 1
  ignored; all integration suites passed, with 1 documented ignored contract
  test.
- Focused PTY, persistence, workspace-target, UI, build, lint, and diff checks
  — passed.

The CRLF-formatted `use-terminal-manager.ts` file was checked with the
repository's intentional CRLF policy; all other touched files pass the normal
diff whitespace check.
