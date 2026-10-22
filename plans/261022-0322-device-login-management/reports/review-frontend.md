# Frontend review — device login management (packages/ui)

Read-only. Method: code trace of working tree incl. untracked files, `connections.ts`/`server-config.ts` internals, server `auth_sessions.rs` for cookie semantics. No tests/builds run. Claims labelled **[TRACE]** = derived from code reading, not executed.

## Scope
`api/auth-client.ts`+`auth-types.ts`+tests; `organisms/{LoginDevicesSection.tsx,use-login-devices.ts,login-devices-owner.ts,LoginDevicesSection.test.tsx}`; `ServerSettingsDialog.tsx`+test diff; `browser-tests/login-devices.browser.tsx`; `e2e/device-login-management/*`; `e2e/fixtures/application-services.ts`.

## Verdict
No Critical/High. 1 Medium product defect, 1 Medium test-quality gap, 5 Low, 1 Info. Core fences (saved-profile authority, owner/generation/token equality, abort, storage-failure recovery, no ambient mutation) hold under trace. Fix F1 + F2 before merge; rest optional.

## Validated OK (evidence)
- **Bearer + credentials omit**: `auth-client.ts:561-567` `credentials:"omit"`, `cache:"no-store"`, `Authorization` only if token; no cookie fallback. Test `auth-client.test.ts:~330` asserts `credentials:"omit"`, headers exact, cursor/ID escaping.
- **Transport allowlist** `auth-client.ts:534-552`: parsed `URL`; https, or http+`localhost`/`[::1]`/`127.x`; rejects userinfo/search/hash. WHATWG parser normalises `127.1`, hex/octal IPv4 to dotted form, so regex is safe; `localhost.evil.test`, `127.0.0.1.evil` fall through → fail closed. Tests cover remote http, `localhost.evil.test`, userinfo, 3 loopback forms.
- **DTO boundary** `:576-613`: every row validated (id non-empty, nullable UA, strict RFC3339 UTC + calendar round-trip, bool `current`), nextCursor null|non-empty string, whole page rejected on one bad row; rows re-projected (extra fields dropped). DELETE requires exactly 204.
- **Saved authority** `LoginDevicesSection.tsx:10-12`, `login-devices-owner.ts:19-32`: only `profileId` crosses from dialog; URL/token/authType re-read from `getProfiles()`/`getAuthToken(id)`; legacy mode captures active id once at mount; `profile:null` → no owner. Draft URL/token never used (dialog test `ServerSettingsDialog.test.tsx:389` URL assertion).
- **Guards** `isLoginDevicesOwnerCurrent` (`:34-39`) = profile exists + URL + authType + **token value equality** + generation equality; list uses per-load `listId` + abort; revoke blocks list loads; stale success/error/finally all gated by `current()`.
- **Storage-failure recovery** `completeLoginDeviceSelfRevoke:52-68`, hook `:83-98,101-111`: clear first, verify via `getAuthToken`, throw → `cleanupRequired`, row kept, "Retry local cleanup" re-runs exact-owner cleanup; no list reload. Test `:189-214` injects real `removeItem` failure.
- **No ambient/global mutation**: only `clearAuthToken(profileId)` + `disconnectProfile(profileId)` (the same pair as `ServerProfilesDialog.handleLogout:157-158`). No `clearAuthUsername`, no reload, no active-profile change. No TanStack Query ⇒ no secrets in keys.
- **Real subscriber interplay [TRACE]**: `clearAuthToken` → `notifyProfileChange({type:"dataChanged"})` → in-process `connections.ts:889` subscriber runs synchronously: stored token (null) ≠ WsTransport token ⇒ `disconnectProfile` (gen++) + `login-required`. Hence `completeLoginDeviceSelfRevoke:62-65` generation check skips second disconnect (no double disconnect). The hook's effect cleanup runs later (React flush), after `revoke()` finished — no mid-call abort. In storage-failure case stored token still equals transport token ⇒ subscriber no-ops ⇒ `cleanupRequired` survives.
- **4401 order [TRACE]**: `handleDrop:294-325` gen++, `clearAuthToken`, then `login-required`+`AUTH_REQUIRED` all synchronous before React renders; owner derivation sees final state.

## Findings

