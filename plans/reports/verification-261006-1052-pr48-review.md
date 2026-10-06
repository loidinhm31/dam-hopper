# PR48 Verification Evidence

Date: 2026-10-06. Reviewed HEAD `9c74aaeeb5efe2e1b4f17878ac0b4933c1854fd4`; base `9e727b4bee3b8634add7d049a247a7d3599f282a`.

## Fresh commands
| Command | Observed result |
|---|---|
| `cargo test --test git_blame_api` (server) | 9 passed, 0 failed |
| `cargo test git::blame` (server) | 11 passed |
| `cargo test git::commit_details` (server) | 5 passed |
| `pnpm --filter @dam-hopper/ui exec vitest run src/hooks/use-editor-git-blame.test.tsx src/components/organisms/WorkspaceGitPanelBlame.test.tsx src/components/organisms/CommitDetailsPanel.test.tsx src/components/pages/WorkspacePageBlameReveal.test.tsx src/lib/editor-git-blame.test.ts` | 57 passed, 5 files |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/editor-git-blame.browser.tsx` | 3 passed, real Chromium |
| `E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e editor-git-blame/editor-git-blame.spec.ts` | 1 passed; isolated production image, SPA, Rust, Mongo |
| `node .omp/evcrate/scripts/validate-docs.cjs` | exit 0; all checked file links exist; 25 environment-key warnings and 5 symbol-reference warnings; intentionally nonblocking |
| Throwaway `vitest run src/hooks/pr48-refresh-smoke.test.tsx` | 1 passed asserting observed defect: late roots rejection changes disabled status off → unavailable; probe removed afterward |
| Plan structure/link smoke | 4 files validated; overview49lines (<80); all requested phase sections present; all relative file links resolve |

No full-suite, lint, build, Windows/native qualification claimed. CI snapshot at start: seven success, six in progress; not final merge certification.

## Live HTTP scenarios
Actual `cargo run` server on isolated loopback port, temporary HOME/config/project; no-auth only trusted loopback. Requests through real HTTP, not router-only tests.
- LF and CRLF committed buffers: 200 ready, original lines committed; terminal newline display row uncommitted.
- Dirty LF buffer: unchanged first line committed; changed second line and terminal row uncommitted.
- Exact 40-hex commit: 200 full multiline message.
- Initial LF/CRLF/dirty/commit smoke: HEAD, index SHA-256, and source file SHA-256 unchanged.
- 64-hex input: 400 `GIT_BLAME_INVALID_INPUT`, parser says `unable to parse OID - too long`.
- HEAD blob 5,242,882 bytes, staged rename: original path 413 `GIT_BLAME_TOO_LARGE`; renamed path 200. Same tiny content supplied to both.
- Binary HEAD blob `abc\0def`, staged rename: original path 415 `GIT_BLAME_UNSUPPORTED_FILE`; renamed path 200 ready. Same `abc\n` buffer supplied to both.
- HEAD symlink `link.txt -> lf.txt`, working copy unlinked: 200 ready attribution of target string instead of unsupported file.
- Raw API lone-CR buffer `alpha\rbeta\r`: 200, line count 1, uncommitted. Monaco normalization limits UI exposure; not elevated to a primary merge blocker.

## Independent production browser smoke
Built production app + real Mongo from existing application service fixture, seeded deterministic 207-commit blame repository. Browser tool opened dedicated managed Chromium; observed actual application, no network mocks.
- Enabled blame via Monaco line-number menu; Alice rows 1/2, Bob row 3, terminal row 5 already Uncommitted before editing.
- Left mouse click committed row 3: focused row, no commit reveal. Enter on same focused row: Workspace Git opened outside-history notice and full Bob commit message.
- Dirty typed line 6: Uncommitted; neighboring Alice/Bob rows remained attributed.
- Real row CSS: inline height and line-height empty, rendered height 16.5px; Monaco line-number height 19px. Installed Monaco `EditorOptions.lineHeight.id = 75`, `glyphMargin.id = 66`; current code queries 66.
- Visual screenshots inspected by assistant: `/tmp/omp-sshots-159b246ff0954540.webp` (commit reveal), `/tmp/omp-sshots-159b24afbed54541.webp` (dirty row). Assistant inspection is not human operator approval; existing PNG/evidence/review files preserved.

## Evidence limits
- Early-return HEAD race and owner/target success-continuation races remain static findings. Disabled-state late roots rejection was reproduced by the throwaway hook probe.
- Existing E2E dirty assertion selects first Uncommitted row: pre-existing trailing row makes it weaker than its claimed acceptance. Live smoke proves current implementation, not adequacy of that assertion.
- Existing review file records `2026-10-06T10:25:00Z`, later than observed wall time `2026-10-06T03:59:38Z`; timezone/provenance unresolved. Do not infer fabrication or replace human sign-off.
- Initial isolated Vite/no-auth browser could not connect; production fixture used instead. No unrelated auth fix attempted.
- Dedicated browser, API/Vite services, owned production app/Mongo containers/network, temporary API fixture and smoke harness removed. Pre-existing unrelated Mongo container untouched.

## Unresolved questions
- Preserve advertised SHA-256/email/click contracts by implementation, or explicitly approve narrowing? No scope reduction applied.
- Human operator acceptance of existing five checkpoints and corrected review timestamp remains to confirm.
