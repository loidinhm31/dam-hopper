# Application journey — terminal validation report

## Outcome
- **COMPLETE: functional device-login journey and full existing application E2E suite passed.**
- Human visual acceptance remains **PENDING_HUMAN_REVIEW**; no human ACCEPTED claim.
- No commits; no production source edits; no fake/intercepted network responses.

## Scoped repair
- Edited only `packages/ui/e2e/device-login-management/device-login-management.spec.ts`.
- Extracted existing TopNav settings-opening steps into `openServerSettings`.
- Helper waits for either Show menu or Hide menu, allowing already-open navigation.
- After changing to 320px, waits for the previous Login devices section to disappear, then reopens settings through real navigation.
- Accommodates the observed responsive shell lifecycle; does not assert that closing the dialog is intended product behavior.
- Original line-73 timeout and remount diagnosis accepted from `tester.md`; not rerun unchanged to reproduce.
- Optional browser/unit import cleanup not needed: targeted ESLint returned no warnings; those files unchanged.

## Runtime provenance
- Linux x64; Chromium `151.0.7922.173`; Docker; isolated real SQLite authentication fixture.
- Existing production-test image reused, not rebuilt (`E2E_SKIP_BUILD=1`).
- Image ID: `bbfdc352e944333216549c22604c419b65d254a74d031fe0dec38d0a620d4845`.
- Image source label and final capture source fingerprint both:
  `4e78d8c85b0d02ec103138cb12fef244f70798e114db41dabfdd5b12f87a1a8b`.
- Identity command: `docker image inspect dam-hopper:production-test --format '{{.Id}} {{index .Config.Labels "dam-hopper.source-fingerprint"}}'`.

## Exact commands and actual results
Commands run from repository root; terminal results below, no invented deadline.

```sh
env CONTAINER_ENGINE=docker E2E_SKIP_BUILD=1 E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e device-login-management/device-login-management.spec.ts
```
- Initial scoped repair: **1 passed**, 8.4s Playwright / 9.12s wall.
- An intermediate extra readiness assertion incorrectly required only Show menu: **1 failed**, 17.95s wall.
- Failure: `expect(locator('button[title="Show menu"]').first()).toBeVisible()`; element absent after 10s.
- Actual failure context showed banner button **Hide menu** and server controls: navigation was already open, not a feature failure.
- Corrected helper to wait for either valid toggle state; removed the Show-menu-only assertion.
- Final targeted run: **1 passed**, 7.8s Playwright; final capture published successfully.
- Intermediate failure context was read from `packages/ui/test-results/device-login-management-de-37f05-ll-app-at-desktop-and-320px-chromium/error-context.md`; subsequent runs replace test-results. Failure details retained above.

```sh
pnpm --filter @dam-hopper/ui test:e2e:typecheck
pnpm --filter @dam-hopper/ui exec eslint e2e/device-login-management/device-login-management.spec.ts browser-tests/login-devices.browser.tsx src/components/organisms/LoginDevicesSection.test.tsx
```
- Both exited **0**, including after final helper correction; ESLint emitted no output/warnings.
- Final targeted E2E, then typecheck, then ESLint ran with `&&`; combined wall time **10.91s**.

```sh
env CONTAINER_ENGINE=docker E2E_SKIP_BUILD=1 CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e
```
- First full run after scoped repair: **11 passed**, 117.12s wall.
- Final full run after corrected readiness guard: **11 passed**, 114.22s wall / 1.9m Playwright; **0 failed, 0 skipped**.
- Existing normal application discovery, one worker, no retries, no max-failure shortcut.
- Covers device login management, editor Git blame, Git conflict resolver, host auto-sleep, privacy blur, project plans dashboard, SQLite authentication, traditional-terminal agents (2 cases), worktree switching, contrast/font system.
- Fixture service-probe specs are excluded by existing normal application configuration; not represented as executed application tests.
- Observed non-failing warning: NO_COLOR ignored because FORCE_COLOR set.

## Exercised feature behavior
- Real MFA enrollment creates sibling login with long untrusted user-agent hint; current seed login has legacy fallback.
- Inventory contains two same-account sessions and exactly one current marker; foreign session absent and foreign DELETE returns 404.
- Real settings show current marker, Unknown browser/client, and literal script-looking text without a script element.
- Cancel revoke preserves sibling authorization (HTTP 200).
- Desktop and 320px settings reopened successfully; section/document horizontal-overflow assertions passed.
- Narrow other-revoke confirmation receives focus and both actions fit viewport.
- Revoke acknowledgment removes sibling row; sibling HTTP becomes 401; current and foreign logins remain HTTP 200.
- Self-revoke warning shown; successful self-revoke changes saved profile to logged-out state and current HTTP becomes 401; foreign remains 200.

## Final captured artifacts and actual inspection
All artifacts beside spec in `packages/ui/e2e/device-login-management/`:
- `desktop-login-devices.png` — 1440x900; account-wide explanation, wrapped literal hint, login/expiry labels and revoke action visible. Current marker is outside this screenshot's shown list portion; functional assertion verified it separately.
- `narrow-login-devices.png` — 320x667; long hint wraps within bounded vertical list, no horizontal spill. The long row's revoke button is below visible list portion; later real click succeeds through scrolling, not established by this image alone.
- `narrow-self-revoke-confirmation.png` — 320x667; warning readable, Cancel and Revoke access fully visible.
- All three actual final PNGs inspected with image read tool; automated inspection is not human acceptance.
- `evidence.json`: run `e2e-run-1792617976750-1d0f9305`, functional **passed**, cleanup **passed**.
- Capture interval: `2026-10-21T21:26:16.750Z` through `2026-10-21T21:26:22.097Z` (UTC).
- Desktop SHA-256: `850847be38ae730471b4cf473b5689add419b4fc9350d710f8d92b1e619ef236`.
- Narrow-list SHA-256: `5fb8ec7364c497ca7a2f3b0bb60183fad8b626e451bc5e891b68d4374232238c`.
- Self-confirm SHA-256: `a6331d3c74132b69dff7d7ad463c8b25736e867edc949da954c8f0e7a878b1ab`.
- `review.md`: **PENDING_HUMAN_REVIEW**, Outcome **PENDING**; left unchanged by agent.

## Qualification boundary / unresolved questions
- No production feature bug observed in this journey; intermediate failure was an incorrect test-readiness assumption.
- Human visual approval and parent's interactive browser review remain outstanding, not fabricated.
- No claims here about live WS/SSE/media cutoff, cookie replacement races, paging beyond two rows, or other profile-fencing permutations; separate parent/peer validation owns them.
- Advisor reviewed final correction and terminal evidence; no further code changes recommended.
- Unresolved product questions: none for this scoped assignment.