### F1 — MEDIUM — Dialog draft token survives self-revoke; Save writes it back
- **Where**: `ServerSettingsDialog.tsx:198` (draft `token` set only on open/test/MFA/logout), `:416,:550,:657` (`setAuthToken(t, …)` on Save), `:567-575` (disconnect+connect). Section mounted `:1007-1010` with no callback. Existing `handleLogout` explicitly does `setToken("")` (`:734`); the new self-revoke path does not.
- **Repro [TRACE]**: open settings for logged-in profile P (autoConnect on) → Login devices → "This session" → End this login → ack → storage token cleared, section shows "Log in and save…" → click **Save** (e.g. rename) without re-login. `t`=revoked token ≠ "" and no URL change ⇒ `setAuthToken(revoked, P)`, `disconnectProfile`, `connectProfile` with dead token ⇒ 4401 ⇒ login-required churn. Worse: if another tab/flow stored replacement token B meanwhile, Save overwrites B with revoked A (data loss). Advisor note: it does not regain access (token dead server-side); harm is credential churn/overwrite, not privilege.
- **Fix**: `onSelfRevoked` prop from section (called after `completeLoginDeviceSelfRevoke` succeeds) → dialog `setToken("")`, `setInitialToken("")`. Optionally in Save: skip write when `t === initialToken` and stored token differs.
- **Test**: ServerSettingsDialog test: self-revoke then Save ⇒ `getAuthToken(id)` stays null and no `connectProfile`.
- **Disposition**: fix before merge.

### F2 — MEDIUM (test quality) — credential authority and real connection coupling unproven
- `LoginDevicesSection.test.tsx` and new dialog tests never assert `Authorization` (grep: zero hits). Hook→client token wiring (`use-login-devices.ts:52,80`) is unpinned: a regression to ambient `getAuthToken()` (token-b) or a dialog draft token would pass. Only URL asserted (`ServerSettingsDialog.test.tsx:~409`).
- Section tests use profiles with identical URL (`b={...a}`, line 21), so ambient-profile URL mixing is invisible there; token header assertion is the only discriminator.
- `@/api/connections.js` fully mocked (`:13-17`): real `handleDrop` ordering and profile-change subscriber (gen++ inside `clearAuthToken`) are not exercised; test `:189` simulates the bump inside mock `disconnect`, not inside the clear. E2E covers real path but nondeterministically (which of WS-4401/DELETE wins is not controlled).
- `:133-149` WS-before-DELETE, `replacement=false`: `getAuthToken("a")===null` is satisfied by the test's own `clearAuthToken("a")` (`:141`), not production. Only `replacement=true` (replacement token survives) and `signal.aborted===false` are discriminating.
- **Fix**: assert `Authorization` on list/DELETE calls (a→token-a while b active; unsaved draft token ≠ used); add one integration test with real `connections.ts` + fake WS transport firing 4401 before DELETE resolves (final state login-required, no reconnect, no spurious alert, replacement login intact).
- **Disposition**: add before merge (cheap).

### F3 — LOW — `isLoginDevicesOwnerRetired` is broader than its name but harmless; branch is near-dead
- **Advisor race A→replace B→B login-required→A DELETE completes [TRACE]**: retired(A) is true (token null, `login-required/AUTH_REQUIRED`, gen > gA, same URL/authType). Post-await `use-login-devices.ts:81-86` proceeds: sets `selfAcknowledged` on dead capture, calls `completeLoginDeviceSelfRevoke(A)` → `isLoginDevicesOwnerCurrent(A)` false (token null ≠ A) → returns; `current()` false → returns; `finally` no `setState`. B's capture is separate. **No consumer-visible effect; no replacement/other-profile mutation.** When B is live, retired is false and DELETE completion returns at `:82`.
- Retired predicate only affects (a) skipping `abort()` at cleanup `:34-36` (request already sent; abort vs not is observably identical: aborted result is swallowed) and (b) redundant post-await check. Safety rests entirely on the token/generation equality in `isLoginDevicesOwnerCurrent` (token **value**, verified). Advisor-noted: it is not a generation-only fence.
- **Recommend**: delete retired branch (simplify) or rename `isRetiredOwnerLogin` + comment; add test "A→B→B 4401→A DELETE 204/503": no alert, B/null token unchanged, no disconnect. Test `:143` (`aborted===false`) pins the dead branch; update if removed.
- **Disposition**: optional cleanup; do not treat as bug.

### F4 — LOW — HTTP LAN profiles: permanent error with useless Retry
- `LoginDevicesSection.tsx:34-38` shows Retry for every error incl. `UNSAFE_AUTH_TRANSPORT`. Allowlist is stricter than `ws-transport.ts` (bearer on any http); standard LAN/systemd HTTP deployment (README 4801/4802) gets message "requires HTTPS or loopback HTTP" + Retry that cannot succeed. Conforms to contract; UX only.
- **Fix**: no Retry for `UNSAFE_AUTH_TRANSPORT`/`INCOMPATIBLE_PROTOCOL`; document in user guide.

