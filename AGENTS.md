# Repository Guidelines

## Project Structure

- `server/` contains the Axum/Tokio Rust backend, organized by concerns such as `api/`, `config/`, `fs/`, `git/`, `pty/`, and `agent_store/`; integration tests live in `server/tests/`.
- `apps/web/` is the React 19/Vite entry application. Shared UI and browser-facing logic live in `packages/ui/`, `packages/shared/`, and `packages/browser-bridge/`.
- `docs/` contains architecture, API, configuration, and coding guidance. `__fixtures__/` holds sample workspaces; `deploy/` and `scripts/` contain operational helpers.

## Build, Test, and Development

Install dependencies with `pnpm install`. Use `pnpm dev` for the Vite app and `pnpm dev:server` for the Rust server. Build with `pnpm build` (web) or `pnpm build:server` (release server). Run `pnpm lint` for ESLint and `pnpm format` for Prettier. Run backend tests with `pnpm test`; UI unit tests with `pnpm --filter @dam-hopper/ui test`; browser tests with `pnpm --filter @dam-hopper/ui test:browser`. Before submitting broad changes, run `pnpm check`.

## Coding Style and Naming

Use the repository’s configured ESLint, Prettier, and Rust formatting rules; keep TypeScript strict and run formatters rather than manually reflowing code. React component files use PascalCase (`FileTree.tsx`); hooks, stores, and other TypeScript modules use kebab-case (`use-file-search.ts`). Rust files use snake_case (`fs_subsystem.rs`). API payloads use camelCase while on-disk TOML uses snake_case.

## Testing Guidelines

Add Rust tests alongside the relevant module or under `server/tests/`; use real temporary filesystems and git repositories rather than mocks. Name tests for observable behavior, for example `test_list_dir`. Add Vitest coverage for shared UI logic and browser regression coverage when behavior depends on Chromium or user interaction.

## Commits and Pull Requests

Use focused Conventional Commit messages, such as `feat(usage): add live telemetry settings flow` or `fix(deploy): pass extension origin`. Pull requests should explain the behavior change, identify validation commands, link the issue or plan when applicable, and include screenshots or recordings for UI changes. Do not commit secrets, local configuration, build output, or generated Android artifacts.

## Security and Configuration

Never commit tokens, credentials, or `.env` files. Local server configuration belongs in `~/.config/dam-hopper/`; use `--no-auth` only for local development without production environment variables.
