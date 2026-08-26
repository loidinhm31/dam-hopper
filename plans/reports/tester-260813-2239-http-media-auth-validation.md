# Validation report — HTTP media auth

Date: 2026-08-13; branch `main`; read-only validation.

## Results

- `cargo fmt --manifest-path server/Cargo.toml -- --check` — PASS.
- Focused UI: `pnpm --filter @dam-hopper/ui test -- src/api/media-session.test.ts src/api/video-tickets.test.ts src/components/organisms/ImagePreview.test.tsx src/components/organisms/VideoPreview.test.tsx src/components/organisms/ServerSettingsDialog.test.tsx` — PASS (169 files, 1016 tests; Vitest interpreted all project files).
- Full UI: `pnpm --filter @dam-hopper/ui test` — PASS (169 files, 1016 tests).
- UI browser: `pnpm --filter @dam-hopper/ui test:browser` — PASS (26 files, 116 tests).
- UI type/build: `pnpm --filter @dam-hopper/ui build` — PASS (`tsc -p tsconfig.json`).
- Root web build: `pnpm build` — PASS (Vite production build; 3881 modules; browser extension staging included).
- Root lint: `pnpm lint` — PASS (`eslint apps/ packages/`).
- `grep -R -n -E 'trusted[-_ ]tls[-_ ]proxy|trusted_tls_proxy|TLS[-_ ]proxy|HTTPS.*required|https.*required|Secure;|Partitioned' server/src packages/ui/src` — PASS; no obsolete matches.

## Backend failure

- `cargo test --manifest-path server/Cargo.toml` — FAIL: 690 passed, 2 failed, 1 ignored.
- Failing tests:
  - `api::tests::image_stream_is_session_bound_inline_mime_typed_and_rangeable` — `src/api/tests.rs:4715:31`, panic `no entry found for key "access-control-expose-headers"`.
  - `api::tests::video_stream_is_session_bound_and_exposes_media_headers_to_browsers` — `src/api/tests.rs:4366:31`, same panic.
- Failure occurs while indexing response header `access-control-expose-headers`; likely test/request CORS setup mismatch after CORS behavior change. No fixes made.
- Attempted combined cargo test filter was invalid Cargo CLI usage (two positional test names); individual filters were then run but matched 0 tests because these are nested test names, so they do not independently validate the failures. Compiler emitted existing dead-code warnings for image/video ticket store methods.

## Diff/check

- `git diff --check` — FAIL: `docs/linux-nohup.md` reports trailing whitespace on lines 57 and 78–150 (CRLF-style lines/newly modified documentation). No edits made.
- Worktree preserved; unrelated untracked files remain untouched.

## Coverage/performance

No coverage command configured/run. Full backend test duration ~9.46s; full UI ~25.22s; browser UI ~15.97s.

## Unresolved questions

- Should the two backend media tests configure an Origin when asserting exposed CORS headers, or should the router expose those headers without CORS?
- Are the reported documentation trailing-whitespace lines pre-existing/unrelated changes or expected to be normalized by the implementation owner?
