# Phase 08 code review

## 1. Score
**5/10 — changes requested.** Good immutable artifact classes, ordinary-owner Cooperative preservation, explicit Cancel-first logout, terminal-incarnation writes, and real-SPA coverage. Security/lifecycle interleavings and required reset UI remain incomplete. Review is source analysis; race outcomes below are [INFERENCE], not reproduced executions. No source/tests/plan state changed.

Authority: `plans/261108-0237-host-browser-cdp-streaming/architecture-contracts.md:142-165`, bounded-resource table at lines 24-48; phase requirements/steps at `phase-08-selection-credential-reset.md:76-140`.

## 2. Critical issues
- **C1 — Sensitive input logging.** `server/src/browser_host/media.rs:900` logs `?msg.event`; `InputEvent::InsertText.text` and `KeyDown.key` contain passwords, pasted tokens and other typed secrets (`server/src/browser_host/input.rs:71-82`). Enabling debug logging persists these values. Remove payload logging; log only a non-sensitive event kind/counter. High confidence.

## 3. Warnings
- **W1 / High — Reset deadline starts after blocking teardown.** `server/src/browser_host/manager.rs:768-794,1032` awaits the fence callback before spawning the independent worker and before starting its 2s response timer. The callback awaits producer shutdown (`server/src/api/browser_host.rs:1360-1362`), which awaits CDP stop/close (`server/src/browser_host/media.rs:68-72`). A stalled browser exceeds the post-intent response bound; cancelling the request here leaves durable intent without an active worker. Move the committed operation, including bounded teardown, into manager-owned work before any post-intent await; separate direct cancellation from network cleanup. Existing slow-cleanup test injects delay only after this boundary (`server/tests/browser_host_logout.rs:704-707`).
- **W2 / High — Destructive role check outside principal lock.** `server/src/api/auth.rs:845-887` checks enabled Admin before entering the manager; dedicated reset authenticates at `server/src/api/browser_host.rs:1397-1407` before entering it. `server/src/browser_host/manager.rs:690-754` can wait for the instance/profile lock and then commits intent without a current-role recheck. Demotion/disable while queued can still authorize deletion. Recheck enabled Admin under the principal lock immediately before intent, using the pre-revocation receipt for logout rather than revalidating its deliberately revoked session.
- **W3 / High — Late managed creation can survive reset/navigation.** `server/src/browser_debug/store.rs:170-190` awaits disk creation then inserts metadata without admission/epoch/reservation revalidation. `server/src/browser_host/selection.rs:549-575,640-645` neither rechecks after JSON creation nor requires a surviving selection entry; `includePng:false` bypasses the later checks entirely. Reset/navigation during the write can finish cleanup before the old JSON/entry is published. Add a revocable creation reservation and completion check for admission/profile/session/navigation/selection/terminal; discard files on invalid completion.
- **W4 / High — Handoff claim is not atomic with reset/navigation.** `server/src/browser_debug/store.rs:397-440` releases authorization/store locks before `server/src/api/browser_debug.rs:127-131` writes to the PTY. Managed metadata has no session/navigation/selection revision binding (`store.rs:31-37,60-69`). Navigation cleanup cannot invalidate a claimed artifact because `delete` rejects it (`store.rs:362-364`). Reset/demotion/navigation after the check can therefore still permit stale reference bytes. Fence claim plus final Browser-state checks plus `write_if_incarnation` against reset/navigation; invalidate outstanding claims, not only entries.
- **W5 / High — Storage ceilings are check-then-act races.** `server/src/browser_debug/store.rs:145-166,208-215,266` reads entry/byte usage separately from reservation and publication. Concurrent creates can all observe fewer than 64 records; concurrent JSON/PNG writes can all pass the 64MiB check. Reserve record slots and bytes atomically before I/O, with rollback on cancellation/error. `server/src/browser_debug/tests.rs:456-474` exercises one tiny artifact, not either ceiling or concurrent admission.
- **W6 / High — Late logout disconnects replacement owner.** `packages/ui/src/components/organisms/ServerProfilesDialog.tsx:852-864` and `ServerSettingsDialog.tsx:1242-1259` guard token clearing but unconditionally disconnect the captured profile ID; Settings also clears current form state. `AccountLogoutTarget` carries no generation (`ServerProfilesDialog.tsx:53-60`), and completion calls the callback before checking dialog session currency (`:262-263`). If a replacement login/connection/profile is installed while logout is in flight, the old completion mutates it. Capture/recheck profile URL, token and generation before all local mutations; retire only the original connection.
- **W7 / High — Required reset-only/status UI absent.** `packages/ui/src/api/browser-host-client.ts:538-644` exports reset/status functions, but bounded search of `packages/ui/src` finds no production callers. `ServerProfilesDialog.tsx:425-438` offers reauthentication only; Settings' callback at `ServerSettingsDialog.tsx:1273-1275` merely closes the dialog. There is no reachable confirmed reset preserving login, nor reauthenticated pending-status/retry flow. Implement the phase step at `phase-08-selection-credential-reset.md:133`; remove duplicate unused origin APIs if not needed. Local removal at `ServerProfilesDialog.tsx:884-895` also lacks the required separate logout choices before removal.
- **W8 / High — Second CDP implementation bypasses established limits.** `server/src/browser_host/selection.rs:956-1041` opens an independent default-config WebSocket and reimplements command IDs, pending calls, writer and event queues instead of reusing the bounded CDP actor. It has no shared byte reservation or explicit 4MiB ingress limit, and queues 32 arbitrary JSON events. Extraction returns unbounded attribute/role/name strings (`:45-54,88-94`) before Rust truncation. Reuse the existing actor/event path and bound extraction before serialization/allocation; do not establish a second transport convention.
- **W9 / Medium — Revocation failure can be presented as successful logout.** `server/src/api/auth.rs:770-773` records revocation failure only locally; payload remains `ok:true` (`:784-790`) and an admitted keep-data request can return retained/cleared (`:812-829`). The UI then claims the server login was revoked (`packages/ui/src/components/organisms/ServerProfilesDialog.tsx:84-113`). Preserve HTTP 200 compatibility, but explicitly return uncertain/failed remote revocation and render it truthfully; never infer auth revocation from Browser reset state.
- **W10 / Medium — Native navigation coverage incomplete.** `server/src/browser_host/selection.rs:1089-1094` handles only `Page.frameNavigated`, not same-document navigation, and increments only selection-local revision. Direct inspect-point flow returns before installing any observer (`:317-332`). Subsequent native navigation can leave selection state stale; the one-shot observer also drops all navigation events when its 32-event queue is full (`:1035`). Bind invalidation to the authoritative target navigation lifecycle, include same-document changes, and treat lost lifecycle events as invalidation/failure rather than silent drops.

