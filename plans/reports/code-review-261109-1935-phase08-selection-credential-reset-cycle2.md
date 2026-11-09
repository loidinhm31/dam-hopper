# Phase 08 — Cycle 2 code review

## Score
**6/10 — changes requested.** Material improvements; not all Cycle 1 findings or Phase 08 acceptance criteria are resolved. No critical finding identified; eight High warnings below. Passing tests do not cover the remaining cancellation/ordering/owner-replacement cases.

Review is direct working-tree/diff/source analysis. Race consequences are **[INFERENCE]**, not reviewer-reproduced executions. No implementation, tests, plan status or task state changed; this report is the only authored file.

## Scope and evidence
- Inspected `git status --short`, `git diff --stat`, and direct `git diff --` across all tracked modified `server/` and `packages/ui/` files; read new selection, logout, browser-test and E2E files separately. Initial status: 31 modified, 9 untracked, none staged.
- Loaded code-review skill, development rules, README, PDR, code standards, phase overview/requirements and architecture contracts §§10–11/resource ceilings.
- Inspected `agent://Phase08TesterFinal` and its command history. Raw Rust result outputs independently read: `artifact://253`, `artifact://258`, `artifact://266`. No checks rerun.
- Approximately 9,000 source/test lines inspected in selected ranges, plus diffs/contracts. Not an exhaustive review of unrelated prior-phase carryovers.

## Critical issues
None identified in this review. Cycle 1 C1 input-payload logging is removed.

## Warnings

### R1 / High — Post-intent work still precedes worker ownership and the response deadline (Cycle 1 W1 partial)
**Evidence:** `server/src/browser_host/manager.rs:817-844,1085`; `server/src/api/browser_host.rs:1365-1372`; `server/src/browser_debug/store.rs:584,820-821,947-959`.

Manager still awaits `sync_cb()` after durable intent, before registering/spawning its worker and starting the 2s timer. Despite its name, the callback awaits artifact file deletion via `spawn_blocking`, as well as async locks. Slow deletion/blocking-pool contention can exceed the response bound; dropping the request there leaves intent without the manager-owned worker. The stalled-CDP test addresses the moved network teardown, not this remaining boundary.

**Correction:** Establish cancellation-independent manager ownership immediately after intent; separate the non-I/O invalidation fence from file cleanup, and include all post-intent work in the deadline/worker lifecycle. Keep artifact cleanup ordered before profile deletion. **Confidence: high; stalled-I/O/cancellation outcome [INFERENCE].**

### R2 / High — Handoff lock does not serialize Browser invalidation with the final PTY write (Cycle 1 W4 partial)
**Evidence:** `server/src/browser_debug/store.rs:609-633,659-665,784-786`; `server/src/state.rs:700-718`; `server/src/browser_host/selection.rs:507-535`.

`execute_handoff` checks live Browser/selection state, releases those locks, then awaits the artifact-entry write lock. Navigation can clear the selection or advance the session revision during that gap, before waiting for artifact cleanup. A previously queued handoff can acquire the entry lock first and write stale reference bytes. Holding only the artifact lock around `write_if_incarnation` solves terminal replacement, not navigation/reset fencing; reset's generation increment also occurs later during artifact revocation, not at intent.

**Correction:** Use one ordered Browser-selection/reset fence or revocable guard spanning final current-state validation and the synchronous incarnation-checked write. Add a deterministic barrier between the current check and entry-lock acquisition, then invalidate before releasing it. **Confidence: high; race execution [INFERENCE].**

### R3 / High — Quota and upload reservations remain cancellation-unsafe (Cycle 1 W5 partial; W3 cancellation gap)
**Evidence:** `server/src/browser_debug/store.rs:309-319,411,447-459,869-872,919-939`.

Atomic admission counters fix concurrent check-then-act oversubscription, but reservations are plain counters/flags with cleanup only on normal return paths. Dropping create after slot reservation leaks a record/bytes; its detached blocking write can publish a file with no metadata/TTL cleanup. Dropping upload can permanently leave `png_uploading=true`, extra-byte accounting and an untracked PNG. Repeated cancelled creates can exhaust the global 64 slots even though no entries exist.

**Correction:** Give reservations cancellation-safe ownership, with rollback and tracking/cleanup of disk publication even when the waiting request disappears. Do not release a reservation while its detached blocking write can still publish. Add abort-during-write tests, not only concurrent successful calls. **Confidence: high; cancellation consequences [INFERENCE].**

### R4 / High — New reset-only callbacks can fence a replacement profile generation (new regression)
**Evidence:** `packages/ui/src/components/organisms/ServerSettingsDialog.tsx:1024-1053,1088-1116`; `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx:75-93`.

