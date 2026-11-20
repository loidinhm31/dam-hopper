# Phase 05 Qualification & Evidence Report — PR #87 DevTools Security & Isolation

**Date:** 2026-11-19
**Plan:** [`plan.md`](../plan.md) · [`phase-05-regressions-qualification-docs.md`](../phase-05-regressions-qualification-docs.md)
**Branch Base:** `feat/browser-enhancement` (`fd7c49532`)
**Scope:** Linux x86_64 native Chromium qualification (no Windows, physical Android, or performance parity claims; raw `/api/browser/cdp/*` remains an explicit privileged exception outside cooperative viewer control).

---

## 1. Environment & Binary Versions

| Component | Observed Value |
| --- | --- |
| Node.js | `v26.13.1` |
| pnpm | `12.18.0` |
| Rust toolchain | `rustc 1.99.1 (58cf8f9c3 2026-10-13)` |
| Chromium binary | `/usr/bin/chromium` -> `Chromium 156.0.8078.79 built on Debian GNU/Linux 13 (trixie)` |
| Web build heap setting | `NODE_OPTIONS="--max-old-space-size=4096"` (default 2 GB V8 heap OOMs during `@dam-hopper/web` Vite bundle) |

---

## 2. Qualification Deliverables Added

1. [`server/tests/browser_host_devtools.rs`](../../../server/tests/browser_host_devtools.rs)
   - Added `omit_keydown_reply` support to `ProgrammableCdpBehavior` / `spawn_programmable_cdp_server`, `connect_paired_viewer_ws`, and `drain_session_updated_downloads`.
   - Expanded `test_real_chromium_devtools_worker_oopif_and_service_worker_isolation` with live held `MessagePort` in `/b-sw.js`, cookies/`localStorage` on `/b-page`, complete `ServiceWorker.*` method denial/suppression, and analogous nonlocal inventory (`Storage.*`, `BackgroundService.*`, cookie/cache `Network.*`, `Browser.*`) on root and owned child sessions.
   - Added `test_real_chromium_f1_confinement_and_two_tab_nested_oopif_attribution` (real Chromium F1 confinement, cross-origin OOPIF reload + same-origin navigation download GUID attribution across two tabs).
   - Added `test_real_chromium_two_viewer_devtools_transfer_and_native_held_input_release` (two viewers transferring control & DevTools mint authority, releasing native held keyboard/mouse state cleanly).
   - Added `test_devtools_stalled_write_omits_reply_keeps_control_unavailable` (deterministic stalled-write / omitted-reply failure injection ensuring no synthetic ACK/availability leak).
2. [`packages/ui/e2e/fixtures/host-browser-app.ts`](../../../packages/ui/e2e/fixtures/host-browser-app.ts) & [`packages/ui/e2e/fixtures/host-browser-journey-target.ts`](../../../packages/ui/e2e/fixtures/host-browser-journey-target.ts)
   - Added isolated per-run `downloadDir`, `sentinelDir` (`0o700`), `XDG_DOWNLOAD_DIR` server env wiring, `allowLocalhostTarget?: boolean`, and fixture routes (`/devtools-sec`, `/sec-worker.js`, `/sec-sw.js`, `/sec-network-probe`, `/sec-payload.bin`, `/sec-oopif-payload.bin`, `/sec-oopif`).
   - Verified temporary E2E directories clean up cleanly on `app.cleanup()` without stray Chromium processes or leftover sentinel files.
3. [`packages/ui/e2e/os-host-browser/devtools-security.spec.ts`](../../../packages/ui/e2e/os-host-browser/devtools-security.spec.ts)
   - Covers real production SPA + Rust server + MongoDB Chromium E2E across DevTools control-holder gating (no auto-steal), Console/Elements/Network/Issues live panels, canvas input + isolated download banner + sentinel immutability, F1/R1/nonlocal DevTools WS probes (`-32601`), worker/OOPIF coexistence, Tab B SW `MessagePort`/cookies/`localStorage` preservation, Cognito privacy mask (`Control+Alt+b`), minimize/restore keep-alive, tab switch, reload remint (`401` old / `200` new), explicit control release (`401`), and `POST /api/auth/logout` revocation (`401`).
4. Maintained Docs Reconciled:
   - [`docs/api/browser-host.md`](../../../docs/api/browser-host.md) (including correcting `POST /api/browser/sessions/{id}/control/release` to documented `200 OK` `{ "status": "released" }`, plus Phase 05 coverage & privileged `/api/browser/cdp/*` exception)
   - [`docs/api-reference.md`](../../../docs/api-reference.md)
   - [`docs/architecture/host-browser-cdp-streaming.md`](../../../docs/architecture/host-browser-cdp-streaming.md)
   - [`docs/system-architecture.md`](../../../docs/system-architecture.md)
   - [`docs/project-roadmap.md`](../../../docs/project-roadmap.md)

---

## 3. Command Ledger & Observed Results

