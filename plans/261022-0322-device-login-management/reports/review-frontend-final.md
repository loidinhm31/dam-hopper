# Frontend final approval review — device login management (round 2)

Read-only. Static code trace of working tree + inspection of tests/report artifacts. No tests/builds/lint/formatters run, no source edits. Claims labelled **[TRACE]** = from code reading; test results quoted from `review-fixes-validation.md` and parent (not re-run by me).

## Verdict: **APPROVED** (frontend). No Critical/High/Medium blockers. 2 Low residuals (narrow races, no credential leak). Human visual review remains PENDING (not a code issue).

## Scope
`ServerSettingsDialog.tsx` (credentialDraftScope, handleSelfRevoked, handleSave guards), `use-login-devices.ts`, `login-devices-owner.ts`, `LoginDevicesSection.tsx` (prop wiring), `login-devices-connections.test.tsx`, `ServerSettingsDialog.test.tsx` additions; contracts.md frontend + "clear only revoked draft" clause; prior `review-frontend.md` F1/F2.

## F1 (dialog draft survives self-revoke, Save rewrites revoked token) — RESOLVED
- `ServerSettingsDialog.tsx:121-131` `handleSelfRevoked(owner)`: guards = scope exists, `credentialDraftScopeRef.current === credentialDraftScope` (closure scope is the live incarnation), `profileId`+`serverUrl` equal, `owner.token` truthy. Then marks `scope.revokedToken` and blanks draft/initial token **only if equal to the revoked token** (functional `setToken`/`setInitialToken`) → new MFA/login draft C preserved.
- Hook `use-login-devices.ts:88-96`: `onSelfRevoked(captured.owner)` fires on ACK *before* cleanup and independent of `captured.active`/retired state ⇒ draft invalidated even if WS 4401 or a replacement already retired the section, and even if local cleanup throws. Grants no runtime/credential cleanup authority (`completeLoginDeviceSelfRevoke` still requires `isLoginDevicesOwnerCurrent`: token **value** + generation equality, `login-devices-owner.ts:41-46,59-60`).
- Save guard `handleSave:445-465`: only active when `scope.revokedToken` set; requires same scope incarnation (ref), same profile id, `t !== revokedToken`, entry-time stored credential ∈ {null, revoked, t}, and stored credential unchanged since last own write. Re-run: on entry (465), inside every `saveAuthToken` wrapper (459-464, covers all awaits: media revoke before clear/set at 507-525/574-600, legacy 649-709), in restore paths (486, 639: refuse to restore the revoked token or to roll back over a changed credential), and before reconnect/`disconnectProfile` (617) and legacy username/reload (720). `scope` object is mutated in place, so a Save already suspended at `await revokeCurrentMediaSession` sees a later ACK. 
- Lifecycle [TRACE + tests]: unmount/close cleanup nulls ref (`:236`) ⇒ stale closures fail the ref check. Reopen/profile switch creates a new scope object; A→B→A ACK of an older A mutation cannot touch the new incarnation or B (test `a deferred retired A ACK…` switch/reopen/switch-back). TopNav passes a state-held stable `profile` (`TopNav.tsx:211`), so the `[open, profile…]` effect does not reset scope spuriously.

## Required behaviors — evidence
| Behavior | Evidence |
|---|---|
| Fresh new MFA C saves when no replacement B | test `preserves a new unsaved MFA challenge/verified…` (`:202-216`): stored null after ACK, Save enabled, saves `new-mfa-token`, connected. Code: `expected===null` branch passes, `t≠revoked`. |
| Replacement B not overwritten/cleared after self ACK / stale Save | `:218-230`: stale MFA draft Save ⇒ "This login changed…", token stays `replacement-b`, generation + socket count unchanged. `:173-187` A ACK after B also 4401: no reconnect/alert. `:139-171` (none/before-ack/after-ack) draft A blanked, Save disabled, B intact, no new sockets. Mid-await ACK (`:273-288`, replacement true/false): `saveAuthToken` fails at resume; B not written/cleared. |
| WS-before-ACK / storage failure clears only A draft | `:139-171` before-ack; `:249-271` real `removeItem` failure: error + Retry cleanup, draft A invalidated (Save disabled), no reconnect, real later 4401 still retires runtime; ambient profile intact (`expectAmbientIntact`). |
| Close/profile A→B→A safe | `:232-247` three variants: new dialog token saved to the right profile, replacement/ambient tokens intact, no alert. Hook cleanup `use-login-devices.ts:34-44` aborts non-retired mutation on close/switch; keeps only same-target self-ACK across credential retirement. |

