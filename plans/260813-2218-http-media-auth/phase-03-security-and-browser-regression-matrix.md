# Phase 03 — Security and Browser Regression Matrix

## Context links

- [Plan](./plan.md) · [Phase 1](./phase-01-preflight-and-backend-http-contract.md) · [Phase 2](./phase-02-frontend-http-media-lifecycle.md)
- Existing server integration: `server/src/api/tests.rs` · store tests: `server/src/fs/media_ticket.rs`
- Browser suites: `packages/ui/browser-tests/explorer-video-playback-download.browser.tsx` · `explorer-image-preview.browser.tsx`
- Harness: `packages/ui/vitest.browser.config.ts`

## Overview

- Date: 2026-08-13
- Description: prove HTTP cookies, Bearer boundaries, Range/revalidation/lifecycle, and same-site limitations without weakening store invariants.
- Priority: P1
- Implementation status: Pending
- Review status: Required; security and browser regression review

## Key Insights

- Existing browser suites bypass transport validation and synthetic endpoints do not set/check cookies. That cannot qualify HTTP media auth.
- Rust integration can prove wire headers and server authority; real Chromium must prove browser stores/sends Lax non-Secure cookies to HEAD/native image/video/download.
- Same-origin HTTP is deterministic in current Vite harness. A second hostname/schemeful-site fixture is needed only to prove/document boundary, not to promise cross-site HTTP support.
- TTL/capacity/revalidation/revocation code should not change. Re-run existing tests as regression gates rather than rewrite store internals.

## Requirements

- Server unit/integration coverage: exact media/auth cookies, optional/HTTP CORS, auth middleware boundaries, image/video GET/HEAD/full/range, missing/foreign cookie, stale file, ticket/session revoke, logout/workspace/restart semantics, no-touch on failed auth, TTL/capacity unchanged.
- Browser same-origin HTTP: issue response sets real `damhopper-media-session`; credentialed HEAD sends it; native image and video requests send it; direct download succeeds; revoke clears/invalidates; no Blob/body fallback.
- Browser schemefully same-site cross-origin HTTP (for example same registrable host with different port/subdomain where harness permits): exact CORS + Lax cookie works. If deterministic harness cannot model this, claim only same-origin HTTP.
- Browser cross-site HTTP: explicitly negative/unsupported. Demonstrate cookie omission/probe failure when feasible; never weaken to `SameSite=None` without Secure.
- Keep response statuses non-disclosing: missing/foreign cookie and bearer-on-stream do not reveal ticket validity; all stream responses remain `private, no-store`.
- Tests and logs must use synthetic tokens; never snapshot full real Set-Cookie/Authorization values outside focused assertions.

## Architecture

- Extend `mediaFixturePlugin` with minimal session state: POST validates Bearer, emits Lax HTTP media cookie; HEAD/GET stream requires matching cookie; DELETE revokes and clears. Reuse existing image/video fixtures.
- Avoid building a second production-like auth server. Fixture tests browser cookie delivery only; Rust tests own store and authorization correctness.
- Preserve native-element path. Observe requests server-side in fixture counters/flags rather than reading HttpOnly cookie from JS.

## Related code files

- Modify `server/src/api/tests.rs` — HTTP cookie/CORS/auth boundary and existing media lifecycle assertions.
- Modify `server/src/fs/media_session.rs` tests — exact non-Secure Lax set/clear and parser.
- Verify `server/src/fs/media_ticket.rs` tests — TTL/capacity/no-touch/revoke/finalization remain green; code change not expected.
- Modify `packages/ui/vitest.browser.config.ts` — cookie-enforcing HTTP media fixture and request observations.
- Modify `packages/ui/browser-tests/explorer-video-playback-download.browser.tsx` — remove transport mock; prove HTTP playback/seek/download cookie path.
- Modify `packages/ui/browser-tests/explorer-image-preview.browser.tsx` — remove transport mock; prove HTTP image/session lifecycle.
- Modify browser fixture helpers only if existing config would exceed maintainable size; no new app/runtime module.
- Delete: obsolete mocked `assertMediaTransport` blocks in both browser suites.

## Implementation Steps

1. Add table-driven backend matrix: auth mode (`Bearer`, auth cookie fallback, none) × endpoint (issue/revoke/session-revoke/stream) × expected result. Assert Bearer wins over fallback and never authorizes stream alone.
2. Assert exact cookie attributes for dev/prod login, logout, media issue, media revoke/logout clear. Parse attributes case-insensitively; verify no `Secure`, `Partitioned`, `Domain`.
3. Run unchanged deterministic-clock store tests for idle/absolute TTL, failed-lookup no-touch, caps/pruning/no-live-eviction, revoke-during-finalization, actor/session isolation.
4. Extend API tests for HTTP exact-origin preflight (POST/DELETE/HEAD/Range) and no configured CORS. Verify unlisted/wildcard never authorized.
5. Upgrade browser fixture to enforce a real HttpOnly Lax media cookie. Native requests without cookie return 404. Record safe booleans/counts only.
6. Remove browser transport mocks; assert same-origin HTTP ticket issue → HEAD → native source ordering; image decode, video metadata/seek, direct download; ticket/session revoke and retry.
7. Add cross-site/same-site topology check if harness can bind deterministic alternate origins. Otherwise document qualification precisely: same-origin HTTP observed; schemefully same-site expected by cookie policy but not claimed as executed; cross-site HTTP unsupported.
8. Grep and review for capability regressions: `Authorization` in stream APIs, ticket in query/log/storage, `blob(`, `createObjectURL`, `SameSite=None`, `Partitioned`, media-cookie `Secure`.

## Todo list

- [ ] Backend auth endpoint matrix green
- [ ] TTL/capacity/revalidation/revocation regression suite green
- [ ] Real Chromium stores/sends HTTP media cookie
- [ ] Native image/video/download HTTP paths green
- [ ] Cross-site HTTP limitation tested or explicitly unqualified
- [ ] No bearer/capability fallback or secret logging found
- [ ] Security/browser reviewers approve

## Success Criteria

- Same-origin HTTP Chromium test fails if cookie is not stored/sent and passes with new attributes.
- Owning cookie + ticket yields existing 200/206/HEAD; ticket alone, Bearer alone, or foreign cookie yields generic 404 without TTL touch.
- Stale file still returns 410 only after authorization; capacity still returns bounded 429; logout/session/workspace revoke works.
- Exact commands: `cargo test --manifest-path server/Cargo.toml fs::media_ticket`; `cargo test --manifest-path server/Cargo.toml api::tests`; `pnpm --filter @dam-hopper/ui test`; `pnpm --filter @dam-hopper/ui test:browser`.

## Risk Assessment

- Browser fixture accidentally tests JS fetch only: require real native image/video and anchor observations.
- Lax same-site assumptions vary by host naming: record exact Chromium version, origins, and result; narrow claims.
- Test fixture stores secrets: use fixed synthetic values and expose only booleans/counters.

## Security Considerations

- Test accepted insecurity, not eliminate it: on-path interception remains possible by design.
- Maintain two-part authorization and redacted failures under hostile replay.
- Cookie clearing must use same host/path/SameSite attributes; session revocation still server-side, not merely browser deletion.

## Next steps

- Phase 4 updates architecture/operator/user docs from observed evidence and runs full release gates.

## Unresolved questions

- None. Qualification claims must follow what the harness actually executes.