### F5 — LOW — Silent cancellation of pending DELETE; list reset on generation churn
- `use-login-devices.ts:30-38`: dialog close/unmount or any generation/token change aborts pending mutation (non-retired) with no message. Reconnect (offline→connecting bumps generation, `connections.ts:448-449`) also resets rows/pagination to page 1 and, mid-revoke, drops the DELETE silently (server may or may not have processed). Self-heals via list reload / 4401.
- **Fix** (optional): keep mutation alive across non-credential generation bumps or surface "Request cancelled"; at minimum refresh after cancelled mutation.
- Also: DELETE 404 (session expired/pruned) shows "Try revoking the login again" forever; offer Refresh hint.

### F6 — LOW — initial render flashes "No active logins found" **[INFERENCE]**
- `use-login-devices.ts:9-14` initial `loading:false` with live owner until effect sets true; `visible` fallback only covers owner mismatch. Likely invisible when mounted from a click (sync passive flush) but not guaranteed. Init `loading: Boolean(owner && ready)`.

### F7 — LOW (test strength)
- `login-devices.browser.tsx:23-38`: one row ⇒ `list.clientHeight<=256` is trivially true; bounded scroll with overflow rows (e.g. 12) and scrollability not exercised. Final DELETE URL/method unasserted.
- Repeated-cursor guard (`use-login-devices.ts:54`) untested. `cache:"no-store"` unasserted.
- `ServerSettingsDialog.test.tsx:326,374` now filter out `/api/auth/sessions` calls: acceptable but hides new background fetch order; prefer explicit expectation of the extra list call.
- Token held in hook React state (`state.owner.token`) — in-memory only, same exposure as existing app state; not a finding.

### F8 — INFO — cookie semantics (parent doc, phase step 8)
- `credentials:"omit"` ⇒ browser ignores server `Set-Cookie` clear on self-revoke (`auth_sessions.rs:120-127`). Server prefers Bearer (`auth.rs:150-161`), so a leftover revoked cookie is inert when bearer present. But `ServerSettingsDialog.handleLogout` still posts `/logout` with `credentials:"include"` (`:718`) and **no bearer** once the token is cleared ⇒ cookie-authenticated; may end whatever session the browser cookie maps to (pre-existing, newly reachable right after self-revoke). Parent must document transport decision; changing logout is out of scope here.
- Self-revoke + Save pending interaction: if Save re-writes the revoked token while DELETE is in flight, owner looks current again and cleanup clears it — benign (dead token), but note fence is value-based.

## App spec adjustment (E2E)
- `device-login-management.spec.ts:79-82`: after `setViewportSize(320)`, asserts `section` count 0 then reopens. Verified `TopNav.tsx`, `ServerSettingsDialog` unchanged for lifecycle (git status: no TopNav change; dialog diff = section mount only). So spec adapts to existing breakpoint-remount without production change — **acceptable, covers desktop (list/marker/cancel/foreign 404/sibling token) and 320 (overflow, focus, button bounds, revoke other, self warning, self revoke)**.
- Caveats: (1) `toHaveCount(0)` pins an incidental behavior (dialog closing on breakpoint cross); replace with `expect.poll` for the section/dialog to be reopenable or drop the assertion. (2) Desktop checks do not re-run after resize (list/current marker at 320 only via screenshot, `Unknown browser/client` not re-asserted). (3) Self-revoke asserts "Log in and save…" + `/api/projects` 401 only; no assertion on stored-token removal, WS non-reconnect, or stale-draft Save (F1). (4) Fixture `args[args.length-1]` assumes username is last arg in both Mongo/SQLite arrays — true in both branches today (`application-services.ts:~200-222`), fragile.
- Evidence dir (`evidence.json` 04:26:22, spec 04:26:09) is consistent with last spec edit; human visual review PENDING (`review.md`).

## Recommended actions (priority)
1. F1: `onSelfRevoked` → clear dialog draft/initial token; regression test.
2. F2: Authorization assertions + real-connections 4401-before-DELETE integration test.
3. F3: simplify/pin retired race (optional).
4. F4/F5: non-retry UX for unsafe transport; cancelled-mutation feedback (optional).
5. Parent: document cookie decision (F8), keep human visual review item open.

## Checks not executed
All tests/builds/lint (instructed). Findings F1/F3/F5/F6 are static traces; F1 is quick to confirm with the proposed dialog test.

## Unresolved questions
- Is permanent unavailability on HTTP-LAN profiles (F4) an accepted product decision? Contract text says "secure bearer transport rules" only.
- Should `handleLogout` after self-revoke be left with cookie-include behavior (F8)?
