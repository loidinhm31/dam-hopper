# Inline Terminal Suggestions — Phase 05 Validation

## Completed

- Fixed the immediate kill switch: a disabled controller no longer persists a later
  `submitted` lifecycle command to browser-local history.
- Preserved IME input by passing legacy composition keycode `229` through unchanged.
- Documented the UI setting, exact history privacy behavior, supported-shell boundary,
  lifecycle WebSocket contract, and manual validation limits.
- Marked Phase 05 complete after review approval; external release gates remain explicit.

## Fresh validation

| Command | Result |
| --- | --- |
| `pnpm --filter @dam-hopper/ui test` | 104 files, 534 passed |
| `pnpm --filter @dam-hopper/ui test:browser` | 4 files, 15 passed |
| `pnpm --filter @dam-hopper/ui build` | passed |
| `pnpm build` | passed |
| `pnpm --filter @dam-hopper/native build` | passed |
| `cargo test` | 465 passed |

Focused controller/history/key/geometry tests also passed 33/33. Review score: 8.5/10,
no critical issues; user approved the documented external gates.

## Known limits

- `pnpm lint` and `pnpm check` remain blocked by pre-existing lint errors in
  `EditorTabs.tsx` and `use-coarse-pointer.ts`; no lint rule was disabled or altered.
- The environment has Bash only. No real supported zsh/fish PTY, desktop IME,
  screen-reader, or WebGL/renderer manual matrix ran here.
- Browser artifacts already present under `packages/ui/.vitest-attachments/` and
  `packages/ui/browser-tests/__screenshots__/` were preserved untracked.

## External release gates

1. Run zsh and fish prompt-framework/PTy scenarios: password/no-echo, SSH-like,
   REPL, silent command, completion, vi/readline, paste, and alternate-buffer TUI.
2. Run desktop DOM/WebGL geometry, IME, and screen-reader smoke checks.
3. Resolve the unrelated lint errors before requiring a fully green root `pnpm check`.

## Unresolved questions

- Required desktop OS, shell/prompt framework, IME, screen-reader, and renderer matrix
  for final production release sign-off remains unspecified.