Standalone reset/status capture URL, profile ID and token but never capture/recheck connection generation or token ownership. Post-await guards compare only URL and the `profile` prop. Replacement login/reconnect at the same URL/profile therefore passes; a late reset/status response fences the *current* generation and clears its Browser window state. Close/reopen of the same profile also lacks an operation/session fence. Logout's new token/generation guards do not protect this new path.

**Correction:** Capture `{profileId, serverUrl, token, generation, dialogSession/requestId}` for preflight/reset/status and check it before every mutation/finally update. Retire only the captured generation. **Confidence: high; late-response effect [INFERENCE].**

### R5 / High — Reachable status UI cannot retry a failed durable reset (Cycle 1 W7 partial)
**Evidence:** `packages/ui/src/components/organisms/ServerSettingsDialog.tsx:1027,1055-1067,1085-1116,1415-1449`; `server/src/browser_host/manager.rs:761-775`.

Status/reset-only controls now exist, but every confirmed reset generates a new operation ID. A failed tombstone must be resumed with its original ID; the manager rejects a different ID. The UI's only recovery actions are Check status and Reset Browser data now, so after transient kill/delete failure the latter returns conflict forever rather than resuming. The new operation ID is also not retained on timeout, preventing status reconciliation of a possibly accepted reset.

**Correction:** Preserve operation identity before dispatch; expose explicit confirmed resume/retry of the existing pending operation using that same ID. On uncertain response, offer authenticated status reconciliation without claiming deletion. **Confidence: high; failure-path UI behavior [INFERENCE].**

### R6 / High — Shared actor now retains an unbudgeted 64-event payload backlog (Cycle 1 W8 partial)
**Evidence:** `server/src/browser_host/cdp.rs:252,587-604`; `server/src/browser_host/selection.rs:1042-1056,1114-1160`; `plans/261108-0237-host-browser-cdp-streaming/architecture-contracts.md:29-31,47`.

The second WebSocket implementation is correctly gone, but its replacement broadcasts up to 64 complete arbitrary `params` Values. Each accepted ingress message can approach 4MiB, while the observer awaits several commands before receiving again. No field projection, byte reservation or shared global budget covers retained event values. A count cap is not the mandatory one-current-event/no-backlog or 128MiB payload ceiling; a full queue can retain roughly 256MiB serialized-equivalent payload before JSON heap overhead.

**Correction:** Project only small validated lifecycle/inspect fields before retention, enforce byte/global reservations, and fail closed on lifecycle overflow rather than queueing arbitrary Values. Preserve the existing lag-invalidates behavior. **Confidence: high; peak retention [INFERENCE].**

### R7 / High — Native navigation advances server revision but never reaches the mounted selection UI (Cycle 1 W10 partial)
**Evidence:** `server/src/browser_host/selection.rs:1093-1109`; `packages/ui/src/browser-host/selection-controller.ts:546-570,618-621`; `packages/ui/src/os/apps/BrowserApp.tsx:173-175,343-349`.

Server observers now cover direct inspect and same-document navigation, but polling stops immediately after receiving a preview. BrowserApp keeps its revision only in window `appState`, with no native-navigation synchronization path. After native navigation the server clears the selection/advances revision while the visible preview/prepared artifact stays stale; the next Select sends the old revision and is rejected. Even the polling mismatch branch clears preview without adopting the current revision. The new Rust test reads the server DTO, not the mounted SPA's recovery.

**Correction:** Feed authoritative target navigation state to the owner-bound window/controller throughout the preview/prepared lifetime, invalidate local artifacts and adopt the new revision. Keep native lifecycle observation independent of a one-shot picker; avoid double advancement for API-originated navigation. Add a mounted-SPA select → native pushState/link → select-again regression. **Confidence: high; end-user sequence [INFERENCE].**

### R8 / High — Logout still transmits Bearer credentials over non-loopback HTTP (inherited exposure in the reviewed flow)
**Evidence:** `packages/ui/src/components/organisms/ServerProfilesDialog.tsx:246-251`; `packages/ui/src/api/media-session.ts:152-166`; `packages/ui/src/components/organisms/ServerSettingsDialog.test.tsx:248-306`.

The shared logout dialog calls media-session revocation with the raw token before the secure logout client. That helper accepts any HTTP URL and sends `Authorization: Bearer ...`; the updated test explicitly expects the leak to `http://insecure.test`. Protecting only `/api/auth/logout` does not protect the preceding request. This exposure predates Cycle 2; it is not claimed as a newly introduced regression.

