# Tester gate: project worktree switching

Status: FAIL — browser suite has 1 failing test.

## Test results overview

- `pnpm --filter @dam-hopper/ui test`: PASS; 183 files, 1168 passed, 0 failed; 7.14s.
- `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts`: FAIL; 29 files, 129 passed, 1 failed; 16.60s.
- `pnpm lint`: PASS; ESLint completed with no diagnostics.
- `pnpm build`: PASS; browser extension and web production bundles built; 23.80s web build.
- `cargo fmt --manifest-path server/Cargo.toml --all -- --check`: PASS.
- `cargo test --manifest-path server/Cargo.toml`: PASS; 727 unit tests passed, 1 ignored; integration suites passed: auth 12, browser debug 4, compatibility 1 passed/1 ignored, fs mutate 9, fs sandbox 13, fs upload 9, fs streaming 5, lifecycle 4, workspace targets 10, websocket FS 7.
- `git -c core.whitespace=cr-at-eol diff --check`: PASS.

## Failed test

`browser-tests/explorer-image-preview.browser.tsx` — “stays usable at narrow widths without adding a download action”. At line 138, `image.naturalWidth` remained `0`; expected `1`. React also emitted two `act(...)` warnings in this file. Failure screenshot generated under the browser test screenshot directory.

## Focused checks

- UI target identity/tree/SSE/terminal set: PASS; 11 files, 80 tests.
- Rust `project_worktree_lifecycle`: PASS; 4/4.
- Rust PTY create/environment subset: PASS; 4/4.

## Coverage / performance

No coverage command was requested or configured by the executed gates; coverage percentages unavailable. Unit suite: 7.14s. Browser suite: 16.60s. Rust test execution: 9.55s library tests; integration timings reported above.

## Pre-existing unrelated worktree changes

Worktree was already dirty before validation, including documentation, UI/server source and tests, plan files, migrations, and new target-switching tests. No production or test files were edited by this gate. Build/test commands produced no additional tracked changes.

## Actionable issue

Investigate the image fixture/load timing or Chromium image decoding in `explorer-image-preview.browser.tsx`; wrap asynchronous state updates in `act(...)` and make the naturalWidth assertion use a deterministic loaded image fixture/event.

## Unresolved questions

- Is the image-preview browser failure an environment/Chromium flake or an intended regression? Re-run the isolated test to classify.