| Suite / Command | Exit | Observed Count / Outcome | Notes |
| --- | --- | --- | --- |
| `cargo check --manifest-path server/Cargo.toml --features vendored --tests` | `0` | Clean compile (`0` errors) | Post-test-edit check |
| `DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium DAM_HOPPER_REQUIRE_BROWSER=1 cargo test --manifest-path server/Cargo.toml --features vendored --lib browser_host::` | `0` | `230 passed; 0 failed; 0 ignored` | Includes `devtools_filter::tests`, `target_ownership::tests`, `devtools::tests`, `input::tests` |
| `... cargo test ... --test browser_host_adapter --test browser_host_auth --test browser_host_devtools --test browser_host_gateway --test browser_host_input --test browser_host_logout --test browser_host_media --test browser_host_selection -- --test-threads=1` | `101` (stopped on `media`) | `adapter`: `21/21`<br>`auth`: `12/12`<br>`devtools`: `13/13`<br>`gateway`: `19/19`<br>`input`: `59/59`<br>`logout`: `12/12`<br>`media`: `31 passed; 1 failed` | Failure is pre-existing unrelated `test_real_chromium_media_stealth_and_pcm_audio_bridge` at `server/tests/browser_host_media.rs:1337:10` (`ScreencastProducer must emit nested cross-origin grandchild audio via 2-hop postMessage relay: Elapsed(())`) |
| `DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium DAM_HOPPER_REQUIRE_BROWSER=1 cargo test --manifest-path server/Cargo.toml --features vendored --test browser_host_selection -- --test-threads=1` | `0` | `30 passed; 0 failed; 0 ignored` | Re-invoked directly after `browser_host_media` halted combined run |
| `pnpm --filter @dam-hopper/ui test src/api/browser-host-client.test.ts src/os/browser/browser-devtools-dock.test.tsx src/os/apps/BrowserApp.test.tsx` | `0` | `3 passed (3)` files, `56 passed (56)` tests | UI DevTools client, dock, control-required gate, and app lifecycle |
| `pnpm --filter @dam-hopper/ui build` | `0` | Clean production UI build | Ran after fixture/spec edits |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | `0` | Clean TypeScript check | Covers `devtools-security.spec.ts` and fixtures |
| `NODE_OPTIONS="--max-old-space-size=4096" DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium BROWSER_EXECUTABLE_PATH=/usr/bin/chromium pnpm --filter @dam-hopper/ui test:e2e e2e/os-host-browser/devtools-security.spec.ts --project=chromium --workers=1` | `0` | `2 passed (51.1s)` | Post-review re-run (after initial `55.4s` pass and review-fix cleanup) against production server/Mongo + Chromium `156.0.8078.79`; `browser_host_devtools` (`13/13`) and `tsc -p tsconfig.e2e.json` (`0`) also re-verified post-fix |

---

## 4. Matrix Coverage Oracle (Phase 05 -> Observed Tests)

| Area | Oracle / Assertion Proven | Evidence Location |
| --- | --- | --- |
| Non-holder gating & no auto-steal | `browser-devtools-control-required` rendered for viewer without control; 0 `/devtools` mint calls before explicit acquire | `devtools-security.spec.ts` Test 1 |
| Two-viewer control & DevTools transfer | Control transfer mints for new holder, revokes prior DevTools WS, releases native held inputs | `browser_host_devtools::test_real_chromium_two_viewer_devtools_transfer_and_native_held_input_release` |
| Positive F1 target/session confinement | Owned root, OOPIF, dedicated worker allowed; foreign tab, `ServiceWorker.*`, `Storage.*`, `BackgroundService.*`, `Browser.*`, cookie `Network.*`, `Page.setDownloadBehavior`, `Target.getTargets`, `setDiscoverTargets` rejected `-32601`; sentinel untouched | `browser_host_devtools::{test_real_chromium_devtools_worker_oopif_and_service_worker_isolation,test_real_chromium_f1_confinement_and_two_tab_nested_oopif_attribution}`, `devtools-security.spec.ts` Test 1 |
| Sibling tab SW / storage / cookie isolation | Tab B's `/b-sw.js` & `/sec-sw.js` held `MessagePort`, cookies, and `localStorage` survive DevTools F1/R1 probes untouched | `browser_host_devtools` + `devtools-security.spec.ts` Test 1 |
| Real DevTools UI panels & canvas input | Docked DevTools Console, Elements, Network (`status: 200` probe), Issues, plus live canvas key/mouse/scroll & isolated `XDG_DOWNLOAD_DIR` download | `devtools-security.spec.ts` Test 1, `browser_host_input` (59/59) |
| GUID-pinned multi-tab / OOPIF downloads | Nested OOPIF + same-origin downloads attributed strictly by `(page_sid, frameId, guid)` without cross-tab mixup | `browser_host_devtools::test_real_chromium_f1_confinement_and_two_tab_nested_oopif_attribution` |
| Stalled write / omitted reply | Dropped/stalled CDP reply leaves held input/control unreleased safely without fake success | `browser_host_devtools::test_devtools_stalled_write_omits_reply_keeps_control_unavailable` |
| Reload remint, privacy, minimize, release, logout | Reload mints new token and revokes old (`401`); Cognito & minimize unmount/revoke cleanly; explicit release -> `401` + gate; `POST /api/auth/logout` -> `401` | `devtools-security.spec.ts` Test 2, `browser_host_logout` (12/12) |

---

## 5. Known Limits & Open Items

- **Unrelated Failure Retained in Ledger:** `browser_host_media::test_real_chromium_media_stealth_and_pcm_audio_bridge` timed out on 2-hop cross-origin grandchild audio relay (`tests/browser_host_media.rs:1337`); unrelated to PR #87 DevTools changes.
- **Privileged Raw CDP Boundary:** `/api/browser/cdp/*` remains an intentionally privileged instance-wide admin/automation endpoint outside cooperative viewer control (used in `devtools-security.spec.ts` out-of-band `rawCdpEval` harness to seed SW/storage and trigger test downloads without Playwright `connectOverCDP` overriding `XDG_DOWNLOAD_DIR`).
- **Platform Scope:** Qualified on Linux x86_64 with Chromium `156.0.8078.79` only; Windows containment stays fail-closed, and no Windows, Android hardware, or performance parity is claimed.