**Correction:** Apply the same HTTPS/loopback transport guard before every credential-bearing leg, including media revocation; unsafe/unreachable remote revocation must remain explicitly uncertain. Correct the test to assert no raw Bearer on either request. **Confidence: high; transmission established by source/test expectation, network interception not exercised.**

## Cycle 1 disposition
| Finding | Current assessment |
|---|---|
| C1 | Source-resolved: `media.rs:902-912` logs event kind, not typed text/key payload. |
| W1 | Partial: network teardown moved; R1 remains. |
| W2 | Source-resolved: role recheck now runs under principal lock at `manager.rs:735-745`; both production reset entrypoints supply it. |
| W3 | Normal completion improved: managed admission/selection/terminal checks and required registration at `store.rs:321-374`, `selection.rs:646-670`, including JSON-only flow. Cancellation gap R3 remains. |
| W4 | Partial: terminal write/claim serialized; Browser invalidation race R2 remains. |
| W5 | Partial: atomic counters and real concurrent ceiling tests added; cancellation ownership R3 remains. |
| W6 | Original late-logout token/generation overwrite addressed at `ServerProfilesDialog.tsx:874-903`, `ServerSettingsDialog.tsx:1684-1726`; analogous new reset-only regression R4. |
| W7 | Partial: standalone reset, status and local-removal logout-first now reachable; recovery contract R5 remains. |
| W8 | Partial: shared bounded CDP actor reused; retained event byte budget R6 remains. |
| W9 | Explicit auth-store revoke failures now surfaced independently of Browser outcome at `auth.rs:766-798` and `ServerProfilesDialog.tsx:90-95`. |
| W10 | Partial: server same-document/direct-inspect observer added and tested; end-to-end navigation synchronization R7 remains. |

## Phase 08 acceptance
| Criterion | Assessment |
|---|---|
| actor-bind-debug-artifacts | Ownership/source immutability, foreign 404 and Cooperative preservation implemented/tested; cancellation/final handoff fencing incomplete (R2–R3). |
| select-cdp-and-handoff | Real SPA PNG/reference/exact-terminal happy path and replaced-terminal refusal exercised by tester; native navigation recovery, atomic invalidation and event budgets incomplete (R2, R6–R7). |
| secure-profile-reset-logout | Revoke-first, confirmation/Origin/role/epoch guards, durable pending and reset-preserves-login present; post-intent ownership/deadline incomplete (R1). |
| migrate-account-logout-ui | Keep/clear/Cancel, local removal explanation/logout-first, reset/status controls present; generation-safe reset callbacks and failed-operation recovery incomplete (R4–R5); insecure media credential leg R8. |
| V1 no preselected logout choice | Source and supplied Chromium evidence support Cancel-first, initial Enter/Escape cancellation, no default/autofocused logout button. |
| No unredacted tokens/tickets/selection in logs | C1 removed; bounded search of touched Browser logging found no matching payload/token/ticket logging. This is not a whole-repository proof. R8 is a separate transport disclosure. |

## Suggestions / recommended actions
1. Resolve R1–R8 before calling Phase 08 technically accepted; retain existing owner/source, revoke-first and Cancel-first behavior.
2. Add deterministic cancellation/barrier tests for create/upload/handoff/reset, same-profile generation replacement during reset/status, and same-operation retry after injected failure. Existing quota success tests and sequential demotion/navigation tests are useful but insufficient for these windows.
3. KISS/DRY: move the shared account logout dialog out of the profile-list module; consolidate owner-captured request/auth construction rather than maintaining selection-specific fetch plumbing and unused owner-bound reset wrappers alongside origin variants. Remove unused `claim_handoff`/`release_handoff` production APIs if only tests need them; their comments still describe the superseded caller-managed write lifecycle.
4. Keep broader prior-phase platform/performance/human qualification separate. Do not convert 423 test executions into coverage percentage or full race-proof acceptance.

## Reviewed files
### Server changes
- `server/src/api/auth.rs`
- `server/src/api/browser_debug.rs`
- `server/src/api/browser_host.rs`
- `server/src/api/router.rs`
- `server/src/browser_debug/mod.rs`
- `server/src/browser_debug/store.rs`
- `server/src/browser_debug/tests.rs`
- `server/src/browser_host/attachments.rs`
- `server/src/browser_host/cdp.rs`
- `server/src/browser_host/manager.rs`
- `server/src/browser_host/media.rs`
- `server/src/browser_host/mod.rs`
- `server/src/browser_host/selection.rs`
- `server/src/browser_host/session.rs`
- `server/src/state.rs`
- `server/tests/auth_device_sessions.rs`
- `server/tests/browser_debug_artifacts.rs`
- `server/tests/browser_host_logout.rs`
- `server/tests/browser_host_selection.rs`

