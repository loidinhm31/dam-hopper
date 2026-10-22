# Phase 03 — Integration, authenticated runtime and review

## Overview and gate
- Status: in-progress (automated test suites, live cutoffs & reviews passed; human visual review pending). Priority: P2. Owner: parent coordinating one tester, then independent code/security reviewer.
- Depends on **both** phase 01 and 02 terminal reports plus readable implementation/regression artifacts. Do not execute against half-finished files.
- Contract: [acceptance](./contracts.md#acceptance--verification); runner authority: [testing guide](../../docs/testing.md).
- Execution status: automated test suites and live runtime cutoff verification executed and documented in reports/tester.md, reports/review-fixes-validation.md, and reports/live-revocation.md; human visual review remains pending.

## Ownership and execution
1. Parent integrates both reports against contract, assigns any missing cross-layer implementation to original exclusive owner and waits for completion. No source edits by tester while implementation owners are active.
2. After join, parent may transfer a specific integration test/fixture file under `server/**` or `packages/ui/**` to one owner at a time. Reviewer is read-only. Permanent regression sources stay under the four existing runner boundaries; runtime reports go under `plans/261022-0322-device-login-management/reports/`.
3. Use existing real SQLite fixtures in `server/tests/common/auth_fixtures.rs`, store tests in `server/tests/auth_sqlite_store.rs`, Mongo tests in `server/tests/auth_state_and_policy.rs`, seed executable `server/examples/application_e2e_seed.rs`, and actual-app services under `packages/ui/e2e/fixtures/`. Do not replace production auth with a fake endpoint or `--no-auth` except its dedicated unavailable scenario.
4. Tester runs the requested existing full suite once after integration; serialize heavyweight runners. Record exact commands, environment, pass/fail/skip counts, warnings and artifacts. Fix reachable failures through original owner, then rerun only affected checks; user-reported failures are already evidence, not something to rerun merely to confirm.

## Planned checks
Existing commands (not executed by planner):
```text
pnpm test:all
pnpm build
pnpm lint
pnpm --filter @dam-hopper/ui test:e2e:typecheck
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e device-login-management/device-login-management.spec.ts
```
Read `scripts/run-all-tests.sh` before running; use its actual enabled scope to avoid duplicate full runs. If it omits any requested tier, execute the existing `pnpm test`, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui test:browser`, or `pnpm --filter @dam-hopper/ui test:e2e` as needed, recording coverage rather than implying aggregate execution includes skipped tiers. Include native build only if required by requested suite or affected host behavior; do not broaden platform qualification claims.

## Persistence and API matrix
| Scenario | Required observation |
| --- | --- |
| SQLite upgrade | Original v1 schema with existing rows upgraded through production open path; data/auth state preserved, userAgent null, reopen safe |
| Metadata | Enrollment + login full MFA capture; absent/empty/legacy null, >512-byte and multibyte bound; step-up preserves hint |
| List authority | Same-account sessions only; no revoked/expired/old-authVersion rows; MFA-due retained; DTO contains no secrets |
| Stable pages | Static dataset: >50 records and timestamp ties with no duplicates/skips, current may appear later, malformed/oversized cursor 400. Concurrent changes: deterministic keyset continuation and correct ownership/revocation filtering per query, not a page-one snapshot guarantee |
| Mutation ownership | Foreign/missing same 404; still-valid survivor can repeat owned revoke with 204 and unchanged first revokedAt |
| Self mutation | Self DELETE 204 with zero Set-Cookie; old token now unauthorized; foreign/replacement cookies preserved; retry under revoked credential need not return 204 |
| Error policy | no-store on successful and rejected list/revoke including middleware auth/storage failures; no-auth both 409 `DEVICE_SESSIONS_UNAVAILABLE` |
| Mongo parity | Real Mongo persistence exercises same ordering/filtering/idempotence/owner predicates, concurrent list/revoke and legacy default; no skipped integration disguised as qualification |

Integration/security resolution: Cookie-authorized self-revoke is strictly unsupported; backend requires Bearer authorization (403 BearerRequired), emits zero Set-Cookie headers on revocation responses, and frontend requests use credentials: "omit". Replacement-login and foreign-cookie preservation verified in real-browser held-response tests.

## Real authenticated runtime journey
1. Use isolated loopback/container auth backend, dedicated temporary MFA key and database; never personal production sessions. Establish two same-account full-MFA sessions A/B plus foreign account C. Seed utilities may bootstrap fixtures but do not replace metadata capture via real MFA endpoint tests. Keep tokens out of logs/screenshots/report bodies.
2. Before revoke, prove A/B protected HTTP and WS work; C cannot list or revoke their sessions. Open B's existing WS and resource SSE, issue media tickets for both A/B, and begin a sufficiently large/throttled B media response to observe revalidation while bytes are consumed.
3. Revoke B from A. Require acknowledged DELETE; A still works, B protected HTTP and new WS fail, existing B WS closes with full-login-required semantics, and C remains isolated. Attempt B-issued ticket reads and observe rejected admission; verify A's tickets remain usable. Do not call actor-wide invalidation.
4. Record elapsed runtime observations against actual implementation points:
   - `server/src/api/ws.rs` auth watcher: 5-second polling plus up-to-2-second store timeout. Allow a stated 10-second healthy-local acceptance window, record observed close code/time; this is not instantaneous revocation.
   - `server/src/api/resource_events.rs` auth watcher: 5-second interval plus 2-second evaluation timeout. In supported environment require revocation/termination within the same stated 10-second window, verify survivor stream remains valid.
   - `server/src/api/media_stream_response.rs`: auth check at admission and after 5 elapsed seconds on a subsequent body read, with 2-second store timeout. Continue consuming long stream to cross that read boundary and observe cutoff; do not claim a wall-clock guarantee for paused/unread/buffered/completed responses.
5. Repeatedly revoke B using A to prove idempotence and preserved timestamp. Revoke A itself; show old A token denied and zero Set-Cookie emitted. Exercise differing bearer/cookie identity and replacement-login/self-revoke overlap; held-response tests verified replacement Cookie B remains intact.
6. If media/resource SSE cannot run in this environment, record exact missing prerequisite and checks attempted; complete all reachable checks. Feature remains unqualified for that acceptance item rather than silently narrowing scope.

## Actual full-app Chromium journey
- Run `packages/ui/e2e/device-login-management/device-login-management.spec.ts` against built `apps/web` plus real authenticated backend via existing fixtures. Browser-component mount alone is insufficient.
- Open selected saved server settings through real TopNav. Verify account/server-wide explanation, UA hint/fallback, login/expiry/current marker, and real paging/refresh.
- Confirm cancellation has no mutation; revoke other login and observe denied access there while current app survives. Self-revoke through confirmation and prove only exact captured profile disconnects/clears.
- Exercise same-server second profile, edited unsaved URL/token, profile switch/deletion, stale response after replacement login, and WS-before-DELETE completion. Never clear a replacement credential or global username.
- At 320px, inspect list and confirmation, long-hint wrap, bounded scroll, focus and visible actions. Capture full app viewport via `captureApplicationCheckpoint`, retaining colocated PNG/evidence.json/review.md policy under the E2E case. Human visual approval must be genuinely obtained, not fabricated.

## Independent review and success criteria
- Review whole implementation against contract: atomic owner predicates, page/cursor limits, byte-safe metadata, migration, Bearer-only revocation, zero Set-Cookie on revocation, middleware no-store, exact-session media cleanup, frontend ownership/secret handling and replacement-login races.
- Code reviews approved with zero blockers: [backend final review](./reports/review-backend-final.md) and [frontend final review](./reports/review-frontend-final.md).
- Verification evidence recorded:
  - Initial aggregate run failed fast without Mongo; resolved tier-by-tier with isolated Mongo: 2015 Rust server tests pass (7 ignored), 15 shared, 19 browser-bridge, 48 native host, 326 UI browser tests pass (4 skipped).
  - Initial targeted UI E2E resize failure fixed test-only.
  - Review fixes validation: backend suites 5+1+14+1+2+1+20 pass, UI connections 15 pass, dialog 9 pass, auth-client 32 pass, browser test 2 pass, build/lint/e2etypecheck pass (170 pre-existing lint warnings).
  - UI unit test fixture URL rebind in `LoginDevicesSection.test.tsx` fixed test-only; parent full UI unit run passed: 339 files, 3131 tests passing (0 failures).
  - Live container cutoffs qualified: WS 4,990 ms code 4401, SSE 4,991 ms, media stream cut at 7.73 MB / 26.21 MB on read beyond 5s boundary ([live-revocation.md](./reports/live-revocation.md)). Note: live probe predated final cookie/draft fix; transport code was unchanged, and held-response cookie preservation was validated separately.
  - E2E captures recorded in `packages/ui/e2e/device-login-management/evidence.json` (run `e2e-run-1792621601955-c069185b`) on image `dam-hopper:production-test` (fingerprint `28c988...`); parent test fixture edit post-dates capture run (no production effect; working tree porcelain status changed, so exact final-tree equivalence to container label is not claimed; host web assets overlay applied).
  - Full application E2E suite passed (11/11 specs).
- Explicit pending gate: human visual review of 3 PNG checkpoints remains PENDING in `packages/ui/e2e/device-login-management/review.md`. Release qualification cannot be marked complete until human sign-off.
## Unresolved questions
No product questions. Runtime prerequisites and cookie-race safety are gates to prove during implementation/validation, not assumed successes.