## 4. Suggestions
1. Fix C1 and High findings before Phase 09; retain current no-default-choice/ordinary-owner behavior.
2. Add deterministic barriers for in-flight create/upload/handoff versus reset/navigation/demotion, queued reset versus role change, and logout versus replacement generation. Test a stalled real CDP teardown rather than only post-fence simulated delay.
3. Exercise actual concurrent quota exhaustion, same-document navigation, reset-only/re-authenticated status UI, and auth-store revoke failure. Current sequential tests do not establish these contracts.
4. KISS/DRY: reuse the owner-bound client request machinery and bounded CDP actor; eliminate unused reset API variants and duplicate numeric parsers as part of the necessary fixes, not an unrelated refactor.

## 5. Reviewed files
Git diff plus new files; relevant supporting code/contracts inspected. All 34 requested files:

- `server/src/browser_debug/mod.rs`
- `server/src/browser_debug/store.rs`
- `server/src/browser_debug/tests.rs`
- `server/src/api/browser_debug.rs`
- `server/src/browser_host/selection.rs`
- `server/src/browser_host/mod.rs`
- `server/src/browser_host/manager.rs`
- `server/src/browser_host/attachments.rs`
- `server/src/browser_host/media.rs`
- `server/src/api/browser_host.rs`
- `server/src/api/auth.rs`
- `server/src/api/router.rs`
- `server/src/state.rs`
- `server/tests/browser_debug_artifacts.rs`
- `server/tests/browser_host_selection.rs`
- `server/tests/browser_host_logout.rs`
- `server/tests/auth_device_sessions.rs`
- `packages/ui/src/api/auth-types.ts`
- `packages/ui/src/api/auth-client.ts`
- `packages/ui/src/api/auth-client.test.ts`
- `packages/ui/src/api/browser-host-client.ts`
- `packages/ui/src/browser-host/selection-controller.ts`
- `packages/ui/src/browser-host/stream-controller.ts`
- `packages/ui/src/browser-host/stream-controller.test.ts`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/src/hooks/use-browser-debug.ts`
- `packages/ui/src/hooks/use-browser-debug.test.ts`
- `packages/ui/src/components/organisms/ServerProfilesDialog.tsx`
- `packages/ui/src/components/organisms/ServerSettingsDialog.tsx`
- `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`
- `packages/ui/src/components/organisms/ServerSettingsDialog.test.tsx`
- `packages/ui/browser-tests/host-browser-selection.browser.tsx`
- `packages/ui/browser-tests/host-browser-logout.browser.tsx`
- `packages/ui/e2e/os-host-browser/selection.spec.ts`

## 6. Validation commands/results
No checks rerun. Supplied results corroborated by `agent://Phase08TesterRetest` terminal report: **18/18 commands passed; 410 executions / 398 distinct tests; 0 failed/skipped; ESLint 0 errors/warnings.**

| Command family (each target/filter separate) | Result |
|---|---|
| `cargo test --manifest-path server/Cargo.toml --test <target> -- --nocapture`: browser_debug_artifacts, browser_host_selection, browser_host_logout, auth_device_sessions, browser_host_lifecycle | 7, 4, 4, 6, 10 passed |
| `cargo test --manifest-path server/Cargo.toml --lib <filter>`: browser_debug, browser_host, auth, api::tests | 9, 26, 47, 155 passed; 12 overlapping tests |
| `pnpm --filter @dam-hopper/ui build` | tsc pass |
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | pass |
| `pnpm --filter @dam-hopper/ui exec vitest run` (8 selected unit files) | 106 passed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts` (5 selected browser files) | 16 passed |
| `pnpm --filter @dam-hopper/ui test:e2e os-host-browser/selection.spec.ts` | 1 passed |
| `pnpm --filter @dam-hopper/browser-bridge test` | 19 passed |
| `pnpm --filter @dam-hopper/browser-extension typecheck` | pass |
| `pnpm exec eslint` (17 selected files) | 0 errors/warnings |
| `pnpm --filter @dam-hopper/web build` | pass |

Pre-existing Rust warnings and Vite chunking notices remain per tester evidence. No new type/test coverage percentage inferred. Plan task state left to Main; findings prevent claiming all acceptance complete.

## 7. Unresolved questions
None requiring user decisions. Listed interleavings, failure cases and missing UI need implementation-owner correction and focused verification; no runtime reproduction claimed by this reviewer.