### UI changes
- `packages/ui/src/api/auth-client.ts`
- `packages/ui/src/api/auth-client.test.ts`
- `packages/ui/src/api/auth-types.ts`
- `packages/ui/src/api/browser-host-client.ts`
- `packages/ui/src/browser-host/selection-controller.ts`
- `packages/ui/src/browser-host/stream-controller.ts`
- `packages/ui/src/browser-host/stream-controller.test.ts`
- `packages/ui/src/components/organisms/ServerProfilesDialog.tsx`
- `packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx`
- `packages/ui/src/components/organisms/ServerSettingsDialog.tsx`
- `packages/ui/src/components/organisms/ServerSettingsDialog.test.tsx`
- `packages/ui/src/components/ui/ConfirmDialog.tsx`
- `packages/ui/src/hooks/use-browser-debug.ts`
- `packages/ui/src/hooks/use-browser-debug.test.ts`
- `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx`
- `packages/ui/src/os/apps/BrowserApp.tsx`
- `packages/ui/browser-tests/host-browser-logout.browser.tsx`
- `packages/ui/browser-tests/host-browser-selection.browser.tsx`
- `packages/ui/e2e/os-host-browser/selection.spec.ts`

Supporting reads: `server/src/browser_host/auth.rs`, `server/src/browser_host/input.rs`, `packages/ui/src/api/media-session.ts`, `packages/ui/src/lib/browser-terminal-handoff.ts`; README/PDR/standards, phase plan/overview/contracts and Cycle 1 report. Plans intentionally unchanged; task/status ownership remains Main's.

## Validation commands/results observed
**Reviewer executed only status/diff/date inspection; no tests/build/lint rerun.** The following are observed in **Phase08TesterFinal's terminal evidence**, not independently rerun claims. Its 18 commands passed with **423/423 executed tests**, zero failed/skipped/ignored.

| # | Command | Observed result |
|---|---|---|
| 1 | `cargo test --manifest-path server/Cargo.toml --test browser_debug_artifacts -- --nocapture` | 7 passed |
| 2 | `cargo test --manifest-path server/Cargo.toml --test browser_host_selection -- --nocapture` | 5 passed; raw output read |
| 3 | `cargo test --manifest-path server/Cargo.toml --test browser_host_logout -- --nocapture` | 7 passed; raw output read |
| 4 | `cargo test --manifest-path server/Cargo.toml --test auth_device_sessions -- --nocapture` | 6 passed |
| 5 | `cargo test --manifest-path server/Cargo.toml --test browser_host_lifecycle -- --nocapture` | 10 passed |
| 6 | `cargo test --manifest-path server/Cargo.toml --lib browser_debug` | 12 passed; raw output read |
| 7 | `cargo test --manifest-path server/Cargo.toml --lib browser_host` | 26 passed |
| 8 | `cargo test --manifest-path server/Cargo.toml --lib auth` | 47 passed |
| 9 | `cargo test --manifest-path server/Cargo.toml --lib api::tests` | 155 passed |
| 10 | `pnpm --filter @dam-hopper/ui build` | typecheck exit 0 |
| 11 | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | exit 0 |
| 12 | `pnpm --filter @dam-hopper/ui exec vitest run` with eight selected unit files | 110 passed |
| 13 | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts` with five selected browser files | 18 passed |
| 14 | `pnpm --filter @dam-hopper/ui test:e2e os-host-browser/selection.spec.ts` | 1 passed |
| 15 | `pnpm --filter @dam-hopper/browser-bridge test` | 19 passed |
| 16 | `pnpm --filter @dam-hopper/browser-extension typecheck` | exit 0 |
| 17 | `pnpm exec eslint` with 15 selected Phase 08 files | exit 0; 0 errors/warnings |
| 18 | `pnpm --filter @dam-hopper/web build` | exit 0 |

Unit selection: auth-client, browser-host-client, use-browser-debug, stream-controller, ServerProfilesDialog, ServerSettingsDialog, ServerSettingsDialogMfa, login-devices-connections. Browser selection: host-browser-selection, host-browser-logout, browser-debug-panel, browser-debug-keep-alive, host-browser-lifecycle. Exact command arguments preserved in `history://Phase08TesterFinal:22-27`.

Non-fatal tester observations: pre-existing Rust warnings (11 lib / 12 lib-test), Vite static/dynamic-import notices for DiffViewer/ConfigEditor, Node NO_COLOR/FORCE_COLOR notice. Coverage percentages unavailable; not inferred.

## Unresolved questions
No user decision required. Remaining uncertainty is execution proof for the explicitly marked race/failure sequences; targeted regression tests are needed after correction. Fresh passing test evidence does not resolve those unexercised cases.
