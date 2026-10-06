# PR48 three-phase hardening qualification

## Scope and provenance

User authorized all three phases of `plans/261006-1052-pr48-review-and-hardening/plan.md` together. Implementation is integrated; final review, human visual acceptance and finalization are separate gates. No commit, push or remote PR mutation has occurred. Earlier feature-plan edits are user-owned and remain untouched. Historical visual artifacts and their original recorded acceptance/timestamp are preserved under `plans/261006-1052-pr48-review-and-hardening/reports/prior-visual-evidence/`; they are not reconfirmed.

## Executed native verification

Terminal smol tester report: `plans/reports/tester-261006-1135-pr48-hardening.md`.

- `cargo test --lib git::`: 177 passed.
- `cargo test --test git_blame_api --test git_sha256_inspection`: 18 passed (12 blame API, 6 actual SHA-256 repository scenarios).
- `cargo build --bin dam-hopper-server`: passed.
- One existing unused `atomic::Ordering` import warning in `src/pty/tests.rs` remains.

## Executed frontend verification

- Scoped 13-file Vitest command: 182 passed. Includes hook lifecycle, gutter, shared reveal guard, details, workspace reveal, host eligibility, metadata validation and existing transport generation fences.
- `pnpm --filter @dam-hopper/ui build`: passed.
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck`: passed.
- Initial browser runner reported 3 passed, but geometry/reveal checks had conditional silent skips. Parent removed those guards, exposing missing local Monaco setup and zero-height fixture layout. The debugger repaired the fixture; strengthened component qualification is tracked separately rather than treating the earlier green run as geometry proof.
- After actual local-loader/layout repairs, the strengthened real Monaco suite passed 3/3 with unconditional mount/row requirements, public geometry and 20px -> 31px configuration transition, plus committed mouse/Enter and Uncommitted no-reveal behavior.
- Final clean cutover removed obsolete constructor/mock-option/magic19 geometry fallbacks. Afterward: focused gutter/MonacoHost tests 21/21, UI build and real Monaco 3/3 passed; forced production rebuild and capture-enabled final application journey 1/1 passed. Current byte provenance: `plans/reports/source-261006-1226-pr48-hardening.json`; earlier source receipt remains historical.
- Scoped ESLint: exit 0, zero errors; warnings for an unused browser capture variable, unused destructured test email and snapshot dependency. The unused browser capture is subsequently removed; this is not a claim of warning-free qualification.

Protocol-invalid test fixtures were corrected rather than weakening behavior: deferred replies echo actual request snapshot identities, paths match requested tabs, and QueryCache invalidation tests create actual cached queries. The hook harness now rerenders the same mounted hook across tab switches, so asynchronous ownership tests exercise transitions instead of remount cleanup.

## Actual HTTP smoke

Evidence: `plans/reports/http-261006-1201-pr48-hardening.json`. Updated server launched via `cargo run --bin dam-hopper-server` with isolated HOME/config on trusted loopback and `--no-auth`; production authentication is unchanged.

- Original and staged-renamed oversized baseline: 413 `GIT_BLAME_TOO_LARGE`.
- Original and staged-renamed binary baseline: 415 `GIT_BLAME_UNSUPPORTED_FILE`.
- Git tree symlink with absent disk entry: 415 `GIT_BLAME_UNSUPPORTED_FILE`.
- LF, CRLF and lone-CR buffers against LF HEAD: three display rows, committed author email retained; dirty buffer retains unchanged neighbor attribution.
- Actual SHA-256 roots/status/log: 200; root and successor commit details/files: 200; historical diff contains exact `first\n` -> `second\n` contents.
- Distinct author/committer names/emails and +0700/-0530 offsets match real Git metadata.
- Before/after HEAD OIDs, index hashes and working file hashes unchanged.

Observed existing limit: a CRLF-committed baseline compared to the normalized LF buffer returns three rows all Uncommitted. The initial smoke incorrectly expected author metadata on that byte-different baseline. The corrected scenario verifies row integrity and records this limitation; it does not claim EOL-insensitive history attribution. The phase explicitly excludes expanded EOL attribution scope.

## Production application and visual review

- Forced current production image build: passed (`pnpm --filter @dam-hopper/ui test:e2e:build-images`); Git is included in the actual runtime image.
- `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e editor-git-blame/editor-git-blame.spec.ts`: 1 passed. Newly typed row6 is Uncommitted while Alice/Bob neighbors retain attribution; mouse/Enter/menu reveal exact commits, metadata renders, and normal/compact checkpoints capture.
- Fresh final record: `packages/ui/e2e/editor-git-blame/review.md`, run `e2e-run-1791264287476-0b473ba8`, fingerprint `d771ab652f5408bba0598897843397a45c132ee26acdc34e91ef9a43b7ed7e8b`; five full-viewport PNGs after typed geometry cutover. Status **ACCEPTED** by explicit session-operator inspection/approval; receipt `approval-261006-1227-pr48-hardening.json`.
- Actual authenticated production browser smoke: gutter and Monaco rows both 19px; clicking Bob and pressing Enter on Alice exposed their own full exact OIDs. Tooltip and committer email visible. Ctrl-wheel editor-font change produced matching 20px row heights and identical row/editor top156.5px; toggling off removed the gutter.
- Separate real SHA-256 repository in the production container: Workspace Git loaded two real 64-hex commits, author/committer metadata with +0700/-0530 offsets, changed `inspection.txt`, and a visible historical diff showing `first` removed and `second` added. Branch/mutation discovery remains outside SHA-256 support and displays a waiting state; supporting read inspection worked.
- Saved actual browser captures: `browser-261006-1211-pr48-gutter.png`, `browser-261006-1214-pr48-sha256-inspection.png`, `browser-261006-1215-pr48-font-transition.png` under `plans/reports/`.
- Browser tab closed. Isolated API service stopped. Production service received graceful `stop`; `PR48_HARDENING_CLEANUP_COMPLETE` and exit0 observed after disposing its owned application/Mongo containers and network.
- Owned throwaway fixture directories, harness scripts and secret-bearing temporary state files removed after smoke completion.

Image-cache fingerprints hash HEAD/status paths, not modified-file bytes. Forced production builds supplied current code; the fingerprint alone is not a content attestation. Historical visual acceptance remains preserved but unverified. The session operator inspected and accepted the five fresh final captures at the recorded approval gate.

## Not claimed

No whole-repository test/lint/Clippy/release gate, universal bounded libgit2 computation, SHA-256 native blame/mutations, automated human visual approval, or merge qualification is claimed.