## F2 (credential authority + real connection coupling unproven) — RESOLVED
- `login-devices-connections.test.tsx` mocks only `fetch` and `WebSocket` (`FakeWebSocket`); `connections.ts`, `server-config.ts`, profile subscriber, 4401 handler, dialog and section are production. Fetch mock discriminates by **URL+bearer** (`:98-128`) so ambient/draft/replacement tokens return different bodies ⇒ wrong-token regression fails on content. `revokeSelf` asserts exact DELETE URL/method, `credentials:"omit"`, `Authorization: Bearer token-a` (`:78-80`); dialog test asserts list `Authorization: Bearer saved-credential` + URL with unsaved URL/ambient selection (`ServerSettingsDialog.test.tsx:~389-436`).
- 4401-before-DELETE-ACK uses real `socket.close(4401)`; assertions on final snapshot status/authCode, generation, socket count, token value — discriminating (not satisfied by test's own mutation as in prior review). DELETE-first path asserts generation+1 exactly (no double disconnect). Meaningful, not vacuous; test comment `:163` documents the prior defect each assertion catches.
- Fixture rebind (parent) edited `LoginDevicesSection.test.tsx` (only file newer than capture evidence per mtime check; test-only). Full UI 339 files/3131 tests PASS reported by parent.

## Residual findings (non-blocking)
1. **LOW — URL-change Save + concurrent self-ACK: misleading message, URL not rolled back.** [TRACE] Post-ACK `scope.revokedToken` set while Save with changed URL is suspended at `revokeCurrentMediaSession` (previous token A stored): resume → `saveAuthToken(null)` fails ownership (stored null ≠ expected A) → `restoreProfileState` returns false (guard `:486`) → `clearPreviousProfileToken` overwrites error with "…server URL was not changed" (`:520-522`) though `updateProfile` already persisted the new URL. Token is already cleared by cleanup ⇒ no credential carried across URL, no leak. Requires self-revoke ACK landing inside that await. Fix if desired: distinct message when ownership fails post-`updateProfile`.
2. **LOW — conservative block mid-Save:** same race with a fresh draft C is rejected ("reopen settings") rather than saved; fail-safe, covered by test `:273`.
3. **INFO — pre-ACK window:** plain WS 4401 (no ACK yet) leaves draft A in dialog (pre-existing for any 4401); Save then writes dead A. Only guarded after ACK/`revokedToken`. Outside contract clause ("on acknowledged self-revocation").
4. **INFO — post-persist ownership recheck** (`:617`, `:720`) can show "login changed" after profile/token were already saved (`onSaved` already called). Only reachable when `revokedToken` set; no security impact.
5. Earlier optional F3-F7 unchanged; none are regressions. `isLoginDevicesOwnerRetired` still used for post-ACK gating, safety rests on value+generation equality in `isLoginDevicesOwnerCurrent` (verified).

## Test/validation status (reported, not re-run)
- Fresh target: connections 15, ServerSettingsDialog 9, auth-client 32, browser 2, build/lint/typecheck clean, E2E 1 + full app 11, cookie boundary regression 1 (per `review-fixes-validation.md`); parent full UI 339/3131 pass after fixture rebind.
- Honest caveat: last test-only edit (`LoginDevicesSection.test.tsx`) post-dates E2E captures/evidence (`evidence.json` 05:26:47) → can change evidence fingerprint but not runtime; production sources last modified 05:04 (before image/captures). Initial 7 ignored Rust / 4 skipped browser / 170 lint warnings recorded as pre-existing. Human review PENDING.

## Unresolved questions
- Is residual #1 message accuracy worth a follow-up? (non-blocking)
- Accept that closing the dialog aborts an in-flight self-revoke DELETE (F5) silently? Self-heals via WS 4401/list reload.
